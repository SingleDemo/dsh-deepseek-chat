/**
 * Check: location
 *
 * Type a location into #dsc-location, save, then reload the whole page and reopen
 * settings: the value must come back from localStorage. No API calls.
 */
'use strict';

async function openSettings(ctx) {
  const s = ctx.steps;
  if (!(await s.exists('.dsc-dialog'))) {
    const trigger = await s.eval(() => {
      const rail = document.querySelector('.dsc-railFoot .dsc-row');
      if (rail) { rail.click(); return 'railFoot'; }
      const head = document.querySelectorAll('.dsc-chatHead .dsc-iconButton');
      const gear = head[head.length - 1];
      if (gear) { gear.click(); return 'chatHead'; }
      return null;
    });
    if (!trigger) throw new Error('找不到设置入口（rail 底部行或标题栏齿轮）');
    await s.waitForSelector('.dsc-dialog', { timeout: 10000, label: '设置对话框 .dsc-dialog' });
  }
}

module.exports = {
  name: 'location',
  description: '设置里 #dsc-location 写入「中国 · 安徽 · 合肥」→ 保存 → reload 后重开设置断言值保留',
  timeoutMs: 90000,
  cost: 'none',
  settings: { thinking: 'off', webSearch: false },

  async run(ctx) {
    const s = ctx.steps;
    const value = '中国 · 安徽 · 合肥';

    await openSettings(ctx);
    ctx.assert(await s.exists('#dsc-location'), '设置里有位置输入框 #dsc-location');
    const initial = await s.value('#dsc-location');
    ctx.assertEqual(initial, '', '位置初始为空');

    await s.typeText('#dsc-location', value);
    ctx.assertEqual(await s.value('#dsc-location'), value, '位置内容已写入输入框');

    await s.clickSelector('.dsc-dialogFoot button[data-primary="true"]');
    await s.waitFor(() => !document.querySelector('.dsc-dialog'), {
      timeout: 10000, label: '保存后设置对话框关闭',
    });

    const stored = await s.eval((key) => {
      try {
        const data = JSON.parse(window.localStorage.getItem(key) || '{}');
        return typeof data.location === 'string' ? data.location : null;
      } catch (error) {
        return null;
      }
    }, [require('../harness.cjs').SETTINGS_KEY]);
    ctx.assertEqual(stored, value, 'localStorage 里已保存 location');
    ctx.log('保存值: ' + stored);

    // Full page reload: proves it is persisted, not just component state.
    await s.reload();
    await s.openPanel();
    await openSettings(ctx);
    const reopened = await s.value('#dsc-location');
    ctx.assertEqual(reopened, value, 'reload 后重开设置位置值保留');
    ctx.log('reload 后读取: ' + reopened);
    await s.shot('location');

    await s.clickText(/^(取消|Cancel)$/, { selector: '.dsc-dialogFoot' }).catch(() => {});
  },
};
