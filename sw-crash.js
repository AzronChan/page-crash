/* Minimal Service Worker for tab heartbeat crash detection */
/* global self */

const SW_VERSION = "sentry-crash-detector-v1.0.0";

function now() {
  return Date.now();
}

self.addEventListener("install", () => {
  console.log("[sw] install", SW_VERSION);
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  console.log("[sw] activate", SW_VERSION);
  event.waitUntil(self.clients.claim());
});

// Track last tab heartbeat to detect page crash
const tabLastBeat = new Map();
let crashCheckTimer = null;
function ensureCrashChecker() {
  if (crashCheckTimer) return;
  crashCheckTimer = setInterval(async () => {
    console.log(
      "%c [ tabLastBeat ]-20",
      "font-size:13px; background:pink; color:#bf2c9f;",
      tabLastBeat
    );
    const nowTs = now();
    for (const [tabId, { ts }] of tabLastBeat.entries()) {
      if (nowTs - ts > 15000) {
        // 15s without heartbeat => consider crashed
        console.warn(
          "[sw] detected possible page crash",
          tabId,
          "diff=",
          nowTs - ts
        );
        sendSentry();
        // Optionally remove to avoid repeated notifications; or keep and debounce
        tabLastBeat.delete(tabId);
      }
    }
  }, 3000);
}

let sentry = {};
function setSentryParams(params) {
  sentry = { ...sentry, ...params };
}

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "sentry") {
    // Accept config from page: { dsn, env, release, user }
    setSentryParams(data);
    return;
  }

  if (data.type === "exit") {
    const tabId = data.tabId || "unknown";
    if (tabLastBeat.has(tabId)) tabLastBeat.delete(tabId);
    return;
  }

  if (data.type === "heartbeat") {
    // 收到来自页面的心跳
    const tabId = data.tabId || "unknown";
    tabLastBeat.set(tabId, { ts: now() });
    ensureCrashChecker();
    console.log(
      "[sw] heartbeat",
      tabId,
      new Date(data.ts || now()).toISOString()
    );
  }
});

// 组装 Sentry 报错数据
function buildSentryStoreUrl(dsn) {
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\//, "");
    const publicKey = u.username; // DSN username is public key
    const host = u.host;
    if (!projectId || !publicKey || !host) return null;
    return `${u.protocol}//${host}/api/${projectId}/store/?sentry_key=${publicKey}&sentry_version=7`;
  } catch {
    return null;
  }
}

function sendSentry() {
  if (!sentry.dsn) {
    return;
  }

  const url = buildSentryStoreUrl(sentry.dsn);
  if (url) {
    const payload = Object.assign(
      {},
      {
        level: "error",
        logger: "sw-crash-detector",
        message: `message: crash`,
        event_id: uuid4(),
        timestamp: Date.now() / 1000,
        platform: "javascript",
      },
      sentry
    );
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  }
}

function uuid4() {
  // lightweight uuid v4
  return "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx".replace(/[x]/g, () =>
    ((Math.random() * 16) | 0).toString(16)
  );
}


