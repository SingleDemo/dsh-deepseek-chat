/**
 * Check: panel
 *
 * Opens the panel from the sidebar entry, verifies the welcome screen and the
 * composer, sends one short real message, and waits up to 30 s for a non-empty
 * reply body. This is the smoke check that proves the panel can talk to the API.
 *
 * Costs one real API call.
 */
'use strict';

module.exports = {
  name: 'panel',
  description: '打开面板 → 断言欢迎语/输入框 → 发「用一句话介绍合肥。」→ 30s 内出现非空回复正文',
  timeoutMs: 90000,
  cost: 'api',
  // Keep the smoke check fast and single-purpose: no reasoning, no web search.
  settings: { thinking: 'off', webSearch: false },

  async run(ctx) {
    const s = ctx.steps;

    ctx.assert(await s.exists('.dsc-root'), '面板根节点 .dsc-root 存在');

    const welcome = await s.eval(() => {
      const title = document.querySelector('.dsc-welcomeTitle');
      if (!title) return null;
      const box = title.getBoundingClientRect();
      return { text: (title.textContent || '').trim(), visible: box.width > 0 && box.height > 0 };
    });
    ctx.assert(welcome && welcome.text, '欢迎语标题 .dsc-welcomeTitle 存在且非空');
    ctx.assert(welcome.visible, '欢迎语标题可见');
    ctx.assertMatch(
      welcome.text,
      /今天想聊点什么|What may I help you/,
      '欢迎语文案属于已知 locale',
    );

    ctx.assert(await s.exists('.dsc-input'), '输入框 .dsc-input 存在');

    const prompt = '用一句话介绍合肥。';
    await s.typeText('.dsc-input', prompt);
    ctx.assertEqual(await s.value('.dsc-input'), prompt, '输入框内容已写入');

    await s.send();
    ctx.log('已发送，等待回复正文…');

    const reply = await s.waitFor(() => {
      const body = document.querySelector('.dsc-botBody');
      if (!body) return '';
      return (body.innerText || body.textContent || '').trim();
    }, { timeout: 30000, label: '.dsc-botBody 出现非空回复正文（30s）' });

    ctx.assert(reply.length > 0, '回复正文非空');
    ctx.assert(await s.exists('.dsc-turnUser'), '用户消息已渲染');

    // The assertion above is the acceptance criterion; waiting for the caret to
    // disappear only makes the screenshot show the finished reply.
    const settled = await s.waitFor(
      () => !document.querySelector('.dsc-caret'),
      { timeout: 20000, interval: 200, label: '流式输出结束（caret 消失）' },
    ).then(() => true, () => false);
    if (!settled) ctx.log('提示: 20s 内流式输出未结束，截图可能是生成中状态');

    const fullReply = await s.text('.dsc-botBody');
    ctx.assert(fullReply && fullReply.trim().length > 0, '流式结束后回复正文仍非空');
    ctx.log('回复: ' + fullReply.replace(/\s+/g, ' ').slice(0, 120));
    await s.shot('panel');
  },
};
