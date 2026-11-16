/**
 * Check: math-mermaid
 *
 * Ask for one inline formula and one mermaid flowchart. KaTeX and Mermaid load
 * from jsDelivr lazily, so this check gives the CDN up to ~40 s. Then it asserts
 * the rendered math node, the mermaid <svg>, and the「代码」switch of the block.
 *
 * Costs 1 real API call.
 */
'use strict';

module.exports = {
  name: 'math-mermaid',
  description: '发 \(E=mc^2\)+```mermaid 请求 → 等 CDN → 断言 .dsc-mathInline/.dsc-mathBlock、.dsc-mermaid svg，点「代码」切到源码视图',
  timeoutMs: 180000,
  cost: 'api',
  settings: { thinking: 'off', webSearch: false },

  async run(ctx) {
    const s = ctx.steps;
    const prompt = [
      '请严格按下面两条要求输出，两条都要有，不要省略：',
      '1) 用 \\(E=mc^2\\) 的形式写出质能方程（保留反斜杠和圆括号，作为行内公式）；',
      '2) 用三个反引号 mermaid 代码块画 A→B→C 的流程图，代码块内容如下：',
      '```mermaid',
      'flowchart LR',
      'A-->B',
      'B-->C',
      '```',
    ].join('\n');

    await s.typeText('.dsc-input', prompt);
    await s.send();

    await s.waitFor(() => {
      const body = document.querySelector('.dsc-botBody');
      return body && (body.innerText || '').trim().length > 0;
    }, { timeout: 45000, label: '回复正文出现' });

    // KaTeX / Mermaid both come from the CDN: wait generously, then assert.
    const math = await s.waitFor(() => {
      const node = document.querySelector('.dsc-mathInline, .dsc-mathBlock');
      if (!node) return '';
      return node.className.indexOf('dsc-mathBlock') >= 0 ? 'block' : 'inline';
    }, { timeout: 40000, label: 'KaTeX 公式节点 .dsc-mathInline/.dsc-mathBlock 出现' });
    ctx.assert(math === 'inline' || math === 'block', '数学公式已渲染（' + math + '）');
    ctx.log('公式节点: ' + math);

    await s.waitFor(() => {
      const svg = document.querySelector('.dsc-mermaid svg');
      return Boolean(svg);
    }, { timeout: 40000, label: 'Mermaid 图表 .dsc-mermaid svg 出现' });
    ctx.assert(true, 'Mermaid 图表 svg 已渲染');
    await s.shot('math-mermaid-diagram');

    // Switch the mermaid block to its source view through the 代码 button.
    const clicked = await s.eval(() => {
      const blocks = Array.from(document.querySelectorAll('.dsc-code'));
      const mermaid = blocks.find((block) => block.querySelector('.dsc-mermaid'));
      if (!mermaid) return null;
      const button = mermaid.querySelector('.dsc-codeHead .dsc-codeCopy');
      if (!button) return null;
      button.click();
      return (button.innerText || '').trim();
    });
    ctx.assert(clicked, 'Mermaid 代码块有「代码」切换按钮');
    ctx.log('切换按钮原文: ' + clicked);

    await s.waitFor(() => {
      if (document.querySelector('.dsc-mermaid')) return false;
      const body = document.querySelector('.dsc-codeBody');
      return Boolean(body) && /flowchart|-->/.test(body.innerText || body.textContent || '');
    }, { timeout: 10000, label: '「代码」视图显示 mermaid 源码' });

    const sourceView = await s.eval(() => {
      const body = document.querySelector('.dsc-codeBody');
      const blocks = Array.from(document.querySelectorAll('.dsc-code'));
      const mermaid = blocks.find((block) => !block.querySelector('.dsc-mermaid') && block.querySelector('.dsc-codeBody'));
      const button = mermaid ? mermaid.querySelector('.dsc-codeHead .dsc-codeCopy') : null;
      return {
        body: body ? (body.innerText || body.textContent || '').slice(0, 120) : '',
        switchText: button ? (button.innerText || '').trim() : '',
      };
    });
    ctx.assertMatch(sourceView.body, /flowchart|-->/, '源码视图里是 mermaid 源码');
    ctx.assertMatch(sourceView.switchText, /图表|Chart/, '切回按钮文案变成「图表」');
    ctx.log('源码片段: ' + sourceView.body.replace(/\s+/g, ' ').slice(0, 60));
    await s.shot('math-mermaid-code');
  },
};
