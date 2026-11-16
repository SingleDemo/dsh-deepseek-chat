/**
 * Check: search-panel
 *
 * With 智能搜索 enabled, one real generation must produce citation markers and a
 * clickable search step; clicking it opens the demo's SearchPanel drawer.
 *
 * Asserts:
 *   - answer contains `.ds-markdown-cite` citation links;
 *   - the 已阅读 N 个网页 search step row is clickable and opens the drawer;
 *   - the drawer renders inside `.dsc-demo-host` (never portaled to <body>) and
 *     its rect is fully inside the panel;
 *   - it lists SourceCard entries (count + first title are logged);
 *   - the close button collapses it again.
 *
 * Costs one real generation.
 */
'use strict';

const h = require('./lib/demo-helpers.cjs');

const PANEL = '[class*="SearchPanel_panel"]';

module.exports = {
  name: 'search-panel',
  description: '开启智能搜索发问 → 断言 citation 角标 + 搜索步骤 → 点开 SearchPanel：在 .dsc-demo-host 内、列出 SourceCard（记录数量/首条标题）、可关闭',
  timeoutMs: 180000,
  cost: 'api',
  settings: { thinking: false, search: true },

  async run(ctx) {
    const s = ctx.steps;
    const prompt = '请联网搜索一下 DeepSeek 最近发布的模型，并用 [citation:N] 引用，给出两个来源。';

    await h.ask(ctx, prompt);
    await h.waitReplyDone(ctx, 120000);

    // 1. Citations in the finished answer.
    const cites = await s.eval((host) => Array.from(document.querySelectorAll(host + ' .ds-markdown-cite'))
      .map((node) => ({
        text: (node.innerText || '').trim(),
        area: Math.round(node.getBoundingClientRect().width * node.getBoundingClientRect().height),
      })), [h.HOST]);
    ctx.assert(cites.length > 0, '回答里出现引用角标 .ds-markdown-cite（' + cites.length + ' 个）');
    ctx.assert(cites.some((item) => item.area > 0), '引用角标可见（非 0 尺寸）');
    ctx.log('citation 角标: ' + cites.length + ' 个，样例: '
      + cites.slice(0, 5).map((item) => item.text).join(', '));
    const answer = await h.replyText(ctx);
    ctx.assert(answer.length > 20, '回答正文非空（' + answer.length + ' 字）');

    // 2. The search tool step ("已阅读 N 个网页") must be a clickable row.
    const step = await s.eval((host) => {
      const root = document.querySelector(host);
      const row = Array.from(root.querySelectorAll('[class*="ReplyArea_clickable"]'))
        .find((node) => /个网页/.test(node.innerText || ''));
      if (!row) return null;
      const rect = row.getBoundingClientRect();
      return {
        text: (row.innerText || '').replace(/\s+/g, ' ').trim(),
        area: Math.round(rect.width * rect.height),
        cursor: getComputedStyle(row).cursor,
      };
    }, [h.HOST]);
    ctx.assert(step, '出现可点击的搜索步骤行（已阅读 N 个网页）');
    ctx.assert(step.area > 0, '搜索步骤行可见');
    ctx.log('搜索步骤: ' + step.text + '（cursor=' + step.cursor + '）');

    // 3. Open the drawer by clicking that row.
    const clicked = await s.eval((host) => {
      const root = document.querySelector(host);
      const row = Array.from(root.querySelectorAll('[class*="ReplyArea_clickable"]'))
        .find((node) => /个网页/.test(node.innerText || ''));
      if (!row) return false;
      row.click();
      return true;
    }, [h.HOST]);
    ctx.assert(clicked, '点击搜索步骤行');
    await s.waitFor((host, selector) => Boolean(document.querySelector(host + ' ' + selector)), {
      timeout: 10000, label: 'SearchPanel 抽屉打开',
    }, [h.HOST, PANEL]);
    await s.wait(400);

    // 4. Drawer content + scope.
    const panel = await s.eval((host, selector) => {
      const hostNode = document.querySelector(host);
      const hostRect = hostNode.getBoundingClientRect();
      const nodes = Array.from(document.querySelectorAll(selector));
      const node = nodes[0];
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      const first = node.querySelector('a[href^="http"] [class*="SourceCard_title"]');
      return {
        count: nodes.length,
        inHost: nodes.every((item) => item.closest(host) === hostNode),
        bodyParent: nodes.some((item) => item.parentElement === document.body),
        tag: node.tagName,
        classes: Array.from(node.classList),
        heading: (node.querySelector('[role="heading"]') || {}).innerText || '',
        cards: node.querySelectorAll('a[href^="http"]').length,
        firstTitle: first ? (first.innerText || '').replace(/\s+/g, ' ').trim() : '',
        hostRect: { x: Math.round(hostRect.x), y: Math.round(hostRect.y), w: Math.round(hostRect.width), h: Math.round(hostRect.height) },
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      };
    }, [h.HOST, PANEL]);
    ctx.assert(panel, 'SearchPanel 已渲染');
    ctx.assertEqual(panel.count, 1, '只渲染一个搜索面板');
    ctx.assert(panel.inHost, '搜索面板在 .dsc-demo-host 内部（不是 body portal）');
    ctx.assert(!panel.bodyParent, '搜索面板没有直接挂在 document.body 下');
    ctx.assertIncludes(panel.heading, '搜索结果', '面板标题是「搜索结果」');
    ctx.assert(panel.cards > 0, '面板里列出 SourceCard 条目（' + panel.cards + ' 条）');
    ctx.assert(panel.firstTitle.length > 0, '首条来源有标题（' + panel.firstTitle.slice(0, 60) + '）');
    ctx.log('SearchPanel: ' + panel.tag + ' ' + panel.classes.join('.')
      + ' · ' + panel.cards + ' 条来源 · 首条: ' + panel.firstTitle.slice(0, 70));

    const inside = panel.rect.x >= panel.hostRect.x - 1
      && panel.rect.y >= panel.hostRect.y - 1
      && panel.rect.x + panel.rect.w <= panel.hostRect.x + panel.hostRect.w + 1
      && panel.rect.y + panel.rect.h <= panel.hostRect.y + panel.hostRect.h + 1;
    ctx.assert(inside, '搜索面板矩形不超出面板容器（host '
      + panel.hostRect.w + 'x' + panel.hostRect.h + ' @' + panel.hostRect.x + ',' + panel.hostRect.y
      + '；panel @' + panel.rect.x + ',' + panel.rect.y + ' ' + panel.rect.w + 'x' + panel.rect.h + '）');
    ctx.log('面板位置: x=' + panel.rect.x + ' w=' + panel.rect.w + '，host: x=' + panel.hostRect.x
      + ' w=' + panel.hostRect.w);
    await s.shot('search-panel');

    // 5. Close via the drawer's own close button.
    const closed = await s.eval((host) => {
      const node = document.querySelector(host + ' [class*="SearchPanel_panel"]');
      const button = node && node.querySelector('button[aria-label="关闭"]');
      if (!button) return false;
      button.click();
      return true;
    }, [h.HOST]);
    ctx.assert(closed, '搜索面板有关闭按钮（aria-label 关闭）');
    await s.waitFor((host, selector) => !document.querySelector(host + ' ' + selector), {
      timeout: 5000, label: '点关闭后搜索面板收起',
    }, [h.HOST, PANEL]);
    ctx.log('关闭后搜索面板已收起');
  },
};
