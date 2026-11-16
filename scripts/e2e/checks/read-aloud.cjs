/**
 * Check: read-aloud
 *
 * Send a short question, wait for the finished answer, click the demo's朗读
 * button (TTS) and assert the button flips to 停止朗读 / a playing state.
 * Costs one generation + one TTS synthesis.
 */
'use strict';

const h = require('./lib/demo-helpers.cjs');

module.exports = {
  name: 'read-aloud',
  description: '对已完成回答点朗读按钮 → 等 TTS → 按钮变 停止朗读（出现播放态）→ 停止朗读',
  timeoutMs: 180000,
  cost: 'api',
  settings: { thinking: false, search: false },

  async run(ctx) {
    const s = ctx.steps;
    await h.ask(ctx, '用一句话介绍巢湖。');
    await h.waitReplyDone(ctx, 90000);

    const buttons = await s.eval((host) => Array.from(document.querySelectorAll(host + ' [aria-label="朗读"]')).length, [h.HOST]);
    ctx.assert(buttons > 0, '回答下方有朗读按钮（aria-label 朗读）');

    await h.trustedClick(ctx, h.HOST + ' [aria-label="朗读"]');
    await s.waitFor((host) => Boolean(document.querySelector(host + ' [aria-label="停止朗读"]')), {
      timeout: 30000, label: 'TTS 开始后按钮变「停止朗读」',
    }, [h.HOST]);
    const playing = await s.eval((host) => {
      const button = document.querySelector(host + ' [aria-label="停止朗读"]');
      return button ? { label: button.getAttribute('aria-label'), pressed: button.getAttribute('aria-pressed') } : null;
    }, [h.HOST]);
    ctx.assert(playing, '朗读按钮进入播放态');
    ctx.assertEqual(playing.label, '停止朗读', '播放态 aria-label 是「停止朗读」');
    ctx.log('TTS 播放中: ' + playing.label);
    await s.shot('read-aloud');

    await h.trustedClick(ctx, h.HOST + ' [aria-label="停止朗读"]');
    await s.wait(600);
    ctx.log('已停止朗读');
  },
};
