/**
 * Check: branch-edit
 *
 * The demo's edit flow forks the conversation: editing the opening question adds
 * a sibling version, the message-version pager switches between the old and the
 * new question+answer, regenerating adds a second answer sibling, the whole tree
 * is persisted in IndexedDB, and it survives a reload.
 *
 * Costs 3 real API calls (initial reply, edited reply, regenerate).
 */
'use strict';

const h = require('./lib/demo-helpers.cjs');

const OLD_PROMPT = '用一句话介绍黄山。';
const NEW_PROMPT = '用一句话介绍九华山。';

module.exports = {
  name: 'branch-edit',
  description: '编辑首条消息 → 出现消息版本 pager(2/2) → 切回旧问题+旧回答、再切回新分支 → 重新生成出现第二个回答版本 → IndexedDB 树 ≥5 条 → reload 后 pager 仍在',
  timeoutMs: 240000,
  cost: 'api',
  settings: { thinking: false, search: false },

  async run(ctx) {
    const s = ctx.steps;

    await h.ask(ctx, OLD_PROMPT);
    await h.waitReplyDone(ctx, 90000);
    const oldAnswer = await h.replyText(ctx);
    ctx.assert(oldAnswer && oldAnswer.length > 5, '旧回答正文可读');
    ctx.log('旧回答: ' + oldAnswer.replace(/\s+/g, ' ').slice(0, 50));

    // Inline edit of the opening question.
    await s.clickSelector(h.HOST + ' [aria-label="编辑消息"]');
    await s.waitForSelector(h.HOST + ' textarea[aria-label="编辑消息"]', { timeout: 5000, label: '消息内编辑框出现' });
    await s.typeText(h.HOST + ' textarea[aria-label="编辑消息"]', NEW_PROMPT);
    ctx.assertEqual(await s.eval((host) => document.querySelector(host + ' textarea[aria-label="编辑消息"]').value, [h.HOST]),
      NEW_PROMPT, '编辑框已改成新问题');
    await h.clickByText(ctx, /^发送$/, h.HOST);
    await h.waitReplyDone(ctx, 90000);

    const newAnswer = await h.replyText(ctx);
    ctx.assert(newAnswer && newAnswer !== oldAnswer, '新分支回答与旧回答不同');
    ctx.log('新回答: ' + newAnswer.replace(/\s+/g, ' ').slice(0, 50));

    // The demo keeps its auto-generated session title after an edit, so only the
    // message content must reflect the new question.
    ctx.log('sider 标题（demo 自动生成，不随编辑变化）: ' + (await h.siderTitles(ctx)).join(' / '));
    ctx.assertIncludes((await h.userBubbles(ctx)).join(' | '), '九华山', '用户消息显示新问题');

    // User message now has two versions; switch between them.
    let versions = await h.switchers(ctx);
    ctx.assertEqual(versions.length, 1, '用户消息出现 1 个消息版本 pager');
    ctx.assertMatch(versions[0].count, /^2\s*\/\s*2$/, '当前在新分支（2 / 2）');
    await s.shot('branch-edit-new');

    await h.clickSwitcher(ctx, 0, -1);
    await s.waitFor((head) => {
      const bubbles = Array.from(document.querySelectorAll('[class*="UserMessage_bubble"]'))
        .map((node) => (node.innerText || '').trim()).join(' | ');
      const replies = Array.from(document.querySelectorAll('.ds-assistant-message-main-content'))
        .map((node) => (node.innerText || '').trim()).join(' | ');
      return bubbles.indexOf('黄山') >= 0 && replies.indexOf(head) >= 0;
    }, { timeout: 15000, label: '切回旧问题后旧回答也回来' }, [oldAnswer.replace(/\s+/g, ' ').slice(0, 12)]);
    const oldBubbles = (await h.userBubbles(ctx)).join(' | ');
    ctx.assertIncludes(oldBubbles, '黄山', '切回后用户消息是黄山问题');
    versions = await h.switchers(ctx);
    ctx.assertMatch(versions[0].count, /^1\s*\/\s*2$/, '切回旧分支后 pager 为 1 / 2');
    ctx.log('已切回旧分支：旧问题 + 旧回答');
    await s.shot('branch-edit-old');

    await h.clickSwitcher(ctx, 0, 1);
    await s.waitFor((head) => {
      const replies = Array.from(document.querySelectorAll('.ds-assistant-message-main-content'))
        .map((node) => (node.innerText || '').trim()).join(' | ');
      return replies.indexOf(head) >= 0;
    }, { timeout: 15000, label: '切回新分支回答' }, [newAnswer.replace(/\s+/g, ' ').slice(0, 12)]);
    ctx.assertIncludes((await h.userBubbles(ctx)).join(' | '), '九华山', '切回后用户消息是九华山问题');
    versions = await h.switchers(ctx);
    ctx.assertMatch(versions[0].count, /^2\s*\/\s*2$/, '切回新分支后 pager 为 2 / 2');

    // Regenerate: a second answer sibling appears under the same question.
    await s.clickSelector(h.HOST + ' [aria-label="重新生成"]');
    await h.waitReplyDone(ctx, 90000);
    await s.waitFor((host) => document.querySelectorAll(host + ' [aria-label="消息版本"]').length >= 2, {
      timeout: 15000, label: '回答下方出现第二个回答版本 pager',
    }, [h.HOST]);
    versions = await h.switchers(ctx);
    ctx.assert(versions.length >= 2, '出现了回答的版本 pager（共 ' + versions.length + ' 个）');
    ctx.assert(versions.some((item) => /^2\s*\/\s*2$/.test(item.count)), '回答 pager 为 2 / 2');
    ctx.assert((await h.replyText(ctx)).length > 0, '重新生成后的回答正文可读');
    ctx.log('重新生成完成，版本 pager: ' + versions.map((item) => item.count).join(' / '));
    await s.shot('branch-edit-regenerated');

    // Persisted tree in IndexedDB (demo auto-title does not contain the question).
    let stored = null;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const sessions = await h.readSessions(ctx);
      const found = sessions[0];
      if (found && Array.isArray(found.messages) && found.messages.length >= 5) {
        stored = found;
        break;
      }
      await s.wait(250);
    }
    ctx.assert(stored, 'IndexedDB 里该会话 messages ≥ 5（分支都保留）');
    ctx.assert(typeof stored.rootMessageId === 'string' && stored.rootMessageId, '会话有 rootMessageId');
    const roots = stored.messages.filter((message) => !message.parentId);
    ctx.assertEqual(roots.length, 2, '编辑首条消息后有两个根分支（旧问题 + 新问题）');
    const branched = stored.messages.some((parent) => stored.messages
      .filter((child) => child.parentId === parent.id && child.role === 'assistant').length >= 2);
    ctx.assert(branched, '同一问题下有两个回答分支（重新生成产生兄弟节点）');
    ctx.log('IndexedDB: ' + stored.messages.length + ' 条消息, ' + roots.length + ' 个根分支');

    // Reload: both pagers must still be there.
    await s.reload();
    await s.openPanel();
    const summaries = await h.readSummaries(ctx);
    ctx.assert(summaries.length >= 1, 'reload 后 IndexedDB 里仍有该会话');
    await h.openSession(ctx, summaries[0].title || '新对话');
    await s.waitFor((host) => document.querySelectorAll(host + ' [aria-label="消息版本"]').length >= 2, {
      timeout: 15000, label: 'reload 后两个版本 pager 仍在',
    }, [h.HOST]);
    versions = await h.switchers(ctx);
    ctx.assertMatch(versions[0].count, /^2\s*\/\s*2$/, 'reload 后用户 pager 仍是 2 / 2');
    ctx.assertIncludes((await h.userBubbles(ctx)).join(' | '), '九华山', 'reload 后可见新问题');
    ctx.log('reload 后 pager 仍在: ' + versions.map((item) => item.count).join(' / '));
    await s.shot('branch-edit');
  },
};
