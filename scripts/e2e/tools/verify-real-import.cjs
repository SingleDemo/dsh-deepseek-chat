/**
 * Real-world verification: import a genuine DeepSeek official export ZIP through
 * the demo's 数据管理 → 导入历史对话 flow, without wiping the existing demo data
 * (snapshot first, keep the imported result at the end).
 *
 * Usage:
 *   node scripts/e2e/tools/verify-real-import.cjs [path\to\deepseek_data-*.zip]
 *
 * Unlike `checks/official-import.cjs` this is NOT part of the E2E suite: it runs
 * once against an external archive, prints a structured report (session counts,
 * sample titles, missing-image sessions, timings) and leaves the imported data in
 * the E2E profile for inspection. Rollback = re-import the snapshot printed in
 * the report.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const h = require('../checks/lib/demo-helpers.cjs');
const { openPage, DOCS_DIR } = require('../harness.cjs');

const DEFAULT_ZIP = path.join('C:', 'Users', 'admin', 'Downloads', 'deepseek_data-2026-11-16.zip');
const ZIP = path.resolve(process.argv[2] || DEFAULT_ZIP);

const log = (...args) => console.log(...args);
const now = () => new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);

/* ------------------------------------------------------------- static pass */

function analyze(zipFile) {
  const bytes = fs.readFileSync(zipFile);
  const entries = h.readZipEntries(bytes);
  const names = entries.map((entry) => entry.name);
  let manifest = null;
  try {
    manifest = JSON.parse(entries[0].data.toString('utf8'));
  } catch (error) {
    manifest = { parseError: error.message };
  }
  const sessionEntries = entries.filter((entry) => /^chat_sessions\/.+\.json$/.test(entry.name));
  const imageNames = names.filter((name) => name.indexOf('chat_sessions/') === 0 && !/\.json$/.test(name));
  const imageSet = new Set(imageNames);
  const indexEntry = entries.find((entry) => entry.name === 'chat_session_index.json');
  const index = indexEntry ? JSON.parse(indexEntry.data.toString('utf8')) : null;
  const sessions = [];
  let messages = 0;
  const missing = [];
  for (const entry of sessionEntries) {
    const data = JSON.parse(entry.data.toString('utf8'));
    messages += data.messages.length;
    sessions.push({ id: data.id, title: data.title, messages: data.messages.length });
    for (const message of data.messages) {
      for (const fragment of message.fragments) {
        if (fragment.type !== 'FILE') continue;
        for (const file of fragment.files) {
          const ref = String(file.export_path || '').replace(/^\.\//, '');
          if (ref && !imageSet.has(ref)) {
            missing.push({ sessionId: data.id, title: data.title, name: file.file_name, path: ref });
          }
        }
      }
    }
  }
  return {
    bytes: bytes.length,
    entryCount: entries.length,
    manifest,
    hasUserJson: names.includes('user.json'),
    sessionCount: sessions.length,
    indexCount: index ? index.length : null,
    indexMatches: Boolean(index) && index.length === sessions.length
      && index.every((item) => sessions.some((session) => session.id === item.id)),
    messages,
    imageCount: imageNames.length,
    missing,
    sessions,
  };
}

/* ------------------------------------------------------------- browser run */

async function importWithCapture(ctx, zipFile) {
  const s = ctx.steps;
  await h.openSettingsTab(ctx, '数据管理');
  await s.shot('real-official-import-settings');
  await ctx.page.send('DOM.enable');
  const doc = await ctx.page.send('DOM.getDocument', { depth: 1 });
  const found = await ctx.page.send('DOM.querySelector', {
    nodeId: doc.root.nodeId,
    selector: 'input[type="file"][accept*="zip"]',
  });
  if (!found || !found.nodeId) throw new Error('找不到导入 ZIP 的隐藏 file input');
  await ctx.page.send('DOM.setFileInputFiles', { files: [zipFile], nodeId: found.nodeId });

  const errorPattern = /无法识别|无法导入|导入失败|不完整|损坏|无效|版本|不支持/;

  // Either the confirm dialog opens (format check passed) or an error toast appears.
  const confirmDeadline = Date.now() + 30000;
  let modal = false;
  let toasts = [];
  while (Date.now() < confirmDeadline) {
    modal = await s.eval((host) => Array.from(document.querySelectorAll(host + ' [role="dialog"]'))
      .some((node) => /确认导入历史对话|Import these conversations/.test(node.innerText || '')), [h.HOST]);
    if (modal) break;
    toasts = await h.toastTexts(ctx);
    const bad = toasts.find((text) => errorPattern.test(text));
    if (bad) {
      await s.shot('real-official-import-failed');
      return { ok: false, stage: 'checkArchiveFormat', toast: bad, toasts };
    }
    await s.wait(250);
  }
  if (!modal) {
    const dialogs = await s.eval((host) => Array.from(document.querySelectorAll(host + ' [role="dialog"]'))
      .map((node) => (node.innerText || '').replace(/\s+/g, ' ').trim()), [h.HOST]);
    await s.shot('real-official-import-failed');
    return { ok: false, stage: 'confirm-dialog-missing', toasts: await h.toastTexts(ctx), dialogs };
  }

  await h.clickByText(ctx, /^确认导入$|^Import$/, h.HOST);
  // Importing 21MB / 141 sessions: wait for 已导入 N 个对话 or an error toast.
  const importDeadline = Date.now() + 180000;
  while (Date.now() < importDeadline) {
    const state = await s.eval((host) => {
      const dialogs = Array.from(document.querySelectorAll(host + ' [role="dialog"]'));
      return {
        text: dialogs.map((node) => (node.innerText || '').replace(/\s+/g, ' ').trim()).join('\n'),
        toasts: Array.from(document.querySelectorAll('[role="status"]'))
          .map((node) => (node.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean),
      };
    }, [h.HOST]);
    const match = state.text.match(/已导入\s*\d+\s*个对话/);
    if (match) {
      await s.shot('real-official-import-settings');
      return { ok: true, status: match[0], toasts: state.toasts };
    }
    const bad = state.toasts.find((text) => errorPattern.test(text));
    if (bad) {
      await s.shot('real-official-import-failed');
      return { ok: false, stage: 'importArchive', toast: bad, toasts: state.toasts, dialogs: state.text.slice(0, 800) };
    }
    await s.wait(400);
  }
  const toastsLeft = await h.toastTexts(ctx);
  await s.shot('real-official-import-failed');
  return { ok: false, stage: 'import-timeout', toasts: toastsLeft };
}

async function openAndInspect(ctx, title, label) {
  const s = ctx.steps;
  await h.openSession(ctx, title);
  await s.waitFor((host) => {
    const bubbles = Array.from(document.querySelectorAll(host + ' [class*="UserMessage_bubble"]'))
      .map((node) => (node.innerText || '').trim());
    const replies = Array.from(document.querySelectorAll(host + ' .ds-assistant-message-main-content'))
      .map((node) => (node.innerText || '').trim());
    return bubbles.some((text) => text.length > 0) && replies.some((text) => text.length > 10);
  }, { timeout: 30000, label: label + ' 正文渲染' }, [h.HOST]);
  const info = await s.eval((host) => ({
    userBubbles: Array.from(document.querySelectorAll(host + ' [class*="UserMessage_bubble"]'))
      .map((node) => (node.innerText || '').replace(/\s+/g, ' ').trim()).slice(0, 3),
    replies: Array.from(document.querySelectorAll(host + ' .ds-assistant-message-main-content'))
      .map((node) => (node.innerText || '').replace(/\s+/g, ' ').trim()).slice(0, 2),
    attachments: Array.from(document.querySelectorAll(host + ' [class*="MessageFile"]'))
      .map((node) => (node.innerText || '').replace(/\s+/g, ' ').trim() || (node.getAttribute('aria-label') || '')).slice(0, 6),
    steps: document.querySelectorAll(host + ' [class*="ReplyArea_area"]').length,
    searchRows: document.querySelectorAll(host + ' [class*="ReplyArea_clickable"]').length,
    thinkingTitles: Array.from(document.querySelectorAll(host + ' [class*="ReplyArea_titleText"]'))
      .map((node) => (node.innerText || '').trim()).slice(0, 4),
  }), [h.HOST]);
  return info;
}

async function main() {
  if (!fs.existsSync(ZIP)) throw new Error('ZIP 不存在: ' + ZIP);
  const started = Date.now();
  const report = { zip: ZIP, profile: process.env.DSH_E2E_PROFILE || '%TEMP%\dsh-e2e-profile' };

  log('== 静态分析 ==');
  const meta = analyze(ZIP);
  report.static = meta;
  log('entries=' + meta.entryCount + ' sessions=' + meta.sessionCount
    + ' index=' + meta.indexCount + ' indexMatches=' + meta.indexMatches
    + ' messages=' + meta.messages + ' images=' + meta.imageCount
    + ' user.json=' + meta.hasUserJson + ' manifest=' + JSON.stringify(meta.manifest));
  log('缺失图片引用: ' + meta.missing.length + ' → '
    + JSON.stringify(meta.missing.map((item) => ({ title: item.title, name: item.name }))));
  const missingBySession = new Map();
  for (const item of meta.missing) {
    if (!missingBySession.has(item.sessionId)) missingBySession.set(item.sessionId, item);
  }

  const session = await openPage({ width: 1440, height: 900, skipSeed: true, shotName: 'real-official-import' });
  const ctx = session;
  const s = session.steps;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-real-import-'));
  const snapshotDir = path.join(DOCS_DIR, 'snapshots');
  fs.mkdirSync(snapshotDir, { recursive: true });

  try {
    await s.openPanel();
    if (await s.exists(h.SETTINGS_DIALOG)) await h.closeSettings(ctx);

    const before = await h.readSummaries(ctx);
    report.before = { sessions: before.length, titles: before.map((item) => item.title).slice(0, 5) };
    log('\n== 导入前 demo 数据 ==');
    log('会话数=' + before.length + ' 标题=' + JSON.stringify(report.before.titles));

    // 1) Snapshot current demo data for rollback (kept on disk in docs/e2e/snapshots).
    if (before.length > 0) {
      await h.allowDownloads(ctx, tmpDir);
      await h.openSettingsTab(ctx, '数据管理');
      const download = await (async () => {
        await h.clickByText(ctx, /^下载$|^Download$/, h.SETTINGS_DIALOG);
        return await h.waitForDownload(tmpDir, /\.zip$/i, 30000);
      })();
      const snapshot = path.join(snapshotDir, 'before-real-import-' + now() + '.zip');
      fs.copyFileSync(download, snapshot);
      const validation = h.validateBackup(snapshot);
      report.snapshot = {
        path: snapshot,
        bytes: fs.statSync(snapshot).size,
        validatorExit: validation.status,
        validator: validation.stdout.trim(),
      };
      log('快照已保存: ' + snapshot + ' (' + report.snapshot.bytes + 'B, validator exit='
        + validation.status + ')');
      await h.closeSettings(ctx);
    } else {
      report.snapshot = null;
      log('导入前 demo 没有会话，无需快照');
    }

    // 2) Import the real archive through the documented UI.
    log('\n== 导入真实 ZIP ==');
    const importStarted = Date.now();
    const result = await importWithCapture(ctx, ZIP);
    report.import = Object.assign({ durationMs: Date.now() - importStarted }, result);
    if (!result.ok) {
      log('导入失败: stage=' + result.stage + ' toast=' + JSON.stringify(result.toast || null));
      log(JSON.stringify(result, null, 2));
      process.exitCode = 1;
      return;
    }
    log('导入成功: ' + result.status + '（' + report.import.durationMs + 'ms）');
    const errorToasts = (result.toasts || []).filter((text) => /失败|无法|不完整|损坏|无效/.test(text));
    report.noErrorToast = errorToasts.length === 0;

    // 3) Wait for the sider/store and verify the counts against the archive.
    await h.closeSettings(ctx);
    await h.waitSummariesCount(ctx, meta.sessionCount, 120000);
    const summaries = await h.readSummaries(ctx);
    const sessions = await h.readSessions(ctx);
    report.imported = {
      summaries: summaries.length,
      sessions: sessions.length,
      expected: meta.sessionCount,
      index: meta.indexCount,
      titles: summaries.map((item) => item.title),
    };
    log('IndexedDB 会话数: summaries=' + summaries.length + ' sessions=' + sessions.length
      + '，ZIP 会话文件=' + meta.sessionCount + '，index=' + meta.indexCount);
    if (summaries.length !== meta.sessionCount || sessions.length !== meta.sessionCount) {
      throw new Error('会话数与 ZIP 不一致: ' + sessions.length + ' != ' + meta.sessionCount);
    }

    // Sample 3 titles from the archive and require them in the sider.
    const wantedTitles = meta.sessions.slice(0, 3).map((item) => item.title);
    const siderText = await s.text(h.HOST);
    report.sampleTitles = wantedTitles;
    for (const title of wantedTitles) {
      if (siderText.indexOf(title) < 0) throw new Error('sider 里找不到会话标题: ' + title);
    }
    log('sider 抽样标题: ' + JSON.stringify(wantedTitles));

    // 4) Open ordinary + missing-image sessions.
    log('\n== 打开会话 ==');
    const first = await openAndInspect(ctx, meta.sessions[0].title || '新对话', '按首条标题');
    report.opened = { title: meta.sessions[0].title, info: first };
    log('[' + meta.sessions[0].title + '] 提问="' + (first.userBubbles[0] || '').slice(0, 50)
      + '" 回答长度=' + (first.replies[0] || '').length + ' 步骤区=' + first.steps
      + ' 搜索行=' + first.searchRows + ' 标题=' + JSON.stringify(first.thinkingTitles));

    const missingTitle = [...new Set([...missingBySession.values()].map((item) => item.title))][0];
    const missingFiles = meta.missing.map((item) => item.name);
    const missingInfo = await openAndInspect(ctx, missingTitle, '缺失图片会话');
    await s.wait(600);
    const missingVisible = await s.eval((host, names) => {
      const text = document.querySelector(host).innerText || '';
      const attrs = Array.from(document.querySelectorAll(host + ' [class*="MessageFile"]'))
        .map((node) => (node.getAttribute('title') || '') + ' ' + (node.getAttribute('aria-label') || ''))
        .join(' ');
      return names.map((name) => ({ name, inText: text.indexOf(name) >= 0, inAttrs: attrs.indexOf(name) >= 0 }));
    }, [h.HOST, missingFiles]);
    report.missingImage = { title: missingTitle, files: missingFiles, visible: missingVisible, info: missingInfo };
    log('[' + missingTitle + '] 打开成功，提问="' + (missingInfo.userBubbles[0] || '').slice(0, 50)
      + '" 回答长度=' + (missingInfo.replies[0] || '').length);
    log('缺失图片的文件名可见性: ' + JSON.stringify(missingVisible));

    // A third, larger session to make sure multi-page history also renders.
    const third = meta.sessions.find((item) => item.messages >= 4 && item.title !== meta.sessions[0].title
      && item.title !== missingTitle);
    if (third) {
      const thirdInfo = await openAndInspect(ctx, third.title, '第三条会话');
      report.third = { title: third.title, info: thirdInfo };
      log('[' + third.title + '] 回答长度=' + (thirdInfo.replies[0] || '').length
        + ' 步骤区=' + thirdInfo.steps + ' 搜索行=' + thirdInfo.searchRows);
    }

    // 5) Final screenshot with sider + an opened conversation.
    await h.openSession(ctx, meta.sessions[0].title || '新对话');
    await s.wait(500);
    await s.shot('real-official-import');

    report.durationMs = Date.now() - started;
    log('\n== 结果 ==');
    log('结论: 可导入');
    log('会话数: ' + sessions.length + '（ZIP ' + meta.sessionCount + '，index ' + meta.indexCount + '）');
    log('无错误 toast: ' + report.noErrorToast);
    log('缺失图片会话: ' + missingTitle + '（' + missingFiles.join(', ') + '，可打开）');
    log('快照: ' + (report.snapshot ? report.snapshot.path : '（导入前为空，无快照）'));
    log('截图: ' + path.join(DOCS_DIR, 'real-official-import.png'));
    log('耗时: ' + report.durationMs + 'ms（导入本身 ' + report.import.durationMs + 'ms）');
    log('JSON: ' + JSON.stringify(report));
    log('注意: 导入结果保留在 E2E profile ' + report.profile
      + '；后续再跑 E2E 全量会先清空 demo 数据。');
  } finally {
    await session.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (error) { /* ignore */ }
  }
}

main().catch(async (error) => {
  console.error('验证失败:', error && error.stack ? error.stack : error);
  process.exitCode = 1;
  try {
    const { close } = require('../harness.cjs');
    await close();
  } catch (ignored) { /* best effort */ }
});
