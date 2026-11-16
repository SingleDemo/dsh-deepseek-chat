/**
 * Check: data-management
 *
 * Exercises the whole「数据管理」loop against the real GUI:
 *   1. seed two conversations into localStorage (so there is user data to lose);
 *   2. export → CDP download interception → inspect the JSON backup;
 *   3. import a filtered backup (one conversation titled IMPORT-CHECK) through
 *      the hidden file input + confirmation dialog;
 *   4. delete all (two clicks: action + confirm) → rail empty, storage [];
 *   5. restore the original export through the same import path and assert the
 *      two conversations are back — the user's data must not be lost.
 *
 * The throwaway e2e profile is the only place touched. Temp download files are
 * removed at the end, and a best-effort restore runs even when the check fails.
 * Costs no API calls.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CONVERSATIONS_KEY } = require('../harness.cjs');

const IMPORT_TITLE = 'IMPORT-CHECK';

/* --------------------------------------------------------------- helpers */

async function trustedClick(ctx, selector) {
  const box = await ctx.steps.eval((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = el.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, [selector]);
  if (!box) throw new Error('找不到可点击元素: ' + selector);
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
}

async function openSettings(ctx) {
  const s = ctx.steps;
  if (!(await s.exists('.dsc-dialog'))) {
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
  }
}

/** Click the button inside the .dsc-dataRow whose text matches. */
async function clickDataRowButton(ctx, pattern) {
  const box = await ctx.steps.eval((source) => {
    const regex = new RegExp(source, 'i');
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
    };
  }, [pattern.source]);
  if (!box) throw new Error('找不到数据管理按钮: ' + pattern);
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
async function allowDownloads(page, dir) {
  try {
    await page.send('Browser.setDownloadBehavior', {
      behavior: 'allow', downloadPath: dir, eventsEnabled: true,
    });
    return 'Browser.setDownloadBehavior';
  } catch (error) {
    await page.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
    return 'Page.setDownloadBehavior';
  }
}

function findDownload(dir) {
  if (!fs.existsSync(dir)) return null;
  const names = fs.readdirSync(dir).filter((name) => /\.json$/i.test(name));
  if (!names.length) return null;
  names.sort();
  return path.join(dir, names[names.length - 1]);
}

async function waitForDownload(dir, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 20000);
  while (Date.now() < deadline) {
    const file = findDownload(dir);
    if (file) {
      try {
        // A .crdownload sibling would mean it is still being written.
        const partial = fs.readdirSync(dir).filter((name) => /\.crdownload$/i.test(name));
        if (!partial.length) {
          const text = fs.readFileSync(file, 'utf8');
          if (text.trim().endsWith('}')) return { file, text };
        }
      } catch (error) { /* still being written */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('等待导出文件超时: ' + dir);
}

/** Put one file into the hidden import input and confirm the dialog. */
async function importFile(ctx, file) {
  const s = ctx.steps;
  const page = ctx.page;
  await page.send('DOM.enable');
  const doc = await page.send('DOM.getDocument', { depth: 1 });
  // The composer attachment input also accepts .json, so target the import input
  // by its MIME type instead of the file extension.
  const found = await page.send('DOM.querySelector', {
    nodeId: doc.root.nodeId,
    selector: 'input[type="file"][accept*="application/json"]',
  });
  if (!found || !found.nodeId) throw new Error('找不到隐藏的导入 file input');
  await page.send('DOM.setFileInputFiles', { files: [file], nodeId: found.nodeId });

  await s.waitFor(() => {
    const dialog = document.querySelector('.dsc-dialogBackdrop .dsc-dialog');
    return dialog && /确认导入|Import these conversations/i.test(dialog.innerText || '');
  }, { timeout: 10000, label: '导入确认弹窗出现' });

  await s.clickSelector('.dsc-dialogBackdrop .dsc-dialogFoot button[data-primary="true"]');
  await s.wait(250);
}

function seedConversations(now) {
  const make = (id, title, question, answer) => ({
    id,
    title,
    createdAt: now - 5000,
    updatedAt: now - 4000,
    messages: [
      { id: id + '-u', role: 'user', text: question, attachments: [] },
      {
        id: id + '-a',
        role: 'assistant',
        blocks: [{ type: 'text', text: answer, citations: [] }],
        status: 'done',
        stopReason: 'end_turn',
        error: '',
      },
    ],
  });
  return [
    make('e2e-seed-1', 'E2E-SEED-一', '占位问题 A：这是第一条假会话。', '占位回答 A。'),
    make('e2e-seed-2', 'E2E-SEED-二', '占位问题 B：这是第二条假会话。', '占位回答 B。'),
  ];
}

module.exports = {
  name: 'data-management',
  description: '数据管理全链路：种子 2 条会话 → 导出(CDP 拦下载/校验 JSON) → 导入 1 条 IMPORT-CHECK → 删除全部 → 用备份恢复且数据不丢',
  timeoutMs: 150000,
  cost: 'none',
  settings: { thinking: 'off', webSearch: false },

  async run(ctx) {
    const s = ctx.steps;
    const now = Date.now();
    const downloadDir = path.join(os.tmpdir(), 'dsh-e2e-download-' + process.pid + '-' + now);
    fs.mkdirSync(downloadDir, { recursive: true });
    let backupFile = null;
    let backupText = '';

    /** Import the original export back; returns true when it worked. */
    const restoreBackup = async () => {
      await openSettings(ctx);
      await importFile(ctx, backupFile);
      await s.waitFor(() => {
        const rows = document.querySelectorAll('.dsc-railList .dsc-row');
        return rows.length === 2;
      }, { timeout: 10000, label: '恢复备份后 rail 回到 2 条会话' });
      const stored = await s.eval((key) => {
        try {
          const value = JSON.parse(window.localStorage.getItem(key) || '[]');
          return Array.isArray(value) ? value.length : -1;
        } catch (error) {
          return -1;
        }
      }, [CONVERSATIONS_KEY]);
      if (stored !== 2) throw new Error('恢复后 localStorage 会话数不是 2，实际 ' + stored);
      return true;
    };

    try {
      // 1. There must be user data to export: seed two conversations. The plugin
      // flushes its in-memory (empty) list on unmount, so the seed has to be
      // written at new-document time, before the panel mounts and reads it.
      const seedSource = 'window.localStorage.setItem(' + JSON.stringify(CONVERSATIONS_KEY)
        + ', ' + JSON.stringify(JSON.stringify(seedConversations(now))) + ');';
      const early = await ctx.page.send('Page.addScriptToEvaluateOnNewDocument', { source: seedSource });
      try {
        await s.reload();
      } finally {
        await ctx.page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: early.identifier });
      }
      await s.openPanel();
      await s.waitFor(() => document.querySelectorAll('.dsc-railList .dsc-row').length === 2, {
        timeout: 10000, label: '种子的 2 条会话出现在 rail',
      });
      ctx.log('已种入 2 条假会话作为「用户数据」');

      await openSettings(ctx);
      const hasGroup = await s.count('.dsc-dataRow');
      ctx.assertEqual(hasGroup, 3, '「数据管理」有 3 行（导出/导入/删除全部）');

      // 2. Export: intercept the download and inspect the backup JSON.
      const behavior = await allowDownloads(ctx.page, downloadDir);
      ctx.log('下载行为: ' + behavior + ' → ' + downloadDir);
      const exportLabel = await clickDataRowButton(ctx, /导出|Export/);
      ctx.log('点击导出按钮: ' + exportLabel);
      const download = await waitForDownload(downloadDir, 20000);
      backupFile = download.file;
      backupText = download.text;
      const backup = JSON.parse(backupText);
      ctx.assertEqual(backup.format, 'dsh-chat-backup', '备份 format 是 dsh-chat-backup');
      ctx.assertEqual(backup.version, 1, '备份 version 是 1');
      ctx.assert(Array.isArray(backup.conversations), '备份 conversations 是数组');
      ctx.assertEqual(backup.conversations.length, 2, '备份包含 2 条会话');
      ctx.assert(backup.settings && typeof backup.settings === 'object', '备份带 settings');
      ctx.assert(!('apiKey' in backup.settings), '备份 settings 里没有 apiKey');
      const seedTitles = backup.conversations.map((item) => item.title).join(' | ');
      ctx.assertIncludes(seedTitles, 'E2E-SEED-一', '备份里能看到种子会话标题');
      ctx.log('备份文件: ' + path.basename(backupFile) + '（' + backupText.length + ' 字节）');
      await s.shot('data-management-export');

      // 3. Import a filtered backup: one conversation, renamed IMPORT-CHECK.
      const filtered = JSON.parse(backupText);
      filtered.conversations = [Object.assign({}, filtered.conversations[0], {
        title: IMPORT_TITLE,
        updatedAt: now,
      })];
      const importPath = path.join(downloadDir, 'import-check.json');
      fs.writeFileSync(importPath, JSON.stringify(filtered, null, 2), 'utf8');

      await importFile(ctx, importPath);
      await s.waitFor((wantedTitle) => {
        const rows = document.querySelectorAll('.dsc-railList .dsc-row');
        if (rows.length !== 1) return false;
        const rowTitle = rows[0].querySelector('.dsc-rowTitle');
        return Boolean(rowTitle) && (rowTitle.innerText || '').indexOf(wantedTitle) >= 0;
      }, { timeout: 15000, label: '导入后 rail 只剩 1 行且标题含 IMPORT-CHECK' }, [IMPORT_TITLE]);
      const afterImport = await s.eval((key) => {
        const rows = document.querySelectorAll('.dsc-railList .dsc-row');
        const stored = JSON.parse(window.localStorage.getItem(key) || '[]');
        return {
          rows: rows.length,
          rowText: rows[0] ? (rows[0].innerText || '') : '',
          stored: Array.isArray(stored) ? stored.length : -1,
        };
      }, [CONVERSATIONS_KEY]);
      ctx.assertEqual(afterImport.rows, 1, '导入后 rail 只有 1 条会话');
      ctx.assertIncludes(afterImport.rowText, IMPORT_TITLE, '导入后会话标题是 IMPORT-CHECK');
      ctx.assertEqual(afterImport.stored, 1, 'localStorage conversations 长度为 1');
      ctx.log('导入成功: rail=' + afterImport.rows + '，storage=' + afterImport.stored);
      await s.shot('data-management');

      // 4. Delete all: click twice (action, then confirm).
      await openSettings(ctx);
      const firstLabel = await clickDataRowButton(ctx, /删除全部|Delete all/);
      ctx.log('第一次点击: ' + firstLabel);
      const confirmLabel = await clickDataRowButton(ctx, /要删除本浏览器中保存的全部对话|Delete every conversation/i);
      ctx.log('确认按钮: ' + confirmLabel);
      await s.waitFor(() => {
        const empty = document.querySelector('.dsc-railEmpty');
        return empty && /还没有对话|No conversations yet/i.test(empty.innerText || '');
      }, { timeout: 10000, label: '删除后 rail 出现空态文案' });
      const afterClear = await s.eval((key) => {
        const stored = JSON.parse(window.localStorage.getItem(key) || '[]');
        return {
          rows: document.querySelectorAll('.dsc-railList .dsc-row').length,
          empty: Boolean(document.querySelector('.dsc-railEmpty')),
          stored: Array.isArray(stored) ? stored.length : -1,
        };
      }, [CONVERSATIONS_KEY]);
      ctx.assertEqual(afterClear.rows, 0, '删除后 rail 没有会话行');
      ctx.assertEqual(afterClear.empty, true, '删除后出现空态 .dsc-railEmpty');
      ctx.assertEqual(afterClear.stored, 0, '删除后 localStorage conversations 为 []');
      ctx.log('删除全部完成: rail=0, storage=0');
      await s.shot('data-management-empty');

      // 5. Restore the original export: user data must come back.
      await restoreBackup();
      await s.shot('data-management-restored');
      ctx.log('已用导出备份恢复 2 条会话，数据未丢');
    } finally {
      // Even when an assertion failed mid-way, try to put the data back.
      if (backupFile && fs.existsSync(backupFile)) {
        try {
          const stored = await s.eval((key) => {
            try {
              const value = JSON.parse(window.localStorage.getItem(key) || '[]');
              return Array.isArray(value) ? value.length : -1;
            } catch (error) {
              return -1;
            }
          }, [CONVERSATIONS_KEY]);
          if (stored !== 2) {
            await restoreBackup();
            ctx.log('finally: 失败后已用备份恢复 2 条会话');
          }
        } catch (error) {
          ctx.log('finally: 恢复备份失败（临时 profile，不影响真实数据）: ' + error.message);
        }
      }
      try {
        fs.rmSync(downloadDir, { recursive: true, force: true });
        ctx.log('已清理临时下载目录');
      } catch (error) {
        ctx.log('清理临时目录失败: ' + error.message);
      }
    }
  },
};
