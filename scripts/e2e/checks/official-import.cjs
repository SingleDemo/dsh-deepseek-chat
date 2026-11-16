/**
 * Check: official-import
 *
 * Feeds three official-format fixtures through the real settings → 数据管理 → 导入
 * flow and asserts they land as conversations:
 *   - official-backup.zip           STORE archive (manifest v3 + session + index + image)
 *   - official-backup-deflate.zip   DEFLATE entries written with a data descriptor
 *   - official-backup-fragments.zip all 13 fragment types + a real branch
 *
 * The user's data is snapshotted first (exported to a ZIP), because importing
 * replaces every conversation; the snapshot is imported back at the end, and the
 * finally block retries that restore if an assertion failed mid-way.
 *
 * Costs no API calls.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const h = require('./lib/backup-helpers.cjs');

const BASIC = {
  title: 'SSE 是什么',
  question: '帮我看下 SSE 是怎么把 token 推过来的',
  answer: 'text/event-stream 帧',
};
const FRAGMENTS = {
  question: '把 13 种片段都覆盖一遍',
  answer: '这是第一个回答版本',
};
const SEEDS = [
  { id: 'e2e-user-1', title: 'E2E-USER-一', question: '快照问题一', answer: '快照回答一' },
  { id: 'e2e-user-2', title: 'E2E-USER-二', question: '快照问题二', answer: '快照回答二' },
];

module.exports = {
  name: 'official-import',
  description: '官方 ZIP 导入：fixture 基本包/ DEFLATE 变体/ 13 片段变体都能导入并渲染；结束用快照恢复用户数据',
  timeoutMs: 180000,
  cost: 'none',
  settings: { thinking: 'off', webSearch: false },

  async run(ctx) {
    const s = ctx.steps;
    const dir = path.join(os.tmpdir(), 'dsh-e2e-official-import-' + process.pid + '-' + Date.now());
    fs.mkdirSync(dir, { recursive: true });
    let snapshot = null;

    const waitRail = async (count, label) => {
      await s.waitFor(expected => document.querySelectorAll('.dsc-railList .dsc-row').length === expected,
        { timeout: 15000, label: label || ('rail 会话数变成 ' + count) }, [count]);
    };
    const threadText = async () => await s.eval(() => ({
      user: Array.from(document.querySelectorAll('.dsc-turnUser')).map(n => n.innerText || '').join(' | '),
      bot: Array.from(document.querySelectorAll('.dsc-botBody')).map(n => n.innerText || '').join(' | '),
      files: Array.from(document.querySelectorAll('.dsc-fileChip')).map(n => n.innerText || '').join(' | '),
      thinking: document.querySelectorAll('.dsc-reasonTitle').length,
      steps: document.querySelectorAll('.dsc-stepAction').length,
      root: Boolean(document.querySelector('.dsc-root')),
      errorNotices: document.querySelectorAll('.dsc-notice[data-error="true"]').length,
    }));

    try {
      // 0. Snapshot the user's current data (real fix: never lose it on import).
      const seeds = await h.seedConversations(ctx, SEEDS);
      ctx.log('种子用户数据: ' + seeds.map(item => item.title).join(' / '));
      await h.openSettings(ctx);
      const exported = await h.exportByDownload(ctx, dir);
      snapshot = exported.file;
      ctx.log('用户数据快照: ' + path.basename(snapshot) + ' (' + exported.bytes.length + 'B via ' + exported.behavior + ')');

      // 1. Basic official fixture (STORE): title + question + answer + thinking + image.
      await h.openSettings(ctx);
      await h.importBackupFile(ctx, h.fixture('official-backup.zip'));
      await waitRail(1, '官方 fixture 导入后 rail 只有 1 条');
      let stored = await h.storedConversations(ctx);
      ctx.assertEqual(stored.length, 1, '导入后 localStorage 只有 1 个对话');
      ctx.assertEqual(stored[0].title, BASIC.title, '会话标题是 fixture 的「SSE 是什么」');
      ctx.assertIncludes((await h.railTitles(ctx)).join(' | '), BASIC.title, 'rail 显示 fixture 会话标题');
      await h.openRailConversation(ctx, BASIC.title);
      const basic = await threadText();
      ctx.assertIncludes(basic.user, BASIC.question, 'fixture 提问文本可见');
      ctx.assertIncludes(basic.bot, BASIC.answer, 'fixture 回答文本可见');
      ctx.assertIncludes(basic.files, 'pic.png', 'fixture 的 FILE 片段渲染成附件');
      ctx.assert(basic.thinking > 0, 'fixture 的 THINK 片段渲染出思考区（实际 ' + basic.thinking + '）');
      ctx.assertEqual(basic.errorNotices, 0, '导入后没有错误提示条');
      ctx.log('思考区 ' + basic.thinking + ' 个 · 搜索步骤 ' + basic.steps + ' 个 · 附件 ' + basic.files.trim());
      await s.shot('official-import');

      // 2. DEFLATE + data descriptor variant.
      await h.openSettings(ctx);
      await h.importBackupFile(ctx, h.fixture('official-backup-deflate.zip'));
      await waitRail(1, 'DEFLATE fixture 导入后 rail 只有 1 条');
      stored = await h.storedConversations(ctx);
      ctx.assertEqual(stored.length, 1, 'DEFLATE 包导入后 localStorage 只有 1 个对话');
      ctx.assertEqual(stored[0].title, BASIC.title, 'DEFLATE 包会话标题正确');
      const deflated = await threadText();
      ctx.assertIncludes(deflated.bot, BASIC.answer, 'DEFLATE 包回答正文可见');
      ctx.log('DEFLATE + data descriptor 导入成功');
      await s.shot('official-import-deflate');

      // 3. All 13 fragment types + a branch: must import without crashing.
      await h.openSettings(ctx);
      await h.importBackupFile(ctx, h.fixture('official-backup-fragments.zip'));
      await waitRail(1, 'fragments fixture 导入后 rail 只有 1 条');
      stored = await h.storedConversations(ctx);
      ctx.assertEqual(stored.length, 1, 'fragments 包导入后 localStorage 只有 1 个对话');
      ctx.assertEqual(stored[0].title, '', 'fragments fixture 的 null 标题导入为空字符串');
      ctx.assert(Array.isArray(stored[0].messages) && stored[0].messages.length >= 2,
        'fragments 包至少导入 user + assistant 两条消息（实际 ' + (stored[0].messages || []).length + '）');
      await h.openRailConversation(ctx);
      const fragments = await threadText();
      ctx.assertEqual(fragments.root, true, '13 片段导入后面板仍在（没崩）');
      ctx.assertIncludes(fragments.user, FRAGMENTS.question, 'fragments 包提问文本可见');
      ctx.assertIncludes(fragments.bot, FRAGMENTS.answer, 'fragments 包第一个回答版本可见');
      ctx.assertEqual(fragments.errorNotices, 0, '13 片段导入没有错误提示条');
      ctx.log('13 片段导入无异常；思考区 ' + fragments.thinking + ' 个 · 步骤 ' + fragments.steps + ' 个');
      await s.shot('official-import-fragments');

      // 4. Restore the user snapshot and prove the data came back.
      await h.openSettings(ctx);
      await h.importBackupFile(ctx, snapshot);
      await waitRail(2, '恢复快照后 rail 回到 2 条');
      const restored = await h.storedConversations(ctx);
      ctx.assertEqual(restored.length, 2, '快照恢复后 localStorage 是 2 个对话');
      const restoredTitles = restored.map(item => item.title).join(' | ');
      ctx.assertIncludes(restoredTitles, 'E2E-USER-一', '快照恢复后标题保留');
      ctx.log('已用快照恢复用户数据: ' + restoredTitles);
      await s.shot('official-import-restored');
    } finally {
      // Never leave the profile without its seeded user data after a failure.
      try {
        if (snapshot && fs.existsSync(snapshot)) {
          const stored = await h.storedConversations(ctx);
          if (!stored.some(item => item.title === 'E2E-USER-一')) {
            await h.openSettings(ctx);
            await h.importBackupFile(ctx, snapshot);
            ctx.log('finally: 已用快照恢复用户数据');
          }
        }
      } catch (error) {
        ctx.log('finally 恢复快照失败（一次性 profile，不影响真实数据）: ' + error.message);
      }
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (error) {
        ctx.log('清理临时下载目录失败: ' + error.message);
      }
    }
  },
};
