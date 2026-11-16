/**
 * Check: waiting-dots
 *
 * Throttle the network, send a message, and assert the demo shows its three
 * waiting dots (`[class*=waitingDot]`) before the first token arrives.
 */
'use strict';

const h = require('./lib/demo-helpers.cjs');

module.exports = {
  name: 'waiting-dots',
  description: '网络限速后发送 → 1-2s 内出现 3 个等待圆点 [class*=waitingDot]，随后停止生成',
  timeoutMs: 90000,
  cost: 'api',
  settings: { thinking: false, search: false },

  async run(ctx) {
    const s = ctx.steps;
    let maxDots = 0;
    let wrappers = 0;

    await s.throttle({ latency: 1500, downloadThroughput: 8000, uploadThroughput: 8000 });
    try {
      await h.typeComposer(ctx, '写一段 200 字左右介绍安徽的短文。');
      await s.send();
      const deadline = Date.now() + 2500;
      while (Date.now() < deadline) {
        const dots = await s.count(h.HOST + ' [class*="waitingDot"]');
        if (dots > maxDots) maxDots = dots;
        if (maxDots >= 3) break;
        await s.wait(100);
      }
      wrappers = await s.eval((host) => document.querySelectorAll(host + ' [class*="waiting"]').length, [h.HOST]);
      if (maxDots >= 3) await s.shot('waiting-dots');
    } finally {
      await s.throttle(null).catch(() => {});
      if (await s.exists(h.HOST + ' button[aria-label="停止生成"]')) {
        await s.clickSelector(h.HOST + ' button[aria-label="停止生成"]').catch(() => {});
      }
    }

    ctx.assert(wrappers >= 1, '等待态容器出现（' + wrappers + ' 个）');
    ctx.assertEqual(maxDots, 3, '等待圆点数量为 3（实测最大 ' + maxDots + '）');
    ctx.log('限速下捕获到 3 个等待圆点');
  },
};
