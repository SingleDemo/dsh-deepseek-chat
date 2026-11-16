/**
 * Check: settings
 *
 * Opens the settings dialog and verifies the API key field is there. The key is
 * seeded from the credentials file; the assertion only checks that a non-empty
 * value arrived, never the value itself.
 */
'use strict';

module.exports = {
  name: 'settings',
  description: '打开设置 → 断言 API Key 输入框存在（password 类型、已注入值）',
  timeoutMs: 60000,
  cost: 'none',

  async run(ctx) {
    const s = ctx.steps;

    // Either the rail footer row or the header gear opens the dialog; the panel
    // keeps both, and the viewport used by the runner is wide so the rail shows.
    const trigger = await s.eval(() => {
      const railFoot = document.querySelector('.dsc-railFoot .dsc-row');
      if (railFoot) { railFoot.click(); return 'railFoot'; }
      const headButtons = document.querySelectorAll('.dsc-chatHead .dsc-iconButton');
      const gear = headButtons[headButtons.length - 1];
      if (gear) { gear.click(); return 'chatHead'; }
      return null;
    });
    ctx.assert(trigger, '找到设置入口（rail 底部行或标题栏齿轮）');
    ctx.log('设置入口: ' + trigger);

    await s.waitForSelector('.dsc-dialog', { timeout: 10000, label: '设置对话框 .dsc-dialog' });

    const dialog = await s.eval(() => {
      const root = document.querySelector('.dsc-dialog');
      if (!root) return null;
      const title = root.querySelector('.dsc-dialogTitle');
      const key = root.querySelector('#dsc-api-key');
      return {
        title: title ? (title.textContent || '').trim() : '',
        key: key ? {
          type: key.type,
          valueLength: (key.value || '').length,
          placeholder: key.placeholder,
          visible: key.getBoundingClientRect().width > 0,
        } : null,
        fields: Array.from(root.querySelectorAll('input, select, textarea')).map((element) => element.id),
      };
    });

    ctx.assert(dialog, '设置对话框可读取');
    ctx.assertMatch(dialog.title, /设置|Settings/, '对话框标题是「设置」');
    ctx.assert(dialog.key, 'API Key 输入框 #dsc-api-key 存在');
    ctx.assertEqual(dialog.key.type, 'password', 'API Key 输入框是 password 类型');
    ctx.assert(dialog.key.visible, 'API Key 输入框可见');
    ctx.assert(dialog.key.valueLength > 0, 'API Key 已从凭证注入（仅断言长度 > 0，不打印值）');
    ctx.log('字段: ' + dialog.fields.filter(Boolean).join(', '));

    await s.shot('settings');
    // Leave the dialog open: that is the state the screenshot should show.
  },
};
