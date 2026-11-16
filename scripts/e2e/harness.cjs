/**
 * E2E harness for the DeepSeek chat bundle.
 *
 * This module is the only place that knows how to get a browser onto the real
 * DSH Web GUI: it mints the `dsh-auth-*` cookie from the credentials file, boots
 * a dedicated headless Chrome on port 9224, talks CDP to the page, and exposes a
 * small `steps` vocabulary that check files use.
 *
 *   const { openPage } = require('./harness.cjs');
 *   const session = await openPage();      // Chrome up, page booted, settings seeded
 *   await session.steps.openPanel();       // click the sidebar entry
 *   await session.steps.shot('panel');     // docs/e2e/panel.png
 *   await session.close();                 // browser and profile left in place
 *
 * Security: the credentials file is read here and nowhere else. The API key is
 * put in `process.env.DEEPSEEK_API_KEY`, seeded into the page's localStorage and
 * never returned, printed, or written to disk by this tool. The throwaway Chrome
 * profile is the only place it persists; `close()` best-effort blanks it again.
 *
 * Node 22+ is required (global `WebSocket` + `fetch`).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

/* ------------------------------------------------------------------ paths */

const ROOT = path.resolve(__dirname, '..', '..');
const DOCS_DIR = path.join(ROOT, 'docs', 'e2e');

const GUI = process.env.DSH_E2E_GUI || 'http://127.0.0.1:55160';
const AUTHORITY = new URL(GUI).host;
const CDP_PORT = Number(process.env.DSH_E2E_CDP_PORT || 9224);
const CHROME = process.env.DSH_E2E_CHROME
  || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE_DIR = process.env.DSH_E2E_PROFILE
  || path.join(os.tmpdir(), 'dsh-e2e-profile');
const CREDENTIALS = process.env.DSH_E2E_CREDENTIALS
  || path.join(os.homedir(), '.dsh', '.credentials.yaml');

const SETTINGS_KEY = 'dsh.deepseekChat.settings.v1';
const CONVERSATIONS_KEY = 'dsh.deepseekChat.conversations.v1';
/** The vendored chat-demo keeps its own localStorage keys (the panel UI reads these). */
const DEMO_KEYS = {
  apiKey: 'chat-demo:api-key',
  locale: 'chat-demo:locale',
  theme: 'chat-demo:theme-preference',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  ttsVoice: 'chat-demo:tts-voice',
  apiBaseUrl: 'chat-demo:api-base-url',
  thinkingEffort: 'chat-demo:thinking-effort',
};
/** Root of the new panel UI (the vendored demo lives inside it). */
const HOST_SELECTOR = '.dsc-demo-host';
/** IndexedDB database the demo stores conversations in. */
const DEMO_DB = 'chat-demo';
const COOKIE_LIFETIME_MS = 12 * 60 * 60 * 1000;

const VIEWPORT = { width: 1440, height: 900 };
const DEFAULT_TIMEOUT = 20000;

/* --------------------------------------------------------------- utilities */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** base64url without padding, the encoding DSH uses for its cookie. */
function b64url(buffer) {
  return Buffer.from(buffer).toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/** Minimal indent-based YAML map reader; only map structures are needed here. */
function parseSimpleYaml(text) {
  const root = {};
  const stack = [{ indent: -1, node: root }];
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim() || /^\s*#/.test(rawLine)) continue;
    const indent = rawLine.match(/^\s*/)[0].length;
    const line = rawLine.trim();
    if (line.startsWith('- ')) continue; // list items are not used by this file
    const colon = line.indexOf(':');
    if (colon < 1) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (value.startsWith('#')) value = '';
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].node;
    if (value === '') {
      const child = {};
      parent[key] = child;
      stack.push({ indent, node: child });
    } else {
      const quoted = (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"));
      parent[key] = quoted ? value.slice(1, -1) : value;
    }
  }
  return root;
}

/**
 * Read the credentials file. Returns the raw secret and the DeepSeek key; the
 * caller decides what to do with them. Nothing here is logged.
 */
function readCredentials() {
  if (!fs.existsSync(CREDENTIALS)) {
    throw new Error('缺少凭证文件: ' + CREDENTIALS);
  }
  const doc = parseSimpleYaml(fs.readFileSync(CREDENTIALS, 'utf8'));
  const apiKey = doc.refs && doc.refs.DEEPSEEK_API_KEY;
  const record = doc.records && doc.records['client-connection/browser-session'];
  const secret = record && record.payload && record.payload.secret;
  if (typeof apiKey !== 'string' || !apiKey) {
    throw new Error('凭证文件缺少 refs.DEEPSEEK_API_KEY');
  }
  if (typeof secret !== 'string' || !secret) {
    throw new Error('凭证文件缺少 records["client-connection/browser-session"].payload.secret');
  }
  const secretBytes = Buffer.from(secret, 'base64url');
  if (secretBytes.length !== 32) {
    throw new Error('browser-session secret 解码后应为 32 字节，实际 ' + secretBytes.length);
  }
  return { apiKey, secret, secretBytes };
}

/**
 * Mint the `dsh-auth-*` cookie DSH expects.
 *
 * name  = 'dsh-auth-' + base64url(sha256(authority))
 * value = 'v1.' + body + '.' + base64url(hmacSha256(secret, body))
 * body  = base64url(JSON {version, authority, issuedAt, expiresAt})
 *
 * @param {{ now?: number, secretBytes?: Buffer, authority?: string }} [options]
 */
function signCookie(options) {
  const now = (options && options.now) || Date.now();
  const authority = (options && options.authority) || AUTHORITY;
  const secretBytes = (options && options.secretBytes)
    || readCredentials().secretBytes;
  const body = b64url(Buffer.from(JSON.stringify({
    version: 1,
    authority,
    issuedAt: now - 60 * 1000,
    expiresAt: now + COOKIE_LIFETIME_MS,
  }), 'utf8'));
  const signature = b64url(crypto.createHmac('sha256', secretBytes).update(body, 'utf8').digest());
  const name = 'dsh-auth-' + b64url(crypto.createHash('sha256').update(authority).digest());
  return { name, value: 'v1.' + body + '.' + signature, expires: now + COOKIE_LIFETIME_MS };
}

/* ------------------------------------------------------------- CDP client */

class Cdp {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.eventSink = null;
    this.closed = false;
  }

  static async connect(url, timeoutMs) {
    const client = new Cdp(url);
    await client.open(timeoutMs || 10000);
    return client;
  }

  open(timeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { this.ws.close(); } catch (error) { /* ignore */ }
        reject(new Error('CDP WebSocket 连接超时: ' + this.url));
      }, timeoutMs);
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.addEventListener('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.closed = false;
        resolve();
      });
      ws.addEventListener('error', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error('CDP WebSocket 连接失败: ' + this.url));
      });
      ws.addEventListener('close', () => {
        this.closed = true;
        for (const pending of this.pending.values()) {
          pending.reject(new Error('CDP 连接已关闭（' + pending.method + '）'));
        }
        this.pending.clear();
      });
      ws.addEventListener('message', (event) => {
        this.onMessage(event.data);
      });
    });
  }

  onMessage(data) {
    let message;
    try {
      const text = typeof data === 'string' ? data : Buffer.from(data).toString('utf8');
      message = JSON.parse(text);
    } catch (error) {
      return;
    }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new Error(pending.method + ': ' + message.error.message));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    const set = this.listeners.get(message.method);
    if (set) {
      for (const handler of Array.from(set)) {
        try { handler(message.params); } catch (error) { /* a listener must not break the socket */ }
      }
    }
    if (this.eventSink) {
      try { this.eventSink(message.method, message.params); } catch (error) { /* ignore */ }
    }
  }

  send(method, params, timeoutMs) {
    const timeout = timeoutMs || 60000;
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new Error('CDP 已关闭，无法发送 ' + method));
        return;
      }
      const id = this.nextId;
      this.nextId += 1;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('CDP 调用超时（' + Math.round(timeout / 1000) + 's）: ' + method));
      }, timeout);
      this.pending.set(id, { resolve, reject, method, timer });
      try {
        this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error('CDP 发送失败（' + method + '）: ' + error.message));
      }
    });
  }

  on(method, handler) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(handler);
    return () => {
      const set = this.listeners.get(method);
      if (set) set.delete(handler);
    };
  }

  waitEvent(method, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error('等待页面事件超时: ' + method));
      }, timeoutMs || DEFAULT_TIMEOUT);
      const off = this.on(method, (params) => {
        clearTimeout(timer);
        off();
        resolve(params);
      });
    });
  }

  close() {
    this.closed = true;
    try { this.ws && this.ws.close(); } catch (error) { /* ignore */ }
  }
}

/* ------------------------------------------------------------ Chrome layer */

const state = {
  chrome: null,
  page: null,
  session: null,
};

/** Poll the CDP version endpoint; resolves null while Chrome is not ready. */
async function cdpVersion(timeoutMs) {
  try {
    const response = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version', {
      signal: AbortSignal.timeout(timeoutMs || 1000),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    return null;
  }
}

async function cdpList() {
  const response = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/list', {
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error('读取 /json/list 失败: HTTP ' + response.status);
  return await response.json();
}

/** PIDs listening on the CDP port, from netstat; only used as a last resort. */
function portOwners(port) {
  try {
    const result = spawnSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0 || !result.stdout) return [];
    const pids = new Set();
    for (const line of result.stdout.split(/\r?\n/)) {
      if (!line.includes(':' + port)) continue;
      if (!/LISTENING/i.test(line)) continue;
      const match = line.trim().match(/(\d+)\s*$/);
      if (match) pids.add(Number(match[1]));
    }
    return Array.from(pids);
  } catch (error) {
    return [];
  }
}

async function killPortOwners() {
  for (const pid of portOwners(CDP_PORT)) {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  }
}

/** Close a Chrome left over from an interrupted run, then wait for the port. */
async function clearStaleChrome() {
  const version = await cdpVersion(700);
  if (!version) return;
  try {
    const browser = await Cdp.connect(version.webSocketDebuggerUrl, 5000);
    await browser.send('Browser.close', {}, 5000).catch(() => {});
    browser.close();
  } catch (error) { /* fall through to the port owner path */ }
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (!(await cdpVersion(400))) return;
    await sleep(100);
  }
  await killPortOwners();
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (!(await cdpVersion(400))) return;
    await sleep(100);
  }
  throw new Error('端口 ' + CDP_PORT + ' 被其它进程占用，无法启动 E2E Chrome');
}

async function launchChrome() {
  if (!fs.existsSync(CHROME)) throw new Error('找不到 Chrome: ' + CHROME);
  await clearStaleChrome();
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const args = [
    '--headless=new',
    '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=' + PROFILE_DIR,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-sync',
    '--mute-audio',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=' + VIEWPORT.width + ',' + VIEWPORT.height,
    '--lang=zh-CN',
    '--remote-allow-origins=*',
    'about:blank',
  ];
  const child = spawn(CHROME, args, { stdio: 'ignore', windowsHide: true });
  state.chrome = child;
  child.once('exit', () => {
    if (state.chrome === child) state.chrome = null;
  });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await cdpVersion(1000)) return;
    if (child.exitCode !== null) {
      throw new Error('Chrome 启动即退出（exit=' + child.exitCode + '），检查端口 ' + CDP_PORT + ' 与用户目录');
    }
    await sleep(150);
  }
  throw new Error('Chrome 在 30s 内没有暴露 CDP 端口 ' + CDP_PORT);
}

async function connectPage() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const targets = await cdpList();
      const target = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
      if (target) return await Cdp.connect(target.webSocketDebuggerUrl, 10000);
    } catch (error) { /* Chrome may still be starting */ }
    await sleep(200);
  }
  throw new Error('没有找到可用的 CDP 页面目标（/json/list）');
}

/** Ask Chrome to shut down; fall back to taskkill if it refuses. */
async function stopChrome() {
  const child = state.chrome;
  const version = await cdpVersion(700);
  if (version) {
    try {
      const browser = await Cdp.connect(version.webSocketDebuggerUrl, 5000);
      await browser.send('Browser.close', {}, 5000).catch(() => {});
      browser.close();
    } catch (error) { /* ignore */ }
  }
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (!(await cdpVersion(400))) {
      break;
    }
    await sleep(150);
  }
  // Chrome may still be winding down child processes after Browser.close; make
  // sure the process tree we started is really gone before returning.
  if (child && child.pid && child.exitCode === null) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  }
  await killPortOwners();
  await sleep(300);
  state.chrome = null;
}

/* ------------------------------------------------------------- page layer */

/** Build the step vocabulary for one open page. */
function createSteps(page, options) {
  const settings = { defaultShotName: (options && options.shotName) || 'screenshot' };
  const pageErrors = [];

  // Log renderer errors for failure diagnostics; values are never printed.
  page.on('Runtime.exceptionThrown', (params) => {
    const detail = params && params.exceptionDetails;
    const text = (detail && (detail.exception && detail.exception.description || detail.text)) || 'exception';
    pageErrors.push(String(text).split('\n')[0].slice(0, 300));
    if (pageErrors.length > 20) pageErrors.shift();
  });
  page.on('Log.entryAdded', (params) => {
    const entry = params && params.entry;
    if (entry && entry.level === 'error') {
      pageErrors.push('console: ' + String(entry.text || '').slice(0, 300));
      if (pageErrors.length > 20) pageErrors.shift();
    }
  });
  page.on('Runtime.consoleAPICalled', (params) => {
    if (!params || params.type !== 'error') return;
    const text = (params.args || []).map((arg) => {
      if (arg.value !== undefined) return String(arg.value);
      if (arg.description) return String(arg.description);
      return arg.type || '';
    }).join(' ').slice(0, 300);
    if (text) pageErrors.push('console: ' + text);
    if (pageErrors.length > 20) pageErrors.shift();
  });

  /** Run an async function or expression inside the page and return its value. */
  async function evaluate(fnOrExpression, args) {
    const list = args || [];
    let expression;
    if (typeof fnOrExpression === 'function') {
      expression = '(' + fnOrExpression.toString() + ').apply(null, ' + JSON.stringify(list) + ')';
    } else {
      expression = String(fnOrExpression);
    }
    const result = await page.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails;
      const message = (detail.exception && detail.exception.description)
        || detail.text
        || '页面内执行出错';
      throw new Error('页面内执行出错: ' + String(message).split('\n').slice(0, 3).join(' | '));
    }
    return result.result ? result.result.value : undefined;
  }

  /** Navigate and wait until the document is complete. */
  async function navigate(url) {
    const loaded = page.waitEvent('Page.loadEventFired', 40000).catch(() => null);
    const result = await page.send('Page.navigate', { url }, 40000);
    if (result.errorText) throw new Error('导航失败: ' + result.errorText + ' (' + url + ')');
    await loaded;
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const ready = await evaluate('document.readyState');
      if (ready === 'complete') return;
      await sleep(100);
    }
    throw new Error('页面在 20s 内没有加载完成: ' + url);
  }

  /** Reload the current document, bypassing the cache. */
  async function reload() {
    const loaded = page.waitEvent('Page.loadEventFired', 40000).catch(() => null);
    await page.send('Page.reload', { ignoreCache: true }, 40000);
    await loaded;
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const ready = await evaluate('document.readyState');
      if (ready === 'complete') return;
      await sleep(100);
    }
    throw new Error('页面在 20s 内没有重新加载完成');
  }

  /**
   * Seed the demo's localStorage settings (and the legacy plugin keys, so any
   * older check still finds them), clear the demo's IndexedDB conversations and
   * reload. The API key comes from the environment; the returned object never
   * contains it.
   */
  async function seedSettings(overrides) {
    if (!process.env.DEEPSEEK_API_KEY) {
      process.env.DEEPSEEK_API_KEY = readCredentials().apiKey;
    }
    const options = overrides || {};
    const demo = {
      apiKey: process.env.DEEPSEEK_API_KEY,
      locale: options.locale || 'zh-CN',
      theme: options.theme || 'system',
      thinking: options.thinking === undefined ? false : Boolean(options.thinking),
      search: options.search === undefined ? false : Boolean(options.search),
      ttsVoice: options.ttsVoice || 'stella',
      apiBaseUrl: options.apiBaseUrl === undefined ? '' : String(options.apiBaseUrl),
      thinkingEffort: options.thinkingEffort || 'high',
    };
    const reloadAfter = options.__noReload !== true;
    const storage = {
      demo: {
        [DEMO_KEYS.apiKey]: demo.apiKey,
        [DEMO_KEYS.locale]: demo.locale,
        [DEMO_KEYS.theme]: demo.theme,
        [DEMO_KEYS.thinking]: String(demo.thinking),
        [DEMO_KEYS.search]: String(demo.search),
        [DEMO_KEYS.ttsVoice]: demo.ttsVoice,
        [DEMO_KEYS.apiBaseUrl]: demo.apiBaseUrl,
        [DEMO_KEYS.thinkingEffort]: demo.thinkingEffort,
      },
      legacy: JSON.stringify({
        apiKey: demo.apiKey,
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-flash',
        thinking: 'off',
        webSearch: false,
        voice: 'stella',
        location: '',
      }),
    };

    // Clear the demo IndexedDB before the reload so every check starts empty.
    // Only open the existing database: opening a missing one would create it at
    // version 1 without the stores the app expects.
    const cleared = await evaluate((keys, host, dbName, legacySettingsKey, legacyConversationsKey, legacySettings) => {
      return new Promise((resolve) => {
        try {
          for (const key of Object.keys(window.localStorage)) {
            if (key.indexOf('chat-demo:') === 0) window.localStorage.removeItem(key);
          }
          for (const [key, value] of Object.entries(keys)) {
            if (value === null) window.localStorage.removeItem(key);
            else window.localStorage.setItem(key, value);
          }
          window.localStorage.removeItem(legacyConversationsKey);
          window.localStorage.setItem(legacySettingsKey, legacySettings);
        } catch (error) {
          resolve('storage-error');
          return;
        }
        const finish = async () => {
          try {
            const databases = indexedDB.databases ? await indexedDB.databases() : [];
            if (!databases.some((item) => item.name === dbName)) {
              resolve('absent');
              return;
            }
            const request = indexedDB.open(dbName);
            request.onerror = () => resolve('open-error');
            request.onsuccess = () => {
              const db = request.result;
              const names = ['sessions', 'sessionSummaries', 'files', 'sessionsStaging', 'filesStaging']
                .filter((name) => db.objectStoreNames.contains(name));
              if (!names.length) {
                db.close();
                resolve('empty');
                return;
              }
              const tx = db.transaction(names, 'readwrite');
              for (const name of names) tx.objectStore(name).clear();
              tx.oncomplete = () => {
                db.close();
                resolve('cleared');
              };
              tx.onerror = () => {
                db.close();
                resolve('clear-error');
              };
            };
          } catch (error) {
            resolve('error');
          }
        };
        void finish();
        return undefined;
      });
    }, [storage.demo, HOST_SELECTOR, DEMO_DB, SETTINGS_KEY, CONVERSATIONS_KEY, storage.legacy]);

    if (reloadAfter) await reload();
    return {
      locale: demo.locale,
      theme: demo.theme,
      thinking: demo.thinking,
      search: demo.search,
      thinkingEffort: demo.thinkingEffort,
      apiBaseUrl: demo.apiBaseUrl,
      apiKeyLength: demo.apiKey.length,
      cleared,
    };
  }

  /** Write/refresh just the demo API key (still never returned). */
  async function seedDemoKey() {
    if (!process.env.DEEPSEEK_API_KEY) {
      process.env.DEEPSEEK_API_KEY = readCredentials().apiKey;
    }
    await evaluate((key, value) => {
      try {
        window.localStorage.setItem(key, value);
        return true;
      } catch (error) {
        return false;
      }
    }, [DEMO_KEYS.apiKey, process.env.DEEPSEEK_API_KEY]);
    return { length: process.env.DEEPSEEK_API_KEY.length };
  }

  /** Click a selector after scrolling it into view; throws when it is missing. */
  async function clickSelector(selector) {
    const clicked = await evaluate((sel) => {
      const element = document.querySelector(sel);
      if (!element) return false;
      element.scrollIntoView({ block: 'center', inline: 'center' });
      element.click();
      return true;
    }, [selector]);
    if (!clicked) throw new Error('点击失败，选择器不存在: ' + selector);
    await sleep(80);
  }

  /** Click the smallest visible element whose text matches; used for the entry. */
  async function clickText(pattern, options) {
    const source = pattern instanceof RegExp ? pattern.source : String(pattern);
    const flags = pattern instanceof RegExp ? pattern.flags : 'i';
    const exact = Boolean(options && options.exact);
    const scoped = (options && options.selector) || 'body';
    const result = await evaluate((scopeSelector, textSource, textFlags, exactMatch) => {
      const scope = document.querySelector(scopeSelector) || document.body;
      const regex = new RegExp(textSource, textFlags);
      const candidates = Array.from(scope.querySelectorAll(
        'button, [role="button"], a, [tabindex], li, div',
      ));
      let best = null;
      for (const node of candidates) {
        const raw = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
        if (!raw) continue;
        const hit = exactMatch ? raw === textSource : regex.test(raw);
        if (!hit) continue;
        const rect = node.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) continue;
        if (node.offsetParent === null && getComputedStyle(node).position !== 'fixed') continue;
        const area = rect.width * rect.height;
        if (!best || area < best.area) best = { node, area, text: raw.slice(0, 120) };
      }
      if (!best) return { ok: false };
      best.node.scrollIntoView({ block: 'center' });
      best.node.click();
      return { ok: true, text: best.text };
    }, [scoped, source, flags, exact]);
    if (!result || !result.ok) throw new Error('找不到文本匹配的可点击元素: ' + source);
    await sleep(80);
    return result.text;
  }

  /** Click the DSH sidebar entry that opens the chat panel. */
  async function clickEntry() {
    return await clickText(/DeepSeek\s*(?:对话|chat)/i, { selector: 'body' });
  }

  /** Wait for the entry to show up, click it, then wait for the demo host. */
  async function openPanel() {
    if (await evaluate((selector) => Boolean(document.querySelector(selector)), [HOST_SELECTOR])) {
      return 'already-open';
    }
    await waitFor(() => {
      const text = document.body ? (document.body.innerText || '') : '';
      return /DeepSeek\s*(?:对话|chat)/i.test(text);
    }, { timeout: 30000, label: '侧栏出现「DeepSeek 对话」入口' });
    const label = await clickEntry();
    await waitForSelector(HOST_SELECTOR, { timeout: 30000, label: '面板根节点 ' + HOST_SELECTOR });
    return label;
  }

  /** Focus an input, replace its value, and verify the DOM took it. */
  async function typeText(selector, text) {
    const focused = await evaluate((sel) => {
      const element = document.querySelector(sel);
      if (!element) return false;
      element.focus();
      if (typeof element.select === 'function') element.select();
      return document.activeElement === element;
    }, [selector]);
    if (!focused) throw new Error('找不到可聚焦的输入框: ' + selector);
    await page.send('Input.insertText', { text }, 15000);
    await sleep(80);
    let value = await evaluate((sel) => {
      const element = document.querySelector(sel);
      return element ? element.value : null;
    }, [selector]);
    if (value !== text) {
      // React-controlled inputs need the native setter plus an input event.
      await evaluate((sel, wanted) => {
        const element = document.querySelector(sel);
        if (!element) return false;
        const proto = element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(element, wanted);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }, [selector, text]);
      value = await evaluate((sel) => {
        const element = document.querySelector(sel);
        return element ? element.value : null;
      }, [selector]);
    }
    if (value !== text) throw new Error('输入内容没有写入 ' + selector + '（当前长度 ' + String(value || '').length + '）');
  }

  /** Click the demo's send button (aria-label is localized) when it is ready. */
  async function send() {
    const selector = 'button[aria-label="发送"], button[aria-label="Send"]';
    await waitFor((sel) => {
      const button = document.querySelector(sel);
      if (!button) return false;
      return button.getAttribute('aria-disabled') !== 'true' && !button.disabled;
    }, { timeout: 8000, label: '发送按钮可点击' }, [selector]);
    await clickSelector(selector);
  }

  /** Poll an in-page predicate (optionally with args) until it is truthy. */
  async function waitFor(predicate, waitOptions, args) {
    const timeout = (waitOptions && waitOptions.timeout) || DEFAULT_TIMEOUT;
    const interval = (waitOptions && waitOptions.interval) || 150;
    const label = (waitOptions && waitOptions.label) || '条件成立';
    const deadline = Date.now() + timeout;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        const value = await evaluate(predicate, args);
        if (value) return value;
      } catch (error) {
        lastError = error;
      }
      await sleep(interval);
    }
    throw new Error('等待超时（' + timeout + 'ms）: ' + label + (await diagnostics(lastError)));
  }

  async function waitForSelector(selector, waitOptions) {
    return await waitFor((sel) => {
      const element = document.querySelector(sel);
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }, Object.assign({ label: '元素可见: ' + selector }, waitOptions || {}), [selector]);
  }

  /** Failure diagnostics: url, title, readyState, and a short visible-text sample. */
  async function diagnostics(lastError) {
    try {
      const info = await evaluate(() => ({
        url: location.href,
        title: document.title,
        ready: document.readyState,
        text: (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').trim().slice(0, 240),
      }));
      const parts = ['url=' + info.url, 'ready=' + info.ready];
      if (info.title) parts.push('title=' + JSON.stringify(info.title));
      if (info.text) parts.push('text=' + JSON.stringify(info.text));
      if (lastError) parts.push('lastError=' + lastError.message);
      return '\n    诊断: ' + parts.join(' · ');
    } catch (error) {
      return '';
    }
  }

  /** Screenshot the viewport (or the full page) into docs/e2e/<name>.png. */
  async function shot(name, shotOptions) {
    const base = name || settings.defaultShotName;
    const file = path.join(DOCS_DIR, base.endsWith('.png') ? base : base + '.png');
    fs.mkdirSync(DOCS_DIR, { recursive: true });
    const params = { format: 'png', fromSurface: true };
    if (shotOptions && shotOptions.fullPage) {
      params.captureBeyondViewport = true;
    } else {
      params.captureBeyondViewport = false;
    }
    const result = await page.send('Page.captureScreenshot', params, 30000);
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
    return file;
  }

  /** Screenshot a single element by selector. */
  async function shotSelector(selector, name) {
    const rect = await evaluate((sel) => {
      const element = document.querySelector(sel);
      if (!element) return null;
      element.scrollIntoView({ block: 'center' });
      const box = element.getBoundingClientRect();
      return { x: box.x + window.scrollX, y: box.y + window.scrollY, width: box.width, height: box.height };
    }, [selector]);
    if (!rect || rect.width < 1 || rect.height < 1) {
      throw new Error('截图失败，元素不存在或不可见: ' + selector);
    }
    const file = path.join(DOCS_DIR, (name || settings.defaultShotName) + '.png');
    fs.mkdirSync(DOCS_DIR, { recursive: true });
    const result = await page.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: true,
      clip: {
        x: Math.max(0, Math.round(rect.x)),
        y: Math.max(0, Math.round(rect.y)),
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
        scale: 1,
      },
    }, 30000);
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
    return file;
  }

  /** Network throttling; `throttle(null)` restores full speed. */
  async function throttle(config) {
    const settingsForNetwork = config === null || config === undefined
      ? { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }
      : {
        offline: Boolean(config.offline),
        latency: Math.max(0, Number(config.latency) || 0),
        downloadThroughput: config.downloadThroughput === undefined ? -1 : config.downloadThroughput,
        uploadThroughput: config.uploadThroughput === undefined ? -1 : config.uploadThroughput,
      };
    await page.send('Network.emulateNetworkConditions', settingsForNetwork);
  }

  /** Resize the emulated viewport. */
  async function metrics(width, height) {
    const size = typeof width === 'object'
      ? width
      : { width: width || VIEWPORT.width, height: height || VIEWPORT.height };
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: size.width,
      height: size.height,
      deviceScaleFactor: size.deviceScaleFactor || 1,
      mobile: Boolean(size.mobile),
    });
  }

  /** Read the trimmed innerText of one element (null when missing). */
  async function text(selector) {
    const value = await evaluate((sel) => {
      const element = document.querySelector(sel);
      return element ? (element.innerText || '').trim() : null;
    }, [selector]);
    return value;
  }

  /** Read an input's value (null when missing). */
  async function value(selector) {
    return await evaluate((sel) => {
      const element = document.querySelector(sel);
      return element ? element.value : null;
    }, [selector]);
  }

  async function exists(selector) {
    return Boolean(await evaluate((sel) => Boolean(document.querySelector(sel)), [selector]));
  }

  async function count(selector) {
    return await evaluate((sel) => document.querySelectorAll(sel).length, [selector]);
  }

  /** Set a cookie through CDP; only the auth cookie helper is used by default. */
  async function setCookie(name, cookieValue, cookieOptions) {
    const optionsForCookie = Object.assign({
      url: GUI,
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
      expires: Math.floor((Date.now() + COOKIE_LIFETIME_MS) / 1000),
    }, cookieOptions || {});
    const result = await page.send('Network.setCookie', Object.assign(
      { name, value: String(cookieValue) }, optionsForCookie,
    ));
    if (result && result.success === false) {
      throw new Error('Network.setCookie 被拒绝: ' + name);
    }
  }

  /** In-page console and exception messages captured since this page opened. */
  function consoleErrors() {
    return pageErrors.slice(-10);
  }

  return {
    /* lifecycle */
    page,
    evaluate,
    eval: evaluate,
    navigate,
    reload,
    seedSettings,
    seedDemoKey,
    /* interactions */
    clickSelector,
    clickText,
    clickEntry,
    openPanel,
    typeText,
    send,
    /* waiting */
    wait: sleep,
    waitFor,
    waitForSelector,
    /* evidence */
    shot,
    shotSelector,
    /* page helpers */
    text,
    value,
    exists,
    count,
    /* environment */
    throttle,
    metrics,
    setCookie,
    consoleErrors,
    get shotName() { return settings.defaultShotName; },
    set shotName(next) { settings.defaultShotName = next; },
  };
}

/* -------------------------------------------------------------- public API */

/**
 * Boot Chrome, sign in, load the GUI and seed the plugin settings.
 *
 * @param {{ width?: number, height?: number, settings?: object, shotName?: string, skipSeed?: boolean }} [options]
 * @param {boolean} [options.skipSeed] leave localStorage/IndexedDB untouched (read/verify existing data)
 * @returns {Promise<{ steps: object, page: Cdp, chrome: object, close: Function }>}
 */
async function openPage(options) {
  const config = options || {};
  if (state.session) await state.session.close();

  if (config.freshProfile) {
    // Cold profile: no cookies, no localStorage and no key at rest afterwards.
    await clearStaleChrome();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
        break;
      } catch (error) {
        await sleep(300); // Chrome may still be releasing files
      }
    }
  }

  await launchChrome();
  const page = await connectPage();
  state.page = page;

  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Network.enable');
  await page.send('Log.enable').catch(() => {});
  await page.send('Network.setCacheDisabled', { cacheDisabled: true }).catch(() => {});
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: config.width || VIEWPORT.width,
    height: config.height || VIEWPORT.height,
    deviceScaleFactor: 1,
    mobile: false,
  });

  // Sign in before the first navigation so the GUI never renders the login page.
  const cookie = signCookie();
  const cookieResult = await page.send('Network.setCookie', {
    name: cookie.name,
    value: cookie.value,
    url: GUI,
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'Lax',
    expires: Math.floor(cookie.expires / 1000),
  });
  if (cookieResult && cookieResult.success === false) {
    throw new Error('登录 cookie 被浏览器拒绝（' + cookie.name + '）');
  }

  const steps = createSteps(page, { shotName: config.shotName });
  await steps.navigate(GUI);
  // A wrong cookie lands on the login screen; fail loudly instead of mid-check.
  const login = await steps.evaluate(() => {
    const text = (document.body ? document.body.innerText : '').replace(/\s+/g, ' ');
    const href = location.href;
    const hasAuthForm = Boolean(document.querySelector('input[type="password"], form[action*="login"]'));
    return {
      href,
      loginLike: hasAuthForm || /(登录|sign in|log in|未授权|unauthorized)/i.test(text),
      hasEntry: /DeepSeek\s*(?:对话|chat)/i.test(text),
    };
  });
  if (login.loginLike && !login.hasEntry) {
    throw new Error('cookie 未通过 DSH 鉴权（落在登录页）: url=' + login.href);
  }

  const seeded = config.skipSeed
    ? null
    : await steps.seedSettings(config.settings);
  const session = {
    steps,
    page,
    chrome: state.chrome,
    seeded,
    close: async () => {
      try {
        // Best effort: do not leave the key sitting in the throwaway profile.
        await steps.evaluate((keys) => {
          try {
            window.localStorage.removeItem(keys.demoKey);
            const raw = window.localStorage.getItem(keys.legacyKey);
            if (raw) {
              const data = JSON.parse(raw);
              data.apiKey = '';
              window.localStorage.setItem(keys.legacyKey, JSON.stringify(data));
            }
            return true;
          } catch (error) {
            return false;
          }
        }, [{ demoKey: DEMO_KEYS.apiKey, legacyKey: SETTINGS_KEY }]);
        // Give the DOM storage write a moment to reach disk before Chrome exits.
        await sleep(300);
      } catch (error) { /* page may already be gone */ }
      const closing = state.session;
      state.session = null;
      if (closing && closing.page) closing.page.close();
      state.page = null;
      await stopChrome();
      if (config.freshProfile) {
        // Remove the profile so the seeded key does not survive on disk.
        for (let attempt = 0; attempt < 8; attempt += 1) {
          try {
            fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
            break;
          } catch (error) {
            await sleep(300);
          }
        }
      }
    },
  };
  state.session = session;
  return session;
}

/** Close the browser started by the last `openPage()`. Safe to call twice. */
async function close() {
  if (state.session) {
    await state.session.close();
    return;
  }
  await stopChrome();
}

// Never leave a headless Chrome behind when this process dies unexpectedly.
process.once('exit', () => {
  if (!state.chrome || !state.chrome.pid) return;
  try {
    spawnSync('taskkill', ['/PID', String(state.chrome.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } catch (error) { /* nothing left to do while exiting */ }
});

module.exports = {
  openPage,
  close,
  /* exposed for the cookie probe and future checks */
  signCookie,
  readCredentials,
  parseSimpleYaml,
  b64url,
  /* constants */
  ROOT,
  DOCS_DIR,
  GUI,
  AUTHORITY,
  CDP_PORT,
  CHROME,
  PROFILE_DIR,
  CREDENTIALS,
  SETTINGS_KEY,
  CONVERSATIONS_KEY,
  DEMO_KEYS,
  DEMO_DB,
  HOST_SELECTOR,
  VIEWPORT,
};
