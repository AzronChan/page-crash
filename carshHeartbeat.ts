
import { on } from './event';

function getTabIdSafe() {
  try {
    var exist = sessionStorage.getItem('__sentry_tab_id__');
    if (exist) return exist;
    var id = Date.now() + '-' + Math.random().toString(36).slice(2);
    sessionStorage.setItem('__sentry_tab_id__', id);
    return id;
  } catch (e) {
    return Date.now() + '-' + Math.random().toString(36).slice(2);
  }
}

export class CrashHeartbeat {
  private timer: ReturnType<typeof setInterval> | null = null;
  tabId: string;
  private heartbeatIntervalMs: number = 5000;

  constructor(opts: {
    heartbeatIntervalMs: number;
    timeoutMs: number;
    checkIntervalMs: number;
    fetch: { url: string; [k: string]: any };
    swUrl?: string;
    swScope: string;
  }) {
    const { heartbeatIntervalMs, timeoutMs, checkIntervalMs, swUrl, swScope } = opts;
    this.tabId = getTabIdSafe();
    this.heartbeatIntervalMs = heartbeatIntervalMs;
    // 如果没有swUrl，卸载当前service worker
    if (!swUrl) {
      try {
        navigator.serviceWorker.ready.then((registration) => {
          registration.unregister();
        });
      } catch {}
      return;
    }

    const swRegUrl = swUrl;
    navigator.serviceWorker.register(swRegUrl, { scope: swScope }).catch((err) => {
      console.warn('[sw] register failed', err);
    });

    navigator.serviceWorker.ready.then(() => {
      try {
        this.postToSW({ type: 'config', timeoutMs, checkIntervalMs });
        this.setReportParams(opts.fetch);
        this.start();
        on('beforeunload', this.normalExit);
        on('visibilitychange', () => {
          if (document.visibilityState === 'hidden') {
            return this.normalExit();
          } else if (document.visibilityState === 'visible') {
            this.start();
          }
        });
        on('pagehide', this.normalExit);
        on('pageshow', () => {
          this.start();
        });
      } catch (err) {
        console.warn('setupSWTabHeartbeat failed', err);
      }
    });
  }

  setReportParams(params: { url: string; [k: string]: any }) {
    this.postToSW({
      type: 'fetch-config',
      ...params
    });
  }

  postToSW(msg: { type: string; [key: string]: any }) {
    if (!navigator.serviceWorker.controller) {
      return;
    }
    navigator.serviceWorker.controller.postMessage(msg);
  }

  start() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.timer = setInterval(() => {
      this.postToSW({ type: 'heartbeat', tabId: this.tabId, ts: Date.now() });
    }, this.heartbeatIntervalMs);
    this.postToSW({ type: 'heartbeat', tabId: this.tabId, ts: Date.now() });
  }

  normalExit() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    try {
      this.postToSW({
        type: 'exit',
        tabId: this.tabId,
        ts: Date.now()
      });
    } catch (e) {
      console.warn('CrashHeartbeat normalExit error', e);
    }
  }
}
