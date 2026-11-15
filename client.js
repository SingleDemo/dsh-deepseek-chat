/**
 * DeepSeek chat — browser half.
 *
 * Registers two slot occupants that belong together:
 *   - `sidebar.panellist` entry id `deepseek-chat` (the left-sidebar launcher),
 *   - `main` panel key `deepseek-chat` (the page the launcher selects).
 *
 * The page is a self-contained chat client: it talks to the DeepSeek API from
 * the browser with the user's own key, keeps conversations in localStorage,
 * and follows the host theme tokens and locale service. No host service is
 * involved, and no DOM outside this component is touched.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-deepseek-chat',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useRef, useState } = React;

    /** Locale namespace owned by this plugin. */
    const NS = 'deepseekChat';
    /** The one id shared by the sidebar entry and the main panel it opens. */
    const PANEL_ID = 'deepseek-chat';
    const SETTINGS_KEY = 'dsh.deepseekChat.settings.v1';
    const CONVERSATIONS_KEY = 'dsh.deepseekChat.conversations.v1';
    const DEFAULT_BASE_URL = 'https://api.deepseek.com';
    const DEFAULT_MODEL = 'deepseek-chat';

    /* ------------------------------------------------------------------ copy */

    const en = {
      panel: 'DeepSeek chat',
      newChat: 'New chat',
      railTitle: 'Conversations',
      railEmpty: 'No conversations yet',
      railEmptyHint: 'Start one and it appears here.',
      railToggle: 'Toggle conversation list',
      settings: 'Settings',
      settingsHint: 'Only this panel reads these values. They stay in this browser.',
      apiKey: 'API key',
      apiKeyPlaceholder: 'sk-…',
      apiKeyHint: 'Stored in localStorage; sent only to the API base URL below.',
      baseUrl: 'API base URL',
      model: 'Model',
      save: 'Save',
      cancel: 'Cancel',
      missingKey: 'Add your DeepSeek API key in Settings first.',
      welcomeTitle: 'What may I help you with?',
      welcomeHint: 'Enter sends · Shift+Enter starts a new line',
      suggest1: 'Explain how server-sent events stream tokens.',
      suggest2: 'Write a small debounce helper in TypeScript.',
      suggest3: 'Summarize what a good plugin release note contains.',
      placeholder: 'Send a message…',
      send: 'Send',
      stop: 'Stop',
      regenerate: 'Regenerate',
      copy: 'Copy',
      copied: 'Copied',
      rename: 'Rename',
      delete: 'Delete',
      thinkingLive: 'Thinking…',
      thinkingDone: 'Thought process',
      assistantName: 'DeepSeek',
      error: 'Request failed',
      clearAll: 'Delete all conversations',
      clearConfirm: 'Delete every conversation stored in this browser?',
      stopped: 'Stopped',
      modelHint: 'Use a model id your key can access.',
      settingsSaved: 'Settings saved',
      untitled: 'Untitled',
      backToConversation: 'Back to the conversation',
    };

    const zh = {
      panel: 'DeepSeek 对话',
      newChat: '新建对话',
      railTitle: '对话',
      railEmpty: '还没有对话',
      railEmptyHint: '新建一个对话，它会出现在这里。',
      railToggle: '收起或展开对话列表',
      settings: '设置',
      settingsHint: '只有本面板会读取这些设置，且保存在当前浏览器中。',
      apiKey: 'API Key',
      apiKeyPlaceholder: 'sk-…',
      apiKeyHint: '保存在 localStorage 中，只会发送给下方的 API 地址。',
      baseUrl: 'API 地址',
      model: '模型',
      save: '保存',
      cancel: '取消',
      missingKey: '请先在「设置」中填写 DeepSeek API Key。',
      welcomeTitle: '今天想聊点什么？',
      welcomeHint: '回车发送 · Shift+回车换行',
      suggest1: '用三句话解释 SSE 是怎么把 token 推过来的。',
      suggest2: '写一个 TypeScript 防抖函数，并说明用法。',
      suggest3: '帮我写一条插件发版说明，突出三点改进。',
      placeholder: '发消息…',
      send: '发送',
      stop: '停止',
      regenerate: '重新生成',
      copy: '复制',
      copied: '已复制',
      rename: '重命名',
      delete: '删除',
      thinkingLive: '思考中…',
      thinkingDone: '思考过程',
      assistantName: 'DeepSeek',
      error: '请求失败',
      clearAll: '删除全部对话',
      clearConfirm: '要删除本浏览器中保存的全部对话吗？',
      stopped: '已停止',
      modelHint: '请填写你的 Key 可以访问的模型 id。',
      settingsSaved: '设置已保存',
      untitled: '未命名',
      backToConversation: '返回对话',
    };

    /* ----------------------------------------------------------------- utils */

    /** Join class names, ignoring falsy entries. */
    function cls() {
      const out = [];
      for (let i = 0; i < arguments.length; i += 1) if (arguments[i]) out.push(arguments[i]);
      return out.join(' ');
    }

    /** A short unique id for conversations and messages. */
    function uid() {
      return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    function readJson(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return fallback;
        const value = JSON.parse(raw);
        return value === null || value === undefined ? fallback : value;
      } catch (error) {
        return fallback;
      }
    }

    function writeJson(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (error) {
        return false;
      }
    }

    /** Stored settings, tolerant of older or partial payloads. */
    function loadSettings() {
      const stored = readJson(SETTINGS_KEY, {}) || {};
      return {
        apiKey: typeof stored.apiKey === 'string' ? stored.apiKey : '',
        baseUrl: typeof stored.baseUrl === 'string' && stored.baseUrl ? stored.baseUrl : DEFAULT_BASE_URL,
        model: typeof stored.model === 'string' && stored.model ? stored.model : DEFAULT_MODEL,
      };
    }

    /** Stored conversations, dropping anything that cannot render. */
    function loadConversations() {
      const stored = readJson(CONVERSATIONS_KEY, []);
      if (!Array.isArray(stored)) return [];
      const list = [];
      for (let i = 0; i < stored.length; i += 1) {
        const item = stored[i];
        if (!item || typeof item.id !== 'string') continue;
        const messages = Array.isArray(item.messages) ? item.messages : [];
        list.push({
          id: item.id,
          title: typeof item.title === 'string' && item.title ? item.title : '',
          createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
          updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
          messages: messages
            .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
            .map((m) => ({
              id: typeof m.id === 'string' ? m.id : uid(),
              role: m.role,
              content: typeof m.content === 'string' ? m.content : '',
              reasoning: typeof m.reasoning === 'string' ? m.reasoning : '',
              error: typeof m.error === 'string' ? m.error : '',
              stopped: m.stopped === true,
            })),
        });
      }
      return list;
    }

    /** Sort newest first without mutating the input. */
    function sortConversations(list) {
      return list.slice().sort((a, b) => b.updatedAt - a.updatedAt);
    }

    /** The readable first line of a message, used as an automatic title. */
    function titleFrom(text) {
      const flat = String(text).replace(/\s+/g, ' ').trim();
      if (!flat) return '';
      return flat.length > 28 ? flat.slice(0, 28) + '…' : flat;
    }

    /** Format one timestamp for the conversation rail. */
    function formatWhen(timestamp) {
      const date = new Date(timestamp);
      const now = new Date();
      const sameDay = date.toDateString() === now.toDateString();
      if (sameDay) return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      return date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
    }

    /* ---------------------------------------------------------------- markdown */

    const INLINE_PATTERN = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(~~[^~\n]+~~)|(\[[^\]\n]*\]\([^)\s]+\))|((?:https?:\/\/)[^\s<>()]+)/g;

    /** Build inline nodes (code, emphasis, links) for one line of text. */
    function renderInline(text, keyPrefix) {
      const nodes = [];
      if (!text) return nodes;
      let last = 0;
      let match;
      let index = 0;
      INLINE_PATTERN.lastIndex = 0;
      while ((match = INLINE_PATTERN.exec(text)) !== null) {
        if (match.index > last) nodes.push(text.slice(last, match.index));
        const token = match[0];
        const key = keyPrefix + '-i' + index;
        index += 1;
        if (token.charAt(0) === '`') {
          nodes.push(h('code', { key, className: 'dsc-inlineCode' }, token.slice(1, -1)));
        } else if (token.startsWith('**') || token.startsWith('__')) {
          nodes.push(h('strong', { key }, token.slice(2, -2)));
        } else if (token.startsWith('~~')) {
          nodes.push(h('del', { key }, token.slice(2, -2)));
        } else if (token.startsWith('*') || token.startsWith('_')) {
          nodes.push(h('em', { key }, token.slice(1, -1)));
        } else if (token.startsWith('[')) {
          const split = token.indexOf('](');
          const label = token.slice(1, split);
          const href = token.slice(split + 2, -1);
          nodes.push(h('a', { key, href, target: '_blank', rel: 'noreferrer noopener' }, label || href));
        } else {
          nodes.push(h('a', { key, href: token, target: '_blank', rel: 'noreferrer noopener' }, token));
        }
        last = match.index + token.length;
      }
      if (last < text.length) nodes.push(text.slice(last));
      return nodes;
    }

    /** Split one markdown table row into trimmed cells. */
    function splitTableRow(line) {
      const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
      return trimmed.split('|').map((cell) => cell.trim());
    }

    /** Group a run of lines that do not start a new block into a paragraph. */
    function startsBlock(line) {      return (
        /^\s*(```|~~~)/.test(line) ||
        /^\s{0,3}#{1,6}\s+/.test(line) ||
        /^\s*>/.test(line) ||
        /^\s*([-*+]|\d+[.)])\s+/.test(line) ||
        /^\s*([-*_])\s*(\1\s*){2,}$/.test(line)
      );
    }

    /** Parse markdown into the small block vocabulary this panel renders. */
    function parseBlocks(source) {
      const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
      const blocks = [];
      let i = 0;
      while (i < lines.length) {
        const line = lines[i];
        if (!line.trim()) {
          i += 1;
          continue;
        }
        const fence = line.match(/^\s*(```|~~~)\s*([\w+#.-]*)\s*$/);
        if (fence) {
          const marker = fence[1];
          const lang = fence[2] || '';
          const body = [];
          i += 1;
          while (i < lines.length && lines[i].trim().indexOf(marker) !== 0) {
            body.push(lines[i]);
            i += 1;
          }
          i += 1;
          blocks.push({ type: 'code', lang, text: body.join('\n') });
          continue;
        }
        const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
        if (heading) {
          blocks.push({ type: 'heading', level: Math.min(heading[1].length, 3), text: heading[2].trim() });
          i += 1;
          continue;
        }
        if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
          blocks.push({ type: 'hr' });
          i += 1;
          continue;
        }
        if (line.indexOf('|') >= 0 && i + 1 < lines.length && /^[\s:|-]+$/.test(lines[i + 1]) && lines[i + 1].indexOf('-') >= 0) {
          const head = splitTableRow(line);
          const rows = [];
          i += 2;
          while (i < lines.length && lines[i].indexOf('|') >= 0 && lines[i].trim()) {
            rows.push(splitTableRow(lines[i]));
            i += 1;
          }
          blocks.push({ type: 'table', head, rows });
          continue;
        }
        if (/^\s*>/.test(line)) {
          const body = [];
          while (i < lines.length && /^\s*>/.test(lines[i])) {
            body.push(lines[i].replace(/^\s*>\s?/, ''));
            i += 1;
          }
          blocks.push({ type: 'quote', text: body.join('\n') });
          continue;
        }
        const listItem = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
        if (listItem) {
          const ordered = /\d/.test(listItem[1]);
          const items = [];
          while (i < lines.length) {
            const current = lines[i].match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
            if (!current) break;
            items.push(current[2]);
            i += 1;
          }
          blocks.push({ type: 'list', ordered, items });
          continue;
        }
        const paragraph = [line];
        i += 1;
        while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) {
          paragraph.push(lines[i]);
          i += 1;
        }
        blocks.push({ type: 'p', text: paragraph.join(' ') });
      }
      return blocks;
    }

    /**
     * Parsed-block cache: a streaming reply re-renders the whole thread on every
     * token, and only the growing message changes its source text.
     */
    const blockCache = new Map();

    /** Parse markdown with a small bounded cache keyed by source text. */
    function parseBlocksCached(source) {
      const cached = blockCache.get(source);
      if (cached) return cached;
      const blocks = parseBlocks(source);
      if (blockCache.size >= 200) blockCache.clear();
      blockCache.set(source, blocks);
      return blocks;
    }

    /** One fenced code block with its language label and copy action. */
    function CodeBlock(props) {
      const { code, lang, t } = props;
      const [copied, setCopied] = useState(false);
      const copy = useCallback(() => {
        copyText(code).then((ok) => {
          if (!ok) return;
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        });
      }, [code]);
      return h('div', { className: 'dsc-code' },
        h('div', { className: 'dsc-codeHead' },
          h('span', { className: 'dsc-codeLang' }, lang || 'text'),
          h('button', { type: 'button', className: 'dsc-codeCopy', onClick: copy }, copied ? t('copied') : t('copy'))),
        h('pre', { className: 'dsc-codeBody' }, h('code', null, code)));
    }

    /** Render markdown source as React nodes. */
    function renderMarkdown(source, t, keyBase) {
      const blocks = parseBlocksCached(source);
      return blocks.map((block, index) => {
        const key = keyBase + '-b' + index;
        if (block.type === 'code') return h(CodeBlock, { key, code: block.text, lang: block.lang, t });
        if (block.type === 'heading') return h('h' + block.level, { key, className: 'dsc-mdHeading' }, renderInline(block.text, key));
        if (block.type === 'hr') return h('hr', { key, className: 'dsc-mdRule' });
        if (block.type === 'quote') {
          return h('blockquote', { key, className: 'dsc-mdQuote' }, renderInline(block.text, key));
        }
        if (block.type === 'table') {
          return h('div', { key, className: 'dsc-tableWrap' },
            h('table', { className: 'dsc-table' },
              h('thead', null, h('tr', null, block.head.map((cell, cellIndex) => h('th', { key: 'h' + cellIndex }, renderInline(cell, key + '-h' + cellIndex))))),
              h('tbody', null, block.rows.map((row, rowIndex) => h('tr', { key: 'r' + rowIndex }, row.map((cell, cellIndex) => h('td', { key: 'c' + cellIndex }, renderInline(cell, key + '-r' + rowIndex + 'c' + cellIndex))))))));
        }
        if (block.type === 'list') {
          const children = block.items.map((item, itemIndex) => h('li', { key: 'l' + itemIndex }, renderInline(item, key + '-l' + itemIndex)));
          return h(block.ordered ? 'ol' : 'ul', { key, className: 'dsc-mdList' }, children);
        }
        return h('p', { key, className: 'dsc-mdPara' }, renderInline(block.text, key));
      });
    }

    /* ------------------------------------------------------------------- api */

    /** Copy text, falling back to a hidden textarea when the clipboard API is unavailable. */
    function copyText(text) {
      return new Promise((resolve) => {
        const clipboard = window.navigator && window.navigator.clipboard;
        if (clipboard && clipboard.writeText) {
          clipboard.writeText(text).then(() => resolve(true), () => resolve(legacyCopy(text)));
          return;
        }
        resolve(legacyCopy(text));
      });
    }

    function legacyCopy(text) {
      try {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(area);
        return ok;
      } catch (error) {
        return false;
      }
    }

    /** Normalize a base URL the way the original app does. */
    function endpoints(baseUrl) {
      const base = String(baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
      return { chat: base + '/chat/completions' };
    }

    /** Turn an HTTP failure into a message the panel can show. */
    function describeFailure(status, body) {
      if (body) {
        try {
          const parsed = JSON.parse(body);
          if (parsed && parsed.error && parsed.error.message) return 'HTTP ' + status + ' · ' + parsed.error.message;
        } catch (error) {
          /* not JSON */
        }
        const trimmed = body.trim();
        if (trimmed) return 'HTTP ' + status + ' · ' + trimmed.slice(0, 240);
      }
      return 'HTTP ' + status;
    }

    /**
     * Stream one assistant reply.
     * @param options.settings - resolved API settings.
     * @param options.messages - conversation history as `{ role, content }`.
     * @param options.signal - abort signal owned by the caller.
     * @param options.onDelta - receives `{ content, reasoning }` increments.
     */
    async function streamReply(options) {
      const { settings, messages, signal, onDelta } = options;
      const response = await fetch(endpoints(settings.baseUrl).chat, {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          authorization: 'Bearer ' + String(settings.apiKey).trim(),
        },
        body: JSON.stringify({ model: settings.model, messages, stream: true }),
      });
      if (!response.ok) {
        let body = '';
        try {
          body = await response.text();
        } catch (error) {
          body = '';
        }
        throw new Error(describeFailure(response.status, body));
      }
      if (!response.body || !response.body.getReader) {
        const text = await response.text();
        const parsed = parseWholeBody(text);
        onDelta(parsed);
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finish = false;
      while (!finish) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf('\n');
          if (!line || line.charAt(0) === ':') continue;
          if (line.indexOf('data:') !== 0) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') {
            finish = true;
            break;
          }
          const delta = readDelta(payload);
          if (delta) onDelta(delta);
        }
      }
      if (buffer.trim()) {
        const tail = readDelta(buffer.trim());
        if (tail) onDelta(tail);
      }
    }

    /** Read one SSE payload into a delta, ignoring keep-alives and errors already surfaced. */
    function readDelta(payload) {
      if (!payload || payload === '[DONE]') return null;
      let json;
      try {
        json = JSON.parse(payload);
      } catch (error) {
        return null;
      }
      if (json && json.error && json.error.message) throw new Error(json.error.message);
      const choice = json && Array.isArray(json.choices) ? json.choices[0] : null;
      if (!choice) return null;
      const delta = choice.delta || choice.message || {};
      const content = typeof delta.content === 'string' ? delta.content : '';
      const reasoning = typeof delta.reasoning_content === 'string' ? delta.reasoning_content : '';
      if (!content && !reasoning) return null;
      return { content, reasoning };
    }

    /** A non-streaming response body, used only when the browser cannot read the stream. */
    function parseWholeBody(text) {
      try {
        const json = JSON.parse(text);
        const choice = json && Array.isArray(json.choices) ? json.choices[0] : null;
        const message = choice && choice.message ? choice.message : {};
        return { content: message.content || '', reasoning: message.reasoning_content || '' };
      } catch (error) {
        return { content: text, reasoning: '' };
      }
    }

    /* ----------------------------------------------------------------- styles */

    const CSS = `
.dsc-root {
  position: relative;
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: var(--dsh-content-font-size, 14px);
  line-height: 1.6;
}
html[data-platform='darwin'] .dsc-root { padding-top: var(--dsh-frame-top-clearance, 0px); }
.dsc-root *, .dsc-root *::before, .dsc-root *::after { box-sizing: border-box; }
.dsc-root button { font: inherit; color: inherit; }
.dsc-root textarea, .dsc-root input { font: inherit; color: inherit; }
.dsc-root :focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }

.dsc-rail {
  display: flex;
  flex-direction: column;
  width: 244px;
  flex: 0 0 244px;
  min-height: 0;
  border-right: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
}
.dsc-rail[hidden] { display: none; }
.dsc-railHead {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 12px 8px;
}
.dsc-brandMark { display: flex; width: 22px; height: 22px; flex: none; }
.dsc-brandName {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  letter-spacing: 0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsc-iconButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex: none;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dsc-iconButton:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsc-newChat {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 2px 12px 10px;
  padding: 8px 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
  cursor: pointer;
}
.dsc-newChat:hover { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.dsc-railSection {
  padding: 2px 14px 6px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.dsc-railList { flex: 1; min-height: 0; overflow-y: auto; padding: 0 8px 8px; scrollbar-width: thin; }
.dsc-railEmpty { padding: 10px 8px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.5; }
.dsc-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin-bottom: 2px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.dsc-row:hover { background: var(--dsw-alias-bg-layer-2); }
.dsc-row[data-active='true'] { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-border-l1); }
.dsc-rowTitle { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsc-rowWhen { color: var(--dsw-alias-label-secondary); font-size: 11px; font-variant-numeric: tabular-nums; }
.dsc-rowActions { display: none; align-items: center; gap: 2px; }
.dsc-row:hover .dsc-rowActions, .dsc-row:focus-within .dsc-rowActions { display: flex; }
.dsc-row:hover .dsc-rowWhen, .dsc-row:focus-within .dsc-rowWhen { display: none; }
.dsc-rowActions .dsc-iconButton { width: 22px; height: 22px; border-radius: 6px; }
.dsc-rowInput {
  flex: 1;
  min-width: 0;
  padding: 2px 6px;
  border: 1px solid var(--dsw-alias-brand-primary);
  border-radius: 6px;
  background: var(--dsw-alias-bg-base);
}
.dsc-railFoot { padding: 8px 8px 10px; border-top: 1px solid var(--dsw-alias-border-l1); }

.dsc-main { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
.dsc-chatHead {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  min-height: 48px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dsc-chatTitle { flex: 1; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsc-chatSub { color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 400; margin-left: 8px; }

.dsc-scroll { flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: thin; }
.dsc-thread { width: 100%; max-width: 780px; margin: 0 auto; padding: 24px 24px 8px; }
.dsc-welcome { max-width: 780px; margin: 0 auto; padding: 12vh 24px 24px; text-align: center; }
.dsc-welcomeMark { display: inline-flex; width: 44px; height: 44px; margin-bottom: 14px; }
.dsc-welcomeTitle { margin: 0 0 6px; font-size: 22px; font-weight: 600; letter-spacing: -0.01em; }
.dsc-welcomeHint { margin: 0 0 22px; color: var(--dsw-alias-label-secondary); font-size: 12.5px; }
.dsc-suggests { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
.dsc-suggest {
  max-width: 100%;
  padding: 9px 14px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 12.5px;
  cursor: pointer;
  text-align: left;
}
.dsc-suggest:hover { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1); }

.dsc-turn { margin-bottom: 26px; }
.dsc-userRow { display: flex; justify-content: flex-end; margin-bottom: 18px; }
.dsc-userBubble {
  max-width: min(78%, 560px);
  padding: 10px 14px;
  border-radius: 16px 16px 4px 16px;
  background: var(--dsw-alias-bg-layer-2);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.dsc-botRow { display: flex; flex-direction: column; gap: 8px; }
.dsc-botHead { display: flex; align-items: center; gap: 8px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsc-botMark { display: flex; width: 16px; height: 16px; flex: none; }
.dsc-botName { font-weight: 600; color: var(--dsw-alias-label-primary); }
.dsc-botActions { display: flex; gap: 2px; margin-left: auto; opacity: 0; transition: opacity 120ms ease; }
.dsc-botRow:hover .dsc-botActions, .dsc-botRow:focus-within .dsc-botActions { opacity: 1; }
.dsc-plainAction {
  padding: 2px 7px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
  cursor: pointer;
}
.dsc-plainAction:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsc-botBody { overflow-wrap: anywhere; }
.dsc-botBody > *:first-child { margin-top: 0; }
.dsc-botBody > *:last-child { margin-bottom: 0; }
.dsc-caret {
  display: inline-block;
  width: 7px;
  height: 15px;
  margin-left: 2px;
  vertical-align: -2px;
  border-radius: 1px;
  background: var(--dsw-alias-brand-primary);
  animation: dsc-blink 1.1s steps(2, start) infinite;
}
@keyframes dsc-blink { to { visibility: hidden; } }
.dsc-error {
  margin-top: 6px;
  padding: 8px 12px;
  border-left: 2px solid var(--dsw-alias-state-error-primary);
  border-radius: 0 8px 8px 0;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-state-error-primary);
  font-size: 12.5px;
  overflow-wrap: anywhere;
}
.dsc-stopNote { color: var(--dsw-alias-label-secondary); font-size: 12px; }

.dsc-reasoning { margin: 2px 0 10px; }
.dsc-reasoningToggle {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 3px 10px 3px 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  cursor: pointer;
}
.dsc-reasoningToggle:hover { color: var(--dsw-alias-label-primary); }
.dsc-liveDot {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
  background: var(--dsw-alias-state-success-primary);
  animation: dsc-pulse 1.2s ease-in-out infinite;
}
@keyframes dsc-pulse { 50% { opacity: 0.3; } }
.dsc-reasoningBody {
  margin-top: 8px;
  padding: 10px 12px;
  border-left: 2px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
  font-size: 12.5px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.dsc-composerWrap { padding: 8px 24px 18px; }
.dsc-composer {
  max-width: 780px;
  margin: 0 auto;
  padding: 10px 10px 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 16px;
  background: var(--dsw-alias-bg-layer-1);
  transition: border-color 120ms ease;
}
.dsc-composer:focus-within { border-color: var(--dsw-alias-brand-primary); }
.dsc-input {
  display: block;
  width: 100%;
  max-height: 200px;
  padding: 2px 6px 6px;
  border: 0;
  outline: none;
  resize: none;
  background: transparent;
  line-height: 1.6;
}
.dsc-composerBar { display: flex; align-items: center; gap: 8px; padding: 0 2px; }
.dsc-composerHint { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary); font-size: 11.5px; }
.dsc-send {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex: none;
  border: 0;
  border-radius: 50%;
  background: var(--dsw-alias-brand-primary);
  color: #fff;
  cursor: pointer;
}
.dsc-send:disabled { background: var(--dsw-alias-state-idle-primary); cursor: default; }
.dsc-send[data-stop='true'] { background: var(--dsw-alias-label-primary); }
.dsc-notice {
  max-width: 780px;
  margin: 0 auto 8px;
  color: var(--dsw-alias-state-warn-primary);
  font-size: 12px;
  text-align: center;
}

.dsc-mdPara { margin: 0 0 10px; }
.dsc-mdHeading { margin: 18px 0 8px; line-height: 1.35; font-weight: 600; }
h1.dsc-mdHeading { font-size: 19px; }
h2.dsc-mdHeading { font-size: 17px; }
h3.dsc-mdHeading { font-size: 15px; }
.dsc-mdList { margin: 0 0 10px; padding-left: 22px; }
.dsc-mdList li { margin-bottom: 3px; }
.dsc-mdQuote {
  margin: 0 0 10px;
  padding: 2px 0 2px 12px;
  border-left: 2px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
}
.dsc-mdRule { margin: 14px 0; border: 0; border-top: 1px solid var(--dsw-alias-border-l1); }
.dsc-inlineCode {
  padding: 1px 5px;
  border-radius: 5px;
  background: var(--dsw-alias-bg-layer-2);
  font-family: var(--dsh-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 0.92em;
}
.dsc-root a { color: var(--dsw-alias-brand-primary); text-decoration: none; }
.dsc-root a:hover { text-decoration: underline; }
.dsc-code {
  margin: 0 0 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  overflow: hidden;
  background: var(--dsw-alias-bg-layer-1);
}
.dsc-codeHead {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
}
.dsc-codeLang { flex: 1; letter-spacing: 0.04em; text-transform: lowercase; }
.dsc-codeCopy { border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 11px; cursor: pointer; }
.dsc-codeCopy:hover { color: var(--dsw-alias-label-primary); }
.dsc-codeBody {
  margin: 0;
  padding: 10px 12px;
  overflow-x: auto;
  font-family: var(--dsh-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: var(--dsh-code-font-size, 12.5px);
  line-height: 1.55;
}
.dsc-codeBody code { white-space: pre; }
.dsc-tableWrap { margin: 0 0 12px; overflow-x: auto; }
.dsc-table { width: 100%; border-collapse: collapse; font-size: 0.95em; }
.dsc-table th, .dsc-table td { padding: 6px 10px; border: 1px solid var(--dsw-alias-border-l1); text-align: left; }
.dsc-table th { background: var(--dsw-alias-bg-layer-1); font-weight: 600; }

.dsc-overlay {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.34);
  background: var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, 0.34));
}
.dsc-dialog {
  width: min(460px, 100%);
  max-height: 100%;
  overflow-y: auto;
  padding: 20px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 14px;
  background: var(--dsw-alias-bg-overlay);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.22);
}
.dsc-dialogTitle { margin: 0 0 4px; font-size: 15px; font-weight: 600; }
.dsc-dialogHint { margin: 0 0 16px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.5; }
.dsc-field { margin-bottom: 14px; }
.dsc-label { display: block; margin-bottom: 5px; font-size: 12px; font-weight: 500; }
.dsc-inputText {
  display: block;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-base);
}
.dsc-inputText:focus { outline: none; border-color: var(--dsw-alias-brand-primary); }
.dsc-fieldHint { margin-top: 5px; color: var(--dsw-alias-label-secondary); font-size: 11px; }
.dsc-dialogFoot { display: flex; align-items: center; gap: 8px; margin-top: 18px; }
.dsc-dialogFoot .dsc-spacer { flex: 1; }
.dsc-button {
  padding: 7px 14px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
}
.dsc-button:hover { background: var(--dsw-alias-bg-layer-1); }
.dsc-button[data-primary='true'] {
  border-color: transparent;
  background: var(--dsw-alias-brand-primary);
  color: #fff;
  font-weight: 500;
}
.dsc-button[data-primary='true']:hover { filter: brightness(1.05); }
.dsc-button[data-danger='true'] { color: var(--dsw-alias-state-error-primary); }
.dsc-button[data-danger='true']:hover { border-color: var(--dsw-alias-state-error-primary); }

.dsc-rail[data-overlay='true'] {
  position: absolute;
  inset: 0 auto 0 0;
  z-index: 20;
  width: min(280px, 84%);
  flex: none;
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.26);
}
.dsc-scrim { position: absolute; inset: 0; z-index: 19; background: rgba(0, 0, 0, 0.3); }

@media (hover: none) {
  .dsc-rowActions { display: flex; }
  .dsc-rowWhen { display: none; }
  .dsc-botActions { opacity: 1; }
}
@media (max-width: 620px) {
  .dsc-thread { padding: 18px 14px 4px; }
  .dsc-composerWrap { padding: 6px 12px 14px; }
  .dsc-welcome { padding-top: 8vh; }
  .dsc-userBubble { max-width: 88%; }
}
@media (prefers-reduced-motion: reduce) {
  .dsc-caret { animation: none; }
  .dsc-liveDot { animation: none; }
}
`;

    /* --------------------------------------------------------------- artwork */

    /** The sidebar glyph, drawn to the host's 20px stroke-icon convention. */
    function PanelIcon(props) {
      const size = props.size || 20;
      return h('svg', {
        viewBox: '0 0 24 24', width: size, height: size, fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true, focusable: false,
      },
        h('path', { d: 'M4.8 5.4h14.4a1.8 1.8 0 0 1 1.8 1.8v8.1a1.8 1.8 0 0 1-1.8 1.8h-7.3l-4.3 3.1v-3.1H4.8A1.8 1.8 0 0 1 3 15.3V7.2a1.8 1.8 0 0 1 1.8-1.8Z' }),
        h('path', { d: 'M8 11.9h.01M12 11.9h.01M16 11.9h.01' }));
    }

    /** The brand mark used inside the page (filled, brand colored). */
    function BrandMark(props) {
      const size = props.size || 22;
      return h('svg', { viewBox: '0 0 64 64', width: size, height: size, 'aria-hidden': true, focusable: false },
        h('rect', { x: 2, y: 2, width: 60, height: 60, rx: 17, fill: 'var(--dsw-alias-brand-primary)' }),
        h('path', {
          d: 'M20 20.5h24a5.5 5.5 0 0 1 5.5 5.5v13.2a5.5 5.5 0 0 1-5.5 5.5H31.4L22.9 51.2a1 1 0 0 1-1.63-.78v-5.72H20a5.5 5.5 0 0 1-5.5-5.5V26A5.5 5.5 0 0 1 20 20.5Z',
          fill: '#fff', fillOpacity: 0.95,
        }),
        h('g', { fill: 'var(--dsw-alias-brand-primary)' },
          h('circle', { cx: 25.4, cy: 32.6, r: 2.4 }),
          h('circle', { cx: 32, cy: 32.6, r: 2.4 }),
          h('circle', { cx: 38.6, cy: 32.6, r: 2.4 })));
    }

    function PlusIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', 'aria-hidden': true },
        h('path', { d: 'M8 3.2v9.6M3.2 8h9.6' }));
    }

    function ArrowIcon(props) {
      const up = props.up === true;
      return h('svg', { viewBox: '0 0 16 16', width: 15, height: 15, fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        up ? h('path', { d: 'M4.5 8.5v3.7h7V8.5M4 5.6l4-3.6 4 3.6M8 2v8.4' })
          : h('path', { d: 'M8 13V3.4M3.8 7.6 8 3.4l4.2 4.2' }));
    }

    function StopIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, fill: 'currentColor', 'aria-hidden': true },
        h('rect', { x: 4, y: 4, width: 8, height: 8, rx: 1.6 }));
    }

    function GearIcon() {
      return h('svg', { viewBox: '0 0 20 20', width: 15, height: 15, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('circle', { cx: 10, cy: 10, r: 2.6 }),
        h('path', { d: 'M10 2.6v1.9M10 15.5v1.9M2.6 10h1.9M15.5 10h1.9M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4' }));
    }

    function PanelToggleIcon() {
      return h('svg', { viewBox: '0 0 20 20', width: 15, height: 15, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('rect', { x: 2.6, y: 3.6, width: 14.8, height: 12.8, rx: 2.4 }),
        h('path', { d: 'M8 3.6v12.8' }));
    }

    function BackIcon() {
      return h('svg', { viewBox: '0 0 20 20', width: 15, height: 15, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M11.8 4.6 6.4 10l5.4 5.4' }));
    }

    function TrashIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M3.2 4.4h9.6M6.4 4.4V3.2h3.2v1.2M4.4 4.4l.6 8h6l.6-8' }));
    }

    function PencilIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M11.1 2.7 13.3 4.9 5.6 12.6l-3.1.8.8-3.1z' }));
    }

    /* ------------------------------------------------------------ components */

    /** A media-query hook so the rail can become an overlay on narrow panels. */
    function useMediaQuery(query) {
      const [matches, setMatches] = useState(() => (
        typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false
      ));
      useEffect(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return undefined;
        const list = window.matchMedia(query);
        const onChange = () => setMatches(list.matches);
        setMatches(list.matches);
        if (list.addEventListener) list.addEventListener('change', onChange);
        else if (list.addListener) list.addListener(onChange);
        return () => {
          if (list.removeEventListener) list.removeEventListener('change', onChange);
          else if (list.removeListener) list.removeListener(onChange);
        };
      }, [query]);
      return matches;
    }

    /** One collapsible block holding the model's reasoning, when the model returns it. */
    function Reasoning(props) {
      const { text, live, t } = props;
      const [open, setOpen] = useState(false);
      if (!text) return null;
      return h('div', { className: 'dsc-reasoning' },
        h('button', {
          type: 'button',
          className: 'dsc-reasoningToggle',
          'aria-expanded': open,
          onClick: () => setOpen((value) => !value),
        },
          live ? h('span', { className: 'dsc-liveDot' }) : null,
          h('span', null, t(live ? 'thinkingLive' : 'thinkingDone')),
          h('span', { 'aria-hidden': true }, open ? '–' : '+')),
        open ? h('div', { className: 'dsc-reasoningBody' }, text) : null);
    }

    /** One assistant message: reasoning, rendered body, streaming caret, actions. */
    function AssistantMessage(props) {
      const { message, streaming, onRegenerate, canRegenerate, t } = props;
      const [copied, setCopied] = useState(false);
      const copy = useCallback(() => {
        copyText(message.content).then((ok) => {
          if (!ok) return;
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        });
      }, [message.content]);
      const hasBody = Boolean(message.content);
      return h('div', { className: 'dsc-botRow' },
        h('div', { className: 'dsc-botHead' },
          h('span', { className: 'dsc-botMark' }, h(BrandMark, { size: 16 })),
          h('span', { className: 'dsc-botName' }, t('assistantName')),
          streaming ? h('span', { className: 'dsc-liveDot' }) : null,
          hasBody && !streaming
            ? h('span', { className: 'dsc-botActions' },
              h('button', { type: 'button', className: 'dsc-plainAction', onClick: copy }, copied ? t('copied') : t('copy')),
              canRegenerate ? h('button', { type: 'button', className: 'dsc-plainAction', onClick: onRegenerate }, t('regenerate')) : null)
            : null),
        h(Reasoning, { text: message.reasoning, live: streaming && !hasBody, t }),
        hasBody
          ? h('div', { className: 'dsc-botBody' }, renderMarkdown(message.content, t, message.id), streaming ? h('span', { className: 'dsc-caret' }) : null)
          : streaming ? h('div', { className: 'dsc-botBody' }, h('span', { className: 'dsc-caret' })) : null,
        message.error ? h('div', { className: 'dsc-error', role: 'alert' }, t('error') + ': ' + message.error) : null,
        message.stopped && !message.error ? h('div', { className: 'dsc-stopNote' }, t('stopped')) : null);
    }

    /** One conversation row with inline rename and delete. */
    function ConversationRow(props) {
      const { conversation, active, renaming, t, onSelect, onStartRename, onCommitRename, onCancelRename, onDelete } = props;
      const [draft, setDraft] = useState(conversation.title || '');
      const inputRef = useRef(null);
      useEffect(() => {
        if (!renaming) return;
        setDraft(conversation.title || '');
        const node = inputRef.current;
        if (node) {
          node.focus();
          node.select();
        }
      }, [renaming, conversation.title]);
      if (renaming) {
        return h('div', { className: 'dsc-row', 'data-active': active ? 'true' : 'false' },
          h('input', {
            ref: inputRef,
            className: 'dsc-rowInput',
            value: draft,
            'aria-label': t('rename'),
            onChange: (event) => setDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onCommitRename(draft);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                onCancelRename();
              }
            },
            onBlur: () => onCommitRename(draft),
          }));
      }
      return h('div', {
        className: 'dsc-row',
        'data-active': active ? 'true' : 'false',
        role: 'button',
        tabIndex: 0,
        onClick: onSelect,
        onKeyDown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect();
          }
        },
      },
        h('span', { className: 'dsc-rowTitle' }, conversation.title || t('untitled')),
        h('span', { className: 'dsc-rowWhen' }, formatWhen(conversation.updatedAt)),
        h('span', { className: 'dsc-rowActions' },
          h('button', {
            type: 'button',
            className: 'dsc-iconButton',
            title: t('rename'),
            'aria-label': t('rename'),
            onClick: (event) => {
              event.stopPropagation();
              onStartRename();
            },
          }, h(PencilIcon)),
          h('button', {
            type: 'button',
            className: 'dsc-iconButton',
            title: t('delete'),
            'aria-label': t('delete'),
            onClick: (event) => {
              event.stopPropagation();
              onDelete();
            },
          }, h(TrashIcon))));
    }

    /** The settings dialog: API key, base URL, model, and destructive reset. */
    function SettingsDialog(props) {
      const { t, settings, onSave, onClose, onClearAll } = props;
      const [apiKey, setApiKey] = useState(settings.apiKey);
      const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
      const [model, setModel] = useState(settings.model);
      const [confirming, setConfirming] = useState(false);
      const keyRef = useRef(null);
      useEffect(() => {
        const node = keyRef.current;
        if (node) node.focus();
      }, []);
      const submit = () => {
        onSave({
          apiKey: apiKey.trim(),
          baseUrl: baseUrl.trim() || DEFAULT_BASE_URL,
          model: model.trim() || DEFAULT_MODEL,
        });
      };
      return h('div', {
        className: 'dsc-overlay',
        onMouseDown: (event) => {
          if (event.target === event.currentTarget) onClose();
        },
      },
        h('div', {
          className: 'dsc-dialog',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': t('settings'),
          onKeyDown: (event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              onClose();
            }
          },
        },
          h('h2', { className: 'dsc-dialogTitle' }, t('settings')),
          h('p', { className: 'dsc-dialogHint' }, t('settingsHint')),
          h('div', { className: 'dsc-field' },
            h('label', { className: 'dsc-label', htmlFor: 'dsc-api-key' }, t('apiKey')),
            h('input', {
              id: 'dsc-api-key',
              ref: keyRef,
              className: 'dsc-inputText',
              type: 'password',
              autoComplete: 'off',
              spellCheck: false,
              placeholder: t('apiKeyPlaceholder'),
              value: apiKey,
              onChange: (event) => setApiKey(event.target.value),
            }),
            h('div', { className: 'dsc-fieldHint' }, t('apiKeyHint'))),
          h('div', { className: 'dsc-field' },
            h('label', { className: 'dsc-label', htmlFor: 'dsc-base-url' }, t('baseUrl')),
            h('input', {
              id: 'dsc-base-url',
              className: 'dsc-inputText',
              type: 'url',
              spellCheck: false,
              value: baseUrl,
              onChange: (event) => setBaseUrl(event.target.value),
            })),
          h('div', { className: 'dsc-field' },
            h('label', { className: 'dsc-label', htmlFor: 'dsc-model' }, t('model')),
            h('input', {
              id: 'dsc-model',
              className: 'dsc-inputText',
              list: 'dsc-model-options',
              spellCheck: false,
              value: model,
              onChange: (event) => setModel(event.target.value),
            }),
            h('datalist', { id: 'dsc-model-options' },
              h('option', { value: 'deepseek-chat' }),
              h('option', { value: 'deepseek-reasoner' })),
            h('div', { className: 'dsc-fieldHint' }, t('modelHint'))),
          h('div', { className: 'dsc-dialogFoot' },
            h('button', {
              type: 'button',
              className: 'dsc-button',
              'data-danger': 'true',
              onClick: () => {
                if (!confirming) {
                  setConfirming(true);
                  return;
                }
                setConfirming(false);
                onClearAll();
              },
            }, confirming ? t('clearConfirm') : t('clearAll')),
            h('span', { className: 'dsc-spacer' }),
            h('button', { type: 'button', className: 'dsc-button', onClick: onClose }, t('cancel')),
            h('button', { type: 'button', className: 'dsc-button', 'data-primary': 'true', onClick: submit }, t('save')))));
    }

    /**
     * The main panel page: conversation rail, thread, composer, and settings.
     * @param props - slot runtime share plus the injected translator.
     */
    function ChatPanel(props) {
      const t = props.t;
      const bootRef = useRef(null);
      if (bootRef.current === null) {
        const initial = sortConversations(loadConversations());
        bootRef.current = { list: initial, activeId: initial.length ? initial[0].id : null };
      }
      const [conversations, setConversations] = useState(bootRef.current.list);
      const [activeId, setActiveId] = useState(bootRef.current.activeId);
      const [settings, setSettings] = useState(loadSettings);
      const [draft, setDraft] = useState('');
      const [railOpen, setRailOpen] = useState(true);
      const [settingsOpen, setSettingsOpen] = useState(false);
      const [renamingId, setRenamingId] = useState(null);
      const [streamingId, setStreamingId] = useState(null);
      const [notice, setNotice] = useState('');
      const [savedNotice, setSavedNotice] = useState('');
      const inputRef = useRef(null);
      const scrollRef = useRef(null);
      const stickRef = useRef(true);
      const abortRef = useRef(null);
      const saveTimerRef = useRef(null);
      const narrow = useMediaQuery('(max-width: 760px)');

      const active = useMemo(
        () => conversations.find((item) => item.id === activeId) || null,
        [conversations, activeId],
      );
      const busy = streamingId !== null;

      /* Persist conversations, coalescing bursts while a reply streams. */
      useEffect(() => {
        if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = window.setTimeout(() => {
          saveTimerRef.current = null;
          writeJson(CONVERSATIONS_KEY, conversations);
        }, 300);
        return () => {
          if (saveTimerRef.current !== null) {
            window.clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
          }
        };
      }, [conversations]);

      /* Keep the newest array reachable from the unmount cleanup. */
      const latestConversations = useRef(conversations);
      latestConversations.current = conversations;

      /* Abort an in-flight reply and flush the last state when the panel unmounts. */
      useEffect(() => () => {
        if (abortRef.current) abortRef.current.abort();
        writeJson(CONVERSATIONS_KEY, latestConversations.current);
      }, []);

      useEffect(() => {
        setRailOpen(!narrow);
      }, [narrow]);

      useEffect(() => {
        if (!notice) return undefined;
        const timer = window.setTimeout(() => setNotice(''), 4000);
        return () => window.clearTimeout(timer);
      }, [notice]);

      useEffect(() => {
        if (!savedNotice) return undefined;
        const timer = window.setTimeout(() => setSavedNotice(''), 2000);
        return () => window.clearTimeout(timer);
      }, [savedNotice]);

      /* Grow the textarea with its content, up to the CSS cap. */
      useEffect(() => {
        const node = inputRef.current;
        if (!node) return;
        node.style.height = 'auto';
        node.style.height = Math.min(node.scrollHeight, 200) + 'px';
      }, [draft]);

      /* Follow the newest content while the reader stays at the bottom. */
      useEffect(() => {
        const node = scrollRef.current;
        if (!node || !stickRef.current) return;
        node.scrollTop = node.scrollHeight;
      }, [conversations, streamingId, activeId]);

      const onScroll = useCallback(() => {
        const node = scrollRef.current;
        if (!node) return;
        stickRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60;
      }, []);

      const updateConversation = useCallback((id, updater) => {
        setConversations((previous) => previous.map((item) => (item.id === id ? updater(item) : item)));
      }, []);

      const patchMessage = useCallback((conversationId, messageId, updater) => {
        setConversations((previous) => previous.map((item) => {
          if (item.id !== conversationId) return item;
          return Object.assign({}, item, {
            updatedAt: Date.now(),
            messages: item.messages.map((message) => (message.id === messageId ? updater(message) : message)),
          });
        }));
      }, []);

      const runReply = useCallback(async (conversationId, messageId, history) => {
        const controller = new AbortController();
        abortRef.current = controller;
        setStreamingId(messageId);
        stickRef.current = true;
        let content = '';
        let reasoning = '';
        try {
          await streamReply({
            settings,
            messages: history,
            signal: controller.signal,
            onDelta: (delta) => {
              if (delta.content) content += delta.content;
              if (delta.reasoning) reasoning += delta.reasoning;
              patchMessage(conversationId, messageId, (message) => Object.assign({}, message, { content, reasoning }));
            },
          });
          patchMessage(conversationId, messageId, (message) => Object.assign({}, message, { content, reasoning }));
        } catch (error) {
          if (error && error.name === 'AbortError') {
            patchMessage(conversationId, messageId, (message) => Object.assign({}, message, { content, reasoning, stopped: true }));
          } else {
            patchMessage(conversationId, messageId, (message) => Object.assign({}, message, {
              content,
              reasoning,
              error: (error && error.message ? error.message : String(error)),
            }));
          }
        } finally {
          abortRef.current = null;
          setStreamingId(null);
        }
      }, [patchMessage, settings]);

      const findConversation = useCallback((id) => conversations.find((item) => item.id === id) || null, [conversations]);

      const send = useCallback((textInput) => {
        const text = String(textInput === undefined ? draft : textInput).trim();
        if (!text || busy) return;
        if (!String(settings.apiKey).trim()) {
          setNotice(t('missingKey'));
          setSettingsOpen(true);
          return;
        }
        const userMessage = { id: uid(), role: 'user', content: text, reasoning: '', error: '', stopped: false };
        const botMessage = { id: uid(), role: 'assistant', content: '', reasoning: '', error: '', stopped: false };
        const target = activeId ? findConversation(activeId) : null;
        const history = [];
        let conversationId = activeId;
        if (target) {
          for (let i = 0; i < target.messages.length; i += 1) {
            const message = target.messages[i];
            if (message.content) history.push({ role: message.role, content: message.content });
          }
          updateConversation(target.id, (item) => Object.assign({}, item, {
            title: item.title || titleFrom(text),
            updatedAt: Date.now(),
            messages: item.messages.concat([userMessage, botMessage]),
          }));
        } else {
          conversationId = uid();
          const created = {
            id: conversationId,
            title: titleFrom(text),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: [userMessage, botMessage],
          };
          setConversations((previous) => [created].concat(previous));
          setActiveId(conversationId);
        }
        history.push({ role: 'user', content: text });
        setDraft('');
        setNotice('');
        stickRef.current = true;
        runReply(conversationId, botMessage.id, history);
        window.setTimeout(() => {
          const node = inputRef.current;
          if (node) node.focus();
        }, 0);
      }, [activeId, busy, draft, findConversation, runReply, settings.apiKey, t, updateConversation]);

      const stop = useCallback(() => {
        if (abortRef.current) abortRef.current.abort();
      }, []);

      const regenerate = useCallback((conversation) => {
        if (!conversation || busy) return;
        const lastIndex = conversation.messages.length - 1;
        const last = conversation.messages[lastIndex];
        if (!last || last.role !== 'assistant') return;
        const history = [];
        for (let i = 0; i < lastIndex; i += 1) {
          const message = conversation.messages[i];
          if (message.content) history.push({ role: message.role, content: message.content });
        }
        if (!history.length) return;
        patchMessage(conversation.id, last.id, (message) => Object.assign({}, message, {
          content: '', reasoning: '', error: '', stopped: false,
        }));
        runReply(conversation.id, last.id, history);
      }, [busy, patchMessage, runReply]);

      const startNewChat = useCallback(() => {
        const created = { id: uid(), title: '', createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
        setConversations((previous) => [created].concat(previous));
        setActiveId(created.id);
        setDraft('');
        setNotice('');
        if (narrow) setRailOpen(false);
        window.setTimeout(() => {
          const node = inputRef.current;
          if (node) node.focus();
        }, 0);
      }, [narrow]);

      const deleteConversation = useCallback((id) => {
        if (id === activeId && abortRef.current) abortRef.current.abort();
        const remaining = conversations.filter((item) => item.id !== id);
        setConversations(remaining);
        if (id === activeId) setActiveId(remaining.length ? remaining[0].id : null);
      }, [activeId, conversations]);

      const commitRename = useCallback((id, value) => {
        const title = String(value || '').trim();
        updateConversation(id, (item) => Object.assign({}, item, { title }));
        setRenamingId(null);
      }, [updateConversation]);

      const saveSettings = useCallback((next) => {
        setSettings(next);
        writeJson(SETTINGS_KEY, next);
        setSettingsOpen(false);
        setSavedNotice(t('settingsSaved'));
        setNotice('');
      }, [t]);

      const clearAll = useCallback(() => {
        if (abortRef.current) abortRef.current.abort();
        setConversations([]);
        setActiveId(null);
        writeJson(CONVERSATIONS_KEY, []);
        setSettingsOpen(false);
      }, []);

      const onKeyDown = useCallback((event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault();
          send();
        }
      }, [send]);

      const messages = active ? active.messages : [];
      const canRegenerate = Boolean(active) && !busy && messages.length > 0 && messages[messages.length - 1].role === 'assistant';
      const hasApiKey = Boolean(String(settings.apiKey).trim());

      const rail = h('aside', {
        className: 'dsc-rail',
        'data-overlay': narrow ? 'true' : 'false',
        'aria-label': t('railTitle'),
        hidden: !railOpen,
      },
        h('div', { className: 'dsc-railHead' },
          h('span', { className: 'dsc-brandMark' }, h(BrandMark, { size: 22 })),
          h('span', { className: 'dsc-brandName' }, t('panel')),
          h('button', {
            type: 'button',
            className: 'dsc-iconButton',
            title: t('railToggle'),
            'aria-label': t('railToggle'),
            onClick: () => setRailOpen(false),
          }, h(PanelToggleIcon))),
        h('button', { type: 'button', className: 'dsc-newChat', onClick: startNewChat },
          h(PlusIcon), h('span', null, t('newChat'))),
        h('div', { className: 'dsc-railSection' }, t('railTitle')),
        h('div', { className: 'dsc-railList' },
          conversations.length === 0
            ? h('div', { className: 'dsc-railEmpty' }, t('railEmpty'), h('br'), h('span', null, t('railEmptyHint')))
            : sortConversations(conversations).map((conversation) => h(ConversationRow, {
              key: conversation.id,
              conversation,
              active: conversation.id === activeId,
              renaming: conversation.id === renamingId,
              t,
              onSelect: () => {
                setActiveId(conversation.id);
                if (narrow) setRailOpen(false);
              },
              onStartRename: () => setRenamingId(conversation.id),
              onCommitRename: (value) => commitRename(conversation.id, value),
              onCancelRename: () => setRenamingId(null),
              onDelete: () => deleteConversation(conversation.id),
            }))),
        h('div', { className: 'dsc-railFoot' },
          h('button', {
            type: 'button',
            className: 'dsc-row',
            onClick: () => setSettingsOpen(true),
          },
            h('span', { className: 'dsc-iconButton' }, h(GearIcon)),
            h('span', { className: 'dsc-rowTitle' }, t('settings')))));

      const thread = messages.length === 0
        ? h('div', { className: 'dsc-welcome' },
          h('span', { className: 'dsc-welcomeMark' }, h(BrandMark, { size: 44 })),
          h('h1', { className: 'dsc-welcomeTitle' }, t('welcomeTitle')),
          h('p', { className: 'dsc-welcomeHint' }, t('welcomeHint')),
          h('div', { className: 'dsc-suggests' },
            ['suggest1', 'suggest2', 'suggest3'].map((key) => h('button', {
              key,
              type: 'button',
              className: 'dsc-suggest',
              onClick: () => send(t(key)),
            }, t(key)))))
        : h('div', { className: 'dsc-thread' }, messages.map((message) => {
          if (message.role === 'user') {
            return h('div', { key: message.id, className: 'dsc-userRow' },
              h('div', { className: 'dsc-userBubble' }, message.content));
          }
          return h('div', { key: message.id, className: 'dsc-turn' },
            h(AssistantMessage, {
              message,
              streaming: message.id === streamingId,
              canRegenerate,
              onRegenerate: () => regenerate(active),
              t,
            }));
        }));

      const chatColumn = h('section', { className: 'dsc-main' },
        h('header', { className: 'dsc-chatHead' },
          h('button', {
            type: 'button',
            className: 'dsc-iconButton',
            title: t('backToConversation'),
            'aria-label': t('backToConversation'),
            onClick: () => {
              if (typeof props.backToConversation === 'function') props.backToConversation();
            },
          }, h(BackIcon)),
          narrow || !railOpen
            ? h('button', {
              type: 'button',
              className: 'dsc-iconButton',
              title: t('railToggle'),
              'aria-label': t('railToggle'),
              onClick: () => setRailOpen(true),
            }, h(PanelToggleIcon))
            : null,
          h('span', { className: 'dsc-chatTitle' },
            (active && active.title) || t('newChat'),
            h('span', { className: 'dsc-chatSub' }, settings.model)),
          h('button', {
            type: 'button',
            className: 'dsc-iconButton',
            title: t('settings'),
            'aria-label': t('settings'),
            onClick: () => setSettingsOpen(true),
          }, h(GearIcon))),
        h('div', { className: 'dsc-scroll', ref: scrollRef, onScroll }, thread),
        h('div', { className: 'dsc-composerWrap' },
          notice ? h('div', { className: 'dsc-notice', role: 'status' }, notice) : null,
          savedNotice ? h('div', { className: 'dsc-notice', role: 'status' }, savedNotice) : null,
          h('div', { className: 'dsc-composer' },
            h('textarea', {
              ref: inputRef,
              className: 'dsc-input',
              rows: 1,
              value: draft,
              placeholder: hasApiKey ? t('placeholder') : t('missingKey'),
              'aria-label': t('placeholder'),
              onChange: (event) => setDraft(event.target.value),
              onKeyDown,
            }),
            h('div', { className: 'dsc-composerBar' },
              h('span', { className: 'dsc-composerHint' }, t('welcomeHint')),
              busy
                ? h('button', {
                  type: 'button',
                  className: 'dsc-send',
                  'data-stop': 'true',
                  title: t('stop'),
                  'aria-label': t('stop'),
                  onClick: stop,
                }, h(StopIcon))
                : h('button', {
                  type: 'button',
                  className: 'dsc-send',
                  title: t('send'),
                  'aria-label': t('send'),
                  disabled: !draft.trim(),
                  onClick: () => send(),
                }, h(ArrowIcon))))));

      return h('div', { className: 'dsc-root' },
        h('style', { dangerouslySetInnerHTML: { __html: CSS } }),
        railOpen && narrow ? h('div', { className: 'dsc-scrim', onClick: () => setRailOpen(false) }) : null,
        rail,
        chatColumn,
        settingsOpen
          ? h(SettingsDialog, {
            t,
            settings,
            onSave: saveSettings,
            onClose: () => setSettingsOpen(false),
            onClearAll: clearAll,
          })
          : null);
    }

    /* ---------------------------------------------------------------- plugin */

    return {
      inject: ['slots', 'locale', 'layout'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'deepseek-chat: dictionaries');
        const t = ctx.locale.bind(NS);
        const openPanel = () => {
          try {
            ctx.layout.selectPanel(PANEL_ID);
          } catch (error) {
            console.error('[deepseek-chat] could not open the chat panel', error);
          }
        };
        const backToConversation = () => {
          try {
            ctx.layout.selectPanel(null);
          } catch (error) {
            console.error('[deepseek-chat] could not return to the conversation', error);
          }
        };
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 40,
          label: () => t('panel'),
          locale: NS,
        }, PanelIcon));
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
          inject: () => ({ t, openPanel, backToConversation }),
        }, ChatPanel));
      },
    };
  },
});
