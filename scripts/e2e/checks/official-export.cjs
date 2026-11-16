/**
 * Check: official-export
 *
 * Seeds one branched conversation (two root questions + two answers, new branch
 * selected) plus one linear conversation, then:
 *   - exports through 设置 → 数据管理 → 下载 and checks the official file name,
 *     PK header, manifest-first layout and manifest v3;
 *   - parses the exported session JSON and asserts the full message tree (4 nodes,
 *     2 roots);
 *   - runs scripts/e2e/fixtures/validate-official-backup.cjs (exit 0 + OK);
 *   - deletes every conversation, imports the ZIP back and asserts the branch is
 *     still there: pager count unchanged and both versions switchable.
 *
 * Costs no API calls (the branch is seeded into IndexedDB, not generated).
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const h = require('./lib/demo-helpers.cjs');

const OLD_QUESTION = '旧问题：介绍黄山。';
const OLD_ANSWER = '旧回答：黄山版本。';
const NEW_QUESTION = '新问题：介绍九华山。';
const NEW_ANSWER = '新回答：九华山版本。';

module.exports = {
  name: 'official-export',
  description: '导出含分支的官方 ZIP（文件名/PK/manifest v3/树结构/校验器 exit0）→ 删除全部 → 导入回来：pager 数量不变且两个分支可切换',
  timeoutMs: 180000,
  cost: 'none',
  settings: { thinking: false, search: false },

  async run(ctx) {
    const s = ctx.steps;
    const dir = path.join(os.tmpdir(), 'dsh-e2e-official-export-' + process.pid + '-' + Date.now());
    fs.mkdirSync(dir, { recursive: true });
    let exportedFile = null;

    try {
      const branch = h.buildBranchSession({
        id: 'e2e-branch-1',
        title: 'E2E-BRANCH',
        oldQuestion: OLD_QUESTION,
        oldAnswer: OLD_ANSWER,
        newQuestion: NEW_QUESTION,
        newAnswer: NEW_ANSWER,
      }, Date.now());
      const linear = h.buildSession({
        id: 'e2e-linear-1', title: 'E2E-LINEAR', question: '线性会话问题', answer: '线性会话回答',
      }, Date.now());
      await h.seedSessions(ctx, [branch, linear]);
      await h.openSession(ctx, 'E2E-BRANCH');

      await s.waitFor(() => document.querySelectorAll('[aria-label="消息版本"]').length >= 1, {
        timeout: 15000, label: '分支会话出现版本 pager',
      });
      const before = await h.switchers(ctx);
      const beforePagers = await s.eval(() => document.querySelectorAll('[aria-label="消息版本"]').length);
      ctx.assertMatch(before[0].count, /^2\s*\/\s*2$/, '导出前用户 pager 是 2 / 2（新分支）');
      ctx.assertIncludes((await h.userBubbles(ctx)).join(' | '), '新问题', '导出前可见新问题');
      ctx.assertIncludes(await h.replyText(ctx), '新回答', '导出前可见新回答');
      ctx.log('导出前: pager=' + beforePagers + '（' + before[0].count + '）');

      const exported = await h.exportHistoryZip(ctx, dir);
      exportedFile = exported.file;
      const fileName = path.basename(exportedFile);
      ctx.assertMatch(fileName, /^deepseek_data-\d{4}-\d{2}-\d{2}(-\d{4})?\.zip$/,
        '下载文件名是官方 deepseek_data-YYYY-MM-DD.zip（实际 ' + fileName + '）');
      ctx.assert(exported.bytes[0] === 0x50 && exported.bytes[1] === 0x4b, '导出文件以 PK 头开始');
      ctx.log('导出: ' + fileName + ' (' + exported.bytes.length + 'B)');

      const entries = h.readZipEntries(exported.bytes);
      const names = entries.map((entry) => entry.name);
      ctx.assertEqual(names[0], 'manifest.json', 'ZIP 首条是 manifest.json');
      ctx.assert(names.includes('chat_session_index.json'), 'ZIP 里有 chat_session_index.json');
      ctx.assert(entries.every((entry) => entry.method === 0 || entry.method === 8),
        'ZIP 条目使用 STORE/DEFLATE（官方读取器都接受）');
      const manifest = JSON.parse(entries[0].data.toString('utf8'));
      ctx.assertEqual(manifest.export_format_version, 3, 'manifest.export_format_version === 3');

      const branchEntry = entries.find((entry) => entry.name === 'chat_sessions/e2e-branch-1.json');
      ctx.assert(branchEntry, '导出 ZIP 里有分支会话 chat_sessions/e2e-branch-1.json');
      const session = JSON.parse(branchEntry.data.toString('utf8'));
      ctx.assertEqual(session.messages.length, 4, '导出会话有 4 条树节点（每个分支提问+回答）');
      const roots = session.messages.filter((message) => message.parent_id === null);
      ctx.assertEqual(roots.length, 2, '导出保留两个根分支（parent_id null）');
      ctx.assert(typeof session.current_message_id === 'number', '导出带 current_message_id');
      ctx.log('导出树: messages=' + session.messages.length + ' roots=' + roots.length
        + ' current_message_id=' + session.current_message_id);

      const validation = h.validateBackup(exportedFile);
      ctx.assertEqual(validation.status, 0,
        'validate-official-backup.cjs exit 0（实际 ' + validation.status + '）\n'
        + (validation.stdout || validation.stderr).trim().split('\n').slice(0, 8).join('\n        '));
      ctx.assert(/^OK\s/m.test(validation.stdout), '校验器输出 OK');
      ctx.log(validation.stdout.trim().split('\n').slice(-1)[0]);
      await s.shot('official-export-file');

      // Delete every conversation, then import the ZIP we just wrote.
      await h.deleteAllSessions(ctx);
      await h.waitSummariesCount(ctx, 0, 20000);
      ctx.log('删除全部后 IndexedDB 会话为 0');

      await h.importHistoryZip(ctx, exportedFile);
      await h.waitSummariesCount(ctx, 2, 30000);
      await s.waitFor((host, titleA, titleB) => {
        const root = document.querySelector(host);
        const text = root ? (root.innerText || '') : '';
        return text.indexOf(titleA) >= 0 && text.indexOf(titleB) >= 0;
      }, { timeout: 15000, label: '导入后 sider 出现两个会话标题' }, [h.HOST, 'E2E-BRANCH', 'E2E-LINEAR']);
      const sessions = await h.readSessions(ctx);
      ctx.assertEqual(sessions.length, 2, '往返后会话数不变（2）');
      const branchAfter = sessions.find((item) => item.title === 'E2E-BRANCH');
      ctx.assert(branchAfter, '往返后分支会话还在');
      ctx.assertEqual(branchAfter.messages.length, 4, '往返后分支会话仍有 4 条树节点');
      ctx.assertEqual(branchAfter.messages.filter((message) => !message.parentId).length, 2, '往返后仍有两个根分支');

      await h.openSession(ctx, 'E2E-BRANCH');
      await s.waitFor(() => document.querySelectorAll('[aria-label="消息版本"]').length >= 1, {
        timeout: 15000, label: '往返后版本 pager 仍在',
      });
      const afterPagers = await s.eval(() => document.querySelectorAll('[aria-label="消息版本"]').length);
      ctx.assertEqual(afterPagers, beforePagers, '往返后 pager 数量不变（' + beforePagers + '）');
      ctx.assertIncludes((await h.userBubbles(ctx)).join(' | '), '新问题', '往返后默认可见新问题');
      ctx.assertIncludes(await h.replyText(ctx), '新回答', '往返后默认可见新回答');

      // Switch to the sibling branch and back.
      const pager = (await h.switchers(ctx))[0];
      const direction = pager.previousDisabled ? 1 : -1;
      await h.clickSwitcher(ctx, 0, direction);
      await s.waitFor((host) => {
        const bubbles = Array.from(document.querySelectorAll('[class*="UserMessage_bubble"]'))
          .map((node) => (node.innerText || '').trim()).join(' | ');
        const replies = Array.from(document.querySelectorAll('.ds-assistant-message-main-content'))
          .map((node) => (node.innerText || '').trim()).join(' | ');
        return bubbles.indexOf('旧问题') >= 0 && replies.indexOf('旧回答') >= 0;
      }, { timeout: 15000, label: '往返后切到旧分支：旧问题+旧回答都在' }, [h.HOST]);
      ctx.log('往返后切到旧分支成功');
      await s.shot('official-export-switch');

      await h.clickSwitcher(ctx, 0, direction === 1 ? -1 : 1);
      await s.waitFor((host) => (document.querySelector(host + ' .ds-assistant-message-main-content') || {}).innerText
        && (document.querySelector(host + ' .ds-assistant-message-main-content').innerText || '').indexOf('新回答') >= 0, {
        timeout: 15000, label: '切回新分支',
      }, [h.HOST]);
      ctx.log('往返成功: 分支/pager 保持不变');
      await s.shot('official-export');
    } finally {
      try {
        const sessions = await h.readSessions(ctx);
        if (exportedFile && fs.existsSync(exportedFile)
          && !sessions.some((session) => session.title === 'E2E-BRANCH')) {
          await h.importHistoryZip(ctx, exportedFile);
          ctx.log('finally: 已用导出的 ZIP 恢复会话');
        }
      } catch (error) {
        ctx.log('finally 恢复失败（一次性 profile）: ' + error.message);
      }
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (error) {
        ctx.log('清理临时下载目录失败: ' + error.message);
      }
    }
  },
};
