/**
 * Check: key-verify
 *
 * Open settings, verify the seeded real key → .dsc-keyOk「Key 可用」, then put an
 * invalid key in #dsc-api-key and verify again → .dsc-keyBad「API Key 无效」.
 *
 * verifyKey() calls GET /models, which is free; still costs one network round
 * trip with the real credentials.
 */
'use strict';

/** Open the settings dialog from the rail footer or the header gear. */
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
    ctx.log('设置入口: ' + trigger);
  }
}

module.exports = {
  name: 'key-verify',
  description: '设置里 .dsc-keyRow 点「验证」→ 有效 key 出现 .dsc-keyOk「Key 可用」；改成 sk-invalid… 再验证 → .dsc-keyBad「API Key 无效」',
  timeoutMs: 120000,
  cost: 'api',
  settings: { thinking: 'off', webSearch: false },

  async run(ctx) {
    const s = ctx.steps;
    await openSettings(ctx);

    const row = await s.eval(() => {
      const rowEl = document.querySelector('.dsc-keyRow');
      if (!rowEl) return null;
      const button = rowEl.querySelector('button');
      return {
        text: button ? (button.innerText || '').trim() : '',
        disabled: button ? Boolean(button.disabled) : true,
        keyLength: ((document.querySelector('#dsc-api-key') || {}).value || '').length,
      };
    });
    ctx.assert(row, '.dsc-keyRow 存在');
    ctx.assertMatch(row.text, /验证|Verify/, '.dsc-keyRow 里有「验证」按钮');
    ctx.assert(!row.disabled, '验证按钮可点击（Key 非空）');
    ctx.assert(row.keyLength > 0, 'Key 已从凭证注入（仅断言长度 > 0）');

    await s.clickSelector('.dsc-keyRow button');
    await s.waitForSelector('.dsc-keyOk', { timeout: 25000, label: '有效 Key 出现 .dsc-keyOk' });
    const okText = await s.text('.dsc-keyOk');
    ctx.assertMatch(okText, /Key 可用|Key works|valid/i, '.dsc-keyOk 文案是「Key 可用」');
    ctx.log('有效 Key: ' + okText);
    await s.shot('key-verify-ok');

    // Invalid key: replace the field and verify again.
    const badKey = 'sk-invalid-000000000000000000000000';
    await s.typeText('#dsc-api-key', badKey);
    ctx.assertEqual(await s.value('#dsc-api-key'), badKey, '无效 Key 已写入输入框');

    await s.clickSelector('.dsc-keyRow button');
    await s.waitForSelector('.dsc-keyBad', { timeout: 25000, label: '无效 Key 出现 .dsc-keyBad' });
    const badText = await s.text('.dsc-keyBad');
    ctx.assertMatch(badText, /无效|invalid/i, '.dsc-keyBad 文案说明 Key 无效');
    ctx.log('无效 Key: ' + badText);
    // The canonical docs/e2e/key-verify.png is the failing-state screenshot.
    await s.shot('key-verify');
    await s.shot('key-verify-bad');

    // Leave without saving: the stored key stays the good one.
    await s.clickText(/^(取消|Cancel)$/, { selector: '.dsc-dialogFoot' }).catch(() => {});
    ctx.assert(!(await s.exists('.dsc-keyBad')), '关闭对话框后无效状态不会保存');
  },
};
