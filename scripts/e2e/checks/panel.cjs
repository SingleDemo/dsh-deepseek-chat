/**
 * Check: panel
 *
 * The panel is now the vendored chat-demo app rendered inside `.dsc-demo-host`.
 * This check proves the entry opens it and the new shell is fully there: sider,
 * welcome copy, composer textarea and its buttons (deep think / web search /
 * voice / attach / send), plus the host theme class.
 */
'use strict';

const h = require('./lib/demo-helpers.cjs');

module.exports = {
  name: 'panel',
  description: '入口进入面板 → .dsc-demo-host 渲染 + 主题 class → 欢迎语「今天有什么可以帮到你？」→ sider（开启新对话/设置）→ 输入区（textarea/深度思考/智能搜索/语音/附件/发送）',
  timeoutMs: 90000,
  cost: 'none',
  settings: { thinking: false, search: false },

  async run(ctx) {
    const s = ctx.steps;

    ctx.assert(await s.exists(h.HOST), '面板根节点 .dsc-demo-host 存在');
    const host = await s.eval((selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        classes: Array.from(node.classList),
        dark: node.classList.contains('dark'),
        light: node.classList.contains('light'),
      };
    }, [h.HOST]);
    ctx.assert(host && host.width > 400 && host.height > 300,
      '面板尺寸正常（' + (host ? host.width + 'x' + host.height : 'null') + '）');
    ctx.assert(host.dark || host.light, '面板容器跟随主题带有 dark/light class（' + host.classes.join(' ') + '）');
    ctx.log('面板尺寸 ' + host.width + 'x' + host.height + '，主题 ' + (host.dark ? 'dark' : 'light'));

    const text = await s.text(h.HOST);
    ctx.assertIncludes(text, '今天有什么可以帮到你？', '欢迎语文案');
    ctx.assertIncludes(text, '开启新对话', 'sider 有新会话按钮');
    ctx.assertIncludes(text, '设置', 'sider 底部有设置按钮');

    ctx.assert(await s.exists(h.HOST + ' textarea'), '输入区 textarea 存在');
    for (const label of ['深度思考', '智能搜索', '语音输入', '上传文件']) {
      const found = await s.exists(h.HOST + ' [aria-label="' + label + '"]');
      ctx.assert(found, '输入区按钮存在：' + label);
    }
    const send = await s.eval((selector) => {
      const button = document.querySelector(selector);
      return button ? { disabled: button.getAttribute('aria-disabled') } : null;
    }, [h.HOST + ' button[aria-label="' + h.SEND_LABEL + '"]']);
    ctx.assert(send, '发送按钮存在（aria-label 发送）');
    ctx.assertEqual(send.disabled, 'true', '空输入时发送按钮为 aria-disabled 状态');

    ctx.log('sider / 欢迎页 / 输入区元素齐全');
    await s.shot('panel');
  },
};
