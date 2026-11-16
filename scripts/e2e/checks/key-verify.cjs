/**
 * Check: key-verify
 *
 * The demo's 数据管理 tab verifies a key with GET /models before saving it. This
 * check proves the seeded key is persisted as a mask, an invalid key shows the
 * official error copy, and re-entering the real key restores the mask.
 * The key value is never printed.
 */
'use strict';

const h = require('./lib/demo-helpers.cjs');

module.exports = {
  name: 'key-verify',
  description: '数据管理里 API Key 显示掩码 → 改成 sk-invalid… 确定后出现「API Key 无效」→ 换回真 Key 后恢复掩码',
  timeoutMs: 120000,
  cost: 'api',
  settings: { thinking: false, search: false },

  async run(ctx) {
    const s = ctx.steps;
    await h.openSettingsTab(ctx, '数据管理');

    const masked = await s.eval((host) => {
      const dialog = document.querySelector(host + ' [role="dialog"]');
      const match = (dialog.innerText || '').match(/\*{20,}/);
      return match ? match[0].length : 0;
    }, [h.HOST]);
    ctx.assert(masked > 0, '已注入的 Key 以掩码展示（长度 ' + masked + '）');

    await s.clickSelector(h.SETTINGS_DIALOG + ' button[aria-label="修改 API Key"]');
    await s.waitForSelector(h.SETTINGS_DIALOG + ' input[type="password"]', {
      timeout: 5000, label: '修改 API Key 的密码输入框',
    });

    await s.typeText(h.SETTINGS_DIALOG + ' input[type="password"]', 'sk-invalid-000000000000000000000000');
    await h.clickByText(ctx, /^确定$/, h.SETTINGS_DIALOG);
    await s.waitFor((host) => {
      const dialog = document.querySelector(host + ' [role="dialog"]');
      return Boolean(dialog) && /API Key 无效/.test(dialog.innerText || '');
    }, { timeout: 20000, label: '无效 Key 的错误文案' }, [h.HOST]);
    ctx.assert(true, '无效 Key 提示「API Key 无效，请检查后重试」');
    await s.shot('key-verify');
    ctx.log('无效 Key 已被拒绝');

    // Re-enter the real key: it verifies against GET /models and saves as a mask.
    const goodKey = process.env.DEEPSEEK_API_KEY;
    ctx.assert(goodKey && goodKey.length > 10, '测试环境里有可用的 DEEPSEEK_API_KEY');
    await s.typeText(h.SETTINGS_DIALOG + ' input[type="password"]', goodKey);
    await h.clickByText(ctx, /^确定$/, h.SETTINGS_DIALOG);
    await s.waitFor((host) => {
      const dialog = document.querySelector(host + ' [role="dialog"]');
      return Boolean(dialog) && Boolean(dialog.querySelector('button[aria-label="修改 API Key"]'))
        && /\*{20,}/.test(dialog.innerText || '');
    }, { timeout: 25000, label: '真 Key 验证通过并恢复掩码' }, [h.HOST]);
    ctx.assert(true, '真 Key 验证通过，恢复掩码显示');
    ctx.assert(!(await s.exists(h.SETTINGS_DIALOG + ' input[type="password"]')), '保存后密码输入框收起');
    ctx.log('遮罩恢复，Key 未被明文展示');
    await h.closeSettings(ctx);
  },
};
