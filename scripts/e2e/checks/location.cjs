/**
 * SKIPPED under the vendored chat-demo UI.
 *
 * Location is now the demo's own province/city cascading `Select` widgets, whose
 * popover is portaled to document.body and whose option lists depend on the
 * browser language. Driving that reliably costs more than the feature is worth
 * in a smoke suite; `settings` already covers both tabs and the two plugin
 * extras (思考强度 / API 地址).
 */
'use strict';

module.exports = {
  name: 'location',
  description: '（旧检查，已跳过）旧插件位置输入框',
  skip: true,
  skipReason: '新 UI 位置是省/市级联自定义 Select（弹层 portal 到 body、依赖浏览器语言），交互成本高于覆盖价值',
};
