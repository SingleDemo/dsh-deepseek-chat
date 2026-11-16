/**
 * Check: import-merge
 *
 * The official-ZIP import now defaults to MERGE (keep current conversations, same
 * ID overwrites). Asserts the whole dialog contract and both modes end-to-end:
 *
 *   - seed 2 sessions (N=2);
 *   - upload official-backup.zip → confirm dialog: checkbox default checked,
 *     primary button 合并导入 (no danger style), merge description;
 *   - confirm → sider N+1, seeded sessions still there, fixture session added,
 *     status 已导入 1 个对话;
 *   - import the same ZIP again (merge) → count unchanged (same ID overwritten);
 *   - uncheck → primary button 确认导入 + danger style + overwrite description →
 *     confirm → only the fixture session remains (old behaviour still works).
 *
 * Costs no API calls.
 */
'use strict';

const h = require('./lib/demo-helpers.cjs');

const SEEDS = [
  { id: 'e2e-merge-1', title: 'E2E-合并种子A', question: '合并前问题A', answer: '合并前回答A' },
  { id: 'e2e-merge-2', title: 'E2E-合并种子B', question: '合并前问题B', answer: '合并前回答B' },
];

module.exports = {
  name: 'import-merge',
  description: '官方 ZIP 默认合并导入：弹窗默认勾选「合并到现有对话」+按钮「合并导入」→ 导入后 N+1、原会话保留、同 ID 再导入不重复 → 取消勾选走覆盖只剩 1 个',
  timeoutMs: 150000,
  cost: 'none',
  settings: { thinking: false, search: false },

  async run(ctx) {
    const s = ctx.steps;
    await h.seedSessions(ctx, SEEDS.map((seed) => h.buildSession(seed, Date.now())));
    await h.waitSummariesCount(ctx, 2, 20000);
    const before = await h.readSummaries(ctx);
    ctx.assertEqual(before.length, 2, '导入前 sider 有 2 个会话');
    const beforeTitles = before.map((item) => item.title);
    ctx.log('导入前会话: ' + beforeTitles.join(' / '));

    // 1) Merge path (default).
    const dialog = await h.selectImportFile(ctx, h.fixture('official-backup.zip'));
    ctx.assertEqual(dialog.checkbox ? dialog.checkbox.checked : null, true,
      '确认弹窗里「合并到现有对话」复选框默认勾选');
    ctx.assertEqual(dialog.buttonText, '合并导入', '默认主按钮文案是「合并导入」');
    ctx.assert(!dialog.buttonClasses.some((name) => /danger/i.test(name)),
      '合并模式主按钮不是 danger 样式（' + dialog.buttonClasses.join(' ') + '）');
    ctx.assertIncludes(dialog.text, '合并到现有对话（保留当前对话，同 ID 覆盖）', '弹窗有合并复选框说明');
    ctx.assertIncludes(dialog.text, '导入的对话会与现有对话合并', '弹窗有合并语义说明');
    ctx.log('合并弹窗: 按钮=' + dialog.buttonText + '，勾选=' + dialog.checkbox.checked);
    await s.shot('import-merge-dialog');

    const merged = await h.confirmImport(ctx, true);
    ctx.log('合并导入后的状态文案: ' + JSON.stringify(merged.status));
    await h.waitSummariesCount(ctx, 3, 20000);
    let summaries = await h.readSummaries(ctx);
    ctx.assertEqual(summaries.length, 3, '合并后 sider 条数 = N+1（2 → 3）');
    for (const title of beforeTitles) {
      ctx.assertIncludes(summaries.map((item) => item.title).join(' | '), title, '原有会话仍在：' + title);
    }
    ctx.assertIncludes(summaries.map((item) => item.title).join(' | '), 'SSE 是什么', 'fixture 会话已合并进来');
    const mergeToasts = await h.toastTexts(ctx);
    ctx.assert(!mergeToasts.some((text) => /失败|无法|不完整|损坏|无效/.test(text)), '合并导入没有错误 toast');
    ctx.log('合并后会话: ' + summaries.map((item) => item.title).join(' / '));
    await s.shot('import-merged');

    // 2) Import the same ZIP again: merge must not duplicate (same ID overwrites).
    await h.selectImportFile(ctx, h.fixture('official-backup.zip'));
    await h.confirmImport(ctx, true);
    await s.wait(500);
    summaries = await h.readSummaries(ctx);
    ctx.assertEqual(summaries.length, 3, '同一 ZIP 再合并一次后条数不变（同 ID 覆盖，不重复）');
    const fixtureCount = summaries.filter((item) => item.title === 'SSE 是什么').length;
    ctx.assertEqual(fixtureCount, 1, 'fixture 会话只有 1 条，没有产生重复');
    ctx.log('二次合并后仍是 3 个会话，fixture 无重复');

    // 3) Overwrite path: uncheck merge.
    const overwriteDialog = await h.selectImportFile(ctx, h.fixture('official-backup.zip'));
    ctx.assertEqual(overwriteDialog.checkbox ? overwriteDialog.checkbox.checked : null, true,
      '打开弹窗时合并复选框仍默认勾选');
    await s.eval((host) => {
      const dialog = Array.from(document.querySelectorAll(host + ' [role="dialog"]'))
        .find((node) => /确认导入历史对话|Import these conversations/.test(node.innerText || ''));
      const checkbox = dialog && dialog.querySelector('input[type="checkbox"]');
      if (checkbox) checkbox.click();
    }, [h.HOST]);
    await s.wait(200);
    const unchecked = await h.readImportDialogState(ctx);
    ctx.assert(unchecked && unchecked.checkbox && unchecked.checkbox.checked === false, '取消勾选后复选框为未选中');
    ctx.assertEqual(unchecked.buttonText, '确认导入', '取消勾选后主按钮变回「确认导入」');
    ctx.assert(unchecked.buttonClasses.some((name) => /danger/i.test(name)),
      '覆盖模式主按钮是 danger 样式（' + unchecked.buttonClasses.join(' ') + '）');
    ctx.assertIncludes(unchecked.text, '上传的历史对话会覆盖当前所有对话记录', '取消勾选后显示覆盖说明文案');
    ctx.log('覆盖弹窗: 按钮=' + unchecked.buttonText + '，类型=' + unchecked.buttonClasses.join(' '));

    const overwritten = await h.confirmImport(ctx, false);
    ctx.log('覆盖导入后的状态文案: ' + JSON.stringify(overwritten.status));
    ctx.assertMatch(overwritten.status || '', /已导入 1 个对话/, '覆盖导入后提示「已导入 1 个对话」');
    await h.waitSummariesCount(ctx, 1, 20000);
    summaries = await h.readSummaries(ctx);
    ctx.assertEqual(summaries.length, 1, '覆盖导入后只剩 fixture 的 1 个会话');
    ctx.assertEqual(summaries[0].title, 'SSE 是什么', '剩下的是 fixture 会话');
    for (const title of beforeTitles) {
      ctx.assert(!summaries.some((item) => item.title === title), '覆盖后原有会话已消失：' + title);
    }
    ctx.log('覆盖后会话: ' + summaries.map((item) => item.title).join(' / '));

    // The merge-mode status text is asserted last on purpose: when it breaks it
    // is a product defect rather than an E2E problem, and everything else above
    // has already been verified in this run.
    ctx.assertMatch(merged.status || '', /已导入 1 个对话/,
      '合并导入后提示「已导入 1 个对话」\n        '
      + '根因: importArchive 返回 void → mergeHistory 的 write() 得到 undefined → '
      + 'store.ts L485 return imported 返回 undefined → SettingsDialog L534 params {count: undefined} → '
      + 'i18n/index.ts L20-22 保留 {count} 占位符（merge 路径 count 丢失；覆盖路径 replaceHistory 正常）');
  },
};
