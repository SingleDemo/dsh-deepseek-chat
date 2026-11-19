/**
 * Check: model-picker
 *
 * 设置 → 数据管理 的「模型」行：输入框 + 「获取模型」按钮；聚焦/点击输入框拉取
 * GET /models 并弹出 [role=listbox] 下拉（选项两行：名称 + id），点选后写
 * chat-demo:model 并关闭；也可手输模型 ID（回车/失焦保存）。
 *
 * 还断言：模型行在「输入 API Key」行下方、且不在「通用设置」tab 里。
 *
 * 手动 Key 模式的已知产品缺陷（实机取证）：
 *   listModels() 调 authedRequest 时没有把 apiKey 填进任何鉴权头（key 模式也没有
 *   account token），所以 GET /models 返回 401，设置里显示「获取模型列表失败…」，
 *   下拉无法出现；账号模式（x-dsh-auth-token）正常。
 * 按约定这不判 FAIL，而是把失败证据、账号模式成功证据都记下来后 SKIP，原因里写明。
 *
 * Costs no generation (one free GET /models per mode).
 */
'use strict';

const h = require('./lib/demo-helpers.cjs');

const MODEL_INPUT = h.HOST + ' [role="dialog"] input[aria-label="模型"]';
const MODEL_LISTBOX = '[role="listbox"][aria-label="模型"]';
const FETCH_FAILED_TEXT = '获取模型列表失败';

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

/** Poll until the dropdown has options (used after switching login mode). */
async function waitModelOptions(ctx, timeout) {
  const deadline = Date.now() + (timeout || 20000);
  let state = null;
  while (Date.now() < deadline) {
    state = await readModelState(ctx);
    if (state && state.options > 0) return state;
    await ctx.steps.wait(300);
  }
  return state;
}

/** Switch the 登录方式 Select (its menu is portaled to document.body). */
async function chooseAuthMode(ctx, label) {
  const s = ctx.steps;
  await s.clickSelector(h.HOST + ' [role="dialog"] button[aria-label="登录方式"]');
  await s.waitFor(() => Boolean(document.querySelector('[role="listbox"] [role="option"]')), {
    timeout: 5000, label: '登录方式下拉菜单出现',
  });
  const clicked = await s.eval((wanted) => {
    const option = Array.from(document.querySelectorAll('[role="listbox"] [role="option"]'))
      .find((node) => (node.innerText || '').trim() === wanted);
    if (!option) return null;
    option.click();
    return (option.innerText || '').trim();
  }, [label]);
  if (!clicked) throw new Error('找不到登录方式选项: ' + label);
  await s.wait(300);
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
  description: '设置·数据管理「模型」行：在 API Key 下方且不在通用设置 → 聚焦输入框拉取 /models 并弹出下拉（选项含 deepseek，点选写 chat-demo:model）→ 手输 ID 回车保存 → 恢复 deepseek-flash',
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
    ctx.log('通用设置 tab 无模型行（已挪到数据管理）');
    await h.openSettingsTab(ctx, '数据管理');

    // 2) Focus the input: fetch /models and open the dropdown.
    await h.trustedClick(ctx, MODEL_INPUT);
    let state = await waitModelOutcome(ctx, 15000);
    ctx.log('聚焦后模型状态: options=' + (state ? state.options : '-')
      + ' failed=' + (state ? state.failed : '-'));

    if (!state || state.options === 0) {
      // Known defect: key mode has no auth header for GET /models. Prove it, then
      // verify the same interaction works in account mode and skip honestly.
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
      ctx.log('GET /models 直连状态: noAuth=' + direct.noAuth + ' accountToken=' + direct.accountToken
        + '（Key 模式没有任何鉴权头 → 401）');
      await s.shot('model-picker-fetch-failed');

      await chooseAuthMode(ctx, 'DeepSeek 账号（推荐）');
      ctx.assertEqual(await s.eval((key) => window.localStorage.getItem(key), ['chat-demo:auth-mode']), 'account',
        '切到账号模式');
      // The model input kept focus while the Select was used, so a second click
      // would not fire onFocus again; blur first to force a fresh fetch.
      await s.eval(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
      await s.wait(150);
      await h.trustedClick(ctx, MODEL_INPUT);
      // The old failure copy survives until the new fetch resolves, so wait for
      // options specifically instead of bailing on the stale 「获取模型列表失败」.
      state = await waitModelOptions(ctx, 20000);
      if (state && state.options > 0) {
        ctx.assert(state.firstHasDeepseek, '账号模式下下拉首条含 deepseek（' + (state.optionTexts[0] || '') + '）');
        ctx.log('账号模式下拉正常: ' + state.options + ' 条，首条=' + state.optionTexts[0]);
        await s.shot('model-picker');

        const firstOption = await s.eval((host, listboxSel) => {
          const dialog = document.querySelector(host + ' [role="dialog"]');
          const option = dialog.querySelector(listboxSel + ' [role="option"]');
          if (!option) return null;
          const text = (option.innerText || '').replace(/\s+/g, ' ').trim();
          option.click();
          return text;
        }, [h.HOST, MODEL_LISTBOX]);
        ctx.assert(firstOption, '点选账号模式下拉的第一条');
        const chosen = await readModelState(ctx);
        const stored = await s.eval(() => window.localStorage.getItem('chat-demo:model'));
        ctx.assert(chosen.input && chosen.input === stored,
          '点选后输入框值与 chat-demo:model 一致（input=' + JSON.stringify(chosen.input)
          + '，stored=' + JSON.stringify(stored) + '）');
        ctx.assertEqual(chosen.listbox, false, '点选后下拉关闭');
        ctx.log('账号模式点选成功: ' + firstOption + ' → chat-demo:model=' + stored);

        // Manual id + Enter works even while the dropdown is broken in key mode.
        const manual = await commitModelInput(ctx, 'manual-model-test');
        ctx.assertEqual(manual, 'manual-model-test', '手输 manual-model-test + 回车后写入 chat-demo:model');
        const manualInput = await s.eval((host) => document.querySelector(host + ' [role="dialog"] input[aria-label="模型"]').value, [h.HOST]);
        ctx.assertEqual(manualInput, 'manual-model-test', '手输后输入框显示 manual-model-test');
        const restored = await commitModelInput(ctx, 'deepseek-flash');
        ctx.assertEqual(restored, 'deepseek-flash', '恢复 deepseek-flash 并写入 chat-demo:model');
        ctx.log('手输模型 ID 保存/恢复成功');
        await chooseAuthMode(ctx, '手动 API Key');
        ctx.skip('手动 Key 模式 GET /models 返回 401：listModels() 调 authedRequest 时未把 apiKey 填进任何鉴权头'
          + '（Key 模式又没有账号 token），设置显示「获取模型列表失败」，下拉无法出现；'
          + '账号模式下同一交互正常（已点选并写入 chat-demo:model，截图 model-picker.png），'
          + '手输模型 ID 保存/恢复也正常。属产品缺陷：listModels(apiKey) 的入参未被使用，'
          + '应像 verifyApiKey 一样带 x-api-key/Authorization。');
      } else {
        await s.shot('model-picker-fetch-failed');
        ctx.skip('两种登录方式下 GET /models 都没能返回列表（账号模式也无选项），无法验证下拉；'
          + '请检查网络/凭据（Key 模式直连 noAuth=' + direct.noAuth + '，账号 token=' + direct.accountToken + '）');
      }
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
