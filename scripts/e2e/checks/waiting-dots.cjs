/**
 * Check: waiting-dots
 *
 * Throttle the network, send a message, and assert the composer/thread shows the
 * three waiting dots (.dsc-waitingDot) while the first token is still in flight.
 *
 * Costs one (aborted) API call.
 */
'use strict';

module.exports = {
  name: 'waiting-dots',
  description: '网络限速后发送 → 1-2s 内断言 .dsc-waitingDot 数量为 3',
  timeoutMs: 90000,
  cost: 'api',
  settings: { thinking: 'off', webSearch: false },

  async run(ctx) {
    const s = ctx.steps;
    let maxDots = 0;
    let waitingWrappers = 0;

    await s.throttle({ latency: 1500, downloadThroughput: 8000, uploadThroughput: 8000 });
    try {
      await s.typeText('.dsc-input', '写一段 200 字左右介绍安徽的短文。');
      await s.send();

      // Poll quickly: the dots only exist until the first token arrives.
      const deadline = Date.now() + 2500;
      while (Date.now() < deadline) {
        const dots = await s.count('.dsc-waitingDot');
        if (dots > maxDots) maxDots = dots;
        if (maxDots >= 3) break;
        await s.wait(100);
      }
      waitingWrappers = await s.count('.dsc-waiting');
      await s.shot('waiting-dots');
    } finally {
      await s.throttle(null).catch(() => {});
      // Stop the throttled request; this check only needs the waiting state.
      if (await s.exists('.dsc-send[data-stop]')) {
        await s.clickSelector('.dsc-send[data-stop]').catch(() => {});
      }
    }

    ctx.assert(waitingWrappers === 1, '等待态容器 .dsc-waiting 出现（实际 ' + waitingWrappers + ' 个）');
    ctx.assertEqual(maxDots, 3, '等待态圆点 .dsc-waitingDot 数量为 3（实测最大 ' + maxDots + '）');
    ctx.log('限速下捕获到 3 个等待圆点');
  },
};
