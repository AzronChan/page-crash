/**
 * CrashHeartbeatMonitor
 *
 * 功能：
 * - 多标签页心跳：当前标签页每隔 `heartbeatIntervalMs` 向 localStorage 写入心跳记录（含页面与 tabId）。
 * - 正常退出标记：在 beforeunload/pagehide/visibilitychange 时尽量写入心跳并标记 normalExit，避免误报。
 * - 异常补偿：通过 `checkPreviousAbnormalExit(timeoutMs)` 检查“其他标签页”的最后心跳；
 *   当其未标记正常退出且距今超过 `timeoutMs`，触发 `onAbnormalExit` 回调，上报“上一会话异常终止”。
 *
 * 设计取舍：
 * - 阈值控制由调用方决定，避免在库内强绑定，兼顾不同业务场景的误报/漏报权衡。
 * - 不在 constructor 中执行副作用，统一在 `init()` 中启动心跳与可选的立即检查。
 */
export interface CrashHeartbeatOptions {
  heartbeatIntervalMs?: number; // 心跳写入间隔
  onAbnormalExit?: (data: AbnormalExitPayload) => void; // 异常终止回调
}

interface HeartbeatRecord {
  ts: number;
  page: string;
  normalExit?: boolean;
  meta?: Record<string, any>;
  tabId: string;
}

const KEY = '__session_heartbeat__';
const TAB_ID_KEY = '__session_tab_id__';

export interface AbnormalExitPayload extends HeartbeatRecord {
  diff: number;
}

export class CrashHeartbeatMonitor {
  private heartbeatIntervalMs: number;
  private stopTimer: (() => void) | null = null;
  private onAbnormalExit?: (data: AbnormalExitPayload) => void;

  constructor(opts: CrashHeartbeatOptions = {}) {
    this.heartbeatIntervalMs = opts.heartbeatIntervalMs ?? 3000;
    this.onAbnormalExit = opts.onAbnormalExit;
    // 心跳间隔可能超过this.heartbeatIntervalMs，比如主线程阻塞，页面隐藏等各种情况
    this.checkAbnormalExit(this.heartbeatIntervalMs * 2);
    this.stopTimer = this.startSessionHeartbeat(this.heartbeatIntervalMs);
  }

  stop() {
    if (this.stopTimer) {
      try {
        this.stopTimer();
      } catch {}
      this.stopTimer = null;
    }
  }

  private getTabId(): string {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const exist = sessionStorage.getItem(TAB_ID_KEY);
      if (exist) return exist;
      sessionStorage.setItem(TAB_ID_KEY, id);
      return id;
    } catch {
      return id;
    }
  }

  private loadAll(): Record<string, HeartbeatRecord> {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as Record<string, HeartbeatRecord>) : {};
    } catch {
      return {};
    }
  }
  private saveAll(map: Record<string, HeartbeatRecord>) {
    try {
      localStorage.setItem(KEY, JSON.stringify(map));
    } catch {}
  }
  private writeHeartbeat(rec: Omit<HeartbeatRecord, 'ts' | 'tabId'>) {
    const tabId = this.getTabId();
    const map = this.loadAll();
    map[tabId] = { ...map[tabId], ...rec, ts: Date.now(), tabId };
    this.saveAll(map);
  }
  private markNormalExit() {
    const tabId = this.getTabId();
    const map = this.loadAll();
    if (map[tabId]) {
      map[tabId].normalExit = true;
      this.saveAll(map);
    }
  }
  private clearTabHeartbeat(tabId?: string) {
    const id = tabId || this.getTabId();
    const map = this.loadAll();
    if (map[id]) {
      delete map[id];
      this.saveAll(map);
    }
  }

  private startSessionHeartbeat(intervalMs: number) {
    const page = `${window.location.pathname}${window.location.hash || ''}`;
    let timer: number | undefined;
    const beat = () => {
      this.writeHeartbeat({
        page,
        meta: undefined,
        normalExit: false
      });
    };
    beat();
    // @ts-ignore
    timer = setInterval(beat, intervalMs);

    // 不一定会触发，比如浏览器关闭等
    const beforeUnload = () => {
      this.markNormalExit();
      if (timer) clearInterval(timer as any);
      this.clearTabHeartbeat();
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('visibilitychange', visibilityHandler);
      window.removeEventListener('pagehide', pageHideHandler);
    };

    const visibilityHandler = () => {
      if (document.visibilityState === 'hidden') beat();
      // todo 页面关闭触发
      this.markNormalExit();
      if (timer) clearInterval(timer as any);
      this.clearTabHeartbeat();
    };

    const pageHideHandler = () => beat();

    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('visibilitychange', visibilityHandler);
    window.addEventListener('pagehide', pageHideHandler);

    return () => {
      if (timer) clearInterval(timer as any);
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('visibilitychange', visibilityHandler);
      window.removeEventListener('pagehide', pageHideHandler);
    };
  }

  /**
   *  检查当前标签页之外的标签页是否有异常退出的会话
   * @param timeoutMs
   */
  public checkAbnormalExit(timeoutMs: number) {
    const now = Date.now();
    const currentTab = this.getTabId();
    const map = this.loadAll();
    let changed = false;
    Object.values(map).forEach((rec) => {
      if (!rec || rec.tabId === currentTab) return;
      const diff = now - (rec.ts || 0);

      if (!rec.normalExit && diff > timeoutMs) {
        // 当崩溃关闭时，normalExit 为 false 或 undefined
        // diff > timeoutMs 主要是为了当多开页面时，正常的页面心跳时间一直在滚动更新，计算diff后不会少于timeoutMs，防止误报
        // diff > timeoutMs 判断有个弊端，当用户崩溃前，刚好设了一个时间戳，并且用户马上打开一个新标签页，这时diff可能还没超过timeoutMs，这种极端情况会漏报

        this.reportPreviousSession(rec, diff);
        delete map[rec.tabId];
        changed = true;
      } else if (rec.normalExit) {
        delete map[rec.tabId];
        changed = true;
      }
    });
    if (changed) this.saveAll(map);
  }

  private reportPreviousSession(rec: HeartbeatRecord, diff: number) {
    if (!this.onAbnormalExit) return;
    this.onAbnormalExit({ ...rec, diff });
  }
}

export default CrashHeartbeatMonitor;
