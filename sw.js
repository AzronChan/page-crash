const SW_VERSION = 'sentry-crash-detector-v1.0.0';

function now() {
  return Date.now();
}

const tabLastBeat = new Map();

let crashCheckTimer = null;
let CRASH_TIMEOUT_MS = 15000; // 默认：15s 未收到心跳视为崩溃
let CHECK_INTERVAL_MS = 3000; // 默认：3s 检查一次
function ensureCrashChecker() {
  if (crashCheckTimer) return;
  crashCheckTimer = setInterval(async () => {
    const nowTs = now();
    for (const [tabId, { ts }] of tabLastBeat.entries()) {
      if (nowTs - ts > CRASH_TIMEOUT_MS) {
        // 15s without heartbeat => consider crashed
        console.warn('[sw] detected possible page crash', tabId, 'diff=', nowTs - ts);
        sendReport();
        tabLastBeat.delete(tabId);
        checkStopTimer();
      }
    }
  }, Math.max(500, CHECK_INTERVAL_MS));
}

function checkStopTimer() {
  const tabLastBeatSize = tabLastBeat.size;
  if (tabLastBeatSize === 0 && crashCheckTimer) {
    clearInterval(crashCheckTimer);
    crashCheckTimer = null;
  }
}

let fetchConfig = {};
function setFetchConf(params) {
  fetchConfig = { ...fetchConfig, ...params };
}

function sendReport() {
  if (!fetchConfig.url) {
    return;
  }
  fetch(fetchConfig.url, { ...fetchConfig, body: JSON.stringify(fetchConfig.body) }).catch(() => {});
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'fetch-config') {
    setFetchConf(data);
    return;
  }

  if (data.type === 'config') {
    if (typeof data.timeoutMs === 'number') CRASH_TIMEOUT_MS = data.timeoutMs;
    if (typeof data.checkIntervalMs === 'number') CHECK_INTERVAL_MS = data.checkIntervalMs;
    // 重启检查定时器以应用新配置
    if (crashCheckTimer) {
      clearInterval(crashCheckTimer);
      crashCheckTimer = null;
    }
    ensureCrashChecker();
    return;
  }

  if (data.type === 'exit') {
    const tabId = data.tabId || 'unknown';
    if (tabLastBeat.has(tabId)) tabLastBeat.delete(tabId);
    checkStopTimer();
    return;
  }

  if (data.type === 'heartbeat') {
    // 收到来自页面的心跳
    const tabId = data.tabId || 'unknown';
    tabLastBeat.set(tabId, { ts: now() });
    ensureCrashChecker();
  }
});
