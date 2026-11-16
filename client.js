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
    /** The Anthropic-compatible surface the demo also uses; files need its beta header. */
    const MESSAGES_PATH = '/anthropic/v1/messages';
    const FILES_PATH = '/anthropic/v1/files';
    const FILES_BETA = 'files-api-2025-04-14';
    /** Thinking levels accepted by the Messages API; `off` disables the mode. */
    const THINKING_LEVELS = ['off', 'low', 'high', 'max'];
    /** TTS voices offered by the speech API. */
    const TTS_VOICES = ['stella', 'tide'];
    /** The speech API caps a single synthesis at 10,000 billing characters. */
    const TTS_MAX_CHARS = 9000;
    /** The ASR API caps one upload at 120 seconds and 8 MiB. */
    const RECORDING_LIMIT_SECONDS = 110;
    /** Attachment limits mirrored from the demo and the Files API. */
    const MAX_ATTACHMENTS = 10;
    const MAX_FILE_MB = 64;
    const MAX_USER_DATA_MB = 32;
    /** Documents the service parses page by page; other files upload as user data. */
    const LAYOUT_EXTS = ['pdf', 'doc', 'docx', 'ppt', 'pptx'];
    /** Extensions accepted for attachments; images are additionally matched by MIME. */
    const ACCEPTED_EXTS = [
      'pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'csv', 'tsv',
      'txt', 'md', 'html', 'htm', 'json', 'log', 'xml', 'yaml', 'yml', 'ini', 'conf',
      'go', 'h', 'c', 'cpp', 'cc', 'cs', 'java', 'js', 'jsx', 'ts', 'tsx', 'mjs',
      'css', 'scss', 'less', 'php', 'py', 'rb', 'rs', 'swift', 'kt', 'sh', 'sql', 'vue', 'svelte',
      'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'avif', 'ico',
    ];

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
      stopGenerating: 'Stop generating',
      regenerate: 'Regenerate',
      copy: 'Copy',
      copied: 'Copied',
      rename: 'Rename',
      delete: 'Delete',
      assistantName: 'DeepSeek',
      thinkingLabel: 'Reasoning',
      thinkingDuration: 'Thought for {count} s',
      thinkingStopped: 'Stopped',
      thinkingNow: 'Thinking',
      searchingDeep: 'Searching the web',
      browsingPages: 'Browsing pages',
      readingLink: 'Reading',
      readPagesCount: 'Read {count} pages',
      searchUnavailable: 'Web search unavailable',
      browseFailed: 'Could not open pages',
      browsedPages: 'Browsed {count} pages',
      viewAll: 'View all',
      changeApiKey: 'Change API key',
      topUp: 'Top up',
      retry: 'Retry',
      previousVersion: 'Previous version',
      nextVersion: 'Next version',
      caveat: 'AI-generated, for reference only',
      noticeNetwork: 'Network problem. Check your connection and try again.',
      noticeInvalidKey: 'The API key is invalid or was deleted. Use another key.',
      noticeBalance: 'Your balance is too low. Top up and try again.',
      noticeRateLimited: 'Too many requests. Wait a moment and retry.',
      noticeBusy: 'The service is busy. Try again later.',
      noticeFileExpired: 'An attachment expired on the service. Send it again.',
      refused: 'Sorry, I cannot answer that. Let us talk about something else.',      error: 'Request failed',
      clearAll: 'Delete all conversations',
      clearConfirm: 'Delete every conversation stored in this browser?',
      stopped: 'Stopped',
      modelHint: 'Use a model id your key can access.',
      settingsSaved: 'Settings saved',
      untitled: 'New chat',
      groupToday: 'Today',
      groupYesterday: 'Yesterday',
      groupWeek: 'Previous 7 days',
      groupMonth: 'Previous 30 days',
      groupOlder: 'Older',
      deleteTitle: 'Delete conversation for good',
      deleteBody: 'The conversation and everything in it will be gone. Delete it?',
      deleteConfirm: 'Delete',
      backToConversation: 'Back to the conversation',
      webSearch: 'Web search',
      thinking: 'Thinking',
      thinkOff: 'Off',
      thinkLow: 'Low',
      thinkHigh: 'High',
      thinkMax: 'Max',
      searching: 'Searching…',
      searchingFor: 'Searching “{query}”',
      searchResult: 'Search results',
      searchNoResult: 'No results for this search',
      close: 'Close',
      voiceInput: 'Voice input',
      listening: 'Listening… tap to stop',
      transcribing: 'Transcribing…',
      recordDenied: 'Microphone access was denied',
      recordFailed: 'Could not start the microphone',
      recordTooLong: 'Recording stopped after 110 seconds',
      speak: 'Read aloud',
      stopReading: 'Stop reading',
      speakFailed: 'Could not synthesize speech',
      attach: 'Add files',
      attachHint: 'Paste or pick them too — up to {count} files, {size} MB each',
      dropHere: 'Drop files here to upload',
      uploadFailed: 'Upload failed',
      uploadRetry: 'Retry upload',
      uploading: 'Uploading…',
      attachUnsupported: 'Unsupported file type',
      attachTooLarge: 'Files must be at most {size} MB',
      attachTooMany: 'At most {count} files per message',
      removeAttachment: 'Remove',
      attachmentOnly: 'Send the attachment',
      image: 'image',
      searchQueries: 'Searched the web',
      readPages: 'Read pages',
      citations: 'Citations',
      thinkingEffort: 'Effort',
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
      stopGenerating: '停止生成',
      regenerate: '重新生成',
      copy: '复制',
      copied: '已复制',
      rename: '重命名',
      delete: '删除',
      assistantName: 'DeepSeek',
      thinkingLabel: '深度思考',
      thinkingDuration: '已思考（用时 {count} 秒）',
      thinkingStopped: '已停止',
      thinkingNow: '正在思考',
      searchingDeep: '正在搜索',
      browsingPages: '正在浏览网页',
      readingLink: '正在阅读',
      readPagesCount: '已阅读 {count} 个网页',
      searchUnavailable: '联网搜索暂不可用',
      browseFailed: '浏览页面失败',
      browsedPages: '浏览 {count} 个页面',
      viewAll: '查看全部',
      changeApiKey: '更换 API Key',
      topUp: '前往充值',
      retry: '重试',
      previousVersion: '上一个版本',
      nextVersion: '下一个版本',
      caveat: '内容由 AI 生成，请仔细甄别',
      noticeNetwork: '网络异常，请检查网络后重试。',
      noticeInvalidKey: 'API Key 无效或已被删除，请更换后重试。',
      noticeBalance: '账户余额不足，请充值后重试。',
      noticeRateLimited: '请求过于频繁，请稍后再试。',
      noticeBusy: '服务器繁忙，请稍后再试。',
      noticeFileExpired: '附件已在服务端失效，请重新发送。',
      refused: '你好，这个问题我暂时无法回答，让我们换个话题再聊聊吧。',      error: '请求失败',
      clearAll: '删除全部对话',
      clearConfirm: '要删除本浏览器中保存的全部对话吗？',
      stopped: '已停止',
      modelHint: '请填写你的 Key 可以访问的模型 id。',
      settingsSaved: '设置已保存',
      untitled: '新对话',
      groupToday: '今天',
      groupYesterday: '昨天',
      groupWeek: '7 天内',
      groupMonth: '30 天内',
      groupOlder: '更早',
      deleteTitle: '永久删除对话',
      deleteBody: '删除后，该对话及其中的消息将不可恢复。确认删除吗？',
      deleteConfirm: '删除',
      backToConversation: '返回对话',
      webSearch: '联网',
      thinking: '思考',
      thinkOff: '关闭',
      thinkLow: '低',
      thinkHigh: '高',
      thinkMax: '最高',
      searching: '正在搜索…',
      searchingFor: '正在搜索「{query}」',
      searchResult: '搜索结果',
      searchNoResult: '这次搜索没有结果',
      close: '关闭',
      voiceInput: '语音输入',
      listening: '正在录音…点击结束',
      transcribing: '正在识别语音…',
      recordDenied: '麦克风权限被拒绝',
      recordFailed: '无法启动麦克风',
      recordTooLong: '录音已自动停止（110 秒）',
      speak: '朗读',
      stopReading: '停止朗读',
      speakFailed: '语音合成失败',
      attach: '添加附件',
      attachHint: '也可以粘贴或选择文件：最多 {count} 个，每个 {size} MB',
      dropHere: '拖动文件到此处即可上传',
      uploadFailed: '上传失败',
      uploadRetry: '重新上传',
      uploading: '上传中…',
      attachUnsupported: '不支持这个文件类型',
      attachTooLarge: '单个文件不能超过 {size} MB',
      attachTooMany: '每条消息最多 {count} 个文件',
      removeAttachment: '移除',
      attachmentOnly: '发送附件',
      image: '图片',
      searchQueries: '联网搜索',
      readPages: '阅读网页',
      citations: '引用',
      thinkingEffort: '强度',
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
        webSearch: stored.webSearch !== false,
        voice: TTS_VOICES.indexOf(stored.voice) >= 0 ? stored.voice : 'stella',
      };
    }

    /** Rebuild blocks for a reply stored before the Messages API move. */
    function legacyBlocks(message) {
      const blocks = [];
      if (typeof message.reasoning === 'string' && message.reasoning.trim()) {
        blocks.push({ type: 'thinking', text: message.reasoning });
      }
      if (typeof message.content === 'string' && message.content.trim()) {
        blocks.push({ type: 'text', text: message.content, citations: [] });
      }
      if (Array.isArray(message.sources) && message.sources.length) {
        blocks.push({
          type: 'sources',
          items: message.sources
            .filter((source) => source && typeof source.url === 'string')
            .map((source) => ({
              title: typeof source.title === 'string' ? source.title : '',
              url: source.url,
              snippet: typeof source.snippet === 'string' ? source.snippet : '',
              site: typeof source.site === 'string' ? source.site : '',
            })),
        });
      }
      return blocks;
    }

    /** Keep only the reply blocks this panel knows how to draw. */
    function sanitizeBlocks(raw) {
      if (!Array.isArray(raw)) return [];
      const out = [];
      for (let i = 0; i < raw.length; i += 1) {
        const item = raw[i];
        if (!item || typeof item.type !== 'string') continue;
        if (item.type === 'text') {
          out.push({
            type: 'text',
            text: typeof item.text === 'string' ? item.text : '',
            citations: Array.isArray(item.citations)
              ? item.citations.filter((c) => c && typeof c.url === 'string')
                .map((c) => ({ url: c.url, title: typeof c.title === 'string' ? c.title : '' }))
              : [],
          });
        } else if (item.type === 'thinking') {
          out.push({
            type: 'thinking',
            text: typeof item.text === 'string' ? item.text : '',
            startedAt: typeof item.startedAt === 'number' ? item.startedAt : 0,
            endedAt: typeof item.endedAt === 'number' ? item.endedAt : 0,
          });
        } else if (item.type === 'tool') {
          out.push({
            type: 'tool',
            kind: typeof item.kind === 'string' ? item.kind : 'search',
            queries: Array.isArray(item.queries) ? item.queries.filter((q) => typeof q === 'string') : [],
            url: typeof item.url === 'string' ? item.url : '',
          });
        } else if (item.type === 'sources') {
          out.push({
            type: 'sources',
            items: Array.isArray(item.items)
              ? item.items.filter((s) => s && typeof s.url === 'string')
                .map((s) => ({
                  title: typeof s.title === 'string' ? s.title : '',
                  url: s.url,
                  snippet: typeof s.snippet === 'string' ? s.snippet : '',
                  site: typeof s.site === 'string' ? s.site : '',
                  icon: typeof s.icon === 'string' ? s.icon : '',
                  date: typeof s.date === 'string' ? s.date : '',
                }))
              : [],
          });
        } else if (item.type === 'fetch') {
          out.push({ type: 'fetch', urls: Array.isArray(item.urls) ? item.urls.filter((u) => typeof u === 'string') : [] });
        }
      }
      return out;
    }

    /** Keep only uploaded attachments; pending uploads never reach storage. */
    function sanitizeAttachments(raw) {
      if (!Array.isArray(raw)) return [];
      const out = [];
      for (let i = 0; i < raw.length; i += 1) {
        const item = raw[i];
        if (!item || typeof item.fileId !== 'string' || typeof item.name !== 'string') continue;
        out.push({
          id: typeof item.id === 'string' ? item.id : uid(),
          name: item.name,
          size: typeof item.size === 'number' ? item.size : 0,
          isImage: item.isImage === true,
          fileId: item.fileId,
        });
      }
      return out;
    }

    /** Group conversations the way the demo's rail does: today, yesterday, 7 days, 30 days. */
    function groupConversations(list, t) {
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const day = 86400000;
      const groups = [
        { key: 'today', label: t('groupToday'), items: [] },
        { key: 'yesterday', label: t('groupYesterday'), items: [] },
        { key: 'week', label: t('groupWeek'), items: [] },
        { key: 'month', label: t('groupMonth'), items: [] },
        { key: 'older', label: t('groupOlder'), items: [] },
      ];
      const sorted = sortConversations(list);
      for (let i = 0; i < sorted.length; i += 1) {
        const time = sorted[i].updatedAt || sorted[i].createdAt;
        let index = 4;
        if (time >= startOfToday) index = 0;
        else if (time >= startOfToday - day) index = 1;
        else if (time >= startOfToday - 7 * day) index = 2;
        else if (time >= startOfToday - 30 * day) index = 3;
        groups[index].items.push(sorted[i]);
      }
      return groups.filter((group) => group.items.length);
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
            .map((m) => {
              if (m.role === 'user') {
                return {
                  id: typeof m.id === 'string' ? m.id : uid(),
                  role: 'user',
                  // `content` is the shape stored before attachments existed.
                  text: typeof m.text === 'string' ? m.text : (typeof m.content === 'string' ? m.content : ''),
                  attachments: sanitizeAttachments(m.attachments),
                };
              }
              const blocks = Array.isArray(m.blocks) ? sanitizeBlocks(m.blocks) : legacyBlocks(m);
              const versions = Array.isArray(m.versions)
                ? m.versions.map((slot) => ({
                  blocks: sanitizeBlocks(slot && slot.blocks),
                  status: slot && (slot.status === 'done' || slot.status === 'stopped' || slot.status === 'error')
                    ? slot.status
                    : 'done',
                  stopReason: slot && typeof slot.stopReason === 'string' ? slot.stopReason : '',
                  error: slot && typeof slot.error === 'string' ? slot.error : '',
                }))
                : [{ blocks, status: 'done', stopReason: '', error: '' }];
              const versionIndex = typeof m.versionIndex === 'number' && m.versionIndex < versions.length
                ? m.versionIndex
                : versions.length - 1;
              const active = versions[versionIndex] || { blocks, status: 'done' };
              return {
                id: typeof m.id === 'string' ? m.id : uid(),
                role: 'assistant',
                versions,
                versionIndex,
                blocks: active.blocks,
                stopReason: active.stopReason || '',
                status: m.status === 'done' || m.status === 'stopped' || m.status === 'error'
                  ? m.status
                  : (m.stopped === true ? 'stopped' : (blocks.length ? 'done' : 'error')),
                error: typeof m.error === 'string' ? m.error : '',
              };
            }),
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
          if (href.indexOf('cite:') === 0) {
            // A citation marker this panel injected; it renders as a superscript chip.
            let url = href.slice(5);
            try {
              url = decodeURIComponent(url);
            } catch (error) {
              /* keep the raw value */
            }
            const cited = sources && sources[url];
            nodes.push(h('sup', { key, className: 'dsc-cites' },
              h('a', { href: url, target: '_blank', rel: 'noreferrer noopener', title: url }, label.replace(/^c/, '')),
              cited
                ? h('span', { className: 'dsc-citeCard', 'aria-hidden': true },
                  h('span', { className: 'dsc-citeCardMeta' },
                    h(SiteDot, { name: cited.site || hostOf(cited.url) }),
                    h('span', null, cited.site || hostOf(cited.url)),
                    cited.date ? h('span', { className: 'dsc-citeCardDate' }, formatDate(cited.date)) : null),
                  h('span', { className: 'dsc-citeCardTitle' }, cited.title || cited.url),
                  cited.snippet ? h('span', { className: 'dsc-citeCardSnippet' }, clipSnippet(cited.snippet)) : null)
                : null));
          } else {
            nodes.push(h('a', { key, href, target: '_blank', rel: 'noreferrer noopener' }, label || href));
          }
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

    /** The endpoints derived from one base URL. */
    function endpoints(baseUrl) {
      const base = String(baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
      return {
        messages: base + MESSAGES_PATH,
        files: base + FILES_PATH,
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

    /** Identity text the original demo also sends with every request. */
    const SYSTEM_PROMPT = '你是 DeepSeek，由深度求索公司创造的 AI 助手。请用与提问相同的语言回答。';

    /** Auth headers for the Anthropic-compatible surface. */
    function apiHeaders(settings, beta) {
      const headers = { 'x-api-key': String(settings.apiKey).trim() };
      if (beta) headers['anthropic-beta'] = FILES_BETA;
      return headers;
    }

    /** Server-side tools declared for one request; link reading always rides along. */
    function serverTools(search) {
      const tools = [{ type: 'deepseek_read_url', name: 'deepseek_read_url' }];
      if (search) tools.push({ type: 'deepseek_web_search', name: 'deepseek_web_search' });
      return tools;
    }

    /** True when a request carries file blocks; the Files beta header is then required. */
    function hasFiles(messages) {
      return messages.some((message) => Array.isArray(message.content)
        && message.content.some((block) => block && (block.type === 'image' || block.type === 'document')));
    }

    /**
     * Stream one reply through the Anthropic-compatible Messages API.
     * Yields the raw stream events; the caller folds them into its message.
     * @param options.settings - resolved API settings.
     * @param options.messages - request messages built by `requestMessages`.
     * @param options.search - declare the server-side web search tool.
     * @param options.signal - abort signal owned by the caller.
     */
    async function* streamMessage(options) {
      const { settings, messages, search, signal } = options;
      const body = {
        model: settings.model,
        system: SYSTEM_PROMPT,
        messages,
        thinking: { type: settings.thinking === 'off' ? 'disabled' : 'enabled' },
        safety_check: { level: 'high' },
        tools: serverTools(search),
        stream: true,
      };
      // The service documents `output_config.effort` for the Anthropic surface;
      // an unsupported field is ignored rather than rejected.
      if (settings.thinking !== 'off') body.output_config = { effort: settings.thinking };
      const response = await fetch(endpoints(settings.baseUrl).messages, {
        method: 'POST',
        signal,
        headers: Object.assign({}, apiHeaders(settings, hasFiles(messages)), {
          'content-type': 'application/json',
          accept: 'text/event-stream',
        }),
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        let text = '';
        try {
          text = await response.text();
        } catch (error) {
          text = '';
        }
        throw new Error(describeFailure(response.status, text));
      }
      if (!response.body || !response.body.getReader) {
        const text = await response.text();
        yield* eventsFromBody(text);
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finished = false;
      while (!finished) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          const line = buffer.slice(0, newline).replace(/\r$/, '');
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf('\n');
          if (!line || line.charAt(0) === ':') continue;
          if (line.indexOf('data:') !== 0) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          let event;
          try {
            event = JSON.parse(payload);
          } catch (error) {
            continue;
          }
          if (event && event.type === 'error') {
            throw new Error((event.error && event.error.message) || 'stream error');
          }
          if (event && event.type === 'message_stop') finished = true;
          yield event;
          if (finished) break;
        }
      }
    }

    /** Synthesize the same event sequence from a non-streaming body. */
    function* eventsFromBody(text) {
      let body;
      try {
        body = JSON.parse(text);
      } catch (error) {
        throw new Error(text.slice(0, 200));
      }
      if (body && body.error) throw new Error(body.error.message || 'request failed');
      yield { type: 'message_start', message: body };
      const blocks = Array.isArray(body.content) ? body.content : [];
      for (let index = 0; index < blocks.length; index += 1) {
        yield { type: 'content_block_start', index, content_block: blocks[index] };
        yield { type: 'content_block_stop', index };
      }
      yield { type: 'message_delta', delta: { stop_reason: body.stop_reason }, usage: body.usage };
      yield { type: 'message_stop' };
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

    /** Lower-case extension without the dot. */
    function fileExt(name) {
      const text = String(name || '');
      const dot = text.lastIndexOf('.');
      return dot > 0 ? text.slice(dot + 1).toLowerCase() : '';
    }

    /** Browsers on Windows sometimes omit `file.type`; fall back to the extension. */
    function resolveMimeType(file) {
      if (file.type) return file.type;
      const ext = fileExt(file.name);
      const map = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
      return map[ext] || '';
    }

    /** Images travel as image blocks; everything else is a document. */
    function isImageFile(file) {
      return resolveMimeType(file).indexOf('image/') === 0;
    }

    /** Files API purpose: images carry none, layout documents ask for page parsing. */
    function uploadPurpose(file) {
      if (isImageFile(file)) return null;
      return LAYOUT_EXTS.indexOf(fileExt(file.name)) >= 0 ? 'rich_layout_recognition' : 'user_data';
    }

    /** The size cap that applies to one file, in MiB. */
    function maxSizeMb(file) {
      return uploadPurpose(file) === 'user_data' ? MAX_USER_DATA_MB : MAX_FILE_MB;
    }

    /**
     * Upload one attachment through the Files API.
     * @param options.settings - resolved API settings.
     * @param options.file - the picked, dropped, or pasted `File`.
     * @param options.signal - abort signal owned by the caller.
     * @returns the server file id used by later message blocks.
     */
    async function uploadAttachment(options) {
      const { settings, file, signal } = options;
      const form = new FormData();
      const purpose = uploadPurpose(file);
      if (purpose) form.append('purpose', purpose);
      form.append('file', file, file.name || 'upload');
      const response = await fetch(endpoints(settings.baseUrl).files, {
        method: 'POST',
        signal,
        headers: apiHeaders(settings, true),
        body: form,
      });
      if (!response.ok) throw await failedResponse(response, 'upload');
      const body = await response.json();
      if (!body || typeof body.id !== 'string') throw new Error('upload · unexpected response');
      return body.id;
    }

    /**
     * Fold one stream event into the reply blocks.
     * @param blocks - current blocks.
     * @param indexes - maps a stream block index to a position in `blocks`.
     * @param event - one Messages API stream event.
     * @returns the same array when the event changes nothing.
     */
    function applyStreamEvent(blocks, indexes, event) {
      if (!event || typeof event.type !== 'string') return blocks;
      if (event.type === 'content_block_start') {
        const content = event.content_block || {};
        let block = null;
        if (content.type === 'text') {
          block = { type: 'text', text: typeof content.text === 'string' ? content.text : '', citations: [] };
        } else if (content.type === 'thinking') {
          block = {
            type: 'thinking',
            text: typeof content.thinking === 'string' ? content.thinking : '',
            startedAt: Date.now(),
            endedAt: 0,
          };
        } else if (content.type === 'server_tool_use') {
          const input = content.input || {};
          const queries = Array.isArray(input.queries)
            ? input.queries.filter((query) => typeof query === 'string')
            : (typeof input.query === 'string' ? [input.query] : []);
          block = {
            type: 'tool',
            kind: typeof content.kind === 'string' ? content.kind : (input.action || 'search'),
            queries,
            url: typeof input.url === 'string' ? input.url : '',
          };
        } else if (content.type === 'web_search_tool_result') {
          const items = Array.isArray(content.content)
            ? content.content.filter((item) => item && item.type === 'web_search_result' && typeof item.url === 'string')
            : [];
          block = {
            type: 'sources',
            items: items.map((item) => ({
              title: typeof item.title === 'string' ? item.title : '',
              url: item.url,
              snippet: typeof item.snippet === 'string' ? item.snippet : '',
              site: typeof item.site_name === 'string' ? item.site_name : '',
              icon: typeof item.site_icon === 'string' ? item.site_icon : '',
              date: typeof item.page_age === 'string' ? item.page_age : '',
            })),
          };
        } else if (content.type === 'web_fetch_tool_result') {
          const result = content.content || {};
          block = { type: 'fetch', urls: typeof result.url === 'string' && result.url ? [result.url] : [] };
        }
        if (!block) {
          indexes.delete(event.index);
          return blocks;
        }
        const next = blocks.concat([block]);
        indexes.set(event.index, next.length - 1);
        return next;
      }
      if (event.type === 'content_block_stop') {
        const position = indexes.get(event.index);
        if (position === undefined) return blocks;
        const block = blocks[position];
        if (!block || block.type !== 'thinking' || block.endedAt) return blocks;
        const next = blocks.slice();
        next[position] = {
          type: 'thinking',
          text: block.text,
          startedAt: block.startedAt,
          endedAt: Date.now(),
        };
        return next;
      }
      if (event.type === 'content_block_delta') {
        const position = indexes.get(event.index);
        if (position === undefined) return blocks;
        const block = blocks[position];
        if (!block) return blocks;
        const delta = event.delta || {};
        if (block.type === 'text' && delta.type === 'text_delta') {
          const next = blocks.slice();
          next[position] = { type: 'text', text: block.text + delta.text, citations: block.citations || [] };
          return next;
        }
        if (block.type === 'text' && delta.type === 'citations_delta') {
          const citation = delta.citation || {};
          if (typeof citation.url !== 'string') return blocks;
          const next = blocks.slice();
          next[position] = {
            type: 'text',
            text: block.text,
            citations: (block.citations || []).concat([{
              url: citation.url,
              title: typeof citation.title === 'string' ? citation.title : '',
            }]),
          };
          return next;
        }
        if (block.type === 'thinking' && delta.type === 'thinking_delta') {
          const next = blocks.slice();
          next[position] = {
            type: 'thinking',
            text: block.text + delta.thinking,
            startedAt: block.startedAt,
            endedAt: block.endedAt,
          };
          return next;
        }
        return blocks;
      }
      return blocks;
    }

    /** Replace the active version slot of a reply, keeping the mirrors in sync. */
    function patchVersion(message, patch) {
      const versions = Array.isArray(message.versions) && message.versions.length
        ? message.versions.slice()
        : [{
          blocks: message.blocks || [],
          status: message.status || 'done',
          stopReason: message.stopReason || '',
          error: message.error || '',
        }];
      const index = typeof message.versionIndex === 'number' && message.versionIndex < versions.length
        ? message.versionIndex
        : versions.length - 1;
      const slot = Object.assign({}, versions[index] || {}, patch);
      versions[index] = slot;
      return Object.assign({}, message, {
        versions,
        versionIndex: index,
        blocks: slot.blocks || [],
        status: slot.status || 'done',
        stopReason: slot.stopReason || '',
        error: slot.error || '',
      });
    }

    /** Stored attachment metadata for the request that is about to be sent. */
    function attachmentMeta(item) {
      return { id: item.id, name: item.name, size: item.size, isImage: item.isImage, fileId: item.fileId };
    }
    /** Stored attachments as request blocks, in the order the user added them. */
    function attachmentBlocks(attachments) {
      const blocks = [];
      for (let i = 0; i < (attachments || []).length; i += 1) {
        const item = attachments[i];
        if (!item || !item.fileId) continue;
        blocks.push({ type: item.isImage ? 'image' : 'document', source: { type: 'file', file_id: item.fileId } });
      }
      return blocks;
    }

    /** One user turn as a request message: files first, then the text. */
    function userMessageParam(message) {
      const files = attachmentBlocks(message.attachments);
      const text = String(message.text || '').trim();
      if (!files.length) return { role: 'user', content: text };
      if (text) files.push({ type: 'text', text });
      return { role: 'user', content: files };
    }

    /** Answer text of one reply; search results and thinking stay out of history. */
    function assistantText(message) {
      return (message.blocks || [])
        .filter((block) => block && block.type === 'text')
        .map((block) => block.text)
        .join('');
    }

    /** The current date and context the service expects, as a `latest_reminder` row. */
    function latestReminder(english) {
      const now = new Date();
      const pad = (value) => (value < 10 ? '0' + value : String(value));
      const date = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
      let weekday = '';
      try {
        weekday = new Intl.DateTimeFormat(english ? 'en-US' : 'zh-CN', { weekday: 'long' }).format(now);
      } catch (error) {
        weekday = '';
      }
      // Five fields are required: date, weekday, location (may be empty), platform, language.
      return [date, weekday, '', 'Web', english ? 'English' : '中文'].join(',');
    }

    /**
     * Build the request history the way the demo does: complete rounds only,
     * then the question being asked now.
     */
    function requestMessages(history, question, english) {
      const messages = [{ role: 'latest_reminder', content: latestReminder(english) }];
      for (let i = 0; i < history.length; i += 1) {
        const user = history[i];
        const reply = history[i + 1];
        if (!user || user.role !== 'user') continue;
        if (!reply || reply.role !== 'assistant') continue;
        i += 1;
        if (reply.status !== 'done' && reply.status !== 'stopped') continue;
        const text = assistantText(reply);
        if (!text.trim()) continue;
        if (!String(user.text || '').trim() && attachmentBlocks(user.attachments).length === 0) continue;
        messages.push(userMessageParam(user));
        messages.push({ role: 'assistant', content: [{ type: 'text', text }] });
      }
      messages.push(userMessageParam(question));
      return messages;
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
.dsc-reasonArea { margin: 2px 0 10px; }
.dsc-reasonHead {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 4px 0;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
  transition: color 120ms ease;
}
.dsc-reasonHead:hover { color: var(--dsw-alias-label-primary); }
.dsc-reasonHead svg:first-child { color: var(--dsw-alias-brand-primary); flex: none; }
.dsc-reasonHead[data-live='true'] svg:first-child { animation: dsc-pulse 1.6s ease-in-out infinite; }
.dsc-reasonTitle { margin-right: 2px; }
.dsc-reasonSteps { padding: 2px 0 2px 2px; }
.dsc-liveDot {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
  background: var(--dsw-alias-state-success-primary);
  animation: dsc-pulse 1.2s ease-in-out infinite;
}
@keyframes dsc-pulse { 50% { opacity: 0.3; } }

.dsc-stepRow {
  position: relative;
  display: flex;
  gap: 8px;
  padding: 3px 0 3px 0;
}
.dsc-stepRow::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 14px;
  bottom: -4px;
  width: 1px;
  background: var(--dsw-alias-border-l2);
}
.dsc-stepRow[data-last='true']::before { display: none; }
.dsc-stepDot {
  position: relative;
  z-index: 1;
  width: 9px;
  height: 9px;
  flex: none;
  margin-top: 5px;
  border-radius: 50%;
  background: var(--dsw-alias-bg-base);
  box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2);
}
.dsc-stepBody { min-width: 0; flex: 1; padding-bottom: 3px; }
.dsc-stepText {
  color: var(--dsw-alias-label-secondary);
  font-size: 12.5px;
  line-height: 1.65;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.dsc-stepAction {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 2px 6px 2px 2px;
  margin-left: -2px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 12.5px;
  text-align: left;
}
.dsc-stepAction[data-clickable='true'] { cursor: pointer; }
.dsc-stepAction[data-clickable='true']:hover {
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
}
.dsc-stepQuery {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsc-stepSites { display: inline-flex; align-items: center; margin-left: 2px; }
.dsc-stepSites .dsc-siteImg,
.dsc-stepSites .dsc-siteDot { margin-left: 3px; }
.dsc-stepOpen {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12.5px;
}
.dsc-stepPage {
  max-width: 190px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
  text-decoration: underline dotted var(--dsw-alias-border-l2);
  text-underline-offset: 3px;
}
.dsc-stepPage:hover { color: var(--dsw-alias-label-primary); }
.dsc-stepChip {
  padding: 1px 7px;
  border: 0;
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
  cursor: pointer;
}
.dsc-stepChip:hover { color: var(--dsw-alias-label-primary); }

.dsc-siteImg { border-radius: 50%; object-fit: cover; flex: none; }

.dsc-noticeLine {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 8px 0 2px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font-size: 12.5px;
  line-height: 1.6;
}
.dsc-noticeLine[data-error='true'] { color: var(--dsw-alias-label-primary); }
.dsc-noticeLine[data-error='true'] > svg { color: var(--dsw-alias-state-warn-primary); flex: none; }
.dsc-noticeAction {
  padding: 1px 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-brand-primary);
  font-size: 12px;
  text-decoration: none;
  cursor: pointer;
}
.dsc-noticeAction:hover { background: var(--dsw-alias-bg-layer-2); }

.dsc-versions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-right: 6px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.dsc-versionArrow {
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}
.dsc-versionArrow:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsc-versionArrow:disabled { opacity: 0.35; cursor: default; }
.dsc-botFoot {
  display: flex;
  gap: 10px;
  margin-top: 10px;
  opacity: 0;
  transition: opacity 120ms ease;
}
.dsc-botRow:hover .dsc-versions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-right: 6px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.dsc-versionArrow {
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}
.dsc-versionArrow:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsc-versionArrow:disabled { opacity: 0.35; cursor: default; }
.dsc-botFoot { opacity: 1; }

.dsc-caveat {
  margin: 8px auto 2px;
  color: var(--dsw-alias-state-idle-primary);
  font-size: 11px;
  text-align: center;
}

.dsc-cites { position: relative; display: inline-flex; gap: 3px; margin-left: 3px; vertical-align: super; }
.dsc-cites a {
  display: inline-block;
  padding: 0 3px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--dsw-alias-label-secondary) 16%, transparent);
  color: var(--dsw-alias-label-primary);
  font-size: 10px;
  font-weight: 500;
  text-decoration: none;
}
.dsc-cites a:hover { background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); }
.dsc-citeCard {
  position: absolute;
  bottom: calc(100% + 8px);
  left: -8px;
  z-index: 30;
  display: none;
  flex-direction: column;
  gap: 4px;
  width: 260px;
  padding: 10px 11px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-overlay);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.24);
  text-align: left;
  vertical-align: baseline;
}
.dsc-cites:hover .dsc-citeCard { display: flex; }
.dsc-citeCardMeta {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
}
.dsc-citeCardDate { color: var(--dsw-alias-state-idle-primary); }
.dsc-citeCardTitle {
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.dsc-citeCardSnippet {
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
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

.dsc-trail {
  display: inline-flex;
  align-self: flex-start;
  align-items: center;
  gap: 7px;
  margin: 2px 0 10px;
  padding: 3px 10px 3px 6px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
}
.dsc-trail:hover { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
.dsc-trail[data-open='true'] {
  border-color: var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
}
.dsc-trail[data-live='true'] { cursor: default; }
.dsc-trailSites { display: inline-flex; align-items: center; }
.dsc-trailSites .dsc-siteDot { box-shadow: 0 0 0 2px var(--dsw-alias-bg-base); }
.dsc-trailSites .dsc-siteDot + .dsc-siteDot { margin-left: -5px; }
.dsc-trailLabel { white-space: nowrap; }
.dsc-trailChevron { font-size: 14px; line-height: 1; transform: translateY(-1px); }

.dsc-siteDot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex: none;
  border-radius: 50%;
  background: hsl(var(--dot-hue, 220) 45% 50% / 0.18);
  color: color-mix(in srgb, hsl(var(--dot-hue, 220) 55% 55%) 65%, var(--dsw-alias-label-primary));
  font-size: 9px;
  font-weight: 600;
  line-height: 1;
}

.dsc-drawer {
  display: flex;
  flex-direction: column;
  flex: none;
  width: 310px;
  min-width: 0;
  border-left: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}
.dsc-drawerHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 52px;
  flex: none;
  padding: 0 10px 0 16px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dsc-drawerTitle { font-size: 13px; font-weight: 600; }
.dsc-drawerBody { flex: 1; min-height: 0; overflow-y: auto; padding: 10px; }
.dsc-drawerGroup { margin-bottom: 14px; }
.dsc-drawerGroup:last-child { margin-bottom: 4px; }
.dsc-drawerQueries { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 8px; }
.dsc-queryChip {
  max-width: 100%;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsc-drawerLabel { margin: 2px 0 8px; color: var(--dsw-alias-label-secondary); font-size: 11.5px; }
.dsc-drawerEmpty { padding: 10px 2px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsc-sourceCard {
  display: block;
  margin-bottom: 4px;
  padding: 9px 10px;
  border-radius: 9px;
  color: inherit;
  text-decoration: none;
  transition: background-color 120ms ease;
}
.dsc-sourceCard:hover { background: var(--dsw-alias-bg-layer-1); }
.dsc-sourceMeta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 5px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
}
.dsc-sourceSite { max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsc-sourceDate { color: var(--dsw-alias-state-idle-primary); }
.dsc-sourceTitle {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1.45;
}
.dsc-sourceCard:hover .dsc-sourceTitle { color: var(--dsw-alias-brand-primary); }
.dsc-sourceSnippet {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-top: 3px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
  line-height: 1.5;
}
.dsc-pageRow {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 8px;
  border-radius: 7px;
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  text-decoration: none;
}
.dsc-pageRow:hover { background: var(--dsw-alias-bg-layer-1); }
.dsc-pageTitle { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsc-pageArrow { color: var(--dsw-alias-label-secondary); font-size: 11px; }
.dsc-drawerScrim {
  position: absolute;
  inset: 0;
  z-index: 15;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent);
}
@media (max-width: 900px) {
  .dsc-drawer {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 16;
    width: min(340px, 92%);
    box-shadow: -12px 0 32px rgba(0, 0, 0, 0.18);
  }
}
.dsc-notice {
  max-width: 720px;
  margin: 0 auto 8px;
  color: var(--dsw-alias-state-warn-primary);
  font-size: 12px;
  text-align: center;
}
.dsc-noticeRow { display: flex; align-items: center; justify-content: center; gap: 6px; flex-wrap: wrap; }

.dsc-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 2px 2px 8px;
  margin-bottom: 6px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dsc-attachment {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 4px 6px 4px 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 9px;
  background: var(--dsw-alias-bg-base);
  font-size: 12px;
}
.dsc-attachment[data-status='uploading'] { opacity: 0.75; }
.dsc-attachment[data-status='error'] { border-color: var(--dsw-alias-state-error-primary); }
.dsc-attachmentGlyph { display: flex; color: var(--dsw-alias-label-secondary); }
.dsc-attachmentName {
  max-width: 190px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsc-attachmentMeta { color: var(--dsw-alias-label-secondary); font-size: 11px; white-space: nowrap; }
.dsc-attachment[data-status='error'] .dsc-attachmentMeta { color: var(--dsw-alias-state-error-primary); }
.dsc-attachmentAction {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dsc-attachmentAction:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsc-spinner {
  width: 11px;
  height: 11px;
  flex: none;
  border: 1.6px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: dsc-spin 720ms linear infinite;
}
@keyframes dsc-spin { to { transform: rotate(360deg); } }

.dsc-dropMask {
  position: absolute;
  inset: 10px;
  z-index: 25;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1.5px dashed var(--dsw-alias-border-l2);
  border-radius: 14px;
  background: color-mix(in srgb, var(--dsw-alias-bg-base) 82%, transparent);
  backdrop-filter: blur(1px);
  pointer-events: none;
}
.dsc-dropCard {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 22px 30px;
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
  text-align: center;
}
.dsc-dropIcon { display: flex; color: var(--dsw-alias-label-secondary); }
.dsc-dropTitle { font-size: 13px; font-weight: 600; }
.dsc-dropHint { font-size: 11.5px; color: var(--dsw-alias-label-secondary); }

.dsc-turnUser { margin-bottom: 22px; }
.dsc-userFiles { display: flex; flex-wrap: wrap; gap: 5px; justify-content: flex-end; margin-bottom: 6px; }
.dsc-userText { white-space: pre-wrap; overflow-wrap: anywhere; }
.dsc-fileChip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 7px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 7px;
  background: var(--dsw-alias-bg-base);
  font-size: 11.5px;
}
.dsc-fileGlyph { display: flex; color: var(--dsw-alias-label-secondary); }
.dsc-fileName { max-width: 210px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsc-fileSize { color: var(--dsw-alias-label-secondary); }

.dsc-cites { display: inline-flex; gap: 3px; margin-left: 3px; vertical-align: super; }
.dsc-cites a {
  display: inline-block;
  padding: 0 3px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--dsw-alias-label-secondary) 16%, transparent);
  color: var(--dsw-alias-label-primary);
  font-size: 10px;
  font-weight: 500;
  text-decoration: none;
}
.dsc-cites a:hover { background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); }

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
.dsc-dialogBackdrop {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent);
}
.dsc-railGroup { margin-bottom: 6px; }
.dsc-railGroupLabel {
  padding: 8px 8px 4px;
  color: var(--dsw-alias-state-idle-primary);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.02em;
}

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

    function PaperclipIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M13 7.1 8.1 12a3 3 0 0 1-4.2-4.2l5.3-5.3a2 2 0 0 1 2.8 2.8l-5.3 5.3a1 1 0 0 1-1.4-1.4l4.8-4.8' }));
    }

    function ImageIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('rect', { x: 2.2, y: 3.2, width: 11.6, height: 9.6, rx: 2 }),
        h('circle', { cx: 6, cy: 6.8, r: 1.1 }),
        h('path', { d: 'M3 11.6 6.6 8.4l2.2 1.9 2-1.7 2.2 3' }));
    }

    function RefreshIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 12, height: 12, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M13 8a5 5 0 1 1-1.6-3.7M13 2.6v3.1h-3.1' }));
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

    /** Thinking glyph used by the timeline header. */
    function ThinkIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M8 2.4a3.9 3.9 0 0 0-2.3 7.1v1.6h4.6V9.5A3.9 3.9 0 0 0 8 2.4Z' }),
        h('path', { d: 'M6.3 13.7h3.4' }));
    }

    /** Rounded search glyph for a search step. */
    function SearchSiteIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', 'aria-hidden': true },
        h('circle', { cx: 7, cy: 7, r: 4.2 }),
        h('path', { d: 'm10.2 10.2 3 3' }));
    }

    /** Rounded page glyph for a read step. */
    function BrowseSiteIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, fill: 'none', stroke: 'currentColor', strokeWidth: 1.35, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M3.2 2.8h6.2l3.4 3.4v7H3.2Z' }),
        h('path', { d: 'M9.2 2.8v3.6h3.6' }));
    }

    /** Where the demo sends people when the balance runs out. */
    const TOP_UP_URL = 'https://platform.deepseek.com/top_up';

    /**
     * Map a failed reply onto the notice the demo shows: a short reason plus,
     * when the user can fix it, the action that fixes it.
     */
    function describeReply(message, t) {
      if (message.status === 'error' && message.error) {
        const raw = String(message.error);
        const match = /HTTP (\d{3})/.exec(raw);
        const code = match ? Number(match[1]) : 0;
        if (!code && /failed to fetch|network|load failed|networkerror/i.test(raw)) {
          return { text: t('noticeNetwork'), error: true, retry: true };
        }
        if (code === 400 && /file_ids do not exist|file data not found|invalid file_id/i.test(raw)) {
          return { text: t('noticeFileExpired'), error: true };
        }
        if (code === 401) return { text: t('noticeInvalidKey'), error: true, action: 'apiKey' };
        if (code === 402) return { text: t('noticeBalance'), error: true, action: 'topUp' };
        if (code === 429) return { text: t('noticeRateLimited'), error: true, retry: true };
        if (code >= 500) return { text: t('noticeBusy'), error: true, retry: true };
        return { text: raw, error: true, retry: true };
      }
      if (message.stopReason === 'refusal') return { text: t('refused') };
      return null;
    }

    /** Warning glyph for a reply notice. */
    function WarningIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', 'aria-hidden': true },
        h('path', { d: 'M8 2.8 14 13H2L8 2.8Z' }),
        h('path', { d: 'M8 6.6v3.1M8 11.4v.6' }));
    }

    /** Seconds spent thinking across the reply's thinking blocks, or null when unknown. */
    function thinkingSeconds(blocks, now) {
      let total = 0;
      let known = false;
      for (let i = 0; i < (blocks || []).length; i += 1) {
        const block = blocks[i];
        if (!block || block.type !== 'thinking' || !block.startedAt) continue;
        known = true;
        total += Math.max(0, ((block.endedAt || now) - block.startedAt) / 1000);
      }
      if (!known) return null;
      return Math.max(1, Math.round(total));
    }

    /**
     * Fold the reply blocks into the timeline the demo draws: reasoning text,
     * search steps with their results, and the pages the model opened.
     */
    function buildSteps(blocks) {
      const steps = [];
      for (let i = 0; i < (blocks || []).length; i += 1) {
        const block = blocks[i];
        if (block.type === 'thinking') {
          const previous = steps[steps.length - 1];
          if (previous && previous.type === 'thinking') {
            previous.text += block.text;
            previous.active = !block.endedAt;
          } else {
            steps.push({ type: 'thinking', text: block.text, active: !block.endedAt });
          }
          continue;
        }
        if (block.type === 'tool') {
          if (block.url) {
            const previous = steps[steps.length - 1];
            if (previous && previous.type === 'open') {
              if (previous.urls.indexOf(block.url) < 0) previous.urls.push(block.url);
            } else {
              steps.push({ type: 'open', urls: [block.url], status: 'wip' });
            }
            continue;
          }
          if (block.queries && block.queries.length) {
            steps.push({ type: 'search', key: i, queries: block.queries.slice(), results: [], status: 'wip' });
            continue;
          }
          continue;
        }
        if (block.type === 'sources') {
          let target = null;
          for (let j = steps.length - 1; j >= 0; j -= 1) {
            if (steps[j].type === 'search' && steps[j].status === 'wip') {
              target = steps[j];
              break;
            }
          }
          if (!target) {
            target = { type: 'search', key: i, queries: [], results: [], status: 'wip' };
            steps.push(target);
          }
          for (let j = 0; j < block.items.length; j += 1) {
            const item = block.items[j];
            if (target.results.some((result) => result.url === item.url)) continue;
            target.results.push(item);
          }
          target.status = 'done';
          continue;
        }
        if (block.type === 'fetch') {
          const urls = block.urls || [];
          if (!urls.length) continue;
          const previous = steps[steps.length - 1];
          const target = previous && previous.type === 'open'
            ? previous
            : { type: 'open', urls: [], status: 'done' };
          if (target !== previous) steps.push(target);
          for (let j = 0; j < urls.length; j += 1) {
            if (target.urls.indexOf(urls[j]) < 0) target.urls.push(urls[j]);
          }
          target.status = 'done';
        }
      }
      return steps;
    }

    /** Header text of the timeline, mirroring the demo's wording. */
    function reasoningTitle(props) {
      const { steps, streaming, hasAnswer, seconds, t } = props;
      if (hasAnswer) {
        if (seconds === null) return t('thinkingLabel');
        return t('thinkingDuration').replace('{count}', String(seconds));
      }
      if (!streaming) return t('thinkingStopped');
      const last = steps[steps.length - 1];
      if (last && last.type === 'search' && last.status === 'wip') return t('searchingDeep');
      if (last && last.type === 'open' && last.status === 'wip') return t('browsingPages');
      return t('thinkingNow');
    }

    /** A result site as its favicon, falling back to the tinted initial. */
    function SiteLogo(props) {
      const { source, size } = props;
      const name = (source && source.site) || hostOf(source ? source.url : '');
      const icon = source && source.icon;
      const [failed, setFailed] = useState(false);
      const box = { width: size || 16, height: size || 16 };
      if (icon && !failed) {
        return h('img', {
          className: 'dsc-siteImg',
          style: box,
          src: icon,
          alt: '',
          loading: 'lazy',
          referrerPolicy: 'no-referrer',
          onError: () => setFailed(true),
        });
      }
      return h(SiteDot, { name });
    }

    /** One row of the timeline: a dot, a connector line, and its content. */
    function StepRow(props) {
      const { children, last } = props;
      return h('div', { className: 'dsc-stepRow', 'data-last': last ? 'true' : 'false' },
        h('span', { className: 'dsc-stepDot' }),
        h('div', { className: 'dsc-stepBody' }, children));
    }

    /**
     * The reply's reasoning timeline: collapsible header plus one row per
     * reasoning block, search, and opened page.
     */
    function ReasoningArea(props) {
      const { blocks, streaming, hasAnswer, steps, now, t, onOpenSources, open, onToggle } = props;
      if (!steps.length && !streaming) return null;
      const seconds = thinkingSeconds(blocks, now);
      const title = reasoningTitle({ steps, streaming, hasAnswer, seconds, t });
      const body = [];
      for (let i = 0; i < steps.length; i += 1) {
        const step = steps[i];
        const last = i === steps.length - 1;
        if (step.type === 'thinking') {
          body.push(h(StepRow, { key: 't' + i, last },
            h('div', { className: 'dsc-stepText' }, step.text)));
          continue;
        }
        if (step.type === 'search') {
          const wip = step.status === 'wip' && streaming;
          const failed = step.status === 'wip' && !streaming;
          const count = step.results.length;
          const query = step.queries.length ? step.queries[0] : '';
          body.push(h(StepRow, { key: 's' + i, last },
            h('button', {
              type: 'button',
              className: 'dsc-stepAction',
              'data-clickable': count ? 'true' : 'false',
              onClick: count ? onOpenSources : undefined,
            },
              h(SearchSiteIcon),
              wip
                ? h('span', { className: 'dsc-stepQuery' }, t('searchingFor').replace('{query}', query))
                : failed
                  ? h('span', null, t('searchUnavailable'))
                  : h('span', null, t('readPagesCount').replace('{count}', String(count))),
              count
                ? h('span', { className: 'dsc-stepSites' }, step.results.slice(0, 4).map((source) => h(SiteLogo, {
                  key: source.url,
                  source,
                  size: 15,
                })))
                : null)));
          continue;
        }
        if (step.type === 'open') {
          const wip = step.status === 'wip' && streaming;
          const failed = step.status === 'wip' && !streaming;
          const pages = step.urls.slice(0, 5);
          body.push(h(StepRow, { key: 'o' + i, last },
            h('div', { className: 'dsc-stepOpen' },
              h(BrowseSiteIcon),
              h('span', null, wip
                ? t('readingLink')
                : failed ? t('browseFailed') : t('browsedPages').replace('{count}', String(step.urls.length))),
              pages.map((url) => h('a', {
                key: url,
                className: 'dsc-stepPage',
                href: url,
                target: '_blank',
                rel: 'noreferrer noopener',
                title: url,
              }, hostOf(url))),
              step.urls.length > 5
                ? h('button', { type: 'button', className: 'dsc-stepChip', onClick: onOpenSources }, t('viewAll'))
                : null)));
        }
      }
      return h('div', { className: 'dsc-reasonArea' },
        h('button', {
          type: 'button',
          className: 'dsc-reasonHead',
          'data-live': streaming && !hasAnswer ? 'true' : 'false',
          'aria-expanded': open ? 'true' : 'false',
          onClick: onToggle,
        },
          h(ThinkIcon),
          h('span', { className: 'dsc-reasonTitle' }, title),
          h(ChevronIcon, { open })),
        open ? h('div', { className: 'dsc-reasonSteps' }, body) : null);
    }

    /** Keep one search snippet short enough to read at a glance. */
    function clipSnippet(text) {
      const flat = String(text).replace(/\s+/g, ' ').trim();
      return flat.length > 150 ? flat.slice(0, 150) + '…' : flat;
    }

    /** The host of one result URL, shown when the service gives no site name. */
    function hostOf(url) {
      try {
        return String(new URL(url).hostname).replace(/^www\./, '');
      } catch (error) {
        return String(url || '').replace(/^https?:\/\//, '').split('/')[0];
      }
    }

    /** A round site chip with the first letter, tinted from the site name. */
    function SiteDot(props) {
      const name = String(props.name || '?').trim();
      const initial = name.charAt(0).toUpperCase() || '?';
      let hue = 0;
      for (let i = 0; i < name.length; i += 1) hue = (hue * 31 + name.charCodeAt(i)) % 360;
      return h('span', {
        className: 'dsc-siteDot',
        style: { '--dot-hue': String(hue) },
        'aria-hidden': true,
      }, initial);
    }

    /**
     * Group the reply blocks into the search and read steps they describe, the
     * way the demo's timeline does: one row per search with its results.
     */
    function buildSearchSteps(blocks) {
      const steps = [];
      let pending = null;
      for (let i = 0; i < (blocks || []).length; i += 1) {
        const block = blocks[i];
        if (block.type === 'tool') {
          if (block.url) {
            if (pending) {
              steps.push(pending);
              pending = null;
            }
            const previous = steps[steps.length - 1];
            if (previous && previous.kind === 'open') {
              if (previous.urls.indexOf(block.url) < 0) previous.urls.push(block.url);
            } else {
              steps.push({ kind: 'open', queries: [], results: [], urls: [block.url] });
            }
            continue;
          }
          if (block.queries && block.queries.length) {
            if (pending) steps.push(pending);
            pending = { kind: 'search', queries: block.queries.slice(), results: [], urls: [] };
          }
          continue;
        }
        if (block.type === 'sources') {
          if (!pending) pending = { kind: 'search', queries: [], results: [], urls: [] };
          for (let j = 0; j < block.items.length; j += 1) {
            const item = block.items[j];
            if (pending.results.some((result) => result.url === item.url)) continue;
            pending.results.push(item);
          }
          continue;
        }
        if (block.type === 'fetch') {
          const urls = block.urls || [];
          if (!urls.length) continue;
          if (pending) {
            steps.push(pending);
            pending = null;
          }
          const previous = steps[steps.length - 1];
          const target = previous && previous.kind === 'open'
            ? previous
            : { kind: 'open', queries: [], results: [], urls: [] };
          if (target !== previous) steps.push(target);
          for (let j = 0; j < urls.length; j += 1) {
            if (target.urls.indexOf(urls[j]) < 0) target.urls.push(urls[j]);
          }
        }
      }
      if (pending) steps.push(pending);
      return steps;
    }

    /** Every distinct result a reply collected, in the order the service sent them. */
    function collectSources(blocks) {
      const sources = [];
      const seen = {};
      for (let i = 0; i < (blocks || []).length; i += 1) {
        const block = blocks[i];
        if (block.type !== 'sources') continue;
        for (let j = 0; j < block.items.length; j += 1) {
          const item = block.items[j];
          if (seen[item.url]) continue;
          seen[item.url] = true;
          sources.push(item);
        }
      }
      return sources;
    }

    /** Published dates arrive as ISO strings; the demo shows YYYY/MM/DD. */
    function formatDate(value) {
      if (!value) return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      const pad = (number) => (number < 10 ? '0' + number : String(number));
      return date.getFullYear() + '/' + pad(date.getMonth() + 1) + '/' + pad(date.getDate());
    }

    /** One result card: site, date, title, and a two-line snippet, all linking out. */
    function SourceCard(props) {
      const { source } = props;
      return h('a', {
        className: 'dsc-sourceCard',
        href: source.url,
        target: '_blank',
        rel: 'noreferrer noopener',
        title: source.title || source.url,
      },
        h('div', { className: 'dsc-sourceMeta' },
          h(SiteDot, { name: source.site || hostOf(source.url) }),
          h('span', { className: 'dsc-sourceSite' }, source.site || hostOf(source.url)),
          source.date ? h('span', { className: 'dsc-sourceDate' }, formatDate(source.date)) : null),
        h('div', { className: 'dsc-sourceTitle' }, source.title || source.url),
        source.snippet
          ? h('div', { className: 'dsc-sourceSnippet' }, clipSnippet(source.snippet))
          : null);
    }

    /** One opened page as a link row; its title comes from the matching result. */
    function PageRow(props) {
      const { url, source } = props;
      return h('a', {
        className: 'dsc-pageRow',
        href: url,
        target: '_blank',
        rel: 'noreferrer noopener',
        title: url,
      },
        h(SiteDot, { name: (source && source.site) || hostOf(url) }),
        h('span', { className: 'dsc-pageTitle' }, (source && source.title) || hostOf(url)),
        h('span', { className: 'dsc-pageArrow', 'aria-hidden': true }, '↗'));
    }

    /**
     * The summary row above a reply: site chips, how many pages were read, and
     * a chevron that opens the search drawer. Live while the reply streams.
     */
    function SearchTrail(props) {
      const { steps, sources, streaming, open, onToggle, t } = props;
      const pending = steps.find((step) => step.kind === 'search' && !step.results.length);
      const query = pending && pending.queries.length ? pending.queries[0] : '';
      const searching = Boolean(streaming && query);
      const count = sources.length;
      if (!count && !searching && !steps.length) return null;
      const chips = sources.slice(0, 4);
      return h('button', {
        type: 'button',
        className: 'dsc-trail',
        'data-open': open ? 'true' : 'false',
        'data-live': searching ? 'true' : 'false',
        'aria-expanded': open ? 'true' : 'false',
        title: t('searchResult'),
        onClick: onToggle,
      },
        searching ? h('span', { className: 'dsc-liveDot' }) : null,
        chips.length
          ? h('span', { className: 'dsc-trailSites' }, chips.map((source, index) => h(SiteDot, {
            key: source.url,
            name: source.site || hostOf(source.url),
            index,
          })))
          : null,
        h('span', { className: 'dsc-trailLabel' },
          searching ? t('searchingFor').replace('{query}', query) : t('sourceCount').replace('{count}', String(count))),
        h('span', { className: 'dsc-trailChevron', 'aria-hidden': true }, '›'));
    }

    /**
     * The search drawer: every query that ran, every page that was read, with
     * links out. Rendered as a column beside the thread, like the demo's panel.
     */
    function SourcesDrawer(props) {
      const { steps, sources, streaming, t, onClose } = props;
      const byUrl = {};
      for (let i = 0; i < sources.length; i += 1) byUrl[sources[i].url] = sources[i];
      const rows = [];
      for (let i = 0; i < steps.length; i += 1) {
        const step = steps[i];
        if (step.kind === 'search') {
          rows.push(h('div', { key: 's' + i, className: 'dsc-drawerGroup' },
            step.queries.length
              ? h('div', { className: 'dsc-drawerQueries' }, step.queries.map((query, index) => h('span', {
                key: 'q' + index,
                className: 'dsc-queryChip',
              }, query)))
              : null,
            step.results.length
              ? step.results.map((source) => h(SourceCard, { key: source.url, source }))
              : h('div', { className: 'dsc-drawerEmpty' }, streaming ? t('searching') : t('searchNoResult'))));
          continue;
        }
        rows.push(h('div', { key: 'o' + i, className: 'dsc-drawerGroup' },
          h('div', { className: 'dsc-drawerLabel' }, t('readPages')),
          step.urls.map((url) => h(PageRow, { key: url, url, source: byUrl[url] }))));
      }
      return h('aside', { className: 'dsc-drawer' },
        h('div', { className: 'dsc-drawerHead' },
          h('span', { className: 'dsc-drawerTitle' }, t('searchResult')),
          h('button', {
            type: 'button',
            className: 'dsc-iconButton',
            title: t('close'),
            'aria-label': t('close'),
            onClick: onClose,
          }, h(CloseIcon))),
        h('div', { className: 'dsc-drawerBody' }, rows.length ? rows : h('div', { className: 'dsc-drawerEmpty' }, t('searching'))));
    }

    /** Human-readable file size. */
    function formatSize(bytes) {
      const size = Number(bytes) || 0;
      if (size < 1024) return size + ' B';
      const units = ['KB', 'MB', 'GB'];
      let value = size / 1024;
      let unit = 0;
      while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
      }
      return (value < 10 ? value.toFixed(1) : Math.round(value)) + ' ' + units[unit];
    }

    /** One queued attachment above the textarea: name, state, retry, remove. */
    function AttachmentChip(props) {
      const { item, t, onRemove, onRetry } = props;
      const failed = item.status === 'error';
      return h('span', { className: 'dsc-attachment', 'data-status': item.status, title: failed ? item.error : item.name },
        h('span', { className: 'dsc-attachmentGlyph' }, item.isImage ? h(ImageIcon) : h(FileIcon)),
        h('span', { className: 'dsc-attachmentName' }, item.name),
        h('span', { className: 'dsc-attachmentMeta' },
          item.status === 'uploading' ? t('uploading') : failed ? t('uploadFailed') : formatSize(item.size)),
        failed
          ? h('button', {
            type: 'button',
            className: 'dsc-attachmentAction',
            title: t('uploadRetry'),
            'aria-label': t('uploadRetry'),
            onClick: onRetry,
          }, h(RefreshIcon))
          : null,
        h('button', {
          type: 'button',
          className: 'dsc-attachmentAction',
          title: t('removeAttachment'),
          'aria-label': t('removeAttachment'),
          onClick: onRemove,
        }, h(CloseIcon)));
    }

    /** A read-only attachment card inside a sent message. */
    function FileChip(props) {
      const { item, t } = props;
      return h('span', { className: 'dsc-fileChip', title: item.name },
        h('span', { className: 'dsc-fileGlyph' }, h(FileIcon)),
        h('span', { className: 'dsc-fileName' }, item.name),
        h('span', { className: 'dsc-fileSize' }, item.isImage ? t('image') : formatSize(item.size)));
    }

    /** One user turn: attachments above the text, right-aligned. */
    function UserMessage(props) {
      const { message, t } = props;
      const items = message.attachments || [];
      return h('div', { className: 'dsc-userRow' },
        h('div', { className: 'dsc-userBubble' },
          items.length
            ? h('div', { className: 'dsc-userFiles' }, items.map((item) => h(FileChip, { key: item.id, item, t })))
            : null,
          message.text ? h('div', { className: 'dsc-userText' }, message.text) : null));
    }

    /** One assistant message rendered from its streamed blocks. */
    function AssistantMessage(props) {
      const { message, streaming, isLast, onRegenerate, canRegenerate, onSpeak, speaking, speakPending, t, onOpenSources, onOpenSettings, onSwitchVersion } = props;
      const [copied, setCopied] = useState(false);
      const [reasonOpen, setReasonOpen] = useState(true);
      const versions = Array.isArray(message.versions) && message.versions.length ? message.versions : [{ blocks: message.blocks || [] }];
      const versionIndex = typeof message.versionIndex === 'number' ? message.versionIndex : versions.length - 1;
      const blocks = message.blocks || [];
      const answer = assistantText(message);
      const copy = useCallback(() => {
        copyText(answer).then((ok) => {
          if (!ok) return;
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        });
      }, [answer]);
      const hasBody = Boolean(answer.trim());
      const steps = buildSteps(blocks);
      const sources = collectSources(blocks);
      const citeIndex = {};
      let cites = 0;
      for (let i = 0; i < blocks.length; i += 1) {
        const list = blocks[i].citations || [];
        for (let j = 0; j < list.length; j += 1) {
          if (citeIndex[list[j].url]) continue;
          cites += 1;
          citeIndex[list[j].url] = cites;
        }
      }
      const byUrl = {};
      for (let i = 0; i < sources.length; i += 1) byUrl[sources[i].url] = sources[i];
      // The service splits a reply into one text block per citation. Joining them
      // again keeps the sentences — and the punctuation after a citation — inline.
      let source = '';
      for (let i = 0; i < blocks.length; i += 1) {
        const block = blocks[i];
        if (block.type !== 'text' || !block.text) continue;
        source += block.text;
        const list = block.citations || [];
        for (let j = 0; j < list.length; j += 1) {
          const number = citeIndex[list[j].url];
          if (!number) continue;
          source += '[c' + number + '](cite:' + encodeURIComponent(list[j].url) + ')';
        }
      }
      const body = source
        ? h('div', { className: 'dsc-botBody' },
          renderMarkdown(source, t, message.id, byUrl),
          streaming ? h('span', { className: 'dsc-caret' }) : null)
        : streaming ? h('div', { className: 'dsc-botBody' }, h('span', { className: 'dsc-caret' })) : null;
      const notice = describeReply(message, t);
      return h('div', { className: 'dsc-botRow' },
        h('div', { className: 'dsc-botHead' },
          h('span', { className: 'dsc-botMark' }, h(BrandMark, { size: 16 })),
          h('span', { className: 'dsc-botName' }, t('assistantName'))),
        h(ReasoningArea, {
          blocks,
          steps,
          streaming,
          hasAnswer: hasBody,
          now: streaming ? Date.now() : (message.updatedAt || Date.now()),
          t,
          onOpenSources: onOpenSources,
          open: reasonOpen,
          onToggle: () => setReasonOpen(!reasonOpen),
        }),
        body,
        notice ? h('div', { className: 'dsc-noticeLine', role: 'alert', 'data-error': notice.error ? 'true' : 'false' },
          notice.error ? h(WarningIcon) : null,
          h('span', null, notice.text),
          notice.action === 'apiKey'
            ? h('button', { type: 'button', className: 'dsc-noticeAction', onClick: onOpenSettings }, t('changeApiKey'))
            : null,
          notice.action === 'topUp'
            ? h('a', { className: 'dsc-noticeAction', href: TOP_UP_URL, target: '_blank', rel: 'noreferrer noopener' }, t('topUp'))
            : null,
          notice.retry
            ? h('button', { type: 'button', className: 'dsc-noticeAction', onClick: onRegenerate }, t('retry'))
            : null) : null,
        hasBody && !streaming
          ? h('div', { className: 'dsc-botFoot', 'data-last': isLast ? 'true' : 'false' },
            versions.length > 1
              ? h('span', { className: 'dsc-versions' },
                h('button', {
                  type: 'button',
                  className: 'dsc-versionArrow',
                  title: t('previousVersion'),
                  'aria-label': t('previousVersion'),
                  disabled: versionIndex <= 0,
                  onClick: () => onSwitchVersion(-1),
                }, '‹'),
                h('span', { className: 'dsc-versionLabel' }, (versionIndex + 1) + ' / ' + versions.length),
                h('button', {
                  type: 'button',
                  className: 'dsc-versionArrow',
                  title: t('nextVersion'),
                  'aria-label': t('nextVersion'),
                  disabled: versionIndex >= versions.length - 1,
                  onClick: () => onSwitchVersion(1),
                }, '›'))
              : null,
            h('button', {
              type: 'button',
              className: 'dsc-plainAction',
              disabled: speakPending,
              title: speaking ? t('stopReading') : t('speak'),
              onClick: onSpeak,
            }, speaking ? t('stopReading') : speakPending ? '…' : t('speak')),
            h('button', { type: 'button', className: 'dsc-plainAction', onClick: copy }, copied ? t('copied') : t('copy')),
            canRegenerate ? h('button', { type: 'button', className: 'dsc-plainAction', onClick: onRegenerate }, t('regenerate')) : null)
          : null);
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
    /** A small confirmation dialog; used before deleting a conversation. */
    function ConfirmDialog(props) {
      const { title, body, confirmLabel, t, onConfirm, onCancel } = props;
      return h('div', { className: 'dsc-dialogBackdrop', onClick: onCancel },
        h('div', {
          className: 'dsc-dialog',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': title,
          onClick: (event) => event.stopPropagation(),
        },
          h('div', { className: 'dsc-dialogHead' },
            h('h2', { className: 'dsc-dialogTitle' }, title),
            h('button', {
              type: 'button',
              className: 'dsc-iconButton',
              title: t('close'),
              'aria-label': t('close'),
              onClick: onCancel,
            }, h(CloseIcon))),
          h('p', { className: 'dsc-dialogHint' }, body),
          h('div', { className: 'dsc-dialogFoot' },
            h('span', { className: 'dsc-spacer' }),
            h('button', { type: 'button', className: 'dsc-button', onClick: onCancel }, t('cancel')),
            h('button', {
              type: 'button',
              className: 'dsc-button',
              'data-primary': 'true',
              onClick: onConfirm,
            }, confirmLabel))));
    }

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
      const [attachments, setAttachments] = useState([]);
      const [dragging, setDragging] = useState(false);
      const [drawerId, setDrawerId] = useState(null);
      const [pendingDelete, setPendingDelete] = useState(null);
      const [ttsId, setTtsId] = useState(null);
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
      const dragDepthRef = useRef(0);
      const narrow = useMediaQuery('(max-width: 760px)');
      const compact = useMediaQuery('(max-width: 900px)');

      const active = useMemo(
        () => conversations.find((item) => item.id === activeId) || null,
        [conversations, activeId],
      );
      const busy = streamingId !== null;
      const uploading = attachments.some((item) => item.status === 'uploading');

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
       * Stream one reply and fold its events into the message.
       * @param conversationId - conversation owning the reply.
       * @param messageId - placeholder message that receives the blocks.
       * @param messages - request messages built by `requestMessages`.
       * @param search - declare the server-side web search tool.
       */
      const runReply = useCallback(async (conversationId, messageId, messages, search) => {
        const controller = new AbortController();
        abortRef.current = controller;
        setStreamingId(messageId);
        stickRef.current = true;
        let blocks = [];
        let stopReason = '';
        const indexes = new Map();
        try {
          for await (const event of streamMessage({ settings, messages, search, signal: controller.signal })) {
            if (event.type === 'message_delta' && event.delta && typeof event.delta.stop_reason === 'string') {
              stopReason = event.delta.stop_reason;
            }
            const next = applyStreamEvent(blocks, indexes, event);
            if (next !== blocks) {
              blocks = next;
              patchMessage(conversationId, messageId, (message) => Object.assign({}, message, { blocks }));
            }
          }
          patchMessage(conversationId, messageId, (message) => patchVersion(message, { blocks, status: 'done', stopReason }));
        } catch (error) {
          const aborted = Boolean(error && error.name === 'AbortError');
          patchMessage(conversationId, messageId, (message) => patchVersion(message, {
            blocks,
            status: aborted ? 'stopped' : 'error',
            error: aborted ? '' : (error && error.message ? error.message : String(error)),
          }));
        } finally {
          abortRef.current = null;
          setStreamingId(null);
        }
      }, [patchMessage, settings]);

      const findConversation = useCallback((id) => conversations.find((item) => item.id === id) || null, [conversations]);

      const send = useCallback((textInput) => {
        const text = String(textInput === undefined ? draft : textInput).trim();
        const ready = attachments.filter((item) => item.status === 'done' && item.fileId);
        if ((!text && !ready.length) || busy || uploading) return;
        if (!String(settings.apiKey).trim()) {
          setNotice(t('missingKey'));
          setSettingsOpen(true);
          return;
        }
        const userMessage = {
          id: uid(),
          role: 'user',
          text,
          attachments: ready.map(attachmentMeta),
        };
        const botMessage = { id: uid(), role: 'assistant', blocks: [], status: 'streaming', error: '' };
        const target = activeId ? findConversation(activeId) : null;
        const title = titleFrom(text || (ready[0] ? ready[0].name : ''));
        let conversationId = activeId;
        let history = [];
        if (target) {
          history = target.messages;
          updateConversation(target.id, (item) => Object.assign({}, item, {
            title: item.title || title,
            updatedAt: Date.now(),
            messages: item.messages.concat([userMessage, botMessage]),
          }));
        } else {
          conversationId = uid();
          const created = {
            id: conversationId,
            title,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: [userMessage, botMessage],
          };
          setConversations((previous) => [created].concat(previous));
          setActiveId(conversationId);
        }
        const request = requestMessages(history, userMessage, t('send') === 'Send');
        setDraft('');
        setAttachments([]);
        setNotice('');
        stickRef.current = true;
        runReply(conversationId, botMessage.id, request, settings.webSearch);
        window.setTimeout(() => {
          const node = inputRef.current;
          if (node) node.focus();
        }, 0);
      }, [activeId, attachments, busy, draft, findConversation, runReply, settings.apiKey, settings.webSearch, t, updateConversation, uploading]);

      /** Show the previous or next answer version of one turn. */
      const switchVersion = useCallback((conversationId, messageId, direction) => {
        patchMessage(conversationId, messageId, (message) => {
          const versions = message.versions || [];
          const index = typeof message.versionIndex === 'number' ? message.versionIndex : 0;
          const next = index + direction;
          if (next < 0 || next >= versions.length) return message;
          const slot = versions[next];
          return Object.assign({}, message, {
            versionIndex: next,
            blocks: slot.blocks || [],
            status: slot.status || 'done',
            stopReason: slot.stopReason || '',
            error: slot.error || '',
          });
        });
      }, [patchMessage]);

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

      /** Current attachments, readable from event handlers without stale closures. */
      const attachmentsRef = useRef(attachments);
      attachmentsRef.current = attachments;

      const removeAttachment = useCallback((id) => {
        setAttachments((previous) => previous.filter((item) => item.id !== id));
      }, []);

      /** Upload one attachment and record its server id or failure. */
      const uploadOne = useCallback(async (item) => {
        try {
          const fileId = await uploadAttachment({ settings, file: item.file });
          setAttachments((previous) => previous.map((current) => (current.id === item.id
            ? Object.assign({}, current, { status: 'done', fileId, error: '' })
            : current)));
        } catch (error) {
          if (error && error.name === 'AbortError') return;
          setAttachments((previous) => previous.map((current) => (current.id === item.id
            ? Object.assign({}, current, {
              status: 'error',
              error: error && error.message ? error.message : String(error),
            })
            : current)));
        }
      }, [settings]);

      /** Validate a batch, queue it, and start its uploads. */
      const addFiles = useCallback((fileList) => {
        const files = Array.prototype.slice.call(fileList || []).filter(Boolean);
        if (!files.length) return;
        if (!String(settings.apiKey).trim()) {
          setNotice(t('missingKey'));
          setSettingsOpen(true);
          return;
        }
        const next = attachmentsRef.current.slice();
        const queued = [];
        let problem = '';
        for (let i = 0; i < files.length; i += 1) {
          const file = files[i];
          if (next.length >= MAX_ATTACHMENTS) {
            problem = t('attachTooMany').replace('{count}', String(MAX_ATTACHMENTS));
            break;
          }
          const image = isImageFile(file);
          if (!image && ACCEPTED_EXTS.indexOf(fileExt(file.name)) < 0) {
            problem = t('attachUnsupported') + ': ' + (file.name || '');
            continue;
          }
          const limit = maxSizeMb(file);
          if (file.size > limit * 1024 * 1024) {
            problem = t('attachTooLarge').replace('{size}', String(limit));
            continue;
          }
          const item = {
            id: uid(),
            name: file.name || 'file',
            size: file.size,
            isImage: image,
            status: 'uploading',
            fileId: '',
            error: '',
            file,
          };
          next.push(item);
          queued.push(item);
        }
        if (problem) setNotice(problem);
        if (!queued.length) return;
        setAttachments(next);
        for (let i = 0; i < queued.length; i += 1) uploadOne(queued[i]);
      }, [settings, t, uploadOne]);

      const retryAttachment = useCallback((item) => {
        if (!item || !item.file) return;
        setAttachments((previous) => previous.map((current) => (current.id === item.id
          ? Object.assign({}, current, { status: 'uploading', error: '' })
          : current)));
        uploadOne(item);
      }, [uploadOne]);

      /** Files carried by one clipboard or drag payload, if any. */
      const payloadFiles = useCallback((data) => {
        if (!data) return [];
        if (data.files && data.files.length) return Array.prototype.slice.call(data.files);
        const items = data.items;
        if (!items) return [];
        const files = [];
        for (let i = 0; i < items.length; i += 1) {
          if (items[i].kind !== 'file') continue;
          const file = items[i].getAsFile();
          if (file) files.push(file);
        }
        return files;
      }, []);

      const onComposerPaste = useCallback((event) => {
        const files = payloadFiles(event.clipboardData);
        if (!files.length) return;
        event.preventDefault();
        addFiles(files);
      }, [addFiles, payloadFiles]);

      const onDragEnter = useCallback((event) => {
        if (!event.dataTransfer || Array.prototype.indexOf.call(event.dataTransfer.types, 'Files') < 0) return;
        event.preventDefault();
        dragDepthRef.current += 1;
        setDragging(true);
      }, []);

      const onDragOver = useCallback((event) => {
        if (!event.dataTransfer || Array.prototype.indexOf.call(event.dataTransfer.types, 'Files') < 0) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }, []);

      const onDragLeave = useCallback((event) => {
        if (!event.dataTransfer || Array.prototype.indexOf.call(event.dataTransfer.types, 'Files') < 0) return;
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setDragging(false);
      }, []);

      const onDrop = useCallback((event) => {
        if (!event.dataTransfer) return;
        event.preventDefault();
        dragDepthRef.current = 0;
        setDragging(false);
        const files = payloadFiles(event.dataTransfer);
        if (files.length) addFiles(files);
      }, [addFiles, payloadFiles]);

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
        const text = readableText(assistantText(message));
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
        const messages = conversation.messages;
        const lastIndex = messages.length - 1;
        const last = messages[lastIndex];
        if (!last || last.role !== 'assistant') return;
        const question = messages[lastIndex - 1];
        if (!question || question.role !== 'user') return;
        const request = requestMessages(messages.slice(0, lastIndex - 1), question, t('send') === 'Send');
        patchMessage(conversation.id, last.id, (message) => {
          const versions = Array.isArray(message.versions) && message.versions.length
            ? message.versions.slice()
            : [{
              blocks: message.blocks || [],
              status: message.status || 'done',
              stopReason: message.stopReason || '',
              error: message.error || '',
            }];
          versions.push({ blocks: [], status: 'streaming', stopReason: '', error: '' });
          const index = versions.length - 1;
          return Object.assign({}, message, {
            versions,
            versionIndex: index,
            blocks: [],
            status: 'streaming',
            stopReason: '',
            error: '',
          });
        });
        runReply(conversation.id, last.id, request, settings.webSearch);
      }, [busy, patchMessage, runReply, settings.webSearch]);

      const startNewChat = useCallback(() => {
        const created = { id: uid(), title: '', createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
        setConversations((previous) => [created].concat(previous));
        setActiveId(created.id);
        setDraft('');
        setNotice('');
        setDrawerId(null);
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
        setDrawerId(null);
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
            : groupConversations(conversations, t).map((group) => h('div', { key: group.key, className: 'dsc-railGroup' },
              h('div', { className: 'dsc-railGroupLabel' }, group.label),
              group.items.map((conversation) => h(ConversationRow, {
                key: conversation.id,
                conversation,
                active: conversation.id === activeId,
                renaming: conversation.id === renamingId,
                t,
                onSelect: () => {
                  setActiveId(conversation.id);
                  setDrawerId(null);
                  if (narrow) setRailOpen(false);
                },
                onStartRename: () => setRenamingId(conversation.id),
                onCommitRename: (value) => commitRename(conversation.id, value),
                onCancelRename: () => setRenamingId(null),
                onDelete: () => setPendingDelete(conversation.id),
              }))))),
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
            return h('div', { key: message.id, className: 'dsc-turn dsc-turnUser' }, h(UserMessage, { message, t }));
          }
          return h('div', { key: message.id, className: 'dsc-turn' },
            h(AssistantMessage, {
              message,
              streaming: message.id === streamingId,
              canRegenerate,
              isLast: canRegenerate,
              onRegenerate: () => regenerate(active),
              onSpeak: () => toggleSpeak(message),
              speaking: ttsId === message.id,
              speakPending: ttsPendingId === message.id,
              onOpenSources: () => setDrawerId((current) => (current === message.id ? null : message.id)),
              onSwitchVersion: (direction) => switchVersion(active.id, message.id, direction),
              onOpenSettings: () => setSettingsOpen(true),
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
        attachments.length
          ? h('div', { className: 'dsc-attachments' }, attachments.map((item) => h(AttachmentChip, {
            key: item.id,
            item,
            t,
            onRemove: () => removeAttachment(item.id),
            onRetry: () => retryAttachment(item),
          })))
          : null,
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
              title: t('attachHint').replace('{count}', String(MAX_ATTACHMENTS)).replace('{size}', String(MAX_FILE_MB)),
              onClick: () => {
                const node = fileRef.current;
                if (node) node.click();
              },
            },
              uploading ? h('span', { className: 'dsc-spinner' }) : h(PaperclipIcon),
              h('span', { className: 'dsc-toolLabel' }, t('attach'))),
            h('input', {
              ref: fileRef,
              type: 'file',
              multiple: true,
              accept: ACCEPTED_EXTS.map((ext) => '.' + ext).join(','),
              style: { display: 'none' },
              onChange: (event) => {
                addFiles(event.target.files);
                event.target.value = '';
              },
            })),
          h('span', { className: 'dsc-composerHint' }, draft.trim() || attachments.length ? '' : t('welcomeHint')),
          busy
            ? h('button', {
              type: 'button',
              className: 'dsc-send',
              'data-stop': 'true',
              title: t('stopGenerating'),
              'aria-label': t('stopGenerating'),
              onClick: stop,
            }, h(StopIcon))
            : h('button', {
              type: 'button',
              className: 'dsc-send',
              title: t('send'),
              'aria-label': t('send'),
              disabled: (!draft.trim() && !attachments.length) || uploading,
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
            (active && active.title) || t('untitled'),
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
          composer,
          h('div', { className: 'dsc-caveat' }, t('caveat'))));

      const drawerMessage = drawerId ? messages.find((message) => message.id === drawerId) : null;
      const drawer = drawerMessage
        ? h(SourcesDrawer, {
          steps: buildSearchSteps(drawerMessage.blocks || []),
          sources: collectSources(drawerMessage.blocks || []),
          streaming: drawerMessage.id === streamingId,
          t,
          onClose: () => setDrawerId(null),
        })
        : null;

      return h('div', {
        className: 'dsc-root',
        onDragEnter,
        onDragOver,
        onDragLeave,
        onDrop,
      },
        h('style', { dangerouslySetInnerHTML: { __html: CSS } }),
        railOpen && narrow ? h('div', { className: 'dsc-scrim', onClick: () => setRailOpen(false) }) : null,
        rail,
        chatColumn,
        drawer,
        drawer && compact ? h('div', { className: 'dsc-drawerScrim', onClick: () => setDrawerId(null) }) : null,
        dragging
          ? h('div', { className: 'dsc-dropMask' },
            h('div', { className: 'dsc-dropCard' },
              h('span', { className: 'dsc-dropIcon' }, h(PaperclipIcon)),
              h('span', { className: 'dsc-dropTitle' }, t('dropHere')),
              h('span', { className: 'dsc-dropHint' }, t('attachHint').replace('{count}', String(MAX_ATTACHMENTS)).replace('{size}', String(MAX_FILE_MB)))))
          : null,
        pendingDelete
          ? h(ConfirmDialog, {
            title: t('deleteTitle'),
            body: t('deleteBody'),
            confirmLabel: t('deleteConfirm'),
            t,
            onCancel: () => setPendingDelete(null),
            onConfirm: () => {
              deleteConversation(pendingDelete);
              setPendingDelete(null);
            },
          })
          : null,
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
