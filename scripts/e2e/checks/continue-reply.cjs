/**
 * Check: continue-reply
 *
 * Ask for a long answer, stop it with the .dsc-send[data-stop] button, then use
 * the「继续生成」button: the reply body must grow and the button must disappear.
 *
 * Costs 2 real API calls.
 */
'use strict';

module.exports = {
  name: 'continue-reply',
  description: '发长回答请求 → 2-3s 后 stop → 出现 .dsc-continueButton「继续生成」→ 点击后正文变长且按钮消失',
  timeoutMs: 180000,
  cost: 'api',
  settings: { thinking: 'off', webSearch: false },

  async run(ctx) {
    const s = ctx.steps;
    const prompt = '请用大约 600 字详细介绍安徽省的地理、历史、文化和美食，分点说明，内容要充实。';

    await s.typeText('.dsc-input', prompt);
    await s.send();

    // Wait for the first tokens so the stopped reply has a body to continue.
    await s.waitFor(() => {
      const body = document.querySelector('.dsc-botBody');
      return body && (body.innerText || '').trim().length > 0;
    }, { timeout: 30000, label: '首段回复正文出现' });

    await s.wait(1600);
    const stopButton = await s.exists('.dsc-send[data-stop]');
    ctx.assert(stopButton, '生成中发送按钮切换为停止按钮 .dsc-send[data-stop]');
    await s.clickSelector('.dsc-send[data-stop]');

    // The foot with the continue button only renders once the stream stopped.
    await s.waitForSelector('.dsc-continueButton', { timeout: 15000, label: '停止后出现 .dsc-continueButton' });
    const continueText = await s.text('.dsc-continueButton');
    ctx.assertMatch(continueText, /继续生成|Continue generating/, '按钮文案是「继续生成」');

    const lengthBefore = await s.eval(() => {
      const body = document.querySelector('.dsc-botBody');
      return body ? (body.innerText || '').trim().length : 0;
    });
    ctx.assert(lengthBefore > 0, '停止时已有部分正文（' + lengthBefore + ' 字）');
    ctx.log('停止时正文长度: ' + lengthBefore);
    await s.shot('continue-reply-stopped');

    await s.clickSelector('.dsc-continueButton');

    // While streaming the foot is hidden, so the button must vanish.
    await s.waitFor(() => !document.querySelector('.dsc-continueButton'), {
      timeout: 10000, label: '点击后继续按钮消失（进入生成中）',
    });

    await s.waitFor((previous) => {
      const body = document.querySelector('.dsc-botBody');
      return body ? (body.innerText || '').trim().length > previous : false;
    }, { timeout: 60000, label: '继续生成后正文变长' }, [lengthBefore]);

    await s.waitFor(() => !document.querySelector('.dsc-caret'), {
      timeout: 60000, label: '继续生成结束',
    }).catch(() => {});

    const lengthAfter = await s.eval(() => {
      const body = document.querySelector('.dsc-botBody');
      return body ? (body.innerText || '').trim().length : 0;
    });
    ctx.assert(lengthAfter > lengthBefore,
      '正文确实变长（' + lengthBefore + ' → ' + lengthAfter + ' 字）');
    // If the service cut it again at max_tokens the button may legitimately
    // reappear; only log it instead of failing on that.
    if (await s.exists('.dsc-continueButton')) {
      ctx.log('提示: 继续生成后又被截断，按钮再次出现（服务端 max_tokens，不算失败）');
    }
    ctx.log('最终正文长度: ' + lengthAfter);
    await s.shot('continue-reply');
  },
};
