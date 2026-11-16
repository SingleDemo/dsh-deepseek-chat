/**
 * Check: branch-edit
 *
 * Editing the opening question must fork the conversation instead of replacing
 * it: the old question + answer stay reachable through a ‹ n / N › pager, the
 * new branch becomes the visible one, regenerating appends another answer
 * sibling, and the whole tree survives a reload.
 *
 * Costs 3 real API calls (initial reply, edited reply, regenerate).
 */
'use strict';

const OLD_PROMPT = '用一句话介绍黄山。';
const NEW_PROMPT = '用一句话介绍九华山。';

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
  await ctx.page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, button: 'none', buttons: 0 });
  await ctx.steps.wait(250);
  return box;
}

/** A real mouse click (trusted user gesture). */
async function trustedClick(ctx, selector) {
  const box = await hover(ctx, selector);
  await ctx.page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1 });
  await ctx.page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', buttons: 0, clickCount: 1 });
  await ctx.steps.wait(120);
}

/** Read one ‹ n / N › pager. */
async function readPager(ctx, scope) {
  return await ctx.steps.eval((sel) => {
    const pager = document.querySelector(sel);
    if (!pager) return null;
    const label = pager.querySelector('.dsc-versionLabel');
    const arrows = Array.from(pager.querySelectorAll('button'));
    return {
      label: label ? (label.innerText || '').trim() : '',
      arrows: arrows.map((button) => ({ disabled: button.disabled, title: button.getAttribute('title') || '' })),
    };
  }, [scope]);
}

/** Click one arrow of a pager (0 = previous / ‹, 1 = next / ›). */
async function clickArrow(ctx, scope, index) {
  const clicked = await ctx.steps.eval((sel, at) => {
    const pager = document.querySelector(sel);
    if (!pager) return false;
    const arrows = Array.from(pager.querySelectorAll('button'));
    const button = arrows[at];
    if (!button || button.disabled) return false;
    button.click();
    return true;
  }, [scope, index]);
  if (!clicked) throw new Error('pager 箭头不可点击: ' + scope + ' #' + index);
  await ctx.steps.wait(300);
}

const userText = (ctx) => ctx.steps.eval(() => Array.from(document.querySelectorAll('.dsc-turnUser .dsc-userText'))
  .map((node) => (node.innerText || '').trim()).join(' | '));
const botText = (ctx) => ctx.steps.eval(() => Array.from(document.querySelectorAll('.dsc-botBody'))
  .map((node) => (node.innerText || '').trim()).join(' | '));
const botFootText = (ctx) => ctx.steps.eval(() => Array.from(document.querySelectorAll('.dsc-botFoot'))
  .map((node) => (node.innerText || '').replace(/\s+/g, ' ').trim()).join(' | '));

module.exports = {
  name: 'branch-edit',
  description: '编辑首条消息 → 用户消息出现 .dsc-versions（2/2）→ 左箭头切回黄山问题+旧回答，右箭头切回新版本 → 重新生成出现 .dsc-botFoot .dsc-versions → reload 后 pager 仍在',
  timeoutMs: 240000,
  cost: 'api',
  settings: { thinking: 'off', webSearch: false },

  async run(ctx) {
    const s = ctx.steps;

    // 1. First question and answer.
    await s.typeText('.dsc-input', OLD_PROMPT);
    await s.send();
    await s.waitFor(() => {
      const body = document.querySelector('.dsc-botBody');
      return body && (body.innerText || '').trim().length > 5;
    }, { timeout: 30000, label: '首个回答正文出现' });
    await s.waitFor(() => !document.querySelector('.dsc-caret'), { timeout: 30000, label: '首个回答流式结束' }).catch(() => {});
    const oldAnswer = await botText(ctx);
    ctx.assert(oldAnswer && oldAnswer.length > 5, '旧回答正文可读');
    ctx.log('旧回答: ' + oldAnswer.replace(/\s+/g, ' ').slice(0, 60));

    // 2. Edit the opening question through the real hover + edit flow.
    await hover(ctx, '.dsc-turnUser');
    await trustedClick(ctx, '.dsc-turnUser .dsc-plainAction');
    await s.waitForSelector('.dsc-editBar', { timeout: 5000, label: '.dsc-editBar 出现' });
    ctx.assertEqual(await s.value('.dsc-input'), OLD_PROMPT, '输入框预填原问题');

    await s.typeText('.dsc-input', NEW_PROMPT);
    ctx.assertEqual(await s.value('.dsc-input'), NEW_PROMPT, '输入框改为新问题');
    await s.send();
    await s.waitFor(() => !document.querySelector('.dsc-editBar'), { timeout: 5000, label: '发送后编辑栏消失' });
    await s.waitFor((needle) => Array.from(document.querySelectorAll('.dsc-turnUser .dsc-userText'))
      .some((node) => (node.innerText || '').indexOf(needle) >= 0), {
      timeout: 15000, label: '用户消息显示新问题',
    }, [NEW_PROMPT]);
    await s.waitFor(() => {
      const body = document.querySelector('.dsc-botBody');
      return body && (body.innerText || '').trim().length > 5;
    }, { timeout: 30000, label: '新分支回答正文出现' });
    await s.waitFor(() => !document.querySelector('.dsc-caret'), { timeout: 30000, label: '新分支回答流式结束' }).catch(() => {});
    const newAnswer = await botText(ctx);
    ctx.assert(newAnswer && newAnswer !== oldAnswer, '新回答与旧回答不同');
    ctx.log('新回答: ' + newAnswer.replace(/\s+/g, ' ').slice(0, 60));

    // 3. Titles follow the edited opening question.
    await s.waitFor(() => {
      const row = document.querySelector('.dsc-railList .dsc-rowTitle');
      const chat = document.querySelector('.dsc-chatTitle');
      return row && chat
        && (row.innerText || '').indexOf('九华山') >= 0
        && (chat.innerText || '').indexOf('九华山') >= 0;
    }, { timeout: 10000, label: 'rail 与顶部标题都变成九华山' });
    const titles = await s.eval(() => ({
      rail: (document.querySelector('.dsc-railList .dsc-rowTitle') || {}).innerText || '',
      chat: (document.querySelector('.dsc-chatTitle') || {}).innerText || '',
    }));
    ctx.assertIncludes(titles.rail, NEW_PROMPT.slice(0, 8), 'rail 标题是新问题');
    ctx.assertIncludes(titles.chat, NEW_PROMPT.slice(0, 8), '顶部标题是新问题');
    ctx.log('标题: ' + titles.rail + ' / ' + titles.chat);

    // 4. The user turn now has a version pager on the new branch (2 / 2).
    await s.waitForSelector('.dsc-turnUser .dsc-versions', { timeout: 10000, label: '用户消息出现 .dsc-versions' });
    let pager = await readPager(ctx, '.dsc-turnUser .dsc-versions');
    ctx.assertEqual(pager.arrows.length, 2, '用户消息 pager 有左右两个箭头');
    ctx.assertMatch(pager.label, /^2\s*\/\s*2$/, '当前在新分支（2 / 2），实际 ' + pager.label);
    await s.shot('branch-edit-new');

    // 5. Switch back to the old question: the old answer must come with it.
    await clickArrow(ctx, '.dsc-turnUser .dsc-versions', 0);
    await s.waitFor((needle) => Array.from(document.querySelectorAll('.dsc-turnUser .dsc-userText'))
      .some((node) => (node.innerText || '').indexOf(needle) >= 0), {
      timeout: 10000, label: '左箭头切回黄山问题',
    }, ['黄山']);
    ctx.assert((await userText(ctx)).indexOf(NEW_PROMPT) < 0, '切回后用户消息不再是九华山');
    await s.waitFor((head) => (document.querySelector('.dsc-botBody') || {}).innerText
      && (document.querySelector('.dsc-botBody').innerText || '').indexOf(head) >= 0, {
      timeout: 10000, label: '旧分支回答文本回来',
    }, [oldAnswer.replace(/\s+/g, ' ').slice(0, 12)]);
    pager = await readPager(ctx, '.dsc-turnUser .dsc-versions');
    ctx.assertMatch(pager.label, /^1\s*\/\s*2$/, '切回旧分支后 pager 是 1 / 2');
    ctx.log('已切回旧分支，回答文本与旧回答一致');
    await s.shot('branch-edit-old');

    // 6. Switch forward again to the new branch.
    await clickArrow(ctx, '.dsc-turnUser .dsc-versions', 1);
    await s.waitFor((needle) => Array.from(document.querySelectorAll('.dsc-turnUser .dsc-userText'))
      .some((node) => (node.innerText || '').indexOf(needle) >= 0), {
      timeout: 10000, label: '右箭头切回九华山问题',
    }, ['九华山']);
    await s.waitFor((head) => (document.querySelector('.dsc-botBody') || {}).innerText
      && (document.querySelector('.dsc-botBody').innerText || '').indexOf(head) >= 0, {
      timeout: 10000, label: '新分支回答文本回来',
    }, [newAnswer.replace(/\s+/g, ' ').slice(0, 12)]);
    pager = await readPager(ctx, '.dsc-turnUser .dsc-versions');
    ctx.assertMatch(pager.label, /^2\s*\/\s*2$/, '切回新分支后 pager 是 2 / 2');

    // 7. Regenerate the new answer: a second answer sibling appears below it.
    await s.clickText(/^(重新生成|Regenerate)$/, { selector: '.dsc-botFoot' });
    await s.waitForSelector('.dsc-botFoot .dsc-versions', { timeout: 60000, label: '重新生成后回答下方出现 .dsc-botFoot .dsc-versions' });
    await s.waitFor(() => !document.querySelector('.dsc-caret'), { timeout: 30000, label: '重新生成结束' }).catch(() => {});
    const assistantPager = await readPager(ctx, '.dsc-botFoot .dsc-versions');
    ctx.assertEqual(assistantPager.arrows.length, 2, '回答 pager 有左右两个箭头');
    ctx.assertMatch(assistantPager.label, /^2\s*\/\s*2$/, '重新生成后回答 pager 是 2 / 2');
    const regenerated = await botText(ctx);
    ctx.assert(regenerated && regenerated.length > 0, '重新生成后的回答正文可读');
    ctx.log('重新生成完成，回答 pager: ' + assistantPager.label);
    await s.shot('branch-edit-regenerated');

    // 8. The tree (both branches) is persisted: >=5 messages, all replies done.
    //    The plugin persists on a 300ms debounce, so also wait until the last
    //    streaming snapshot was replaced by the finished one before reloading.
    let stored = null;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const list = await s.eval((key) => {
        try {
          const value = JSON.parse(window.localStorage.getItem(key) || '[]');
          return Array.isArray(value) ? value : [];
        } catch (error) {
          return [];
        }
      }, [require('../harness.cjs').CONVERSATIONS_KEY]);
      const found = list.find((item) => (item.title || '').indexOf('九华山') >= 0);
      if (found && Array.isArray(found.messages) && found.messages.length >= 5) {
        const replies = found.messages.filter((node) => node.role === 'assistant');
        const settled = replies.every((node) => node.status === 'done'
          || node.status === 'stopped' || node.status === 'error');
        const hasText = replies.some((node) => (node.blocks || [])
          .some((block) => block.type === 'text' && String(block.text || '').trim()));
        if (settled && hasText) {
          stored = found;
          break;
        }
      }
      await s.wait(200);
    }
    ctx.assert(stored, 'localStorage 里该会话 messages 数量 >= 5（分支都保留）且回答已落盘为完成态');
    ctx.assertEqual(stored.messages.length >= 5, true, '实际消息数 ' + stored.messages.length);
    ctx.assert(typeof stored.rootId === 'string' && stored.rootId, 'localStorage 里有 rootId');
    const roots = stored.messages.filter((node) => !node.parentId);
    ctx.assertEqual(roots.length, 2, '编辑首条消息后有两个根分支（旧问题 + 新问题）');
    const branched = stored.messages.some((parent) => stored.messages
      .filter((child) => child.parentId === parent.id && child.role === 'assistant').length >= 2);
    ctx.assert(branched, '同一问题下有两个回答分支（重新生成产生兄弟节点）');
    ctx.log('持久化: ' + stored.messages.length + ' 条消息, ' + roots.length + ' 个根分支, rootId=' + stored.rootId);

    // 9. Reload and reopen the conversation: both pagers must still be there.
    await s.reload();
    await s.openPanel();
    await s.waitFor(() => document.querySelectorAll('.dsc-railList .dsc-row').length >= 1, {
      timeout: 15000, label: 'reload 后 rail 恢复',
    });
    const opened = await s.eval(() => {
      const row = Array.from(document.querySelectorAll('.dsc-railList .dsc-row'))
        .find((item) => (item.innerText || '').indexOf('九华山') >= 0);
      if (!row) return null;
      row.click();
      return (row.innerText || '').replace(/\s+/g, ' ').trim();
    });
    ctx.assert(opened, 'reload 后能在 rail 找到并打开九华山会话');
    await s.waitForSelector('.dsc-turnUser .dsc-versions', { timeout: 10000, label: 'reload 后用户消息 pager 仍在（树持久化）' });
    await s.waitForSelector('.dsc-botFoot .dsc-versions', { timeout: 10000, label: 'reload 后回答 pager 仍在' });
    await s.waitFor(() => document.querySelectorAll('.dsc-turnUser .dsc-userText').length > 0, {
      timeout: 10000, label: 'reload 后会话正文渲染',
    });
    pager = await readPager(ctx, '.dsc-turnUser .dsc-versions');
    ctx.assertMatch(pager.label, /^2\s*\/\s*2$/, 'reload 后用户 pager 仍是 2 / 2');
    const afterReload = await readPager(ctx, '.dsc-botFoot .dsc-versions');
    ctx.assertMatch(afterReload.label, /^2\s*\/\s*2$/, 'reload 后回答 pager 仍是 2 / 2');
    ctx.log('reload 后 pager 仍在: 用户 ' + pager.label + ' · 回答 ' + afterReload.label);
    await s.shot('branch-edit');
  },
};
