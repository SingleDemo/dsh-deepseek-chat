/**
 * SKIPPED under the vendored chat-demo UI.
 *
 * In the upstream demo, editing a message always forks a new branch instead of
 * replacing the turn, so the old "only one user message / old answer deleted"
 * semantics no longer exist. The edit flow itself is covered by `branch-edit`
 * (edit → version pager → switch back to the old question and answer).
 */
'use strict';

module.exports = {
  name: 'edit-message',
  description: '（旧检查，已跳过）旧手写 UI 的编辑语义',
  skip: true,
  skipReason: '新 UI 编辑总是新建分支，旧「替换并删旧回答」语义不存在；编辑流程由 branch-edit 覆盖',
};
