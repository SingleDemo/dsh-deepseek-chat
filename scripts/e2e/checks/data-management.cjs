/**
 * SKIPPED under the vendored chat-demo UI.
 *
 * The demo's data management only accepts the official DeepSeek ZIP; the old
 * `dsh-chat-backup` JSON import no longer exists. Export / import / delete-all /
 * restore are covered by `official-export` and `official-import`.
 */
'use strict';

module.exports = {
  name: 'data-management',
  description: '（旧检查，已跳过）旧 JSON 备份流程',
  skip: true,
  skipReason: '新 UI 只支持官方 ZIP（旧 JSON 备份已移除）；导出/导入/删除全部/恢复由 official-export + official-import 覆盖',
};
