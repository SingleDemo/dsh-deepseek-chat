/**
 * Check: voice-copy
 *
 * Headless Chrome has no usable microphone. The composer's voice button must be
 * present and clicking it must surface the demo's microphone-error toast
 * (permission denied / no device), never crash the panel.
 */
'use strict';

const h = require('./lib/demo-helpers.cjs');

module.exports = {
  name: 'voice-copy',
  description: '输入区语音按钮存在；点击后 headless 无麦克风 → 出现「无法使用麦克风/未检测到麦克风」提示，面板不崩',
  timeoutMs: 90000,
  cost: 'none',
  settings: { thinking: false, search: false },

  async run(ctx) {
    const s = ctx.steps;
    const voice = await s.eval((host) => {
      const button = document.querySelector(host + ' [aria-label="语音输入"]');
      if (!button) return null;
      return {
        disabled: button.getAttribute('aria-disabled') === 'true',
        label: button.getAttribute('aria-label'),
      };
    }, [h.HOST]);
    ctx.assert(voice, '输入区有语音输入按钮（aria-label 语音输入）');
    ctx.assertEqual(voice.disabled, false, '安全上下文（localhost）里语音按钮可用');

    await h.trustedClick(ctx, h.HOST + ' [aria-label="语音输入"]');
    const toast = await h.waitToast(ctx, /无法使用麦克风|未检测到麦克风|语音识别失败|麦克风/, 15000);
    ctx.assert(toast, '点击语音后出现麦克风相关提示：' + toast);
    ctx.log('提示: ' + toast);
    ctx.assert(await s.exists(h.HOST), '面板仍然存在（没崩）');
    await s.shot('voice-copy');
  },
};
