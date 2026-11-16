/**
 * Shared helpers for the backup checks (data-management, official-import,
 * official-export). Lives under checks/lib/ so run.cjs does not load it as a
 * check (it only reads top-level *.cjs files).
 *
 * Everything here talks to the real GUI through ctx.steps / ctx.page; nothing
 * imports from client.js.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { CONVERSATIONS_KEY } = require('../../harness.cjs');

const FIXTURES_DIR = path.resolve(__dirname, '..', '..', 'fixtures');
const VALIDATOR = path.join(FIXTURES_DIR, 'validate-official-backup.cjs');

/** Absolute path of one fixture archive. */
function fixture(name) {
  const file = path.join(FIXTURES_DIR, 'fixtures', name);
  if (!fs.existsSync(file)) throw new Error('缺少 fixture: ' + file);
  return file;
}

/** Real mouse click at an element's centre (trusted user gesture). */
async function trustedClick(ctx, selector) {
  const box = await ctx.steps.eval((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = el.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: rect.width };
  }, [selector]);
  if (!box || box.width < 1) throw new Error('找不到可点击元素: ' + selector);
  await ctx.page.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: box.x, y: box.y, button: 'none', buttons: 0,
  });
  await ctx.page.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1,
  });
  await ctx.page.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: box.x, y: box.y, button: 'left', buttons: 0, clickCount: 1,
  });
  await ctx.steps.wait(120);
  return box;
}

/** Open the settings dialog from the rail footer row (fallback: header gear). */
async function openSettings(ctx) {
  const s = ctx.steps;
  if (await s.exists('.dsc-dialog')) return 'already-open';
  const trigger = await s.eval(() => {
    const rail = document.querySelector('.dsc-railFoot .dsc-row');
    if (rail) { rail.click(); return 'railFoot'; }
    const head = document.querySelectorAll('.dsc-chatHead .dsc-iconButton');
    const gear = head[head.length - 1];
    if (gear) { gear.click(); return 'chatHead'; }
    return null;
  });
  if (!trigger) throw new Error('找不到设置入口（rail 底部行或标题栏齿轮）');
  await s.waitForSelector('.dsc-dialog', { timeout: 10000, label: '设置对话框 .dsc-dialog' });
  return trigger;
}

/** Click the button of the .dsc-dataRow whose text matches; returns its label. */
async function clickDataRowButton(ctx, pattern) {
  const box = await ctx.steps.eval((source, flags) => {
    const regex = new RegExp(source, flags);
    const row = Array.from(document.querySelectorAll('.dsc-dataRow'))
      .find((item) => regex.test(item.innerText || ''));
    if (!row) return null;
    const button = row.querySelector('button');
    if (!button) return null;
    button.scrollIntoView({ block: 'center' });
    const rect = button.getBoundingClientRect();
    return {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
      text: (button.innerText || '').trim(),
      width: rect.width,
    };
  }, [pattern.source, pattern.flags]);
  if (!box || box.width < 1) throw new Error('找不到数据管理按钮: ' + pattern);
  await ctx.page.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: box.x, y: box.y, button: 'none', buttons: 0,
  });
  await ctx.page.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1,
  });
  await ctx.page.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: box.x, y: box.y, button: 'left', buttons: 0, clickCount: 1,
  });
  await ctx.steps.wait(150);
  return box.text;
}

/** Point Chrome's downloads at a throwaway directory. */
async function allowDownloads(ctx, dir) {
  try {
    await ctx.page.send('Browser.setDownloadBehavior', {
      behavior: 'allow', downloadPath: dir, eventsEnabled: true,
    });
    return 'Browser.setDownloadBehavior';
  } catch (error) {
    await ctx.page.send('Page.setDownloadBehavior', {
      behavior: 'allow', downloadPath: dir,
    });
    return 'Page.setDownloadBehavior';
  }
}

/** Wait for one fully written download matching `extension`; returns its path. */
async function waitForDownload(dir, options) {
  const settings = options || {};
  const extension = settings.extension || /\.(zip|json)$/i;
  const timeout = settings.timeout || 25000;
  const deadline = Date.now() + timeout;
  let lastSize = -1;
  while (Date.now() < deadline) {
    if (fs.existsSync(dir)) {
      const partial = fs.readdirSync(dir).filter((name) => /\.crdownload$/i.test(name));
      const names = fs.readdirSync(dir).filter((name) => extension.test(name));
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
  throw new Error('等待下载文件超时: ' + dir);
}

/** Click 导出 and return the downloaded file path + bytes. */
async function exportByDownload(ctx, dir) {
  const behavior = await allowDownloads(ctx, dir);
  const label = await clickDataRowButton(ctx, /导出|Export/);
  const file = await waitForDownload(dir, { extension: /\.zip$/i, timeout: 25000 });
  return { file, bytes: fs.readFileSync(file), behavior, label };
}

/**
 * Put one backup file (official ZIP or legacy JSON) into the hidden import input
 * and confirm the dialog. Waits until both dialogs are gone.
 */
async function importBackupFile(ctx, file) {
  const s = ctx.steps;
  await ctx.page.send('DOM.enable');
  const doc = await ctx.page.send('DOM.getDocument', { depth: 1 });
  const found = await ctx.page.send('DOM.querySelector', {
    nodeId: doc.root.nodeId,
    // The composer attachment input has no zip accept; this one does.
    selector: 'input[type="file"][accept*="zip"]',
  });
  if (!found || !found.nodeId) throw new Error('找不到隐藏的导入 file input');
  await ctx.page.send('DOM.setFileInputFiles', { files: [file], nodeId: found.nodeId });

  await s.waitFor(() => {
    const dialog = document.querySelector('.dsc-dialogBackdrop .dsc-dialog');
    return dialog && /确认导入|Import these conversations/i.test(dialog.innerText || '');
  }, { timeout: 10000, label: '导入确认弹窗出现' });

  await s.clickSelector('.dsc-dialogBackdrop .dsc-dialogFoot button[data-primary="true"]');
  await s.waitFor(() => !document.querySelector('.dsc-overlay')
    && !document.querySelector('.dsc-dialogBackdrop'), {
    timeout: 15000, label: '导入完成后设置/确认弹窗都关闭',
  });
}

/** Build fake conversations and inject them before the panel mounts (early script). */
function buildSeedConversations(definitions, now) {
  return definitions.map((item, index) => ({
    id: item.id,
    title: item.title,
    createdAt: now - 9000 + index * 1000,
    updatedAt: now - 8000 + index * 1000,
    messages: [
      { id: item.id + '-u', role: 'user', text: item.question, attachments: [] },
      {
        id: item.id + '-a',
        role: 'assistant',
        blocks: [{ type: 'text', text: item.answer, citations: [] }],
        status: 'done',
        stopReason: 'end_turn',
        error: '',
      },
    ],
  }));
}

/**
 * Replace the stored conversations with the given seed list and reload. The
 * plugin flushes its in-memory list on unmount, so the seed must be written at
 * new-document time (Page.addScriptToEvaluateOnNewDocument) rather than with a
 * plain localStorage write before reload.
 */
async function seedConversations(ctx, definitions) {
  const s = ctx.steps;
  const list = buildSeedConversations(definitions, Date.now());
  const source = 'window.localStorage.setItem(' + JSON.stringify(CONVERSATIONS_KEY) + ', '
    + JSON.stringify(JSON.stringify(list)) + ');';
  const early = await ctx.page.send('Page.addScriptToEvaluateOnNewDocument', { source });
  try {
    await s.reload();
  } finally {
    await ctx.page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: early.identifier });
  }
  await s.openPanel();
  await s.waitFor(expected => document.querySelectorAll('.dsc-railList .dsc-row').length === expected,
    { timeout: 10000, label: '种子的 ' + list.length + ' 条会话出现在 rail' }, [list.length]);
  return list;
}

/** The conversations currently persisted in localStorage. */
async function storedConversations(ctx) {
  return await ctx.steps.eval((key) => {
    try {
      const value = JSON.parse(window.localStorage.getItem(key) || '[]');
      return Array.isArray(value) ? value : [];
    } catch (error) {
      return [];
    }
  }, [CONVERSATIONS_KEY]);
}

/** Titles shown in the conversation rail, top to bottom. */
async function railTitles(ctx) {
  return await ctx.steps.eval(() => Array.from(document.querySelectorAll('.dsc-railList .dsc-rowTitle'))
    .map((node) => (node.innerText || '').trim()));
}

/** Click one rail row (by title substring; any row when omitted). */
async function openRailConversation(ctx, titleIncludes) {
  const clicked = await ctx.steps.eval((needle) => {
    const rows = Array.from(document.querySelectorAll('.dsc-railList .dsc-row'));
    const row = rows.find((item) => !needle || (item.innerText || '').indexOf(needle) >= 0);
    if (!row) return null;
    row.click();
    return (row.innerText || '').replace(/\s+/g, ' ').trim();
  }, [titleIncludes || '']);
  if (!clicked) throw new Error('找不到会话行: ' + (titleIncludes || '(任意)'));
  await ctx.steps.wait(350);
  return clicked;
}

/** Run the independent validator on one ZIP; returns { status, stdout, stderr }. */
function validateBackup(file) {
  const result = spawnSync(process.execPath, [VALIDATOR, file], {
    encoding: 'utf8',
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
  };
}

/** Parse the local file header(s) of a ZIP written by our STORE exporter. */
function readLocalEntries(bytes) {
  const entries = [];
  let offset = 0;
  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    const flags = bytes.readUInt16LE(offset + 6);
    const method = bytes.readUInt16LE(offset + 8);
    const compressedSize = bytes.readUInt32LE(offset + 18);
    const realSize = bytes.readUInt32LE(offset + 22);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const dataStart = offset + 30 + nameLength + extraLength;
    const dataLength = method === 0 ? realSize : compressedSize;
    entries.push({
      name,
      method,
      flags,
      data: bytes.subarray(dataStart, dataStart + dataLength),
    });
    offset = dataStart + dataLength;
    if (flags & 0x0008) break; // data descriptor: local sizes are zero, stop walking
  }
  return entries;
}

module.exports = {
  FIXTURES_DIR,
  VALIDATOR,
  fixture,
  trustedClick,
  openSettings,
  clickDataRowButton,
  allowDownloads,
  waitForDownload,
  exportByDownload,
  importBackupFile,
  buildSeedConversations,
  seedConversations,
  storedConversations,
  railTitles,
  openRailConversation,
  validateBackup,
  readLocalEntries,
};
