/**
 * Check: account-login
 *
 * The plugin can use the Harness's own DeepSeek login instead of a pasted API
 * key. Seeds account mode with an empty API key, then:
 *   - no "输入 API Key" settings dialog pops up on panel mount;
 *   - GET /plugins/dsh-deepseek-chat/account-token answers 200 {ok:true,token}
 *     (the token is never logged);
 *   - 数据管理 shows the 登录方式 select on 「DeepSeek 账号（推荐）」 and the
 *     已登录 status copy;
 *   - switching to 手动 API Key brings the key input back, switching back works;
 *   - one real generation succeeds with an empty key (proof account auth works).
 *
 * If this profile is not signed in to DeepSeek, the check reports SKIP honestly
 * (route ok:false) instead of failing.
 *
 * Costs one real generation.
 */
'use strict';

const h = require('./lib/demo-helpers.cjs');

const TOKEN_ROUTE = '/plugins/dsh-deepseek-chat/account-token';
const ACCOUNT_LABEL = 'DeepSeek 账号（推荐）';
const KEY_LABEL = '手动 API Key';

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
  return clicked;
}

module.exports = {
  name: 'account-login',
  description: '账号登录（免 Key）：空 api-key + account 模式 → 不弹 Key 提示 → account-token 路由 200/ok → 数据管理「登录方式=DeepSeek 账号（推荐）」+「已登录」→ 切手动 Key 再切回 → 空 Key 真实生成成功',
  timeoutMs: 180000,
  cost: 'api',
  settings: { authMode: 'account', apiKey: '', thinking: false, search: false },

  async run(ctx) {
    const s = ctx.steps;
    const keyInfo = await s.eval((modeKey, apiKeyKey) => ({
      authMode: window.localStorage.getItem(modeKey),
      apiKey: window.localStorage.getItem(apiKeyKey) || '',
    }), [h.DEMO_KEYS.authMode, h.DEMO_KEYS.apiKey]);
    ctx.assertEqual(keyInfo.authMode, 'account', '种子后 chat-demo:auth-mode 是 account');
    ctx.assertEqual(keyInfo.apiKey, '', '种子后 API Key 为空');
    ctx.log('种子: auth-mode=account，api-key 为空（长度 0）');

    // 1) No auto-opened "输入 API Key" dialog.
    const dialogs = await s.count(h.HOST + ' [role="dialog"]');
    ctx.assertEqual(dialogs, 0, 'account 模式下打开面板不弹「输入 API Key」设置弹窗');
    ctx.log('面板内 0 个 dialog（未弹 Key 提示）');

    // 2) Host route hands out a token for the signed-in account.
    const route = await s.eval(async (url) => {
      try {
        const response = await fetch(url, {
          headers: { accept: 'application/json' },
          cache: 'no-store',
        });
        let body = null;
        try {
          body = await response.json();
        } catch (error) {
          body = null;
        }
        return {
          status: response.status,
          ok: response.ok,
          bodyOk: Boolean(body && body.ok === true),
          reason: body && typeof body.reason === 'string' ? body.reason : null,
          tokenLength: body && typeof body.token === 'string' ? body.token.length : 0,
          cacheControl: response.headers.get('cache-control'),
        };
      } catch (error) {
        return { status: 0, ok: false, bodyOk: false, reason: 'fetch-error: ' + error.message, tokenLength: 0 };
      }
    }, [TOKEN_ROUTE]);
    ctx.assertEqual(route.status, 200, 'account-token 路由返回 200（实际 ' + route.status + '）');
    ctx.log('account-token: status=' + route.status + ' ok=' + route.bodyOk
      + ' reason=' + JSON.stringify(route.reason) + ' tokenLength=' + route.tokenLength
      + ' cache-control=' + JSON.stringify(route.cacheControl));

    // 3) Settings: 数据管理 has 登录方式 row + signed-in status.
    await h.openSettingsTab(ctx, '数据管理');
    const dialogText = await h.settingsText(ctx);
    ctx.assertIncludes(dialogText, '登录方式', '数据管理里有「登录方式」行');
    const selectLabel = await s.eval((host) => {
      const button = document.querySelector(host + ' [role="dialog"] button[aria-label="登录方式"]');
      return button ? (button.innerText || '').replace(/\s+/g, ' ').trim() : null;
    }, [h.HOST]);
    ctx.assertIncludes(selectLabel, ACCOUNT_LABEL, '登录方式当前是「DeepSeek 账号（推荐）」（实际 ' + selectLabel + '）');
    await s.waitFor((host) => {
      const dialog = document.querySelector(host + ' [role="dialog"]');
      const text = dialog ? dialog.innerText || '' : '';
      return /已登录|未登录|无法获取登录状态/.test(text);
    }, { timeout: 15000, label: '账号登录状态文案出现' }, [h.HOST]);
    const statusText = await s.eval((host) => {
      const dialog = document.querySelector(host + ' [role="dialog"]');
      const text = dialog ? dialog.innerText || '' : '';
      const match = text.match(/已登录[^\n]*|未登录[^\n]*|无法获取登录状态[^\n]*/);
      return match ? match[0].trim() : '';
    }, [h.HOST]);
    ctx.log('登录状态文案: ' + statusText);
    await s.shot('account-login-settings');

    if (!route.bodyOk) {
      await h.closeSettings(ctx);
      ctx.skip('当前 profile 未登录 DeepSeek 账号（route reason=' + JSON.stringify(route.reason)
        + '，设置里显示「' + statusText + '」），本项无法验证账号免 Key 对话');
    }
    ctx.assertIncludes(dialogText + ' ' + statusText, '已登录', '设置里显示「已登录，无需填写 API Key」');

    // 4) Switch to manual key mode: key input semantics come back.
    const chosenKey = await chooseAuthMode(ctx, KEY_LABEL);
    ctx.assertEqual(chosenKey, KEY_LABEL, '选择「手动 API Key」');
    const keyMode = await s.eval((modeKey) => window.localStorage.getItem(modeKey), [h.DEMO_KEYS.authMode]);
    ctx.assertEqual(keyMode, 'key', 'chat-demo:auth-mode 写入 key');
    await s.waitFor((host) => Boolean(document.querySelector(host + ' [role="dialog"] input[type="password"]')), {
      timeout: 5000, label: '手动 Key 模式出现 API Key 输入框',
    }, [h.HOST]);
    const keyModeText = await h.settingsText(ctx);
    ctx.assertIncludes(keyModeText, '使用你填写的 API Key 发起请求', '手动 Key 模式显示对应说明');
    ctx.log('已切到手动 API Key：auth-mode=key，出现 Key 输入框');

    // 5) Back to account mode.
    const chosenAccount = await chooseAuthMode(ctx, ACCOUNT_LABEL);
    ctx.assertEqual(chosenAccount, ACCOUNT_LABEL, '切回「DeepSeek 账号（推荐）」');
    const accountMode = await s.eval((modeKey) => window.localStorage.getItem(modeKey), [h.DEMO_KEYS.authMode]);
    ctx.assertEqual(accountMode, 'account', 'chat-demo:auth-mode 复位为 account');
    const accountText = await h.settingsText(ctx);
    ctx.assertIncludes(accountText, '已登录', '切回账号模式后仍显示已登录');
    await h.closeSettings(ctx);
    ctx.log('已切回账号模式');

    // 6) One real generation with an empty API key.
    try {
      await h.ask(ctx, '你好，请只回复「账号登录成功」五个字。');
      await h.waitReplyDone(ctx, 120000);
      const answer = await h.replyText(ctx);
      ctx.assert(answer.length > 0, 'account 模式下空 API Key 也能生成回答');
      ctx.assert(await s.exists(h.HOST + ' button[aria-label="朗读"]'), '回答带有助手操作区（生成完成）');
      ctx.log('空 Key 真实生成成功，回答长度 ' + answer.length);
      await s.shot('account-login');
    } finally {
      // Restore a usable key for any later manual session on this profile.
      const restored = await s.eval((apiKeyKey, modeKey, key) => {
        try {
          window.localStorage.setItem(apiKeyKey, key);
          window.localStorage.setItem(modeKey, 'account');
          return { keyLength: window.localStorage.getItem(apiKeyKey).length, authMode: window.localStorage.getItem(modeKey) };
        } catch (error) {
          return { keyLength: 0, authMode: null };
        }
      }, [h.DEMO_KEYS.apiKey, h.DEMO_KEYS.authMode, process.env.DEEPSEEK_API_KEY || '']);
      ctx.log('finally: 已写回 API Key（长度 ' + restored.keyLength + '），auth-mode=' + restored.authMode);
    }
  },
};
