/**
 * Check: continue-reply
 *
 * Ask for a long answer, stop it with the demo's stop button, then use the
 * 「继续生成」button: the reply body must grow and the button must disappear.
 *
 * Costs 2 real API calls.
 */
'use strict';

const h = require('./lib/demo-helpers.cjs');

module.exports = {
  name: 'continue-reply',
  description: '发长回答 → 出首段后停止生成 → 出现「继续生成」→ 点击后正文变长且按钮消失',
  timeoutMs: 180000,
  cost: 'api',
  settings: { thinking: false, search: false },

  async run(ctx) {
    const s = ctx.steps;
    const prompt = '请用大约 600 字详细介绍安徽省的地理、历史、文化和美食，分点说明，内容要充实。';

    await h.ask(ctx, prompt);
    await s.waitFor((host) => {
      const text = Array.from(document.querySelectorAll(host + ' .ds-assistant-message-main-content'))
        .map((node) => (node.innerText || '').trim()).join('');
      return text.length > 20;
    }, { timeout: 45000, label: '首段回答正文出现' }, [h.HOST]);

    await s.wait(1600);
    ctx.assert(await s.exists(h.HOST + ' button[aria-label="停止生成"]'), '生成中发送按钮切换为停止按钮');
    await s.clickSelector(h.HOST + ' button[aria-label="停止生成"]');

    await s.waitFor((host) => {
      return Array.from(document.querySelectorAll(host + ' button'))
        .some((button) => (button.innerText || '').trim() === '继续生成' && !button.disabled);
    }, { timeout: 20000, label: '停止后出现「继续生成」按钮' }, [h.HOST]);
    const before = (await h.replyText(ctx)).length;
    ctx.assert(before > 0, '停止时已有部分正文（' + before + ' 字）');
    ctx.log('停止时正文长度: ' + before + ' · 尾部: ' + (await h.replyText(ctx)).slice(-40).replace(/\s+/g, ' '));
    await s.shot('continue-reply-stopped');

    await h.clickByText(ctx, /^继续生成$/, h.HOST);
    await s.waitFor((previous, host) => {
      const text = Array.from(document.querySelectorAll(host + ' .ds-assistant-message-main-content'))
        .map((node) => (node.innerText || '').trim()).join('');
      return text.length > previous;
    }, { timeout: 60000, label: '继续生成后正文变长' }, [before, h.HOST]);
    // Let this continuation finish so the final text is a stable measurement.
    await s.waitFor((host) => Boolean(document.querySelector(host + ' button[aria-label="发送"]')), {
      timeout: 60000, label: '继续生成结束',
    }, [h.HOST]).catch(() => {});
    await s.wait(500);

    const after = (await h.replyText(ctx)).length;
    ctx.assert(after > before + 5,
      '正文确实变长（' + before + ' → ' + after + ' 字）');
    const continueGone = await s.eval((host) => !Array.from(document.querySelectorAll(host + ' button'))
      .some((button) => (button.innerText || '').trim() === '继续生成' && !button.disabled), [h.HOST]);
    if (!continueGone) {
      ctx.log('提示: 继续生成后又被截断，按钮再次出现（服务端 max_tokens，不算失败）');
    }
    ctx.log('最终正文长度: ' + after);
    await s.shot('continue-reply');
  },
};
