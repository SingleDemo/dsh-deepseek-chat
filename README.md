# DeepSeek chat — a DSH plugin

A left-sidebar entry and a main-area page that bring the DeepSeek chat
experience of [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)
into the DeepSeek Harness Web GUI.

The page is a focused, self-contained chat client: conversations on the left,
a thread with streamed Markdown replies in the middle, and one composer at the
bottom. It talks to the DeepSeek API directly from the browser with your own
key and keeps conversations in `localStorage`.

## Where it appears

- **Left sidebar** — a chat glyph labelled *DeepSeek chat* (中文：*DeepSeek 对话*).
  Selecting it opens the panel.
- **Main area** — the panel itself, replacing the conversation view until you
  return. The back chevron at the top-left of the panel, or any Session row in
  the DSH sidebar, returns to the conversation.
- **Plugins page** — this bundle's row, description, and detail preview.

## Use it

1. Open **Settings** (the gear at the top-right of the panel, or at the foot of
   the conversation rail) and paste your DeepSeek API key (`sk-…`).
2. Adjust the **API base URL** (`https://api.deepseek.com` by default), the
   **model** (`deepseek-flash` by default), and the read-aloud **voice**.
3. Type in the composer. **Enter** sends, **Shift+Enter** starts a new line.
   While a reply streams the send button becomes **Stop**.

The composer toolbar carries one control per capability:

| Control | What it does |
| --- | --- |
| **Web search** | Searches before answering and lists numbered sources under the reply; the model cites them as `[1]`, `[2]` links. |
| **Thinking · high** | Picks the reasoning strength: off, low, high, or max (`thinking` + `reasoning_effort` on the request). |
| **Microphone** | Records up to 110 seconds, transcribes it with ASR, and drops the text into the draft. |
| **Scan text (OCR)** | Reads a PDF, Word, PowerPoint, or image and puts the recognized text into the draft. Pasting an image does the same. |
| **Read aloud** | On each answer: synthesizes speech with TTS and plays it; press again to stop. |

Conversations are created automatically on the first message, titled from its
first words, and can be renamed, deleted, or removed in bulk from Settings.
Each reply also offers **Copy** and **Regenerate**.

## Features

- Streaming replies over SSE, with a stop control and inline error text.
- Thinking mode: reasoning effort off / low / high / max, with the reasoning
  shown in a collapsible block.
- Web search through `/v1/tools/search`: a numbered source list per answer and
  inline `[n]` citations that open the page.
- Speech: `/v1/tools/asr` for voice input (Ogg Opus, or WAV resampled to
  16 kHz in the browser) and `/v1/tools/tts` for read-aloud.
- OCR through `/v1/tools/ocr` for PDF, Word, PowerPoint, and images, by picker
  or clipboard paste.
- Markdown: headings, lists, quotes, tables, links, inline code, and fenced
  code blocks with a copy button.
- Simplified Chinese and English through the host locale service; light and
  dark themes through the host design tokens.
- A conversation rail that becomes an overlay on narrow panels.

## Data and privacy

- The API key, base URL, model, voice, thinking level, and conversations live
  in this browser's `localStorage` (`dsh.deepseekChat.settings.v1`,
  `dsh.deepseekChat.conversations.v1`).
- The key is sent only to the configured API base URL, as the `Authorization`
  header of each request. Nothing is sent to the DSH Host, and no other plugin
  reads it.
- Web search sends your question as the search `query`; OCR uploads the picked
  file; voice input uploads the recording; read-aloud uploads the answer text.
  All four go to the same API base URL and appear on your bill.
- Clearing site data, or **Delete all conversations** in Settings, removes the
  local data. Requests already sent to the API service are not recalled.
- Turning the plugin off hides the entry and the page; it does not delete the
  stored data.

## Install

From the DSH **Plugins** page choose **Add plugin** and install this directory,
or let an agent install it:

```
plugin_manager install_bundle target="<absolute path to this folder>"
```

The bundle is a plain package: no build step, no dependencies, no Host code.
`client.js` is a browser artifact that registers into `sidebar.panellist` and
`main`; `index.js` is an empty Host row that keeps the bundle valid.

## Development

- `node --check client.js` — syntax check the browser half.
- `scripts/smoke.cjs` — loads the module with a stubbed runtime, runs `apply`,
  and asserts both slot registrations plus every locale key used by the UI.

## Known limits

- One API key per browser profile; no per-conversation model.
- Web search is client-side: one `/v1/tools/search` call per message, then the
  results are passed to the model as context. The model does not decide when
  to search, and it cannot open pages beyond those snippets.
- Voice input needs microphone permission for the Harness window, and stops at
  110 seconds because the ASR endpoint accepts at most 120.
- OCR keeps only the recognized text; the original file is not stored.
- Read-aloud speaks one answer at a time and caps the text at 9,000 characters.
- Attachments, chat history import/export, and math/diagram rendering from the
  original demo are not part of this version.
- Long histories are kept whole in memory and in `localStorage`; very large
  archives can exceed the storage quota, in which case the newest state is
  kept in memory only.
- Direct browser calls require an API service that allows cross-origin
  requests from this GUI's origin. `api.deepseek.com` does for chat, search,
  OCR, ASR, and TTS.

## License

[MIT](LICENSE). The visual design follows the MIT-licensed
[deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo); its license
text is reproduced in [NOTICE](NOTICE).
