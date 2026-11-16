/**
 * SKIPPED under the vendored chat-demo UI.
 *
 * The demo bundles KaTeX and Mermaid, so both render pipelines are asserted in
 * `chat-live` with a single real API call: a separate check would spend another
 * generation for the same coverage.
 */
'use strict';

module.exports = {
  name: 'math-mermaid',
  description: '（旧检查，已跳过）公式/Mermaid 单独检查',
  skip: true,
  skipReason: '已并入 chat-live：一次请求同时断言 .katex 与 .md-mermaid-diagram svg，避免重复花 API',
};
