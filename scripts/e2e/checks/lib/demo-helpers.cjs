/**
 * Shared helpers for the checks that drive the vendored chat-demo UI.
 *
 * The new panel is the upstream demo, so the stable handles are its accessible
 * names (aria-label / role / visible copy) and its IndexedDB database rather
 * than the old plugin's `.dsc-*` classes. Lives under checks/lib/ so run.cjs
 * does not load it as a check.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DEMO_KEYS, DEMO_DB, HOST_SELECTOR } = require('../../harness.cjs');

const HOST = HOST_SELECTOR;
const SETTINGS_DIALOG = HOST + ' [role="dialog"]';
const ASSISTANT_CONTENT = '.ds-assistant-message-main-content';
const SEND_LABEL = '发送';
const SEND_LABEL_EN = 'Send';

const FIXTURES_DIR = path.resolve(__dirname, '..', '..', 'fixtures');
const VALIDATOR = path.join(FIXTURES_DIR, 'validate-official-backup.cjs');

/** Absolute path of one fixture archive. */
function fixture(name) {
  const file = path.join(FIXTURES_DIR, 'fixtures', name);
  if (!fs.existsSync(file)) throw new Error('缺少 fixture: ' + file);
  return file;
}

/** Text of every visible toast (role=status cards). */
async function toastTexts(ctx) {
  return await ctx.steps.eval(() => Array.from(document.querySelectorAll('[role="status"]'))
    .map((node) => (node.innerText || '').replace(/\s+/g, ' ').trim())
    .filter((text) => text && !/加载|图表|正在/.test(text)));
}

async function waitToast(ctx, pattern, timeout) {
  return await ctx.steps.waitFor((source, flags) => {
    const regex = new RegExp(source, flags);
    return Array.from(document.querySelectorAll('[role="status"]'))
      .map((node) => (node.innerText || '').replace(/\s+/g, ' ').trim())
      .find((text) => regex.test(text)) || '';
  }, { timeout: timeout || 15000, label: '出现提示 ' + pattern }, [pattern.source, pattern.flags]);
}

/** Real mouse click at an element's centre (trusted social gesture). */
async function trustedClick(ctx, selector) {
  const box = await ctx.steps.eval((sel) => {
    const element = document.querySelector(sel);
    if (!element) return null;
    element.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: rect.width };
  }, [selector]);
  if (!box || box.width < 1) throw new Error('找不到可点击元素: ' + selector);
  await ctx.page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, button: 'none', buttons: 0 });
  await ctx.page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1 });
  await ctx.page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', buttons: 0, clickCount: 1 });
  await ctx.steps.wait(120);
}

/** Click the smallest visible element whose text matches (panel scoped). */
async function clickByText(ctx, pattern, selector) {
  const source = pattern instanceof RegExp ? pattern.source : String(pattern);
  const flags = pattern instanceof RegExp ? pattern.flags : 'i';
  const scope = selector || HOST;
  const clicked = await ctx.steps.eval((scopeSel, textSource, textFlags) => {
    const root = document.querySelector(scopeSel);
    if (!root) return null;
    const regex = new RegExp(textSource, textFlags);
    let best = null;
    for (const node of root.querySelectorAll('button, [role="button"], [role="tab"], [role="option"], [role="radio"], a, div')) {
      const raw = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
      if (!raw || !regex.test(raw)) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      if (node.offsetParent === null && getComputedStyle(node).position !== 'fixed') continue;
      const area = rect.width * rect.height;
      if (!best || area < best.area) best = { node, area, text: raw.slice(0, 120) };
    }
    if (!best) return null;
    best.node.click();
    return best.text;
  }, [scope, source, flags]);
  if (!clicked) throw new Error('找不到文本匹配的元素: ' + source);
  await ctx.steps.wait(150);
  return clicked;
}

/** True when the demo host is mounted. */
async function hostReady(ctx) {
  return await ctx.steps.exists(HOST);
}

/** Open the demo settings dialog (sider bottom button). */
async function openSettings(ctx) {
  if (await ctx.steps.exists(SETTINGS_DIALOG)) return 'already-open';
  const opened = await ctx.steps.eval((host) => {
    const root = document.querySelector(host);
    if (!root) return null;
    const buttons = Array.from(root.querySelectorAll('button'));
    const button = buttons.find((item) => (item.innerText || '').trim() === '设置');
    if (!button) return null;
    button.click();
    return 'sider';
  }, [HOST]);
  if (!opened) throw new Error('找不到侧栏「设置」按钮');
  await ctx.steps.waitForSelector(SETTINGS_DIALOG, { timeout: 10000, label: '设置弹窗出现' });
  await ctx.steps.wait(150);
  return opened;
}

/** Press Escape (the demo closes its topmost modal on it). */
async function pressEscape(ctx) {
  await ctx.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await ctx.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await ctx.steps.wait(150);
}

async function closeSettings(ctx) {
  if (!(await ctx.steps.exists(SETTINGS_DIALOG))) return false;
  await pressEscape(ctx);
  await ctx.steps.waitFor((sel) => !document.querySelector(sel), { timeout: 5000, label: '设置弹窗关闭' }, [SETTINGS_DIALOG]);
  return true;
}

/** Switch the settings dialog to one tab (通用设置 / 数据管理, or en labels). */
async function openSettingsTab(ctx, label) {
  await openSettings(ctx);
  const clicked = await ctx.steps.eval((host, wanted) => {
    const root = document.querySelector(host);
    if (!root) return null;
    const tab = Array.from(root.querySelectorAll('[role="tab"]'))
      .find((item) => (item.innerText || '').trim() === wanted);
    if (!tab) return null;
    tab.click();
    return (tab.innerText || '').trim();
  }, [HOST, label]);
  if (!clicked) throw new Error('找不到设置 tab: ' + label);
  await ctx.steps.wait(200);
  return clicked;
}

/** The settings dialog's visible text. */
async function settingsText(ctx) {
  return await ctx.steps.text(SETTINGS_DIALOG);
}

/** Assert one settings cell row exists (by its label text). */
async function hasSettingsRow(ctx, label) {
  return await ctx.steps.eval((host, wanted) => {
    const dialog = document.querySelector(host + ' [role="dialog"]');
    return Boolean(dialog) && (dialog.innerText || '').indexOf(wanted) >= 0;
  }, [HOST, label]);
}

/* ------------------------------------------------------------ chat helpers */

/** Wait until a reply is on screen and the stream has finished. */
async function waitReplyDone(ctx, timeout) {
  await ctx.steps.waitFor((contentSel, label) => {
    const contents = Array.from(document.querySelectorAll(contentSel))
      .map((node) => (node.innerText || '').trim())
      .filter(Boolean);
    const send = document.querySelector('button[aria-label="' + label + '"]');
    return contents.length > 0 && Boolean(send);
  }, { timeout: timeout || 60000, label: '回答完成（发送按钮恢复）' }, [ASSISTANT_CONTENT, SEND_LABEL]);
}

/** Visible reply text (all assistant markdown blocks joined). */
async function replyText(ctx) {
  return await ctx.steps.eval((sel) => Array.from(document.querySelectorAll(sel))
    .map((node) => (node.innerText || '').trim()).filter(Boolean).join('\n'), [ASSISTANT_CONTENT]);
}

/** Visible user bubbles. */
async function userBubbles(ctx) {
  return await ctx.steps.eval(() => Array.from(document.querySelectorAll('[class*="UserMessage_bubble"]'))
    .map((node) => (node.innerText || '').trim()).filter(Boolean));
}

/** Sider session titles, top to bottom (outermost SessionItem node per row). */
async function siderTitles(ctx) {
  return await ctx.steps.eval((host) => {
    const root = document.querySelector(host);
    if (!root) return [];
    return Array.from(root.querySelectorAll('[class*="SessionItem"]'))
      .filter((node) => node.closest('[class*="SessionItem"]') === node)
      .map((node) => (node.innerText || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }, [HOST]);
}

/** Number of session rows in the sider (outermost SessionItem nodes). */
async function siderSessionCount(ctx) {
  return await ctx.steps.eval((host) => {
    const root = document.querySelector(host);
    if (!root) return 0;
    return Array.from(root.querySelectorAll('[class*="SessionItem"]'))
      .filter((node) => node.closest('[class*="SessionItem"]') === node).length;
  }, [HOST]);
}

/** Click one sider session by title substring. */
async function openSession(ctx, title) {
  const clicked = await ctx.steps.eval((host, needle) => {
    const root = document.querySelector(host);
    if (!root) return null;
    const candidates = Array.from(root.querySelectorAll('[class*="SessionItem"] button, [class*="SessionItem"] [role="button"], [class*="SessionItem"] div'))
      .filter((node) => (node.innerText || '').indexOf(needle) >= 0);
    const target = candidates[candidates.length - 1] || null;
    if (!target) return null;
    target.click();
    return (target.innerText || '').replace(/\s+/g, ' ').trim();
  }, [HOST, title]);
  if (!clicked) throw new Error('找不到并打开会话: ' + title);
  await ctx.steps.wait(500);
  return clicked;
}

/** Start a new chat from the sider. */
async function newChat(ctx) {
  await clickByText(ctx, /^开启新对话$|^New chat$/, HOST);
  await ctx.steps.wait(400);
}

/** Type text into the composer textarea and send it. */
async function ask(ctx, text) {
  await ctx.steps.typeText(HOST + ' textarea', text);
  await ctx.steps.send();
}

/** Send without waiting for the reply (for throttled/aborted scenarios). */
async function typeComposer(ctx, text) {
  await ctx.steps.typeText(HOST + ' textarea', text);
}

/* --------------------------------------------------------------- branch UI */

/** Branch switchers currently rendered (aria-label 消息版本). */
async function switchers(ctx) {
  return await ctx.steps.eval(() => Array.from(document.querySelectorAll('[aria-label="消息版本"]'))
    .map((node, index) => ({
      index,
      count: (node.innerText || '').replace(/\s+/g, ' ').trim(),
      previousDisabled: Boolean(node.querySelector('button[aria-label="上一个版本"]')?.disabled),
      nextDisabled: Boolean(node.querySelector('button[aria-label="下一个版本"]')?.disabled),
    })));
}

/** Click one arrow of one switcher (0 = previous, 1 = next). */
async function clickSwitcher(ctx, index, direction) {
  const label = direction < 0 ? '上一个版本' : '下一个版本';
  const clicked = await ctx.steps.eval((at, name) => {
    const switchers = Array.from(document.querySelectorAll('[aria-label="消息版本"]'));
    const switcher = switchers[at];
    if (!switcher) return false;
    const button = switcher.querySelector('button[aria-label="' + name + '"]');
    if (!button || button.disabled) return false;
    button.click();
    return true;
  }, [index, label]);
  if (!clicked) throw new Error('切换版本失败: #' + index + ' ' + label);
  await ctx.steps.wait(400);
}

/* -------------------------------------------------------------- IndexedDB */

/** Read all sessions from the demo IndexedDB (created by the app). */
async function readSessions(ctx) {
  return await ctx.steps.eval(() => new Promise((resolve) => {
    const request = indexedDB.open('chat-demo');
    request.onerror = () => resolve([]);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('sessions')) {
        db.close();
        resolve([]);
        return;
      }
      const tx = db.transaction('sessions', 'readonly');
      const all = tx.objectStore('sessions').getAll();
      all.onsuccess = () => { db.close(); resolve(all.result || []); };
      all.onerror = () => { db.close(); resolve([]); };
    };
  }));
}

/** Read the session summaries stored for the sider. */
async function readSummaries(ctx) {
  return await ctx.steps.eval(() => new Promise((resolve) => {
    const request = indexedDB.open('chat-demo');
    request.onerror = () => resolve([]);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('sessionSummaries')) {
        db.close();
        resolve([]);
        return;
      }
      const tx = db.transaction('sessionSummaries', 'readonly');
      const all = tx.objectStore('sessionSummaries').getAll();
      all.onsuccess = () => { db.close(); resolve(all.result || []); };
      all.onerror = () => { db.close(); resolve([]); };
    };
  }));
}

/** Persist sessions (+ their summaries) directly, then reload into the panel. */
async function seedSessions(ctx, sessions) {
  await ctx.steps.eval((list) => new Promise((resolve, reject) => {
    const request = indexedDB.open('chat-demo');
    request.onerror = () => reject(new Error('打不开 chat-demo IndexedDB'));
    request.onsuccess = () => {
      const db = request.result;
      const names = ['sessions', 'sessionSummaries']
        .filter((name) => db.objectStoreNames.contains(name));
      if (names.length !== 2) {
        db.close();
        reject(new Error('chat-demo IndexedDB 缺少 sessions/sessionSummaries 存储'));
        return;
      }
      const tx = db.transaction(names, 'readwrite');
      for (const session of list) {
        tx.objectStore('sessions').put(session);
        tx.objectStore('sessionSummaries').put({
          id: session.id,
          title: session.title,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          fileIds: [],
        });
      }
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }), [sessions]);
  await ctx.steps.reload();
  await ctx.steps.openPanel();
}

/** Poll IndexedDB until the session count matches (source of truth after import). */
async function waitSummariesCount(ctx, count, timeout) {
  const deadline = Date.now() + (timeout || 25000);
  let latest = -1;
  while (Date.now() < deadline) {
    latest = (await readSummaries(ctx)).length;
    if (latest === count) return latest;
    await ctx.steps.wait(250);
  }
  throw new Error('等待 IndexedDB 会话数为 ' + count + ' 超时（当前 ' + latest + '）');
}

/* --------------------------------------------------------------- ZIP flow */

/** Point Chrome downloads at a throwaway dir. */
async function allowDownloads(ctx, dir) {
  try {
    await ctx.page.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir, eventsEnabled: true });
    return 'Browser.setDownloadBehavior';
  } catch (error) {
    await ctx.page.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
    return 'Page.setDownloadBehavior';
  }
}

/** Wait for one finished download matching the extension. */
async function waitForDownload(dir, extension, timeout) {
  const pattern = extension || /\.(zip)$/i;
  const deadline = Date.now() + (timeout || 25000);
  let lastSize = -1;
  while (Date.now() < deadline) {
    if (fs.existsSync(dir)) {
      const partial = fs.readdirSync(dir).filter((name) => /\.crdownload$/i.test(name));
      const names = fs.readdirSync(dir).filter((name) => pattern.test(name));
      if (!partial.length && names.length) {
        names.sort();
        const file = path.join(dir, names[names.length - 1]);
        const size = fs.statSync(file).size;
        if (size > 0 && size === lastSize) return file;
        lastSize = size;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('等待下载超时: ' + dir);
}

/** Export via 设置 → 数据管理 → 下载 and return { file, bytes }. */
async function exportHistoryZip(ctx, dir) {
  await allowDownloads(ctx, dir);
  await openSettingsTab(ctx, '数据管理');
  await clickByText(ctx, /^下载$|^Download$/, SETTINGS_DIALOG);
  const file = await waitForDownload(dir, /\.zip$/i, 30000);
  return { file, bytes: fs.readFileSync(file) };
}

/** Read the import-confirm dialog state (merge checkbox defaults to checked). */
async function readImportDialogState(ctx) {
  return await ctx.steps.eval((host) => {
    const dialogs = Array.from(document.querySelectorAll(host + ' [role="dialog"]'));
    const dialog = dialogs.find((node) => /确认导入历史对话|Import these conversations/.test(node.innerText || ''));
    if (!dialog) return null;
    const checkbox = dialog.querySelector('input[type="checkbox"]');
    const buttons = Array.from(dialog.querySelectorAll('button')).map((button) => ({
      text: (button.innerText || '').trim(),
      classes: Array.from(button.classList),
    }));
    const main = buttons.find((button) => !/取消|Cancel/.test(button.text)) || null;
    return {
      text: (dialog.innerText || '').replace(/\s+/g, ' ').trim(),
      checkbox: checkbox ? { checked: checkbox.checked } : null,
      buttonText: main ? main.text : '',
      buttonClasses: main ? main.classes : [],
    };
  }, [HOST]);
}

/**
 * Pick a ZIP in 数据管理's hidden import input and wait for the confirm dialog.
 * The selector is the zip-specific input (the composer also has a file input).
 */
async function selectImportFile(ctx, file) {
  await openSettingsTab(ctx, '数据管理');
  await ctx.page.send('DOM.enable');
  const doc = await ctx.page.send('DOM.getDocument', { depth: 1 });
  const found = await ctx.page.send('DOM.querySelector', {
    nodeId: doc.root.nodeId,
    selector: 'input[type="file"][accept*=".zip"]',
  });
  if (!found || !found.nodeId) throw new Error('找不到导入 ZIP 的隐藏 file input');
  await ctx.page.send('DOM.setFileInputFiles', { files: [file], nodeId: found.nodeId });
  await ctx.steps.waitFor((host) => Array.from(document.querySelectorAll(host + ' [role="dialog"]'))
    .some((node) => /确认导入历史对话|Import these conversations/.test(node.innerText || '')),
  { timeout: 15000, label: '导入确认弹窗出现' }, [HOST]);
  const state = await readImportDialogState(ctx);
  if (!state) throw new Error('导入确认弹窗读取失败');
  return state;
}

/**
 * Confirm the import dialog in merge (default) or overwrite mode, then wait for
 * the 已导入 N 个对话 status and close settings. Returns what the dialog showed
 * right before confirming.
 */
async function confirmImport(ctx, merge) {
  const wanted = merge !== false; // product default: merge
  let state = await readImportDialogState(ctx);
  if (!state) throw new Error('导入确认弹窗不存在');
  if (state.checkbox && state.checkbox.checked !== wanted) {
    await ctx.steps.eval((host) => {
      const dialog = Array.from(document.querySelectorAll(host + ' [role="dialog"]'))
        .find((node) => /确认导入历史对话|Import these conversations/.test(node.innerText || ''));
      const checkbox = dialog && dialog.querySelector('input[type="checkbox"]');
      if (checkbox) checkbox.click();
    }, [HOST]);
    await ctx.steps.wait(150);
    state = await readImportDialogState(ctx);
  }
  await clickByText(ctx, wanted ? /^合并导入$|^Merge$|^导入$/ : /^确认导入$|^Import$/, HOST);
  await ctx.steps.waitFor((host) => Array.from(document.querySelectorAll(host + ' [role="dialog"]'))
    .some((node) => /已导入|Imported/.test(node.innerText || '')),
  { timeout: 60000, label: '导入完成提示' }, [HOST]);
  const status = await ctx.steps.eval((host) => {
    const dialogs = Array.from(document.querySelectorAll(host + ' [role="dialog"]'));
    const match = dialogs.map((node) => node.innerText || '').join('\n').match(/已导入[^\n]*/);
    return match ? match[0].trim() : null;
  }, [HOST]);
  await closeSettings(ctx);
  return {
    merge: wanted,
    buttonText: state.buttonText,
    checkboxChecked: state.checkbox ? state.checkbox.checked : null,
    status,
  };
}

/**
 * Import one ZIP via 设置 → 数据管理 → 上传 + confirm. Defaults to merge (the
 * product default); pass { merge: false } to overwrite all existing sessions.
 */
async function importHistoryZip(ctx, file, options) {
  const merge = !options || options.merge !== false;
  await selectImportFile(ctx, file);
  return await confirmImport(ctx, merge);
}

/** 设置 → 数据管理 → 删除 → confirm: wipe every conversation. */
async function deleteAllSessions(ctx) {
  await openSettingsTab(ctx, '数据管理');
  await clickByText(ctx, /^删除$|^Delete$/, SETTINGS_DIALOG);
  await ctx.steps.waitFor((host) => {
    const dialogs = Array.from(document.querySelectorAll(host + ' [role="dialog"]'));
    return dialogs.some((node) => /所有对话都将被清空|Delete every conversation/.test(node.innerText || ''));
  }, { timeout: 10000, label: '删除全部确认弹窗出现' }, [HOST]);
  await clickByText(ctx, /^删除所有对话$|^Delete all conversations$/, HOST);
  await waitToast(ctx, /删除成功|Deleted/i, 20000).catch(() => null);
  await closeSettings(ctx);
}

/** Run the independent validator against one ZIP. */
function validateBackup(file) {
  const result = spawnSync(process.execPath, [VALIDATOR, file], { encoding: 'utf8', windowsHide: true });
  return { status: result.status, stdout: String(result.stdout || ''), stderr: String(result.stderr || '') };
}

/** Parse a ZIP through its central directory (STORE or DEFLATE, data descriptors OK). */
function readZipEntries(bytes) {
  const zlib = require('node:zlib');
  let eocd = -1;
  for (let end = bytes.length - 22; end >= Math.max(0, bytes.length - 22 - 0xffff); end -= 1) {
    if (bytes.readUInt32LE(end) !== 0x06054b50) continue;
    if (end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length) continue;
    eocd = end;
    break;
  }
  if (eocd < 0) throw new Error('不是 ZIP：找不到 EOCD');
  const count = bytes.readUInt16LE(eocd + 10);
  const directorySize = bytes.readUInt32LE(eocd + 12);
  const directoryOffset = bytes.readUInt32LE(eocd + 16);
  const entries = [];
  let cursor = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error('坏的中央目录条目');
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const realSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    cursor += 46 + nameLength + extraLength + commentLength;

    if (bytes.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('坏的本地头: ' + name);
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);
    let data = raw;
    if (method === 8) {
      try {
        data = zlib.inflateRawSync(raw);
      } catch (error) {
        throw new Error('解压失败: ' + name + ' (' + error.message + ')');
      }
    } else if (method !== 0) {
      throw new Error('不支持的压缩方法 ' + method + ': ' + name);
    }
    if (data.length !== realSize) throw new Error('大小不符: ' + name);
    entries.push({ name, method, flags, data });
  }
  if (cursor !== directoryOffset + directorySize) throw new Error('中央目录大小不一致');
  return entries;
}

/* ----------------------------------------------------------- seed builders */

/** Build one linear demo session (native branch fields, no migration needed). */
function buildSession(definition, now) {
  const createdAt = now - 9000;
  const user = {
    id: definition.id + '-u',
    role: 'user',
    content: definition.question,
    files: [],
    createdAt,
    parentId: null,
    selectedChildId: definition.id + '-a',
  };
  const assistant = {
    id: definition.id + '-a',
    role: 'assistant',
    createdAt: createdAt + 500,
    model: 'deepseek-flash',
    thinking: false,
    search: false,
    prefix: false,
    status: 'done',
    blocks: [{ type: 'text', text: definition.answer }],
    parentId: user.id,
  };
  return {
    id: definition.id,
    title: definition.title,
    createdAt,
    updatedAt: createdAt + 1000,
    rootMessageId: user.id,
    messages: [user, assistant],
  };
}

/** The tree a branch edit produces: two root questions + two answers. */
function buildBranchSession(definition, now) {
  const createdAt = now - 6000;
  const nodes = [
    {
      id: 'q-old', role: 'user', content: definition.oldQuestion, files: [],
      createdAt, parentId: null, selectedChildId: 'a-old',
    },
    {
      id: 'a-old', role: 'assistant', createdAt: createdAt + 200,
      model: 'deepseek-flash', thinking: false, search: false, prefix: false,
      status: 'done', blocks: [{ type: 'text', text: definition.oldAnswer }],
      parentId: 'q-old', selectedChildId: undefined,
    },
    {
      id: 'q-new', role: 'user', content: definition.newQuestion, files: [],
      createdAt: createdAt + 2000, parentId: null, selectedChildId: 'a-new',
    },
    {
      id: 'a-new', role: 'assistant', createdAt: createdAt + 2200,
      model: 'deepseek-flash', thinking: false, search: false, prefix: false,
      status: 'done', blocks: [{ type: 'text', text: definition.newAnswer }],
      parentId: 'q-new', selectedChildId: undefined,
    },
  ];
  return {
    id: definition.id,
    title: definition.title,
    createdAt,
    updatedAt: createdAt + 3000,
    rootMessageId: 'q-new',
    messages: nodes,
  };
}

module.exports = {
  HOST,
  SETTINGS_DIALOG,
  ASSISTANT_CONTENT,
  SEND_LABEL,
  SEND_LABEL_EN,
  DEMO_KEYS,
  DEMO_DB,
  fixture,
  VALIDATOR,
  toastTexts,
  waitToast,
  trustedClick,
  clickByText,
  hostReady,
  openSettings,
  closeSettings,
  pressEscape,
  openSettingsTab,
  settingsText,
  hasSettingsRow,
  waitReplyDone,
  replyText,
  userBubbles,
  siderTitles,
  siderSessionCount,
  openSession,
  newChat,
  ask,
  typeComposer,
  switchers,
  clickSwitcher,
  readSessions,
  readSummaries,
  waitSummariesCount,
  seedSessions,
  allowDownloads,
  waitForDownload,
  exportHistoryZip,
  readImportDialogState,
  selectImportFile,
  confirmImport,
  importHistoryZip,
  deleteAllSessions,
  validateBackup,
  readZipEntries,
  buildSession,
  buildBranchSession,
};
