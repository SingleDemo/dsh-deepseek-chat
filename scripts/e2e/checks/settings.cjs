/**
 * Check: settings
 *
 * The demo's settings dialog is portaled into the panel (overlay dims the panel,
 * not the Harness window) and has two tabs. This check asserts the tabs, the two
 * plugin extras on 通用设置 (思考强度 / API 地址), the data-management rows, and
 * that the theme control follows "跟随系统" / switches the host class.
 */
'use strict';

const h = require('./lib/demo-helpers.cjs');

module.exports = {
  name: 'settings',
  description: '面板内设置弹窗 + 两个 tab；通用设置含思考强度/API 地址/主题跟随系统；数据管理含 API Key/导入/导出/删除全部',
  timeoutMs: 90000,
  cost: 'none',
  settings: { thinking: false, search: false, theme: 'system' },

  async run(ctx) {
    const s = ctx.steps;
    await h.openSettings(ctx);

    const dialog = await s.eval((host) => {
      const node = document.querySelector(host + ' [role="dialog"]');
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      const overlay = node.closest('[class*="overlay"]');
      const hostRect = document.querySelector(host).getBoundingClientRect();
      return {
        text: node.innerText || '',
        width: Math.round(rect.width),
        overlay: Boolean(overlay),
        overlayWidth: overlay ? Math.round(overlay.getBoundingClientRect().width) : 0,
        hostWidth: Math.round(hostRect.width),
        tabs: Array.from(node.querySelectorAll('[role="tab"]')).map((tab) => (tab.innerText || '').trim()),
      };
    }, [h.HOST]);
    ctx.assert(dialog, '设置弹窗 [role=dialog] 在面板内');
    ctx.assert(dialog.overlay, '弹窗有 [class*=overlay] 遮罩');
    ctx.assert(Math.abs(dialog.overlayWidth - dialog.hostWidth) <= 2,
      '遮罩尺寸等于面板（面板 ' + dialog.hostWidth + 'px，遮罩 ' + dialog.overlayWidth + 'px）');
    ctx.assertEqual(dialog.tabs.join(','), '通用设置,数据管理', '设置有两个 tab：通用设置 / 数据管理');

    // 通用设置: plugin extras + theme control.
    ctx.assertIncludes(dialog.text, '主题', '通用设置有主题行');
    const radios = await s.eval((host) => Array.from(document.querySelectorAll(host + ' [role="dialog"] [role="radio"]'))
      .map((node) => ({ text: (node.innerText || '').trim(), checked: node.getAttribute('aria-checked') === 'true' })), [h.HOST]);
    ctx.assertEqual(radios.length, 3, '主题有浅色/深色/跟随系统三个选项');
    ctx.assert(radios.some((item) => item.text === '跟随系统' && item.checked),
      '默认主题是「跟随系统」');
    ctx.assert(await s.exists(h.HOST + ' [role="dialog"] [aria-label="思考强度"]'), '通用设置里有「思考强度」选择器');
    const effort = await s.text(h.HOST + ' [role="dialog"] [aria-label="思考强度"]');
    ctx.assertMatch(effort, /高|低|最高/, '思考强度当前值可读（' + effort + '）');
    const apiInput = await s.eval((host) => {
      const input = document.querySelector(host + ' [role="dialog"] input[placeholder="留空使用默认地址"]');
      return input ? { value: input.value, placeholder: input.placeholder } : null;
    }, [h.HOST]);
    ctx.assert(apiInput, '通用设置里有「API 地址」输入框（占位：留空使用默认地址）');
    ctx.assertEqual(apiInput.value, '', 'API 地址默认留空');
    ctx.log('通用设置：主题 3 选项（跟随系统默认）、思考强度=' + effort + '、API 地址为空');
    await s.shot('settings-general');

    // Theme follows the host and can be forced, then back to system.
    await h.clickByText(ctx, /^深色$/, h.SETTINGS_DIALOG);
    await s.waitForSelector(h.HOST + '.dark', { timeout: 5000, label: '切到深色后面板 host 带 dark class' });
    ctx.assertEqual(await s.eval((key) => window.localStorage.getItem(key), [h.DEMO_KEYS.theme]), 'dark',
      '深色偏好写入 chat-demo:theme-preference');
    await h.clickByText(ctx, /^跟随系统$/, h.SETTINGS_DIALOG);
    await s.waitFor((host, key) => {
      if (window.localStorage.getItem(key) !== 'system') return false;
      const node = document.querySelector(host);
      const hostDark = document.documentElement.getAttribute('data-ds-theme-source') === 'dark'
        || document.body.hasAttribute('data-ds-dark-theme');
      return node.classList.contains(hostDark ? 'dark' : 'light');
    }, { timeout: 5000, label: '跟随系统后面板主题与宿主一致' }, [h.HOST, h.DEMO_KEYS.theme]);
    ctx.log('主题：深色切换生效，跟随系统恢复为宿主主题');

    // 数据管理 tab.
    await h.openSettingsTab(ctx, '数据管理');
    const dataText = await h.settingsText(ctx);
    for (const label of ['API Key', '导入历史对话', '导出所有历史对话', '删除所有对话']) {
      ctx.assertIncludes(dataText, label, '数据管理包含：' + label);
    }
    ctx.assert(await s.exists(h.HOST + ' [role="dialog"] input[type="password"]') === false,
      '已注入 Key 时 API Key 只显示掩码（不出现密码输入框）');
    const masked = await s.eval((host) => {
      const node = document.querySelector(host + ' [role="dialog"]');
      const match = (node.innerText || '').match(/\*{20,}/);
      return match ? match[0].length : 0;
    }, [h.HOST]);
    ctx.assert(masked > 0, '数据管理里显示 API Key 掩码（长度 ' + masked + '）');
    ctx.log('数据管理：掩码长度 ' + masked + '，导入/导出/删除全部齐全');
    await s.shot('settings-data');
    // Canonical screenshot: the settings dialog itself, not the panel behind it.
    await s.shot('settings');

    await h.closeSettings(ctx);
  },
};
