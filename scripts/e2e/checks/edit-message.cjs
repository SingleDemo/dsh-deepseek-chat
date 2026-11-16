/**
 * Check: edit-message
 *
 * Send one question, wait for the reply, hover the user turn, click「编辑消息」,
 * assert the composer is prefilled and .dsc-editBar shows, change the text, send,
 * and assert the old answer disappeared while only one user turn remains.
 *
 * Costs 2 real API calls.
 */
'use strict';

/** Move the real mouse pointer over one element (CSS :hover needs it). */
async function hover(ctx, selector) {
  const box = await ctx.steps.eval((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = el.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, [selector]);
  if (!box) throw new Error('找不到要 hover 的元素: ' + selector);
  await ctx.page.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: box.x, y: box.y, button: 'none', buttons: 0,
  });
  await ctx.steps.wait(250);
  return box;
}

/** A real mouse click (gives the page a trusted user gesture). */
async function trustedClick(ctx, selector) {
  const box = await hover(ctx, selector);
  await ctx.page.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1,
  });
  await ctx.page.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: box.x, y: box.y, button: 'left', buttons: 0, clickCount: 1,
  });
  await ctx.steps.wait(120);
}

module.exports = {
  name: 'edit-message',
  description: '发一句 → hover 用户消息点「编辑消息」→ 输入框预填+出现 .dsc-editBar → 改文本发送 → 只剩 1 条用户消息、旧回答被删',
  timeoutMs: 150000,
  cost: 'api',
  settings: { thinking: 'off', webSearch: false },

  async run(ctx) {
    const s = ctx.steps;
    const firstPrompt = '请用一句话介绍黄山。';
    const secondPrompt = '请用一句话介绍九华山。';
    const newPromptHead = secondPrompt.slice(0, 8);

    // 1. One complete turn.
    await s.typeText('.dsc-input', firstPrompt);
    await s.send();
    await s.waitFor(() => {
      const body = document.querySelector('.dsc-botBody');
      return body && (body.innerText || '').trim();
    }, { timeout: 30000, label: '首条回复正文出现' });
    await s.waitFor(() => !document.querySelector('.dsc-caret'), {
      timeout: 30000, label: '首条回复流式结束',
    }).catch(() => {});
    const oldReply = await s.text('.dsc-botBody');
    ctx.assert(oldReply && oldReply.length > 5, '首条回复正文可读');
    ctx.assertEqual(await s.count('.dsc-turnUser'), 1, '编辑前只有 1 条用户消息');

    // 2. Hover reveals the edit action.
    await hover(ctx, '.dsc-turnUser');
    const actions = await s.eval(() => {
      const row = document.querySelector('.dsc-turnUser .dsc-userActions');
      const button = document.querySelector('.dsc-turnUser .dsc-plainAction');
      if (!row || !button) return null;
      return {
        opacity: getComputedStyle(row).opacity,
        text: (button.innerText || '').trim(),
      };
    });
    ctx.assert(actions, '用户消息里存在「编辑消息」按钮（.dsc-turnUser .dsc-plainAction）');
    ctx.assertEqual(actions.opacity, '1', 'hover 后编辑按钮可见（opacity 1）');
    ctx.assertMatch(actions.text, /编辑消息|Edit message/, '按钮文案是「编辑消息」');

    // 3. Click it: composer prefilled, edit bar shown.
    await trustedClick(ctx, '.dsc-turnUser .dsc-plainAction');
    await s.waitForSelector('.dsc-editBar', { timeout: 5000, label: '.dsc-editBar 出现' });
    const editBar = await s.text('.dsc-editBar');
    ctx.assertMatch(editBar, /正在编辑|Editing this message/, '.dsc-editBar 文案是「正在编辑…」');
    ctx.assertEqual(await s.value('.dsc-input'), firstPrompt, '输入框被填入原消息');

    // 4. Change the text and send.
    await s.typeText('.dsc-input', secondPrompt);
    ctx.assertEqual(await s.value('.dsc-input'), secondPrompt, '输入框已改成新文本');
    await s.send();

    await s.waitFor(() => !document.querySelector('.dsc-editBar'), {
      timeout: 5000, label: '发送后 .dsc-editBar 消失',
    });

    // 5. Only one user turn remains, carrying the new text; the old answer is gone.
    await s.waitFor(() => {
      const turns = Array.from(document.querySelectorAll('.dsc-turnUser'));
      return turns.length === 1 && (turns[0].innerText || '').indexOf('九华山') >= 0;
    }, { timeout: 15000, label: '会话里只剩 1 条用户消息且是新文本' });

    const oldHead = oldReply.replace(/\s+/g, ' ').slice(0, 14);
    await s.waitFor((head) => {
      const bodies = Array.from(document.querySelectorAll('.dsc-botBody'));
      if (!bodies.length) return false;
      const joined = bodies.map((body) => (body.innerText || '').replace(/\s+/g, ' ')).join(' | ');
      return joined.indexOf(head) < 0;
    }, { timeout: 15000, label: '旧回答已从 DOM 删除' }, [oldHead]);

    await s.waitFor(() => {
      const body = document.querySelector('.dsc-botBody');
      return body && (body.innerText || '').trim().length > 5;
    }, { timeout: 30000, label: '编辑后的新回复正文出现' });

    const newReply = await s.text('.dsc-botBody');
    ctx.assert(newReply && newReply !== oldReply, '新回复与旧回答不同');
    ctx.log('新回复: ' + newReply.replace(/\s+/g, ' ').slice(0, 80));
    ctx.assertEqual(await s.count('.dsc-turnUser'), 1, '编辑后仍只有 1 条用户消息');

    // The edit branch also re-titles a conversation whose first message changed.
    await s.waitFor(() => {
      const row = document.querySelector('.dsc-railList .dsc-rowTitle');
      const title = document.querySelector('.dsc-chatTitle');
      const rowText = row ? (row.innerText || '') : '';
      const chatText = title ? (title.innerText || '') : '';
      return rowText.indexOf('九华山') >= 0 && chatText.indexOf('九华山') >= 0;
    }, { timeout: 10000, label: '编辑后 rail 会话行与 .dsc-chatTitle 都更新为新问题' });

    const titles = await s.eval(() => ({
      rail: (document.querySelector('.dsc-railList .dsc-rowTitle') || {}).innerText || '',
      chat: (document.querySelector('.dsc-chatTitle') || {}).innerText || '',
    }));
    ctx.assertIncludes(titles.rail, secondPrompt.slice(0, 8), 'rail 会话行标题含新问题前几个字');
    ctx.assertIncludes(titles.chat, newPromptHead, '顶部 .dsc-chatTitle 含新问题前几个字');
    ctx.log('rail 标题: ' + titles.rail + ' · 顶部标题: ' + titles.chat);
    await s.shot('edit-message');
  },
};
