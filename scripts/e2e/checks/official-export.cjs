/**
 * Check: official-export (with a branched conversation)
 *
 * Seeds one conversation that mirrors a branch-edit result (two root questions,
 * two answers, the new branch selected) plus one linear conversation, then:
 *   - exports the official deepseek_data-*.zip and checks file name / PK header /
 *     manifest-first layout / STORE / no data descriptor / manifest v3;
 *   - asserts the exported session JSON really carries both branches
 *     (4 tree nodes, two parent_id null roots, current_message_id = visible tail);
 *   - runs scripts/e2e/fixtures/validate-official-backup.cjs (exit 0 + OK);
 *   - deletes every conversation, imports the ZIP back and asserts the branch is
 *     still there: pager count unchanged, both versions switchable.
 *
 * Costs no API calls (the branch is seeded as a native tree, not generated).
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const h = require('./lib/backup-helpers.cjs');

const OLD_QUESTION = '旧问题：介绍黄山。';
const OLD_ANSWER = '旧回答：黄山版本。';
const NEW_QUESTION = '新问题：介绍九华山。';
const NEW_ANSWER = '新回答：九华山版本。';

const LINEAR = [
  { id: 'e2e-linear-1', title: 'E2E-LINEAR', question: '线性会话问题', answer: '线性会话回答' },
];

/** The tree a branch-edit produces: two root questions, the new one selected. */
function branchConversation(now) {
  return {
    id: 'e2e-branch-1',
    title: 'E2E-BRANCH',
    createdAt: now - 6000,
    updatedAt: now - 4000,
    rootId: 'q-new',
    messages: [
      {
        id: 'q-old', role: 'user', parentId: null, selectedChildId: 'a-old',
        createdAt: now - 6000, text: OLD_QUESTION, attachments: [],
      },
      {
        id: 'a-old', role: 'assistant', parentId: 'q-old', selectedChildId: null,
        createdAt: now - 5900,
        blocks: [{ type: 'text', text: OLD_ANSWER, citations: [] }],
        status: 'done', stopReason: 'end_turn', error: '',
      },
      {
        id: 'q-new', role: 'user', parentId: null, selectedChildId: 'a-new',
        createdAt: now - 5500, text: NEW_QUESTION, attachments: [],
      },
      {
        id: 'a-new', role: 'assistant', parentId: 'q-new', selectedChildId: null,
        createdAt: now - 5400,
        blocks: [{ type: 'text', text: NEW_ANSWER, citations: [] }],
        status: 'done', stopReason: 'end_turn', error: '',
      },
    ],
  };
}

const userText = (ctx) => ctx.steps.eval(() => Array.from(document.querySelectorAll('.dsc-turnUser .dsc-userText'))
  .map((node) => (node.innerText || '').trim()).join(' | '));
const botText = (ctx) => ctx.steps.eval(() => Array.from(document.querySelectorAll('.dsc-botBody'))
  .map((node) => (node.innerText || '').trim()).join(' | '));
const pagerCount = (ctx) => ctx.steps.eval(() => document.querySelectorAll('.dsc-versions').length);

module.exports = {
  name: 'official-export',
  description: '导出含分支的官方 ZIP（校验器 exit0/manifest 首条 v3/STORE）→ 删除全部后导入回来 → pager 数量不变且两个分支可切换',
  timeoutMs: 180000,
  cost: 'none',
  settings: { thinking: 'off', webSearch: false },

  async run(ctx) {
    const s = ctx.steps;
    const dir = path.join(os.tmpdir(), 'dsh-e2e-official-export-' + process.pid + '-' + Date.now());
    fs.mkdirSync(dir, { recursive: true });
    let exportedFile = null;

    const waitRail = async (count, label) => {
      await s.waitFor(expected => document.querySelectorAll('.dsc-railList .dsc-row').length === expected,
        { timeout: 15000, label: label || ('rail 会话数变成 ' + count) }, [count]);
    };

    try {
      const branch = branchConversation(Date.now());
      const linear = h.buildSeedConversations(LINEAR, Date.now());
      await h.seedStoredConversations(ctx, [branch, ...linear]);
      await h.openRailConversation(ctx, 'E2E-BRANCH');
      const before = await s.eval(() => ({
        pagers: document.querySelectorAll('.dsc-versions').length,
        label: (document.querySelector('.dsc-turnUser .dsc-versions .dsc-versionLabel') || {}).innerText || '',
        user: Array.from(document.querySelectorAll('.dsc-turnUser .dsc-userText'))
          .map((node) => (node.innerText || '')).join(' | '),
        bot: Array.from(document.querySelectorAll('.dsc-botBody'))
          .map((node) => (node.innerText || '')).join(' | '),
      }));
      ctx.assertEqual(before.pagers, 1, '导出前分支会话有 1 个版本 pager');
      ctx.assertMatch(before.label, /^2\s*\/\s*2$/, '导出前用户 pager 是 2 / 2（新分支）');
      ctx.assertIncludes(before.user, '新问题', '导出前可见新问题');
      ctx.assertIncludes(before.bot, '新回答', '导出前可见新回答');
      ctx.log('导出前: pager=' + before.pagers + '（' + before.label.trim() + '）');

      await h.openSettings(ctx);
      const exported = await h.exportByDownload(ctx, dir);
      exportedFile = exported.file;
      const fileName = path.basename(exportedFile);
      ctx.assertMatch(fileName, /^deepseek_data-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/,
        '下载文件名是官方 deepseek_data-YYYY-MM-DD-HHmm.zip（实际 ' + fileName + '）');
      ctx.assert(exported.bytes[0] === 0x50 && exported.bytes[1] === 0x4b, '导出文件以 PK 头开始');
      ctx.log('导出: ' + fileName + ' (' + exported.bytes.length + 'B)');

      const entries = h.readLocalEntries(exported.bytes);
      const nameList = entries.map(item => item.name);
      ctx.assertEqual(nameList[0], 'manifest.json', 'ZIP 首条是 manifest.json');
      ctx.assertEqual(nameList[nameList.length - 1], 'chat_session_index.json', 'ZIP 最后一条是索引');
      ctx.assert(entries.every(item => item.method === 0), '所有条目都是 STORE（method 0）');
      ctx.assert(entries.every(item => (item.flags & 0x0008) === 0), '所有条目都没有 data descriptor');
      const manifest = JSON.parse(entries[0].data.toString('utf8'));
      ctx.assertEqual(manifest.export_format_version, 3, 'manifest.export_format_version === 3');

      // The exported session JSON must carry the whole tree, not just the visible path.
      const branchEntry = entries.find(item => item.name === 'chat_sessions/e2e-branch-1.json');
      ctx.assert(branchEntry, '导出的 ZIP 里有分支会话 chat_sessions/e2e-branch-1.json');
      const session = JSON.parse(branchEntry.data.toString('utf8'));
      ctx.assertEqual(session.messages.length, 4, '导出会话包含 4 条树节点（每个分支的提问+回答）');
      const roots = session.messages.filter(item => item.parent_id === null);
      ctx.assertEqual(roots.length, 2, '导出保留两个根分支（parent_id null）');
      ctx.assertEqual(session.current_message_id, 2, 'current_message_id 指向当前可见分支的尾部');
      ctx.log('导出树: messages=' + session.messages.length + ' roots=' + roots.length
        + ' current_message_id=' + session.current_message_id);

      const validation = h.validateBackup(exportedFile);
      ctx.assertEqual(validation.status, 0,
        'validate-official-backup.cjs exit 0（实际 ' + validation.status + '）\n'
        + (validation.stdout || validation.stderr).trim().split('\n').slice(0, 8).join('\n        '));
      ctx.assert(/^OK\s/m.test(validation.stdout), '校验器输出 OK');
      ctx.log(validation.stdout.trim().split('\n').slice(-1)[0]);
      await s.shot('official-export-file');

      // Round trip: delete every conversation, then import the ZIP we just wrote.
      await h.openSettings(ctx);
      const firstLabel = await h.clickDataRowButton(ctx, /删除全部|Delete all/);
      const confirmLabel = await h.clickDataRowButton(ctx, /要删除本浏览器中保存的全部对话|Delete every conversation/i);
      ctx.log('删除全部: ' + firstLabel + ' → ' + confirmLabel);
      await waitRail(0, '删除后 rail 为空');
      ctx.assertEqual((await h.storedConversations(ctx)).length, 0, '删除后 localStorage conversations 为 []');

      await h.openSettings(ctx);
      await h.importBackupFile(ctx, exportedFile);
      await waitRail(2, '导入自己导出的 ZIP 后 rail 回到 2 条');
      const stored = await h.storedConversations(ctx);
      ctx.assertEqual(stored.length, 2, '往返后会话数不变（2）');
      const branchAfter = stored.find(item => item.title === 'E2E-BRANCH');
      ctx.assert(branchAfter, '往返后分支会话还在');
      ctx.assertEqual(branchAfter.messages.length, 4, '往返后分支会话仍有 4 条树节点');
      const rootsAfter = branchAfter.messages.filter(node => !node.parentId);
      ctx.assertEqual(rootsAfter.length, 2, '往返后仍有两个根分支');
      const rootNode = branchAfter.messages.find(node => node.id === branchAfter.rootId);
      ctx.assert(rootNode && rootNode.role === 'user' && (rootNode.text || '').indexOf('新问题') >= 0,
        '往返后 rootId 指向新问题分支');

      await h.openRailConversation(ctx, 'E2E-BRANCH');
      const after = await s.eval(() => ({
        pagers: document.querySelectorAll('.dsc-versions').length,
        label: (document.querySelector('.dsc-turnUser .dsc-versions .dsc-versionLabel') || {}).innerText || '',
        user: Array.from(document.querySelectorAll('.dsc-turnUser .dsc-userText'))
          .map((node) => (node.innerText || '')).join(' | '),
        bot: Array.from(document.querySelectorAll('.dsc-botBody'))
          .map((node) => (node.innerText || '')).join(' | '),
      }));
      ctx.assertEqual(after.pagers, before.pagers, '往返后 pager 数量不变（' + before.pagers + '）');
      ctx.assertMatch(after.label, /\/\s*2$/, '往返后用户 pager 仍表示 2 个版本（实际 ' + after.label + '）');
      ctx.assertIncludes(after.user, '新问题', '往返后默认可见新问题');
      ctx.assertIncludes(after.bot, '新回答', '往返后默认可见新回答');

      // Both branches must stay reachable: switch to the sibling question.
      const pager = await h.readPager(ctx, '.dsc-turnUser .dsc-versions');
      ctx.assert(pager, '往返后用户消息仍有 pager');
      ctx.assertEqual(pager.arrows.length, 2, '往返后 pager 有两个箭头');
      const oldIndex = pager.arrows[0].disabled ? 1 : 0;
      await h.clickPagerArrow(ctx, '.dsc-turnUser .dsc-versions', oldIndex);
      await s.waitFor(() => Array.from(document.querySelectorAll('.dsc-turnUser .dsc-userText'))
        .some(node => (node.innerText || '').indexOf('旧问题') >= 0), {
        timeout: 10000, label: '往返后能切到旧问题分支',
      });

      const oldAnswerVisible = await s.waitFor(() => {
        const body = document.querySelector('.dsc-botBody');
        return body && (body.innerText || '').indexOf('旧回答') >= 0;
      }, { timeout: 8000, label: '往返后切到旧分支能看到旧回答' }).then(() => true, () => false);

      if (!oldAnswerVisible) {
        // Sample the defect: before reload the branch is dangling, after reload the
        // loader sanitizer fills selectedChildId and the answer is back.
        await s.shot('official-export-bug-before-reload');
        ctx.log('BUG: 导入后切到旧分支只显示问题、看不到旧回答；再做一次 reload 对照');
        await s.reload();
        await s.openPanel();
        await h.openRailConversation(ctx, 'E2E-BRANCH');
        const retryPager = await h.readPager(ctx, '.dsc-turnUser .dsc-versions');
        const visibleQuestion = await s.eval(() => {
          const node = document.querySelector('.dsc-turnUser .dsc-userText');
          return node ? (node.innerText || '').trim() : '';
        });
        // Only switch if the reloaded state still shows the new question.
        if (retryPager && visibleQuestion.indexOf('旧问题') < 0) {
          await h.clickPagerArrow(ctx, '.dsc-turnUser .dsc-versions',
            retryPager.arrows[0].disabled ? 1 : 0);
        }
        const visibleAfterReload = await s.waitFor(() => {
          const body = document.querySelector('.dsc-botBody');
          return body && (body.innerText || '').indexOf('旧回答') >= 0;
        }, { timeout: 8000, label: 'reload 后切到旧分支能看到旧回答' }).then(() => true, () => false);
        ctx.assert(false,
          '导入官方 ZIP 后，切到非 current_message_id 的分支只显示问题、看不到该分支回答'
          + '（reload 后可见=' + visibleAfterReload + '）。'
          + '原因：client.js fromOfficialSession 只为 current_message_id 链上的父节点补 '
          + 'selectedChildId，非链分支的父节点 selectedChildId 仍为 null，visiblePath 到那里就断了；'
          + '需像 sanitizeConversations 一样，给“有子节点但 selectedChildId 为空”的节点补第一个子节点');
      }
      ctx.log('往返后切到旧分支：旧问题 + 旧回答都在');
      await s.shot('official-export-switch');

      await h.clickPagerArrow(ctx, '.dsc-turnUser .dsc-versions', oldIndex === 0 ? 1 : 0);
      await s.waitFor(() => Array.from(document.querySelectorAll('.dsc-turnUser .dsc-userText'))
        .some(node => (node.innerText || '').indexOf('新问题') >= 0), {
        timeout: 10000, label: '再切回新问题分支',
      });
      ctx.log('往返成功: 分支/pager 保持不变');
      await s.shot('official-export');
    } finally {
      try {
        const stored = await h.storedConversations(ctx);
        if (!stored.some(item => item.title === 'E2E-BRANCH')) {
          if (exportedFile && fs.existsSync(exportedFile)) {
            await h.openSettings(ctx);
            await h.importBackupFile(ctx, exportedFile);
            ctx.log('finally: 已用导出的 ZIP 恢复会话');
          }
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
