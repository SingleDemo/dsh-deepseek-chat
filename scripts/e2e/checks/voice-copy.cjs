/**
 * Check: voice-copy
 *
 * Headless Chrome has no usable microphone. Clicking the mic button must either
 * show recordDenied / recordFailed or start a recording that can be stopped.
 * Minimum assertion per the spec: the button title is「语音输入」while idle.
 *
 * Costs no API calls (transcription would need a recording; we never get one).
 */
'use strict';

async function micRect(ctx) {
  return await ctx.steps.eval(() => {
    const buttons = Array.from(document.querySelectorAll('.dsc-composer .dsc-tool'));
    const button = buttons.find((item) => {
      const title = item.getAttribute('title') || '';
      return /语音输入|Voice input/i.test(title);
    });
    if (!button) return null;
    button.scrollIntoView({ block: 'center' });
    const rect = button.getBoundingClientRect();
    return {
      title: button.getAttribute('title') || '',
      recording: button.getAttribute('data-recording') === 'true',
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    };
  });
}

async function trustedClickAt(ctx, point) {
  await ctx.page.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1,
  });
  await ctx.page.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1,
  });
  await ctx.steps.wait(120);
}

module.exports = {
  name: 'voice-copy',
  description: '麦克风按钮 idle title 是「语音输入」；点击后必须出现 recordDenied/recordFailed 提示（headless 无麦克风）',
  timeoutMs: 90000,
  cost: 'none',
  settings: { thinking: 'off', webSearch: false },

  async run(ctx) {
    const s = ctx.steps;

    const mic = await micRect(ctx);
    ctx.assert(mic, '输入区存在麦克风按钮');
    ctx.assertMatch(mic.title, /语音输入|Voice input/, 'idle 时麦克风 title 是「语音输入」（实际: ' + mic.title + '）');
    ctx.assertEqual(mic.recording, false, 'idle 时未在录音');

    // Real user gesture: getUserMedia needs one to settle immediately.
    await trustedClickAt(ctx, mic);
    await s.wait(300);

    const outcome = await s.waitFor(() => {
      const recording = document.querySelector('.dsc-composer .dsc-tool[data-recording="true"]');
      if (recording) return 'recording';
      const notices = Array.from(document.querySelectorAll('.dsc-notice'))
        .map((node) => (node.innerText || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      const hit = notices.find((text) => /麦克风|录音|Microphone|Could not start/i.test(text));
      return hit ? 'notice:' + hit : '';
    }, { timeout: 12000, interval: 150, label: '点击麦克风后出现录音状态或提示' });

    if (outcome === 'recording') {
      ctx.log('headless 里居然进入了录音状态（data-recording=true），点击停止');
      const again = await micRect(ctx);
      await trustedClickAt(ctx, again);
      await s.wait(600);
    } else {
      const noticeText = String(outcome).replace(/^notice:/, '');
      ctx.log('提示: ' + noticeText);
      ctx.assertMatch(
        noticeText,
        /麦克风权限被拒绝|无法启动麦克风|Microphone access was denied|Could not start the microphone/i,
        '提示走的是 recordDenied / recordFailed 文案',
      );
    }

    const after = await micRect(ctx);
    ctx.assert(after, '点击后麦克风按钮仍在');
    ctx.assertMatch(after.title, /语音输入|Voice input|停止|Stop/i, '按钮 title 处于已知状态');
    await s.shot('voice-copy');
  },
};
