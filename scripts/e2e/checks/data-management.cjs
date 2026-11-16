/**
 * Check: data-management
 *
 * Lead is landing the「数据管理」group (export / import / delete all). When the
 * group is present this check asserts its rows, labels and the "no API key in
 * the backup" hint; when it is absent it logs SKIP instead of failing, so the
 * check is also safe to run before the feature lands.
 *
 * Never clicks export/import/delete: those touch files or destroy data.
 * Costs no API calls.
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
  name: 'data-management',
  description: '设置里「数据管理」分组（导出/导入/删除全部）：已落地则断言三行与按钮，未落地则记 SKIP',
  timeoutMs: 60000,
  cost: 'none',
  settings: { thinking: 'off', webSearch: false },

  async run(ctx) {
    const s = ctx.steps;
    await openSettings(ctx);

    const group = await s.eval(() => {
      const dialog = document.querySelector('.dsc-dialog');
      if (!dialog) return null;
      const rows = Array.from(dialog.querySelectorAll('.dsc-dataRow'));
      const titles = Array.from(dialog.querySelectorAll('.dsc-sectionTitle'))
        .map((node) => (node.innerText || '').trim());
      return {
        rows: rows.length,
        titles,
        buttons: rows.map((row) => {
          const button = row.querySelector('button');
          return button ? (button.innerText || '').trim() : '';
        }),
        text: (dialog.innerText || '').replace(/\s+/g, ' '),
      };
    });

    ctx.assert(group, '设置对话框可读取');
    const hasGroup = group.rows > 0 || group.titles.some((title) => /数据管理|^Data$/.test(title));
    if (!hasGroup) {
      ctx.log('SKIP: 当前 client.js 还没有「数据管理」分组（无 .dsc-dataRow），等你落地后补断言');
      return;
    }

    ctx.assertEqual(group.rows, 3, '「数据管理」有 3 行（导出/导入/删除全部）');
    ctx.assert(group.titles.some((title) => /数据管理|^Data$/.test(title)), '分组标题是「数据管理」');
    ctx.assertMatch(group.buttons.join(' | '), /下载|Download/, '有导出下载按钮');
    ctx.assertMatch(group.buttons.join(' | '), /选择文件|Choose file|Select/i, '有导入选择文件按钮');
    ctx.assertMatch(group.buttons.join(' | '), /删除全部|Delete all/i, '有删除全部按钮');
    ctx.assertMatch(group.text, /API Key|API key/i, '导出说明里写明备份不含 API Key');
    ctx.log('按钮: ' + group.buttons.join(' / '));
    await s.shot('data-management');

    // Leave without clicking anything destructive.
    await s.clickText(/^(取消|Cancel)$/, { selector: '.dsc-dialogFoot' }).catch(() => {});
  },
};
