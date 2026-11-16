/**
 * Check: chat-live
 *
 * One real request that must come back with both render pipelines visible:
 * an inline KaTeX formula (`.katex`) and a mermaid diagram (`.md-mermaid-diagram
 * svg`). This covers the old panel/math-mermaid checks in a single API call.
 */
'use strict';

const h = require('./lib/demo-helpers.cjs');

module.exports = {
  name: 'chat-live',
  description: '发一句要求含公式+Mermaid 的话 → 断言回答文本、.katex 公式节点、.md-mermaid-diagram svg',
  timeoutMs: 180000,
  cost: 'api',
  settings: { thinking: false, search: false },

  async run(ctx) {
    const s = ctx.steps;
    const prompt = [
      '请严格按下面两点回答，两点都要有：',
      '1) 用行内公式 $E=mc^2$ 写出质能方程，并配一句话解释；',
      '2) 用三个反引号 mermaid 代码块画 A→B→C 的流程图，代码块内容如下：',
      '```mermaid',
      'flowchart LR',
      'A-->B',
      'B-->C',
      '```',
    ].join('\n');

    await h.ask(ctx, prompt);
    await h.waitReplyDone(ctx, 90000);

    const answer = await h.replyText(ctx);
    ctx.assert(answer && answer.length > 20, '回答文本非空');
    ctx.assertIncludes(answer, 'E=mc', '回答里能看到质能方程文本');
    ctx.log('回答片段: ' + answer.replace(/\s+/g, ' ').slice(0, 80));

    await s.waitFor(() => document.querySelectorAll('.katex').length > 0, {
      timeout: 20000, label: 'KaTeX 公式节点 .katex 出现',
    });
    const katex = await s.eval(() => ({
      nodes: document.querySelectorAll('.katex').length,
      text: (document.querySelector('.katex') || {}).innerText || '',
    }));
    ctx.assert(katex.nodes > 0, 'KaTeX 公式已渲染（' + katex.nodes + ' 个节点）');
    ctx.log('KaTeX 节点 ' + katex.nodes + ' 个');

    await s.waitFor(() => Boolean(document.querySelector('.md-mermaid-diagram svg')), {
      timeout: 30000, label: 'Mermaid 图表 .md-mermaid-diagram svg 出现',
    });
    const mermaid = await s.eval(() => {
      const svg = document.querySelector('.md-mermaid-diagram svg');
      return svg ? { shape: svg.getBoundingClientRect().width > 40, text: (svg.textContent || '').slice(0, 40) } : null;
    });
    ctx.assert(mermaid && mermaid.shape, 'Mermaid 图表 svg 已渲染');
    ctx.log('Mermaid 图: ' + mermaid.text.replace(/\s+/g, ' '));
    await s.shot('chat-live');
  },
};
