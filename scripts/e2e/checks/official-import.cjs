/**
 * Check: official-import
 *
 * Feeds the three official-format fixtures through the demo's 设置 → 数据管理 →
 * 导入 flow:
 *   - official-backup.zip           STORE archive (manifest v3 + session + index + image)
 *   - official-backup-deflate.zip   DEFLATE entries written with a data descriptor
 *   - official-backup-fragments.zip all 13 fragment types + a USER with two ASSISTANT siblings
 *
 * Assertions: session title in the sider, question/answer text rendered, the
 * branch fixture keeps both answers switchable via the version pager.
 * The user's seeded data is snapshotted first and restored at the end.
 * Costs no API calls.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const h = require('./lib/demo-helpers.cjs');

const SEEDS = [
  { id: 'e2e-user-1', title: 'E2E-USER-一', question: '快照问题一', answer: '快照回答一' },
  { id: 'e2e-user-2', title: 'E2E-USER-二', question: '快照问题二', answer: '快照回答二' },
];

module.exports = {
  name: 'official-import',
  description: '官方 ZIP 导入（demo 数据管理）：fixture 基本包/DEFLATE 变体/13 片段分支包都能导入渲染，分支可切换；结束用快照恢复',
  timeoutMs: 180000,
  cost: 'none',
  settings: { thinking: false, search: false },

  async run(ctx) {
    const s = ctx.steps;
    const dir = path.join(os.tmpdir(), 'dsh-e2e-official-import-' + process.pid + '-' + Date.now());
    fs.mkdirSync(dir, { recursive: true });
    let snapshot = null;

    const waitSiderTitle = async (needle, timeout) => {
      await s.waitFor((host, text) => Array.from(document.querySelectorAll(host + ' [class*="SessionItem"]'))
        .some((node) => (node.innerText || '').indexOf(text) >= 0),
      { timeout: timeout || 20000, label: 'sider 出现会话「' + needle + '」' }, [h.HOST, needle]);
    };
    const restoreSnapshot = async () => {
      await h.importHistoryZip(ctx, snapshot);
      await waitSiderTitle('E2E-USER-一');
      const sessions = await h.readSessions(ctx);
      if (sessions.length !== 2) throw new Error('快照恢复后会话数不是 2（' + sessions.length + '）');
    };

    try {
      const seeded = SEEDS.map((item) => h.buildSession(item, Date.now()));
      await h.seedSessions(ctx, seeded);
      await waitSiderTitle('E2E-USER-一');
      const summaries = await h.readSummaries(ctx);
      ctx.log('种子用户数据: ' + summaries.map((item) => item.title).join(' / '));

      const exported = await h.exportHistoryZip(ctx, dir);
      snapshot = exported.file;
      ctx.assert(snapshot, '导出用户数据快照成功（' + path.basename(snapshot) + '）');
      ctx.log('用户数据快照: ' + path.basename(snapshot) + ' (' + exported.bytes.length + 'B)');

      // 1. Basic official fixture: title / question / answer / attachment chip.
      await h.importHistoryZip(ctx, h.fixture('official-backup.zip'));
      await waitSiderTitle('SSE 是什么');
      await h.openSession(ctx, 'SSE 是什么');
      await s.waitFor((host) => (document.querySelector(host + ' .ds-assistant-message-main-content') || {}).innerText, {
        timeout: 15000, label: 'fixture 回答正文渲染',
      }, [h.HOST]);
      const question = (await h.userBubbles(ctx)).join(' | ');
      const answer = await h.replyText(ctx);
      ctx.assertIncludes(question, '帮我看下 SSE 是怎么把 token 推过来的', 'fixture 提问文本可见');
      ctx.assertIncludes(answer, 'text/event-stream 帧', 'fixture 回答文本可见');
      const imported = await h.readSessions(ctx);
      const importedUser = (imported[0].messages || []).find((message) => message.role === 'user');
      const fileNames = ((importedUser && importedUser.files) || []).map((file) => file.name).join(' | ');
      ctx.assertIncludes(fileNames, 'pic.png', 'fixture 的 FILE 片段作为附件元数据保留');
      ctx.assertEqual(imported.length, 1, '导入覆盖后只剩 1 个会话');
      ctx.log('基本包导入成功：标题/提问/回答/附件都在');
      await s.shot('official-import');

      // 2. DEFLATE + data descriptor variant.
      await h.importHistoryZip(ctx, h.fixture('official-backup-deflate.zip'));
      await waitSiderTitle('SSE 是什么', 15000);
      await h.openSession(ctx, 'SSE 是什么');
      await s.waitFor((host) => ((document.querySelector(host + ' .ds-assistant-message-main-content') || {}).innerText || '').indexOf('text/event-stream') >= 0, {
        timeout: 15000, label: 'DEFLATE 包回答正文',
      }, [h.HOST]);
      ctx.log('DEFLATE + data descriptor 导入成功');
      await s.shot('official-import-deflate');

      // 3. All 13 fragment types + a branch (USER with two ASSISTANT siblings).
      await h.importHistoryZip(ctx, h.fixture('official-backup-fragments.zip'));
      await waitSiderTitle('新对话');
      await h.openSession(ctx, '新对话');
      await s.waitFor(() => document.querySelectorAll('[aria-label="消息版本"]').length >= 1, {
        timeout: 15000, label: '分支包导入后出现消息版本 pager',
      });
      const questions = (await h.userBubbles(ctx)).join(' | ');
      const firstAnswer = await h.replyText(ctx);
      ctx.assertIncludes(questions, '把 13 种片段都覆盖一遍', '13 片段包提问文本可见');
      ctx.assertIncludes(firstAnswer, '这是第一个回答版本', '默认可见 current_message_id 指向的第一个回答');
      let versions = await h.switchers(ctx);
      ctx.assert(versions.length >= 1, '分支包出现版本 pager（' + versions.length + ' 个）');
      ctx.assertMatch(versions[0].count, /^1\s*\/\s*2$/, '默认在第一个回答版本（1 / 2）');
      await h.clickSwitcher(ctx, 0, 1);
      await s.waitFor((host) => (document.querySelector(host + ' .ds-assistant-message-main-content') || {}).innerText
        && (document.querySelector(host + ' .ds-assistant-message-main-content').innerText || '').indexOf('第二个回答版本') >= 0, {
        timeout: 15000, label: '切到第二个回答版本',
      }, [h.HOST]);
      versions = await h.switchers(ctx);
      ctx.assertMatch(versions[0].count, /^2\s*\/\s*2$/, '切换后 pager 为 2 / 2');
      ctx.assertIncludes(await h.replyText(ctx), '第二个回答版本（同父兄弟节点）', '第二个回答版本可以切换出来');
      ctx.log('13 片段 + 分支导入成功：两个回答版本可切换');
      await s.shot('official-import-fragments');

      // 4. Restore the user snapshot.
      await restoreSnapshot();
      const restored = await h.readSummaries(ctx);
      ctx.log('已用快照恢复用户数据: ' + restored.map((item) => item.title).join(' / '));
      await s.shot('official-import-restored');
    } finally {
      try {
        const sessions = await h.readSessions(ctx);
        if (snapshot && !sessions.some((session) => session.title === 'E2E-USER-一')) {
          await restoreSnapshot();
          ctx.log('finally: 已用快照恢复用户数据');
        }
      } catch (error) {
        ctx.log('finally 恢复快照失败（一次性 profile）: ' + error.message);
      }
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (error) {
        ctx.log('清理临时下载目录失败: ' + error.message);
      }
    }
  },
};
