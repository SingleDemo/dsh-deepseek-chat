/**
 * Check: read-aloud
 *
 * Send a short question, wait for the finished reply, click「朗读」and assert the
 * speaking waveform .dsc-soundBars appears. TTS synthesis is a billed API call,
 * so this check is marked cost:'api' and gets a long timeout.
 */
'use strict';

async function trustedClick(ctx, selector) {
  const box = await ctx.steps.eval((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = el.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, [selector]);
  if (!box) throw new Error('找不到可点击元素: ' + selector);
  await ctx.page.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: box.x, y: box.y, button: 'none', buttons: 0,
  });
  await ctx.page.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1,
  });
  await ctx.page.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: box.x, y: box.y, button: 'left', buttons: 0, clickCount: 1,
  });
  await ctx.steps.wait(120);
}

module.exports = {
  name: 'read-aloud',
  description: '对已完成回答点 .dsc-speakAction「朗读」→ 等 TTS → 断言出现 .dsc-soundBars 波形（消耗 TTS 计费）',
  timeoutMs: 180000,
  cost: 'api',
  settings: { thinking: 'off', webSearch: false },

  async run(ctx) {
    const s = ctx.steps;

    await s.typeText('.dsc-input', '用一句话介绍巢湖。');
    await s.send();
    await s.waitFor(() => {
      const body = document.querySelector('.dsc-botBody');
      return body && (body.innerText || '').trim().length > 5;
    }, { timeout: 30000, label: '回复正文出现' });
    await s.waitFor(() => !document.querySelector('.dsc-caret'), {
      timeout: 30000, label: '回复流式结束',
    }).catch(() => {});

    await s.waitForSelector('.dsc-speakAction', { timeout: 10000, label: '朗读按钮 .dsc-speakAction' });
    const before = await s.eval(() => {
      const button = document.querySelector('.dsc-speakAction');
      return {
        title: button.getAttribute('title') || '',
        playing: button.getAttribute('data-playing'),
        bars: document.querySelectorAll('.dsc-soundBars').length,
      };
    });
    ctx.assertMatch(before.title, /朗读|Read aloud/i, '朗读按钮 title 是「朗读」');
    ctx.assertEqual(before.playing, 'false', '点击前未在播放');
    ctx.assertEqual(before.bars, 0, '点击前没有波形');

    await trustedClick(ctx, '.dsc-speakAction');
    ctx.log('已点击朗读，等待 TTS 与波形…');

    await s.waitFor(() => document.querySelectorAll('.dsc-soundBars').length > 0, {
      timeout: 25000, interval: 80, label: '朗读中出现 .dsc-soundBars 波形',
    });

    const playing = await s.eval(() => {
      const button = document.querySelector('.dsc-speakAction');
      return {
        playing: button.getAttribute('data-playing'),
        bars: document.querySelectorAll('.dsc-soundBars').length,
        title: button.getAttribute('title') || '',
      };
    });
    ctx.assert(playing.bars > 0, '波形 .dsc-soundBars 存在（' + playing.bars + ' 个）');
    ctx.assertEqual(playing.playing, 'true', '朗读按钮进入播放态（data-playing=true）');
    ctx.assertMatch(playing.title, /停止朗读|Stop reading/i, '播放中按钮 title 变成「停止朗读」');
    await s.shot('read-aloud');

    // Stop playback so the next check starts clean.
    await trustedClick(ctx, '.dsc-speakAction');
    await s.wait(500);
    ctx.log('已停止朗读');
  },
};
