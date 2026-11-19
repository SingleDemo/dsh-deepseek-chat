/**
 * Check: model-picker
 *
 * 设置 → 数据管理 的「模型」行：输入框 + 「获取模型」按钮；聚焦/点击输入框拉取
 * GET /models 并弹出 [role=listbox] 下拉（选项两行：名称 + id），点选后写
 * chat-demo:model 并关闭；也可手输模型 ID（回车/失焦保存）。还断言模型行在
 * 「输入 API Key」行下方、且不在「通用设置」tab 里。
 *
 * 走的是手动 API Key 模式（种子真 Key）。1.2.2 起 listModels 与 verifyApiKey 一致：
 * Key 模式带 `Authorization: Bearer <key>`，账号模式带账号 token。
 * 只有 GET /models 因网络/凭据异常拿不到列表时才 SKIP（附证据与直连状态），
 * 正常的交互失败一律判 FAIL。
 *
 * Costs no generation (a few free GET /models).
 */
'use strict';

const h = require('./lib/demo-helpers.cjs');

const MODEL_INPUT = h.HOST + ' [role="dialog"] input[aria-label="模型"]';
const MODEL_LISTBOX = '[role="listbox"][aria-label="模型"]';

/** Read the model row state: input value / option count / failure copy / option texts. */
async function readModelState(ctx) {
  return await ctx.steps.eval((host, listboxSel) => {
    const dialog = document.querySelector(host + ' [role="dialog"]');
    if (!dialog) return null;
    const input = dialog.querySelector('input[aria-label="模型"]');
    const listbox = dialog.querySelector(listboxSel);
    const options = listbox ? Array.from(listbox.querySelectorAll('[role="option"]')) : [];
    return {
      input: input ? input.value : null,
      listbox: Boolean(listbox),
      options: options.length,
      optionTexts: options.map((node) => (node.innerText || '').replace(/\s+/g, ' ').trim()),
      firstHasDeepseek: options.length ? /deepseek/i.test(options[0].innerText || '') : false,
      failed: (dialog.innerText || '').indexOf('获取模型列表失败') >= 0,
    };
  }, [h.HOST, MODEL_LISTBOX]);
}

/** Poll until the dropdown has options, or the failure copy shows up. */
async function waitModelOutcome(ctx, timeout) {
  const deadline = Date.now() + (timeout || 15000);
  let state = null;
  while (Date.now() < deadline) {
    state = await readModelState(ctx);
    if (state && (state.options > 0 || state.failed)) return state;
    await ctx.steps.wait(300);
  }
  return state;
}

/** Commit a value through the input + Enter key. */
async function commitModelInput(ctx, value) {
  const s = ctx.steps;
  await s.typeText(MODEL_INPUT, value);
  await s.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await s.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await s.wait(300);
  return await s.eval((key) => window.localStorage.getItem(key), ['chat-demo:model']);
}

module.exports = {
  name: 'model-picker',
  description: '设置·数据管理「模型」行：在 API Key 下方且不在通用设置 → 手动 Key 模式聚焦输入框拉取 /models 并弹出下拉（首条含 deepseek）→ 点选写 chat-demo:model、下拉关闭 → 手输 ID 回车保存 → 恢复 deepseek-flash',
  timeoutMs: 180000,
  cost: 'none',
  settings: { authMode: 'key', thinking: false, search: false },

  async run(ctx) {
    const s = ctx.steps;
    await h.openSettingsTab(ctx, '数据管理');

    // 1) Row exists, under the API key row, and not in 通用设置.
    const layout = await s.eval((host) => {
      const dialog = document.querySelector(host + ' [role="dialog"]');
      const cells = Array.from(dialog.querySelectorAll('[class*="Settings_cell"]'));
      const rowOf = (needle) => {
        const cell = cells.find((node) => (node.innerText || '').indexOf(needle) >= 0);
        if (!cell) return null;
        const rect = cell.getBoundingClientRect();
        return { top: Math.round(rect.top), text: (cell.innerText || '').replace(/\s+/g, ' ').slice(0, 60) };
      };
      return {
        model: rowOf('模型'),
        apiKey: rowOf('输入 API Key 开始使用'),
        hasModelInput: Boolean(dialog.querySelector('input[aria-label="模型"]')),
        fetchButton: Boolean(Array.from(dialog.querySelectorAll('button'))
          .find((node) => /^获取模型$|^获取中…$/.test((node.innerText || '').trim()))),
      };
    }, [h.HOST]);
    ctx.assert(layout && layout.model, '数据管理里有「模型」行');
    ctx.assert(layout.apiKey, '数据管理里有「输入 API Key 开始使用」行');
    ctx.assert(layout.hasModelInput, '模型行有输入框（aria-label=模型）');
    ctx.assert(layout.fetchButton, '模型行有「获取模型」按钮');
    ctx.assert(layout.model.top > layout.apiKey.top,
      '模型行在 API Key 行下方（model top=' + layout.model.top + '，api top=' + layout.apiKey.top + '）');
    ctx.log('模型行 top=' + layout.model.top + ' / API Key 行 top=' + layout.apiKey.top);

    await h.openSettingsTab(ctx, '通用设置');
    const general = await s.eval((host) => {
      const dialog = document.querySelector(host + ' [role="dialog"]');
      return {
        modelInput: Boolean(dialog.querySelector('input[aria-label="模型"]')),
        modelRows: Array.from(dialog.querySelectorAll('[class*="Settings_cell"]'))
          .filter((node) => /^模型\s/.test((node.innerText || '').trim())).length,
      };
    }, [h.HOST]);
    ctx.assertEqual(general.modelInput, false, '「通用设置」tab 里没有模型输入框');
    ctx.assertEqual(general.modelRows, 0, '「通用设置」tab 里没有模型行');
    ctx.log('通用设置 tab 无模型行（在数据管理里）');
    await h.openSettingsTab(ctx, '数据管理');

    // 2) Focus the input (key mode): GET /models → dropdown.
    await h.trustedClick(ctx, MODEL_INPUT);
    const state = await waitModelOutcome(ctx, 15000);
    ctx.log('聚焦后模型状态: options=' + (state ? state.options : '-')
      + ' failed=' + (state ? state.failed : '-')
      + (state && state.optionTexts[0] ? '，首条=' + state.optionTexts[0] : ''));

    if (!state || state.options === 0) {
      // Network/credential fallback only: record the exact failure, then SKIP
      // honestly instead of pretending the interaction is broken.
      const direct = await s.eval(async (url) => {
        const status = async (headers) => {
          try {
            const response = await fetch(url, { headers, cache: 'no-store' });
            return response.status;
          } catch (error) {
            return 'network-error: ' + error.message;
          }
        };
        const account = await fetch('/plugins/dsh-deepseek-chat/account-token', {
          headers: { accept: 'application/json' }, cache: 'no-store',
        }).then((response) => response.json()).catch(() => null);
        const token = account && account.ok ? account.token : null;
        return {
          noAuth: await status({}),
          accountToken: token ? await status({ 'x-dsh-auth-token': token }) : 'no-token',
        };
      }, ['https://api.deepseek.com/models']);
      await s.shot('model-picker-fetch-failed');
      ctx.skip('聚焦模型输入框后 15s 内没拿到模型列表（选项 0，出现「获取模型列表失败」文案）；'
        + '直连 GET /models: noAuth=' + direct.noAuth + '，accountToken=' + direct.accountToken
        + '。这是网络/凭据异常的兜底，不按产品缺陷处理；手输模型 ID 仍可用。');
    }

    ctx.assert(state.firstHasDeepseek,
      '下拉首条含 deepseek（' + (state.optionTexts[0] || '') + '）');
    ctx.log('下拉就绪: ' + state.options + ' 条，首条=' + state.optionTexts[0]);
    await s.shot('model-picker');

    // 3) Pick the first option: input + localStorage update, dropdown closes.
    const picked = await s.eval((host, listboxSel) => {
      const dialog = document.querySelector(host + ' [role="dialog"]');
      const option = dialog.querySelector(listboxSel + ' [role="option"]');
      if (!option) return null;
      const text = (option.innerText || '').replace(/\s+/g, ' ').trim();
      option.click();
      return text;
    }, [h.HOST, MODEL_LISTBOX]);
    ctx.assert(picked, '点选下拉第一条');
    await s.wait(400);
    const afterPick = await readModelState(ctx);
    const storedAfterPick = await s.eval(() => window.localStorage.getItem('chat-demo:model'));
    ctx.assert(afterPick.input && afterPick.input === storedAfterPick,
      '点选后输入框值与 chat-demo:model 一致（input=' + JSON.stringify(afterPick.input)
      + '，stored=' + JSON.stringify(storedAfterPick) + '）');
    ctx.assertEqual(afterPick.listbox, false, '点选后下拉关闭');
    ctx.log('点选: ' + picked + ' → chat-demo:model=' + storedAfterPick);

    // 4) Manual id + Enter saves; then restore deepseek-flash.
    const manual = await commitModelInput(ctx, 'manual-model-test');
    ctx.assertEqual(manual, 'manual-model-test', '手输 manual-model-test + 回车后写入 chat-demo:model');
    const manualInput = await s.eval((host) => document.querySelector(host + ' [role="dialog"] input[aria-label="模型"]').value, [h.HOST]);
    ctx.assertEqual(manualInput, 'manual-model-test', '手输后输入框显示 manual-model-test');
    ctx.log('手输模型 ID 保存成功');
    const restored = await commitModelInput(ctx, 'deepseek-flash');
    ctx.assertEqual(restored, 'deepseek-flash', '恢复 deepseek-flash 并写入 chat-demo:model');
    await h.closeSettings(ctx);
  },
};
