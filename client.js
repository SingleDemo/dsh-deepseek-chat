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
    const DEFAULT_MODEL = 'deepseek-flash';
    /** Thinking levels accepted by `reasoning_effort`; `off` disables the mode. */
    const THINKING_LEVELS = ['off', 'low', 'high', 'max'];
    /** TTS voices offered by the speech API. */
    const TTS_VOICES = ['stella', 'tide'];
    /** The speech API caps a single synthesis at 10,000 billing characters. */
    const TTS_MAX_CHARS = 9000;
    /** The ASR API caps one upload at 120 seconds and 8 MiB. */
    const RECORDING_LIMIT_SECONDS = 110;

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
      webSearch: 'Web search',
      thinking: 'Thinking',
      thinkOff: 'Off',
      thinkLow: 'Low',
      thinkHigh: 'High',
      thinkMax: 'Max',
      sources: 'Sources',
      searching: 'Searching the web…',
      searchFailed: 'Web search failed; answering without sources',
      voiceInput: 'Voice input',
      listening: 'Listening… tap to stop',
      transcribing: 'Transcribing…',
      recordDenied: 'Microphone access was denied',
      recordFailed: 'Could not start the microphone',
      recordTooLong: 'Recording stopped after 110 seconds',
      speak: 'Read aloud',
      stopReading: 'Stop reading',
      speakFailed: 'Could not synthesize speech',
      ocr: 'Scan text (OCR)',
      ocrWorking: 'Recognizing text…',
      ocrDone: 'Text recognized and added to the draft',
      ocrEmpty: 'No text was recognized in that file',
      ocrFailed: 'OCR failed',
      ocrHint: 'PDF, Word, PowerPoint, or an image',
      showAll: 'Show all',
      collapse: 'Collapse',
      jumpToLatest: 'Jump to latest',
      voice: 'Voice',
      voiceStella: 'Stella · female',
      voiceTide: 'Tide · male',
      speechHint: 'Voice input and read-aloud use your API key and appear on your bill.',
      settingsConnection: 'Connection',
      settingsSpeech: 'Speech',
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
      webSearch: '联网',
      thinking: '思考',
      thinkOff: '关闭',
      thinkLow: '低',
      thinkHigh: '高',
      thinkMax: '最高',
      sources: '来源',
      searching: '正在联网搜索…',
      searchFailed: '联网搜索失败，改为不引用来源回答',
      voiceInput: '语音输入',
      listening: '正在录音…点击结束',
      transcribing: '正在识别语音…',
      recordDenied: '麦克风权限被拒绝',
      recordFailed: '无法启动麦克风',
      recordTooLong: '录音已自动停止（110 秒）',
      speak: '朗读',
      stopReading: '停止朗读',
      speakFailed: '语音合成失败',
      ocr: '识别文字（OCR）',
      ocrWorking: '正在识别文字…',
      ocrDone: '已识别，文字已加入输入框',
      ocrEmpty: '这个文件里没有识别到文字',
      ocrFailed: 'OCR 识别失败',
      ocrHint: '支持 PDF、Word、PowerPoint 或图片',
      showAll: '显示全部',
      collapse: '收起',
      jumpToLatest: '跳到最新',
      voice: '音色',
      voiceStella: '海星 · 女声',
      voiceTide: '暗潮 · 男声',
      speechHint: '语音输入与朗读使用你的 API Key，会产生相应费用。',
      settingsConnection: '连接',
      settingsSpeech: '语音',
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
        thinking: THINKING_LEVELS.indexOf(stored.thinking) >= 0 ? stored.thinking : 'high',
        webSearch: stored.webSearch === true,
        voice: TTS_VOICES.indexOf(stored.voice) >= 0 ? stored.voice : 'stella',
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
              sources: Array.isArray(m.sources)
                ? m.sources
                  .filter((s) => s && typeof s.url === 'string')
                  .map((s) => ({
                    title: typeof s.title === 'string' ? s.title : '',
                    url: s.url,
                    snippet: typeof s.snippet === 'string' ? s.snippet : '',
                    site: typeof s.site === 'string' ? s.site : '',
                  }))
                : [],
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

    const INLINE_PATTERN = /(!\[[^\]\n]*\]\([^)\s]+\))|(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(~~[^~\n]+~~)|(\[[^\]\n]*\]\([^)\s]+\))|((?:https?:\/\/)[^\s<>()]+)|(\[\d{1,2}\])/g;

    /** Build inline nodes (code, emphasis, links, citation chips) for one line of text. */
    function renderInline(text, keyPrefix, sources) {
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
        if (token.charAt(0) === '!' && token.indexOf('](') > 2) {
          const split = token.indexOf('](');
          const alt = token.slice(2, split);
          const src = token.slice(split + 2, -1);
          nodes.push(h('img', { key, className: 'dsc-mdImage', src, alt: alt || '' }));
        } else if (token.charAt(0) === '`') {
          nodes.push(h('code', { key, className: 'dsc-inlineCode' }, token.slice(1, -1)));
        } else if (token.startsWith('**') || token.startsWith('__')) {
          nodes.push(h('strong', { key }, token.slice(2, -2)));
        } else if (token.startsWith('~~')) {
          nodes.push(h('del', { key }, token.slice(2, -2)));
        } else if (token.startsWith('*') || token.startsWith('_')) {
          nodes.push(h('em', { key }, token.slice(1, -1)));
        } else if (token.charAt(0) === '[' && token.indexOf('](') > 0) {
          const split = token.indexOf('](');
          const label = token.slice(1, split);
          const href = token.slice(split + 2, -1);
          nodes.push(h('a', { key, href, target: '_blank', rel: 'noreferrer noopener' }, label || href));
        } else if (/^\[\d{1,2}\]$/.test(token)) {
          const number = Number(token.slice(1, -1));
          const source = sources && sources[number - 1];
          if (source) {
            nodes.push(h('sup', { key, className: 'dsc-cite' },
              h('a', { href: source.url, target: '_blank', rel: 'noreferrer noopener', title: source.title || source.url }, String(number))));
          } else {
            nodes.push(token);
          }
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
    function startsBlock(line) {
      return (
        /^\s*(```|~~~)/.test(line) ||
        /^\s{0,3}#{1,6}\s+/.test(line) ||
        /^\s*>/.test(line) ||
        /^\s*([-*+]|\d+[.)])\s+/.test(line) ||
        /^\s*([-*_])\s*(\1\s*){2,}$/.test(line)
      );
    }

    /** Read one markdown list marker from a line, if it starts a list item. */
    function matchListItem(line) {
      if (typeof line !== 'string') return null;
      const match = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
      if (!match) return null;
      const ordered = /\d/.test(match[1]);
      return { ordered, number: ordered ? Number.parseInt(match[1], 10) : 1, text: match[2] };
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
        const listItem = matchListItem(line);
        if (listItem) {
          const ordered = listItem.ordered;
          const start = listItem.number;
          const items = [listItem.text];
          i += 1;
          for (;;) {
            // A blank line does not end a list: models separate loose items with one.
            let probe = i;
            while (probe < lines.length && !lines[probe].trim()) probe += 1;
            const next = matchListItem(lines[probe]);
            if (!next || next.ordered !== ordered) break;
            items.push(next.text);
            i = probe + 1;
          }
          blocks.push({ type: 'list', ordered, start, items });
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

    /* ---------------------------------------------------------- highlighting */

    /** Keywords shared by the C-like languages this panel colors. */
    const CODE_KEYWORDS = 'const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|async|await|new|class|extends|implements|interface|type|enum|import|from|export|default|try|catch|finally|throw|typeof|instanceof|in|of|void|null|undefined|true|false|this|super|public|private|protected|readonly|static|as|is|yield|delete|def|elif|lambda|with|pass|raise|except|and|or|not|None|True|False|func|package|struct|map|chan|defer|go|select|fn|impl|pub|use|mut|match|echo|then|fi|done|esac';

    /** Languages whose comments start with `#` rather than `//`. */
    const HASH_COMMENT_LANGS = ['py', 'python', 'sh', 'bash', 'shell', 'zsh', 'yaml', 'yml', 'toml', 'rb', 'ruby', 'makefile', 'dockerfile', 'ini'];

    /** Build the token pattern for one language. */
    function tokenPattern(lang) {
      const hashComment = HASH_COMMENT_LANGS.indexOf(String(lang).toLowerCase()) >= 0;
      const parts = [
        '(?<comment>\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*' + (hashComment ? '|#[^\\n]*' : '') + ')',
        '(?<string>`(?:\\\\.|[^`\\\\])*`|"(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\')',
        '(?<number>\\b\\d+(?:\\.\\d+)?\\b)',
        '(?<keyword>\\b(?:' + CODE_KEYWORDS + ')\\b)',
        '(?<fn>\\b[A-Za-z_$][\\w$]*(?=\\())',
      ];
      return new RegExp(parts.join('|'), 'g');
    }

    /** Highlights kept by source text so a streaming reply does not re-tokenize. */
    const highlightCache = new Map();

    /**
     * Color one code block with theme tokens.
     * @param code - the block body.
     * @param lang - the fence language.
     * @returns React nodes; plain text for unknown or large blocks.
     */
    function highlightCode(code, lang) {
      if (!lang || code.length > 12000) return code;
      const key = lang + '\u0000' + code;
      const cached = highlightCache.get(key);
      if (cached) return cached;
      const pattern = tokenPattern(lang);
      const nodes = [];
      let last = 0;
      let index = 0;
      let match;
      while ((match = pattern.exec(code)) !== null) {
        if (match.index > last) nodes.push(code.slice(last, match.index));
        const groups = match.groups || {};
        const kind = groups.comment ? 'comment'
          : groups.string ? 'string'
            : groups.number ? 'number'
              : groups.keyword ? 'keyword' : 'fn';
        nodes.push(h('span', { key: 'k' + index, className: 'dsc-tok', 'data-kind': kind }, match[0]));
        index += 1;
        last = match.index + match[0].length;
      }
      if (last < code.length) nodes.push(code.slice(last));
      if (highlightCache.size >= 40) highlightCache.clear();
      highlightCache.set(key, nodes);
      return nodes;
    }

    /** One fenced code block with its language label, copy action, and collapse for long bodies. */
    function CodeBlock(props) {
      const { code, lang, t } = props;
      const [copied, setCopied] = useState(false);
      const [expanded, setExpanded] = useState(false);
      const copy = useCallback(() => {
        copyText(code).then((ok) => {
          if (!ok) return;
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        });
      }, [code]);
      const long = code.split('\n').length > 24;
      return h('div', { className: 'dsc-code' },
        h('div', { className: 'dsc-codeHead' },
          h('span', { className: 'dsc-codeLang' }, lang || 'text'),
          h('button', { type: 'button', className: 'dsc-codeCopy', onClick: copy }, copied ? t('copied') : t('copy'))),
        h('div', { className: 'dsc-codeScroll', 'data-clipped': long && !expanded ? 'true' : 'false' },
          h('pre', { className: 'dsc-codeBody' }, h('code', null, highlightCode(code, lang)))),
        long
          ? h('button', {
            type: 'button',
            className: 'dsc-codeToggle',
            'aria-expanded': expanded,
            onClick: () => setExpanded((value) => !value),
          }, expanded ? t('collapse') : t('showAll'))
          : null);
    }

    /** Render markdown source as React nodes. */
    function renderMarkdown(source, t, keyBase, sources) {
      const blocks = parseBlocksCached(source);
      return blocks.map((block, index) => {
        const key = keyBase + '-b' + index;
        if (block.type === 'code') return h(CodeBlock, { key, code: block.text, lang: block.lang, t });
        if (block.type === 'heading') return h('h' + block.level, { key, className: 'dsc-mdHeading' }, renderInline(block.text, key, sources));
        if (block.type === 'hr') return h('hr', { key, className: 'dsc-mdRule' });
        if (block.type === 'quote') {
          return h('blockquote', { key, className: 'dsc-mdQuote' }, renderInline(block.text, key, sources));
        }
        if (block.type === 'table') {
          return h('div', { key, className: 'dsc-tableWrap' },
            h('table', { className: 'dsc-table' },
              h('thead', null, h('tr', null, block.head.map((cell, cellIndex) => h('th', { key: 'h' + cellIndex }, renderInline(cell, key + '-h' + cellIndex, sources))))),
              h('tbody', null, block.rows.map((row, rowIndex) => h('tr', { key: 'r' + rowIndex }, row.map((cell, cellIndex) => h('td', { key: 'c' + cellIndex }, renderInline(cell, key + '-r' + rowIndex + 'c' + cellIndex, sources))))))));
        }
        if (block.type === 'list') {
          const children = block.items.map((item, itemIndex) => h('li', { key: 'l' + itemIndex }, renderInline(item, key + '-l' + itemIndex, sources)));
          return h(block.ordered ? 'ol' : 'ul', {
            key,
            className: 'dsc-mdList',
            start: block.ordered && block.start > 1 ? block.start : undefined,
          }, children);
        }
        return h('p', { key, className: 'dsc-mdPara' }, renderInline(block.text, key, sources));
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

    /** The chat and tool endpoints derived from one base URL. */
    function endpoints(baseUrl) {
      const base = String(baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
      return {
        chat: base + '/chat/completions',
        search: base + '/v1/tools/search',
        ocr: base + '/v1/tools/ocr',
        asr: base + '/v1/tools/asr',
        tts: base + '/v1/tools/tts',
      };
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
      const body = { model: settings.model, messages, stream: true };
      // Thinking mode defaults to on at `high` on the service; only send what the
      // user chose so an older model that rejects the fields keeps working.
      if (settings.thinking === 'off') body.thinking = { type: 'disabled' };
      else if (THINKING_LEVELS.indexOf(settings.thinking) > 0) {
        body.thinking = { type: 'enabled' };
        body.reasoning_effort = settings.thinking;
      }
      const response = await fetch(endpoints(settings.baseUrl).chat, {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          authorization: 'Bearer ' + String(settings.apiKey).trim(),
        },
        body: JSON.stringify(body),
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

    /* ------------------------------------------------------------ tool calls */

    /** Extract a readable error from any failed tool response. */
    async function failedResponse(response, prefix) {
      let body = '';
      try {
        body = await response.text();
      } catch (error) {
        body = '';
      }
      try {
        const parsed = JSON.parse(body.trim());
        if (parsed && parsed.error && parsed.error.message) {
          return new Error((prefix ? prefix + ' · ' : '') + parsed.error.message);
        }
      } catch (error) {
        /* plain text or padded body */
      }
      const trimmed = body.trim();
      return new Error((prefix ? prefix + ' · ' : '') + 'HTTP ' + response.status + (trimmed ? ' · ' + trimmed.slice(0, 200) : ''));
    }

    /**
     * Search the web through `POST /v1/tools/search`.
     * @param options.settings - resolved API settings.
     * @param options.query - the user's question or a rewritten query.
     * @param options.count - how many results to ask for.
     * @param options.signal - abort signal owned by the caller.
     * @returns the result rows, newest and most relevant first.
     */
    async function searchWeb(options) {
      const { settings, query, count, signal } = options;
      const question = String(query).trim();
      if (!question) return [];
      const response = await fetch(endpoints(settings.baseUrl).search, {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + String(settings.apiKey).trim(),
        },
        body: JSON.stringify({
          query: question.length > 128 ? question.slice(0, 128) : question,
          ori_question: question.length > 128 ? question.slice(0, 128) : question,
          count: count || 5,
          need_content: false,
        }),
      });
      if (!response.ok) throw await failedResponse(response, 'search');
      const body = await response.json();
      const results = body && Array.isArray(body.results) ? body.results : [];
      return results
        .filter((item) => item && typeof item.url === 'string')
        .map((item) => ({
          title: typeof item.title === 'string' ? item.title : '',
          url: item.url,
          snippet: typeof item.snippet === 'string' && item.snippet
            ? item.snippet
            : typeof item.summary === 'string' ? item.summary : '',
          site: typeof item.site_name === 'string' ? item.site_name : '',
          date: typeof item.date === 'string' ? item.date : '',
        }));
    }

    /**
     * Turn search rows into the context message that precedes the question.
     * The answer instructions keep citations in the `[n]` form the UI links back.
     */
    function searchContext(question, sources) {
      if (!sources.length) return '';
      const lines = sources.map((source, index) => {
        const head = '[' + (index + 1) + '] ' + (source.title || source.url);
        const parts = [head, 'URL: ' + source.url];
        if (source.site) parts.push('站点: ' + source.site);
        if (source.snippet) parts.push('摘要: ' + source.snippet);
        return parts.join('\n');
      });
      return [
        '以下是针对用户问题「' + question + '」刚刚检索到的网页搜索结果：',
        '',
        lines.join('\n\n'),
        '',
        '回答要求：优先使用上述结果作答；引用某条结果时在句末标注 [序号]，例如 [1]；不要编造结果之外的事实；如果结果不足以回答，请明确说明。',
      ].join('\n');
    }

    /** History plus the search context, without mutating the caller's array. */
    function withSearchContext(history, question, sources) {
      const context = searchContext(question, sources);
      if (!context) return history;
      return [{ role: 'system', content: context }].concat(history);
    }

    /**
     * Recognize text in a document or image through `POST /v1/tools/ocr`.
     * @param options.settings - resolved API settings.
     * @param options.file - the picked `File`.
     * @param options.signal - abort signal owned by the caller.
     * @returns the recognized text, pages joined by a blank line.
     */
    async function ocrFile(options) {
      const { settings, file, signal } = options;
      const form = new FormData();
      form.append('purpose', 'text_recognition');
      form.append('file', file, file.name || 'upload');
      const response = await fetch(endpoints(settings.baseUrl).ocr, {
        method: 'POST',
        signal,
        headers: { authorization: 'Bearer ' + String(settings.apiKey).trim() },
        body: form,
      });
      if (!response.ok) throw await failedResponse(response, 'ocr');
      const raw = await response.text();
      let body;
      try {
        // The service pads the body with newlines while it works.
        body = JSON.parse(raw.trim());
      } catch (error) {
        throw new Error('ocr · ' + raw.slice(0, 200));
      }
      if (body && body.error && body.error.message) throw new Error('ocr · ' + body.error.message);
      const pages = body && Array.isArray(body.pages) ? body.pages : [];
      return pages
        .map((page) => (page && typeof page.text === 'string' ? page.text.trim() : ''))
        .filter(Boolean)
        .join('\n\n');
    }

    /**
     * Transcribe one recording through `POST /v1/tools/asr`.
     * @param options.settings - resolved API settings.
     * @param options.blob - WAV or Ogg Opus audio, at most 120 seconds.
     * @param options.filename - name shown in the multipart form.
     * @param options.signal - abort signal owned by the caller.
     */
    async function transcribeAudio(options) {
      const { settings, blob, filename, signal } = options;
      if (blob.size > 8 * 1024 * 1024) throw new Error('asr · recording is larger than 8 MiB');
      const form = new FormData();
      form.append('file', blob, filename || 'recording.wav');
      const response = await fetch(endpoints(settings.baseUrl).asr, {
        method: 'POST',
        signal,
        headers: { authorization: 'Bearer ' + String(settings.apiKey).trim() },
        body: form,
      });
      if (!response.ok) throw await failedResponse(response, 'asr');
      const body = await response.json();
      if (!body || typeof body.text !== 'string') throw new Error('asr · unexpected response');
      return body.text;
    }

    /**
     * Synthesize speech through `POST /v1/tools/tts`.
     * @param options.settings - resolved API settings.
     * @param options.text - text to read, already trimmed.
     * @param options.signal - abort signal owned by the caller.
     * @returns an audio blob (`audio/wav`) ready for an `Audio` element.
     */
    async function synthesizeSpeech(options) {
      const { settings, text, signal } = options;
      const spoken = String(text).trim().slice(0, TTS_MAX_CHARS);
      if (!spoken) throw new Error('tts · empty text');
      const response = await fetch(endpoints(settings.baseUrl).tts, {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + String(settings.apiKey).trim(),
        },
        body: JSON.stringify({
          text: spoken,
          voice_id: settings.voice,
          format: 'wav',
          filter_markdown: true,
        }),
      });
      if (!response.ok) throw await failedResponse(response, 'tts');
      return response.blob();
    }

    /** Strip the parts of a reply that should not be read aloud. */
    function readableText(markdown) {
      return String(markdown)
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_~>#|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    /** Encode decoded audio as 16 kHz mono 16-bit PCM WAV, the ASR-preferred shape. */
    async function encodeWav(blob) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error('audio is unavailable in this browser');
      const bytes = await blob.arrayBuffer();
      const decoder = new AudioContextClass();
      let decoded;
      try {
        decoded = await decoder.decodeAudioData(bytes.slice(0));
      } finally {
        if (decoder.close) decoder.close();
      }
      const rate = 16000;
      const frames = Math.max(1, Math.ceil(decoded.duration * rate));
      const OfflineClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      let samples;
      if (OfflineClass) {
        const offline = new OfflineClass(1, frames, rate);
        const source = offline.createBufferSource();
        source.buffer = decoded;
        source.connect(offline.destination);
        source.start();
        const rendered = await offline.startRendering();
        samples = rendered.getChannelData(0);
      } else {
        const channel = decoded.getChannelData(0);
        const ratio = decoded.sampleRate / rate;
        samples = new Float32Array(frames);
        for (let i = 0; i < frames; i += 1) samples[i] = channel[Math.min(channel.length - 1, Math.round(i * ratio))] || 0;
      }
      const buffer = new ArrayBuffer(44 + samples.length * 2);
      const view = new DataView(buffer);
      const writeAscii = (offset, text) => {
        for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
      };
      writeAscii(0, 'RIFF');
      view.setUint32(4, 36 + samples.length * 2, true);
      writeAscii(8, 'WAVE');
      writeAscii(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, rate, true);
      view.setUint32(28, rate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeAscii(36, 'data');
      view.setUint32(40, samples.length * 2, true);
      let offset = 44;
      for (let i = 0; i < samples.length; i += 1) {
        const sample = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      }
      return new Blob([view], { type: 'audio/wav' });
    }

    /** Pick a recorder MIME type the browser accepts. */
    function preferredRecordingType() {
      const candidates = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm'];
      if (typeof window.MediaRecorder === 'undefined') return '';
      for (let i = 0; i < candidates.length; i += 1) {
        if (window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
      }
      return '';
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
.dsc-root textarea, .dsc-root input, .dsc-root select { font: inherit; color: inherit; }
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
.dsc-railEmpty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 26px 14px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 1.5;
  text-align: center;
}
.dsc-railEmptyMark { display: flex; opacity: 0.45; margin-bottom: 2px; }
.dsc-railEmptyHint { font-size: 11.5px; opacity: 0.85; }
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

.dsc-scroll { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: thin; }
.dsc-scroll::-webkit-scrollbar, .dsc-railList::-webkit-scrollbar, .dsc-codeBody::-webkit-scrollbar, .dsc-tableWrap::-webkit-scrollbar { width: 10px; height: 10px; }
.dsc-scroll::-webkit-scrollbar-thumb, .dsc-railList::-webkit-scrollbar-thumb,
.dsc-codeBody::-webkit-scrollbar-thumb, .dsc-tableWrap::-webkit-scrollbar-thumb {
  border: 3px solid transparent;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dsw-alias-label-secondary) 30%, transparent);
  background-clip: content-box;
}
.dsc-scroll::-webkit-scrollbar-thumb:hover, .dsc-railList::-webkit-scrollbar-thumb:hover,
.dsc-codeBody::-webkit-scrollbar-thumb:hover, .dsc-tableWrap::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--dsw-alias-label-secondary) 48%, transparent);
  background-clip: content-box;
}
.dsc-scroll::-webkit-scrollbar-track, .dsc-railList::-webkit-scrollbar-track,
.dsc-codeBody::-webkit-scrollbar-track, .dsc-tableWrap::-webkit-scrollbar-track { background: transparent; }
.dsc-thread { width: 100%; max-width: 720px; margin: 0 auto; padding: 22px 24px 8px; }
.dsc-welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  max-width: 720px;
  margin: auto;
  padding: 32px 24px;
  text-align: center;
}
.dsc-welcomeMark { position: relative; display: inline-flex; width: 56px; height: 56px; margin-bottom: 20px; }
.dsc-welcomeMark::before {
  content: '';
  position: absolute;
  inset: -22px;
  border-radius: 50%;
  background: radial-gradient(circle, color-mix(in srgb, var(--dsw-alias-brand-primary) 15%, transparent), transparent 70%);
  pointer-events: none;
}
.dsc-welcomeTitle { margin: 0 0 8px; font-size: 24px; font-weight: 600; letter-spacing: -0.015em; }
.dsc-welcomeHint { margin: 0 0 26px; color: var(--dsw-alias-label-secondary); font-size: 12.5px; }
.dsc-suggests { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
.dsc-suggest {
  max-width: 100%;
  padding: 10px 16px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 12.5px;
  cursor: pointer;
  text-align: left;
  transition: border-color 120ms ease, color 120ms ease, background 120ms ease, transform 120ms ease;
}
.dsc-suggest:hover {
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, var(--dsw-alias-border-l1));
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1);
  transform: translateY(-1px);
}

.dsc-turn { margin-bottom: 28px; }
.dsc-userRow { display: flex; justify-content: flex-end; margin-bottom: 20px; }
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
.dsc-botName { font-size: 12.5px; font-weight: 600; color: var(--dsw-alias-label-primary); }
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

.dsc-chev { transition: transform 140ms ease; }
.dsc-chevOpen { transform: rotate(90deg); }
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

.dsc-composerWrap { position: relative; padding: 8px 24px 18px; }
.dsc-jump {
  position: absolute;
  left: 50%;
  bottom: calc(100% - 4px);
  z-index: 4;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 999px;
  background: var(--dsw-alias-bg-overlay);
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
  cursor: pointer;
  transform: translateX(-50%);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
  transition: color 120ms ease, transform 120ms ease;
}
.dsc-jump:hover { color: var(--dsw-alias-label-primary); transform: translateX(-50%) translateY(-1px); }
.dsc-composer {
  max-width: 720px;
  margin: 0 auto;
  padding: 12px 12px 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 18px;
  background: var(--dsw-alias-bg-layer-1);
  transition: border-color 140ms ease, box-shadow 140ms ease;
}
.dsc-composer:focus-within {
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, var(--dsw-alias-border-l2));
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.10);
}
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
.dsc-input:focus-visible { outline: none; }
.dsc-composerBar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
  padding: 7px 2px 0;
  border-top: 1px solid var(--dsw-alias-border-l1);
}
.dsc-composerHint {
  flex: 1;
  min-width: 0;
  margin-left: auto;
  overflow: hidden;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.85;
}
.dsc-send {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex: none;
  border: 0;
  border-radius: 50%;
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-bg-base);
  cursor: pointer;
  transition: transform 120ms ease, opacity 120ms ease;
}
.dsc-send:hover:not(:disabled) { transform: scale(1.06); }
.dsc-send:active:not(:disabled) { transform: scale(0.97); }
.dsc-send:disabled { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-state-idle-primary); cursor: default; }
.dsc-send[data-stop='true'] { background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-base); }

.dsc-tools { display: flex; align-items: center; gap: 4px; flex: none; }
.dsc-toolWrap { position: relative; }
.dsc-tool {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 9px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}
.dsc-tool:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsc-tool:disabled { opacity: 0.45; cursor: default; }
.dsc-tool[data-active='true'] {
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, transparent);
  color: var(--dsw-alias-label-primary);
}
.dsc-tool[data-open='true'] { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsc-tool[data-dim='true'] { opacity: 0.62; }
.dsc-tool[data-recording='true'] {
  border-color: var(--dsw-alias-state-error-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);
  color: var(--dsw-alias-state-error-primary);
}
.dsc-toolLabel { font-variant-numeric: tabular-nums; }
.dsc-recDot {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 50%;
  background: var(--dsw-alias-state-error-primary);
  animation: dsc-pulse 1.1s ease-in-out infinite;
}
.dsc-popover {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  z-index: 5;
  min-width: 128px;
  padding: 4px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-overlay);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.18);
}
.dsc-menuItem {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 9px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}
.dsc-menuItem:hover { background: var(--dsw-alias-bg-layer-2); }
.dsc-menuItem[data-selected='true'] { color: var(--dsw-alias-brand-primary); font-weight: 500; }
.dsc-menuItem .dsc-check { width: 11px; flex: none; }
.dsc-stage { display: flex; align-items: center; gap: 8px; color: var(--dsw-alias-label-secondary); font-size: 12.5px; }
.dsc-stage .dsc-caret { animation: none; }

.dsc-sources { margin-top: 10px; }
.dsc-sourcesHead {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px 3px 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  cursor: pointer;
}
.dsc-sourcesHead:hover { color: var(--dsw-alias-label-primary); }
.dsc-sourceList { margin: 8px 0 0; padding: 0; list-style: none; }
.dsc-source {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 6px 0 6px 12px;
  border-left: 2px solid var(--dsw-alias-border-l1);
  margin-bottom: 6px;
}
.dsc-sourceTitle { color: var(--dsw-alias-label-primary); font-size: 12.5px; text-decoration: none; }
.dsc-sourceTitle:hover { color: var(--dsw-alias-brand-primary); text-decoration: underline; }
.dsc-sourceSite { color: var(--dsw-alias-label-secondary); font-size: 11px; }
.dsc-sourceSnippet {
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.dsc-cite { font-size: 0.66em; line-height: 0; vertical-align: super; }
.dsc-cite a {
  display: inline-block;
  margin-left: 2px;
  padding: 0.16em 0.34em;
  border-radius: 3px;
  background: color-mix(in srgb, var(--dsw-alias-label-secondary) 18%, transparent);
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
  text-decoration: none;
  transition: background 120ms ease, color 120ms ease;
}
.dsc-cite a:hover {
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-bg-base);
}
.dsc-notice {
  max-width: 720px;
  margin: 0 auto 8px;
  color: var(--dsw-alias-state-warn-primary);
  font-size: 12px;
  text-align: center;
}
.dsc-noticeRow { display: flex; align-items: center; justify-content: center; gap: 6px; flex-wrap: wrap; }

.dsc-mdPara { margin: 0 0 10px; }
.dsc-mdHeading { margin: 18px 0 8px; line-height: 1.35; font-weight: 600; }
h1.dsc-mdHeading { font-size: 19px; }
h2.dsc-mdHeading { font-size: 17px; }
h3.dsc-mdHeading { font-size: 15px; }
.dsc-mdList { margin: 0 0 12px; padding-left: 24px; }
.dsc-mdList li { margin-bottom: 6px; }
.dsc-mdQuote {
  margin: 0 0 10px;
  padding: 2px 0 2px 12px;
  border-left: 2px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
}
.dsc-mdRule { margin: 14px 0; border: 0; border-top: 1px solid var(--dsw-alias-border-l1); }
.dsc-mdImage { display: block; max-width: 100%; height: auto; margin: 6px 0 12px; border-radius: 10px; border: 1px solid var(--dsw-alias-border-l1); }
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
.dsc-codeScroll { position: relative; }
.dsc-codeScroll[data-clipped='true'] { max-height: 320px; overflow: hidden; }
.dsc-codeScroll[data-clipped='true']::after {
  content: '';
  position: absolute;
  inset: auto 0 0;
  height: 68px;
  background: linear-gradient(to bottom, transparent, var(--dsw-alias-bg-layer-1));
  pointer-events: none;
}
.dsc-codeToggle {
  display: block;
  width: 100%;
  padding: 6px 10px;
  border: 0;
  border-top: 1px solid var(--dsw-alias-border-l1);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
  cursor: pointer;
}
.dsc-codeToggle:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsc-tok[data-kind='comment'] { color: var(--dsw-alias-label-secondary); font-style: italic; }
.dsc-tok[data-kind='string'] { color: var(--dsw-alias-state-success-primary); }
.dsc-tok[data-kind='number'] { color: var(--dsw-alias-state-warn-primary); }
.dsc-tok[data-kind='keyword'] { color: var(--dsw-alias-brand-primary); font-weight: 600; }
.dsc-tok[data-kind='fn'] { color: var(--dsw-alias-label-primary); }
.dsc-tableWrap { margin: 0 0 14px; overflow-x: auto; }
.dsc-table { width: 100%; border-collapse: collapse; font-size: 0.94em; }
.dsc-table th, .dsc-table td { padding: 8px 12px; border: 0; border-bottom: 1px solid var(--dsw-alias-border-l1); text-align: left; vertical-align: top; }
.dsc-table th { border-bottom-color: var(--dsw-alias-border-l2); font-weight: 600; }
.dsc-table tbody tr:last-child td { border-bottom: 0; }

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
  width: min(480px, 100%);
  max-height: 100%;
  overflow-y: auto;
  padding: 22px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 16px;
  background: var(--dsw-alias-bg-overlay);
  box-shadow: 0 22px 56px rgba(0, 0, 0, 0.26);
}
.dsc-dialogHead { display: flex; align-items: center; gap: 8px; }
.dsc-dialogTitle { flex: 1; margin: 0; font-size: 16px; font-weight: 600; }
.dsc-sectionTitle {
  margin: 18px 0 10px;
  padding-top: 14px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
}
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
.dsc-root select.dsc-inputText { height: 36px; appearance: auto; }
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
  color: var(--dsw-alias-bg-base);
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
  .dsc-composerHint { display: none; }
  .dsc-tool { padding: 0 6px; }
  .dsc-toolLabel { display: none; }
  .dsc-tool[data-active='true'] .dsc-toolLabel { display: inline; }
}
@media (max-height: 560px) {
  .dsc-welcome { justify-content: flex-start; padding: 18px 20px; }
  .dsc-welcomeMark { width: 40px; height: 40px; margin-bottom: 10px; }
  .dsc-welcomeTitle { margin-bottom: 4px; font-size: 19px; }
  .dsc-welcomeHint { margin-bottom: 12px; }
  .dsc-suggest { padding: 7px 12px; font-size: 12px; }
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

    /** The brand mark used inside the page: a fixed blue identity that reads in both themes. */
    function BrandMark(props) {
      const size = props.size || 22;
      return h('svg', { viewBox: '0 0 64 64', width: size, height: size, 'aria-hidden': true, focusable: false },
        h('defs', null,
          h('linearGradient', { id: 'dscBrandMark', x1: '0', y1: '0', x2: '1', y2: '1' },
            h('stop', { offset: '0', stopColor: '#6E8CFF' }),
            h('stop', { offset: '1', stopColor: '#3B54DE' }))),
        h('rect', { x: 2, y: 2, width: 60, height: 60, rx: 17, fill: 'url(#dscBrandMark)' }),
        h('path', {
          d: 'M20 20.5h24a5.5 5.5 0 0 1 5.5 5.5v13.2a5.5 5.5 0 0 1-5.5 5.5H31.4L22.9 51.2a1 1 0 0 1-1.63-.78v-5.72H20a5.5 5.5 0 0 1-5.5-5.5V26A5.5 5.5 0 0 1 20 20.5Z',
          fill: '#FFFFFF', fillOpacity: 0.97,
        }),
        h('g', { fill: '#3A56E0' },
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
        h('path', { d: 'M3 6.5h14M3 13.5h14' }),
        h('circle', { cx: 7.5, cy: 6.5, r: 2.1, fill: 'var(--dsw-alias-bg-base)' }),
        h('circle', { cx: 13, cy: 13.5, r: 2.1, fill: 'var(--dsw-alias-bg-base)' }));
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

    function GlobeIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('circle', { cx: 8, cy: 8, r: 5.8 }),
        h('path', { d: 'M2.4 8h11.2M8 2.2c1.5 1.6 2.3 3.6 2.3 5.8S9.5 12.2 8 13.8c-1.5-1.6-2.3-3.6-2.3-5.8S6.5 3.8 8 2.2z' }));
    }

    function BrainIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M8 3.2v9.6M5.6 3.9a2.1 2.1 0 0 0-2 2.6A2 2 0 0 0 4 10a2.1 2.1 0 0 0 3.4 2.2M10.4 3.9a2.1 2.1 0 0 1 2 2.6A2 2 0 0 1 12 10a2.1 2.1 0 0 1-3.4 2.2' }));
    }

    function MicIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('rect', { x: 6, y: 2.2, width: 4, height: 7, rx: 2 }),
        h('path', { d: 'M3.6 7.6a4.4 4.4 0 0 0 8.8 0M8 12v1.8' }));
    }

    function FileIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M9.2 2.2H4.6a1.4 1.4 0 0 0-1.4 1.4v8.8a1.4 1.4 0 0 0 1.4 1.4h6.8a1.4 1.4 0 0 0 1.4-1.4V5.8z' }),
        h('path', { d: 'M9.2 2.2v3.6h3.6M5.8 9.2h4.4M5.8 11.4h3' }));
    }

    function VolumeIcon(props) {
      const off = props.off === true;
      return h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M3 6.2h2.2L8.4 3.6v8.8L5.2 9.8H3z' }),
        off
          ? h('path', { d: 'M11 6.4l3.2 3.2M14.2 6.4 11 9.6' })
          : h('path', { d: 'M10.6 6a2.8 2.8 0 0 1 0 4M12.4 4.4a5 5 0 0 1 0 7.2' }));
    }

    function CheckIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 11, height: 11, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M3 8.4l3.2 3.2L13 4.8' }));
    }

    /** Disclosure chevron; rotates when its section is open. */
    function ChevronIcon(props) {
      return h('svg', {
        viewBox: '0 0 12 12',
        width: 9,
        height: 9,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        className: props.open ? 'dsc-chev dsc-chevOpen' : 'dsc-chev',
      }, h('path', { d: 'M4.2 2.2 8 6l-3.8 3.8' }));
    }

    function CloseIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', 'aria-hidden': true },
        h('path', { d: 'M4 4l8 8M12 4l-8 8' }));
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
          h(ChevronIcon, { open })),
        open ? h('div', { className: 'dsc-reasoningBody' }, text) : null);
    }

    /** Keep one search snippet short enough to read at a glance. */
    function clipSnippet(text) {
      const flat = String(text).replace(/\s+/g, ' ').trim();
      return flat.length > 150 ? flat.slice(0, 150) + '…' : flat;
    }

    /** Search results attached to one answer; collapsed while the answer is still streaming. */
    function Sources(props) {
      const { sources, t, streaming } = props;
      const [manual, setManual] = useState(null);
      if (!sources || !sources.length) return null;
      const followDefault = !streaming && sources.length <= 4;
      const open = manual === null ? followDefault : manual;
      return h('div', { className: 'dsc-sources' },
        h('button', {
          type: 'button',
          className: 'dsc-sourcesHead',
          'aria-expanded': open,
          onClick: () => setManual(!open),
        },
          h(GlobeIcon),
          h('span', null, t('sources') + ' · ' + sources.length),
          h(ChevronIcon, { open })),
        open
          ? h('ol', { className: 'dsc-sourceList' }, sources.map((source, index) => h('li', { key: index, className: 'dsc-source' },
            h('a', {
              className: 'dsc-sourceTitle',
              href: source.url,
              target: '_blank',
              rel: 'noreferrer noopener',
            }, (index + 1) + '. ' + (source.title || source.url)),
            source.site ? h('span', { className: 'dsc-sourceSite' }, source.site) : null,
            source.snippet
              ? h('span', { className: 'dsc-sourceSnippet' }, renderInline(clipSnippet(source.snippet), 'src' + index))
              : null)))
          : null);
    }

    /** One assistant message: search stage, reasoning, body, sources, and actions. */
    function AssistantMessage(props) {
      const { message, streaming, onRegenerate, canRegenerate, onSpeak, speaking, speakPending, t } = props;
      const [copied, setCopied] = useState(false);
      const copy = useCallback(() => {
        copyText(message.content).then((ok) => {
          if (!ok) return;
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        });
      }, [message.content]);
      const hasBody = Boolean(message.content);
      const searching = message.stage === 'searching';
      const sources = message.sources || [];
      return h('div', { className: 'dsc-botRow' },
        h('div', { className: 'dsc-botHead' },
          h('span', { className: 'dsc-botMark' }, h(BrandMark, { size: 16 })),
          h('span', { className: 'dsc-botName' }, t('assistantName')),
          streaming && !searching ? h('span', { className: 'dsc-liveDot' }) : null,
          hasBody && !streaming
            ? h('span', { className: 'dsc-botActions' },
              h('button', {
                type: 'button',
                className: 'dsc-plainAction',
                disabled: speakPending,
                title: speaking ? t('stopReading') : t('speak'),
                onClick: onSpeak,
              }, speaking ? t('stopReading') : speakPending ? '…' : t('speak')),
              h('button', { type: 'button', className: 'dsc-plainAction', onClick: copy }, copied ? t('copied') : t('copy')),
              canRegenerate ? h('button', { type: 'button', className: 'dsc-plainAction', onClick: onRegenerate }, t('regenerate')) : null)
            : null),
        h(Reasoning, { text: message.reasoning, live: streaming && !hasBody, t }),
        searching
          ? h('div', { className: 'dsc-stage' }, h('span', { className: 'dsc-liveDot' }), h('span', null, t('searching')))
          : hasBody
            ? h('div', { className: 'dsc-botBody' }, renderMarkdown(message.content, t, message.id, sources), streaming ? h('span', { className: 'dsc-caret' }) : null)
            : streaming ? h('div', { className: 'dsc-botBody' }, h('span', { className: 'dsc-caret' })) : null,
        h(Sources, { sources, t, streaming }),
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
      const [voice, setVoice] = useState(settings.voice);
      const [confirming, setConfirming] = useState(false);
      const keyRef = useRef(null);
      useEffect(() => {
        const node = keyRef.current;
        if (node) node.focus();
      }, []);
      const submit = () => {
        onSave(Object.assign({}, settings, {
          apiKey: apiKey.trim(),
          baseUrl: baseUrl.trim() || DEFAULT_BASE_URL,
          model: model.trim() || DEFAULT_MODEL,
          voice,
        }));
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
          h('div', { className: 'dsc-dialogHead' },
            h('h2', { className: 'dsc-dialogTitle' }, t('settings')),
            h('button', {
              type: 'button',
              className: 'dsc-iconButton',
              title: t('cancel'),
              'aria-label': t('cancel'),
              onClick: onClose,
            }, h(CloseIcon))),
          h('p', { className: 'dsc-dialogHint' }, t('settingsHint')),
          h('div', { className: 'dsc-sectionTitle' }, t('settingsConnection')),
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
              h('option', { value: 'deepseek-flash' }),
              h('option', { value: 'deepseek-v4-pro' })),
            h('div', { className: 'dsc-fieldHint' }, t('modelHint'))),
          h('div', { className: 'dsc-sectionTitle' }, t('settingsSpeech')),
          h('div', { className: 'dsc-field' },
            h('label', { className: 'dsc-label', htmlFor: 'dsc-voice' }, t('voice')),
            h('select', {
              id: 'dsc-voice',
              className: 'dsc-inputText',
              value: voice,
              onChange: (event) => setVoice(event.target.value),
            },
              h('option', { value: 'stella' }, t('voiceStella')),
              h('option', { value: 'tide' }, t('voiceTide'))),
            h('div', { className: 'dsc-fieldHint' }, t('speechHint'))),
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
      const [atBottom, setAtBottom] = useState(true);
      const [notice, setNotice] = useState('');
      const [savedNotice, setSavedNotice] = useState('');
      const [thinkMenuOpen, setThinkMenuOpen] = useState(false);
      const [recState, setRecState] = useState('idle');
      const [recSeconds, setRecSeconds] = useState(0);
      const [ocrBusy, setOcrBusy] = useState(false);      const [ttsId, setTtsId] = useState(null);
      const [ttsPendingId, setTtsPendingId] = useState(null);
      const inputRef = useRef(null);
      const scrollRef = useRef(null);
      const stickRef = useRef(true);
      const abortRef = useRef(null);
      const saveTimerRef = useRef(null);
      const recRef = useRef(null);
      const ttsRef = useRef(null);
      const fileRef = useRef(null);
      const thinkWrapRef = useRef(null);
      const narrow = useMediaQuery('(max-width: 760px)');

      const active = useMemo(
        () => conversations.find((item) => item.id === activeId) || null,
        [conversations, activeId],
      );
      const busy = streamingId !== null;

      /* Persist conversations, coalescing bursts while a reply streams. An untouched
         "new chat" stays in memory only, so it never becomes an empty row on reload. */
      useEffect(() => {
        if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = window.setTimeout(() => {
          saveTimerRef.current = null;
          writeJson(CONVERSATIONS_KEY, conversations.filter((item) => item.messages.length > 0));
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

      /* Abort an in-flight reply, stop audio, and flush the last state on unmount. */
      useEffect(() => () => {
        if (abortRef.current) abortRef.current.abort();
        const session = recRef.current;
        if (session) {
          if (session.timer !== null) window.clearInterval(session.timer);
          try {
            session.stream.getTracks().forEach((track) => track.stop());
          } catch (error) {
            /* already released */
          }
          recRef.current = null;
        }
        const audio = ttsRef.current;
        if (audio) {
          try {
            audio.audio.pause();
          } catch (error) {
            /* already stopped */
          }
          if (audio.url) URL.revokeObjectURL(audio.url);
          ttsRef.current = null;
        }
        writeJson(CONVERSATIONS_KEY, latestConversations.current.filter((item) => item.messages.length > 0));
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
        const near = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
        stickRef.current = near;
        setAtBottom((previous) => (previous === near ? previous : near));
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

      /**
       * Stream one reply, optionally running a web search first.
       * @param conversationId - conversation owning the reply.
       * @param messageId - placeholder message that receives the content.
       * @param history - `{ role, content }` rows already sent for this turn.
       * @param searchQuery - when set, search this text and answer against the results.
       */
      const runReply = useCallback(async (conversationId, messageId, history, searchQuery) => {
        const controller = new AbortController();
        abortRef.current = controller;
        setStreamingId(messageId);
        stickRef.current = true;
        let content = '';
        let reasoning = '';
        let messages = history;
        try {
          if (searchQuery) {
            patchMessage(conversationId, messageId, (message) => Object.assign({}, message, { stage: 'searching' }));
            try {
              const found = await searchWeb({ settings, query: searchQuery, count: 5, signal: controller.signal });
              const sources = found.slice(0, 5).map((item) => ({
                title: item.title, url: item.url, snippet: item.snippet, site: item.site,
              }));
              patchMessage(conversationId, messageId, (message) => Object.assign({}, message, { stage: '', sources }));
              messages = withSearchContext(history, searchQuery, found.slice(0, 5));
            } catch (error) {
              if (error && error.name === 'AbortError') throw error;
              patchMessage(conversationId, messageId, (message) => Object.assign({}, message, { stage: '' }));
              setNotice(t('searchFailed') + ': ' + (error && error.message ? error.message : String(error)));
            }
          }
          patchMessage(conversationId, messageId, (message) => Object.assign({}, message, { stage: 'streaming' }));
          await streamReply({
            settings,
            messages,
            signal: controller.signal,
            onDelta: (delta) => {
              if (delta.content) content += delta.content;
              if (delta.reasoning) reasoning += delta.reasoning;
              patchMessage(conversationId, messageId, (message) => Object.assign({}, message, { content, reasoning }));
            },
          });
          patchMessage(conversationId, messageId, (message) => Object.assign({}, message, { content, reasoning, stage: '' }));
        } catch (error) {
          if (error && error.name === 'AbortError') {
            patchMessage(conversationId, messageId, (message) => Object.assign({}, message, { content, reasoning, stage: '', stopped: true }));
          } else {
            patchMessage(conversationId, messageId, (message) => Object.assign({}, message, {
              content,
              reasoning,
              stage: '',
              error: (error && error.message ? error.message : String(error)),
            }));
          }
        } finally {
          abortRef.current = null;
          setStreamingId(null);
        }
      }, [patchMessage, settings, t]);

      const findConversation = useCallback((id) => conversations.find((item) => item.id === id) || null, [conversations]);

      const send = useCallback((textInput) => {
        const text = String(textInput === undefined ? draft : textInput).trim();
        if (!text || busy) return;
        if (!String(settings.apiKey).trim()) {
          setNotice(t('missingKey'));
          setSettingsOpen(true);
          return;
        }
        const userMessage = { id: uid(), role: 'user', content: text, reasoning: '', error: '', stopped: false, sources: [] };
        const botMessage = { id: uid(), role: 'assistant', content: '', reasoning: '', error: '', stopped: false, sources: [], stage: '' };
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
        runReply(conversationId, botMessage.id, history, settings.webSearch ? text : '');
        window.setTimeout(() => {
          const node = inputRef.current;
          if (node) node.focus();
        }, 0);
      }, [activeId, busy, draft, findConversation, runReply, settings.apiKey, settings.webSearch, t, updateConversation]);

      const stop = useCallback(() => {
        if (abortRef.current) abortRef.current.abort();
      }, []);

      /* Merge one settings change and persist it; the panel reads the result. */
      const patchSettings = useCallback((patch) => {
        setSettings((previous) => {
          const next = Object.assign({}, previous, patch);
          writeJson(SETTINGS_KEY, next);
          return next;
        });
      }, []);

      const toggleWebSearch = useCallback(() => {
        patchSettings({ webSearch: !settings.webSearch });
      }, [patchSettings, settings.webSearch]);

      const chooseThinking = useCallback((level) => {
        patchSettings({ thinking: level });
        setThinkMenuOpen(false);
      }, [patchSettings]);

      /* Close the thinking menu on an outside pointer press or Escape. */
      useEffect(() => {
        if (!thinkMenuOpen) return undefined;
        const onPointerDown = (event) => {
          const wrap = thinkWrapRef.current;
          if (wrap && wrap.contains(event.target)) return;
          setThinkMenuOpen(false);
        };
        const onKey = (event) => {
          if (event.key === 'Escape') setThinkMenuOpen(false);
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKey);
        return () => {
          document.removeEventListener('mousedown', onPointerDown);
          document.removeEventListener('keydown', onKey);
        };
      }, [thinkMenuOpen]);

      /** Add recognized or dictated text to the draft without losing what is typed. */
      const appendToDraft = useCallback((text) => {
        const value = String(text || '').trim();
        if (!value) return;
        setDraft((previous) => (previous.trim() ? previous.replace(/\s+$/, '') + ' ' + value : value));
        window.setTimeout(() => {
          const node = inputRef.current;
          if (node) node.focus();
        }, 0);
      }, []);

      /** Send one recording to ASR and put the transcript in the draft. */
      const transcribe = useCallback(async (blob) => {
        setRecState('transcribing');
        try {
          const type = String(blob.type || '').toLowerCase();
          let audio = blob;
          let filename = 'recording.ogg';
          if (type.indexOf('ogg') < 0) {
            audio = await encodeWav(blob);
            filename = 'recording.wav';
          }
          const text = await transcribeAudio({ settings, blob: audio, filename });
          if (text && text.trim()) appendToDraft(text);
        } catch (error) {
          setNotice((error && error.message) || t('transcribing'));
        } finally {
          setRecState('idle');
        }
      }, [appendToDraft, settings, t]);

      const stopRecorder = useCallback(() => {
        const session = recRef.current;
        if (!session) return;
        if (session.timer !== null) window.clearInterval(session.timer);
        session.timer = null;
        if (session.recorder && session.recorder.state !== 'inactive') {
          session.recorder.stop();
        }
      }, []);

      /** Start or stop one voice-input recording. */
      const toggleRecording = useCallback(async () => {
        if (recState !== 'idle') {
          stopRecorder();
          return;
        }
        if (!String(settings.apiKey).trim()) {
          setNotice(t('missingKey'));
          setSettingsOpen(true);
          return;
        }
        const media = window.navigator && window.navigator.mediaDevices;
        if (!media || !media.getUserMedia || typeof window.MediaRecorder === 'undefined') {
          setNotice(t('recordFailed'));
          return;
        }
        let stream;
        try {
          stream = await media.getUserMedia({ audio: true });
        } catch (error) {
          setNotice(error && error.name === 'NotAllowedError' ? t('recordDenied') : t('recordFailed'));
          return;
        }
        const mimeType = preferredRecordingType();
        let recorder;
        try {
          recorder = new window.MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        } catch (error) {
          stream.getTracks().forEach((track) => track.stop());
          setNotice(t('recordFailed'));
          return;
        }
        const chunks = [];
        const session = { recorder, chunks, stream, timer: null, mimeType: mimeType || recorder.mimeType || '' };
        recRef.current = session;
        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size) chunks.push(event.data);
        };
        recorder.onstop = () => {
          const current = recRef.current;
          recRef.current = null;
          if (current && current.timer !== null) window.clearInterval(current.timer);
          if (current) {
            current.stream.getTracks().forEach((track) => {
              try {
                track.stop();
              } catch (error) {
                /* already released */
              }
            });
          }
          setRecSeconds(0);
          const type = session.mimeType ? session.mimeType.split(';')[0] : 'audio/ogg';
          const blob = new Blob(chunks, { type });
          if (!blob.size) {
            setRecState('idle');
            setNotice(t('recordFailed'));
            return;
          }
          transcribe(blob);
        };
        try {
          recorder.start();
        } catch (error) {
          stream.getTracks().forEach((track) => track.stop());
          recRef.current = null;
          setNotice(t('recordFailed'));
          return;
        }
        setRecState('recording');
        setRecSeconds(0);
        const startedAt = Date.now();
        session.timer = window.setInterval(() => {
          const seconds = Math.floor((Date.now() - startedAt) / 1000);
          setRecSeconds(seconds);
          if (seconds >= RECORDING_LIMIT_SECONDS) {
            setNotice(t('recordTooLong'));
            stopRecorder();
          }
        }, 500);
      }, [recState, settings.apiKey, stopRecorder, t, transcribe]);

      /** Recognize one picked or pasted file and drop the text into the draft. */
      const runOcr = useCallback(async (file) => {
        if (!file) return;
        if (ocrBusy) return;
        if (!String(settings.apiKey).trim()) {
          setNotice(t('missingKey'));
          setSettingsOpen(true);
          return;
        }
        setOcrBusy(true);
        setNotice(t('ocrWorking'));
        try {
          const text = await ocrFile({ settings, file });
          if (text && text.trim()) {
            appendToDraft(text);
            setNotice(t('ocrDone'));
          } else {
            setNotice(t('ocrEmpty'));
          }
        } catch (error) {
          setNotice((error && error.message) || t('ocrFailed'));
        } finally {
          setOcrBusy(false);
          if (fileRef.current) fileRef.current.value = '';
        }
      }, [appendToDraft, ocrBusy, settings, t]);

      const onComposerPaste = useCallback((event) => {
        const items = event.clipboardData && event.clipboardData.items;
        if (!items) return;
        for (let i = 0; i < items.length; i += 1) {
          const item = items[i];
          if (item.kind === 'file' && /^image\//.test(item.type)) {
            const file = item.getAsFile();
            if (file) {
              event.preventDefault();
              runOcr(file);
            }
            return;
          }
        }
      }, [runOcr]);

      const stopSpeaking = useCallback(() => {
        const current = ttsRef.current;
        ttsRef.current = null;
        if (current) {
          try {
            current.audio.pause();
          } catch (error) {
            /* already stopped */
          }
          if (current.url) URL.revokeObjectURL(current.url);
        }
        setTtsId(null);
      }, []);

      /** Read one answer aloud, or stop the one already playing. */
      const toggleSpeak = useCallback(async (message) => {
        if (!message || ttsPendingId) return;
        if (ttsId === message.id) {
          stopSpeaking();
          return;
        }
        if (!String(settings.apiKey).trim()) {
          setNotice(t('missingKey'));
          setSettingsOpen(true);
          return;
        }
        const text = readableText(message.content);
        if (!text) return;
        stopSpeaking();
        setTtsPendingId(message.id);
        try {
          const blob = await synthesizeSpeech({ settings, text });
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          ttsRef.current = { audio, url };
          audio.onended = () => stopSpeaking();
          audio.onerror = () => {
            stopSpeaking();
            setNotice(t('speakFailed'));
          };
          setTtsId(message.id);
          await audio.play();
        } catch (error) {
          stopSpeaking();
          setNotice(t('speakFailed') + (error && error.message ? ': ' + error.message : ''));
        } finally {
          setTtsPendingId(null);
        }
      }, [settings, stopSpeaking, t, ttsId, ttsPendingId]);

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
          content: '', reasoning: '', error: '', stopped: false, stage: '', sources: [],
        }));
        runReply(conversation.id, last.id, history, '');
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
            ? h('div', { className: 'dsc-railEmpty' },
              h('span', { className: 'dsc-railEmptyMark' }, h(PanelIcon, { size: 20 })),
              h('span', null, t('railEmpty')),
              h('span', { className: 'dsc-railEmptyHint' }, t('railEmptyHint')))
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
              onSpeak: () => toggleSpeak(message),
              speaking: ttsId === message.id,
              speakPending: ttsPendingId === message.id,
              t,
            }));
        }));

      const thinkingLabel = t(
        settings.thinking === 'off' ? 'thinkOff'
          : settings.thinking === 'low' ? 'thinkLow'
            : settings.thinking === 'max' ? 'thinkMax' : 'thinkHigh',
      );
      const thinkingMenu = thinkMenuOpen
        ? h('div', { className: 'dsc-popover', role: 'menu', 'aria-label': t('thinking') },
          THINKING_LEVELS.map((level) => {
            const label = t(level === 'off' ? 'thinkOff' : level === 'low' ? 'thinkLow' : level === 'max' ? 'thinkMax' : 'thinkHigh');
            return h('button', {
              key: level,
              type: 'button',
              role: 'menuitemradio',
              className: 'dsc-menuItem',
              'data-selected': settings.thinking === level ? 'true' : 'false',
              'aria-checked': settings.thinking === level ? 'true' : 'false',
              onClick: () => chooseThinking(level),
            },
              h('span', { className: 'dsc-check' }, settings.thinking === level ? h(CheckIcon) : null),
              h('span', null, label));
          }))
        : null;

      const recordingLabel = recState === 'recording'
        ? recSeconds + 's'
        : recState === 'transcribing' ? t('transcribing') : '';

      const composer = h('div', { className: 'dsc-composer' },
        h('textarea', {
          ref: inputRef,
          className: 'dsc-input',
          rows: 1,
          value: draft,
          placeholder: t('placeholder'),
          'aria-label': t('placeholder'),
          onChange: (event) => setDraft(event.target.value),
          onKeyDown,
          onPaste: onComposerPaste,
        }),
        h('div', { className: 'dsc-composerBar' },
          h('div', { className: 'dsc-tools' },
            h('button', {
              type: 'button',
              className: 'dsc-tool',
              'data-active': settings.webSearch ? 'true' : 'false',
              'aria-pressed': settings.webSearch ? 'true' : 'false',
              title: t('webSearch'),
              onClick: toggleWebSearch,
            }, h(GlobeIcon), h('span', { className: 'dsc-toolLabel' }, t('webSearch'))),
            h('div', { className: 'dsc-toolWrap', ref: thinkWrapRef },
              h('button', {
                type: 'button',
                className: 'dsc-tool',
                'data-open': thinkMenuOpen ? 'true' : 'false',
                'data-dim': settings.thinking === 'off' ? 'true' : 'false',
                'aria-haspopup': 'menu',
                'aria-expanded': thinkMenuOpen ? 'true' : 'false',
                title: t('thinking'),
                onClick: () => setThinkMenuOpen((value) => !value),
              }, h(BrainIcon), h('span', { className: 'dsc-toolLabel' }, t('thinking') + ' · ' + thinkingLabel)),
              thinkingMenu),
            h('button', {
              type: 'button',
              className: 'dsc-tool',
              'data-recording': recState === 'recording' ? 'true' : 'false',
              title: recState === 'recording' ? t('listening') : t('voiceInput'),
              disabled: recState === 'transcribing',
              onClick: toggleRecording,
            },
              recState === 'recording' ? h('span', { className: 'dsc-recDot' }) : h(MicIcon),
              recordingLabel ? h('span', { className: 'dsc-toolLabel' }, recordingLabel) : null),
            h('button', {
              type: 'button',
              className: 'dsc-tool',
              title: ocrBusy ? t('ocrWorking') : t('ocrHint'),
              disabled: ocrBusy,
              onClick: () => {
                const node = fileRef.current;
                if (node) node.click();
              },
            }, h(FileIcon), h('span', { className: 'dsc-toolLabel' }, ocrBusy ? t('ocrWorking') : 'OCR')),
            h('input', {
              ref: fileRef,
              type: 'file',
              accept: '.pdf,.doc,.docx,.ppt,.pptx,image/*',
              style: { display: 'none' },
              onChange: (event) => {
                const file = event.target.files && event.target.files[0];
                if (file) runOcr(file);
              },
            })),
          h('span', { className: 'dsc-composerHint' }, draft.trim() ? '' : t('welcomeHint')),
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
            }, h(ArrowIcon))));

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
          atBottom || !messages.length
            ? null
            : h('button', {
              type: 'button',
              className: 'dsc-jump',
              onClick: () => {
                stickRef.current = true;
                setAtBottom(true);
                const node = scrollRef.current;
                if (node) node.scrollTop = node.scrollHeight;
              },
            }, h('span', { 'aria-hidden': true }, '↓'), h('span', null, t('jumpToLatest'))),
          notice ? h('div', { className: 'dsc-notice', role: 'status' }, notice) : null,
          savedNotice ? h('div', { className: 'dsc-notice', role: 'status' }, savedNotice) : null,
          hasApiKey
            ? null
            : h('div', { className: 'dsc-notice dsc-noticeRow', role: 'status' },
              h('span', null, t('missingKey')),
              h('button', { type: 'button', className: 'dsc-plainAction', onClick: () => setSettingsOpen(true) }, t('settings'))),
          composer));

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
