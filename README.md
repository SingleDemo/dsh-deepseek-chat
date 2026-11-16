# DeepSeek chat — a DSH plugin

A left-sidebar entry and a main-area page that bring the DeepSeek chat
experience of [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)
into the DeepSeek Harness Web GUI.

The page is a focused, self-contained chat client: conversations on the left,
a thread with streamed Markdown replies in the middle, and one composer at the
bottom. It speaks the same Anthropic-compatible Messages surface as the demo —
`/anthropic/v1/messages` plus the Files API — from the browser with your own
key, and keeps conversations in `localStorage`.

![The chat panel: a conversation rail, a search-backed answer with citations, and the composer toolbar](docs/screenshots/answer.png)

| New chat | Settings |
| --- | --- |
| ![The empty panel with the assistant above the composer](docs/screenshots/welcome.png) | ![The settings dialog with connection and speech sections](docs/screenshots/settings.png) |

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
4. Attach work the way the demo does: **drag files onto the panel**, **paste**
   them into the composer, or use the paperclip. Images and documents upload
   through the Files API and the model reads them directly — there is no
   separate OCR step.

The composer toolbar carries one control per capability:

| Control | What it does |
| --- | --- |
| **Web search** | Declares the server-side `deepseek_web_search` tool; the model decides when to search, answers with numbered citations, and the reply lists its sources. Link reading (`deepseek_read_url`) is always declared. |
| **Thinking · high** | Picks the reasoning strength: off, low, high, or max (`thinking` and `output_config.effort` on the Messages request). |
| **Microphone** | Records up to 110 seconds, transcribes it with ASR, and drops the text into the draft. |
| **Add files** | Same as drag, paste, or the picker: up to 10 attachments per message, 64 MB each (32 MB for plain-text uploads). |
| **Read aloud** | On each answer: synthesizes speech with TTS and plays it; press again to stop. |

Above each answer that used the web, a pill shows the sites it read and how many
pages it collected. Selecting the pill opens the **search drawer** — the same
idea as the demo's right-hand panel:

![The search drawer listing the queries that ran, the results, and every page the model read](docs/screenshots/search-drawer.png)

The drawer lists the queries that actually ran, one card per result (site,
date, title, snippet), and the pages the model opened. Every row is a link that
opens in a new tab, and the list fills in while the reply is still streaming —
so you can watch the search happen instead of waiting for the answer.

Conversations are created automatically on the first message, titled from its
first words, and can be renamed, deleted, or removed in bulk from Settings.
Each reply also offers **Copy** and **Regenerate**.

## Features

- Streaming replies over the Messages API, folded from `content_block_delta`
  events, with a stop control and inline error text.
- Thinking mode: reasoning on/off plus effort off / low / high / max, with the
  reasoning shown in a collapsible block.
- Attachments through `/anthropic/v1/files`: images become `image` blocks,
  PDFs/Word/PowerPoint upload for page layout recognition and become `document`
  blocks, everything else uploads as user data. File chips show upload state and
  can be retried or removed; sent messages keep their chips.
- Native web tools: `deepseek_web_search` (toggled) and `deepseek_read_url`,
  with inline citation chips, a page-count pill, and a drawer that shows every
  query, result card, and opened page with live updates while streaming.
- Speech: `/v1/tools/asr` for voice input (Ogg Opus, or WAV resampled to
  16 kHz in the browser) and `/v1/tools/tts` for read-aloud.
- Markdown: headings, lists, quotes, tables, links, images, inline code, and
  fenced code blocks with theme-token highlighting and a copy button.
- Simplified Chinese and English through the host locale service; light and
  dark themes through the host design tokens.
- A conversation rail that becomes an overlay on narrow panels.

## Data and privacy

- The API key, base URL, model, voice, thinking level, and conversations live
  in this browser's `localStorage` (`dsh.deepseekChat.settings.v1`,
  `dsh.deepseekChat.conversations.v1`). Conversations store the file ids of
  their attachments, not the file bytes.
- The key is sent only to the configured API base URL, as the `x-api-key`
  header. Nothing is sent to the DSH Host, and no other plugin reads it.
- Attachments, recordings, answer text for read-aloud, and search queries go to
  the same API base URL and appear on your bill. Uploaded files stay on the API
  service; removing a chip only stops it from being sent.
- The search drawer only lists what the service returned: site initials are
  drawn locally, so opening it makes no extra network requests.
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
- The plugin needs an API base URL that serves the Anthropic-compatible
  surface (`/anthropic/v1/messages`, `/anthropic/v1/files`); a proxy that only
  speaks OpenAI-style `/chat/completions` will not work.
- Web search, link reading, and document parsing are server-side: the model
  decides when to search, and search results stay out of later turns' context.
- Attachments are capped at 10 per message, 64 MB each (32 MB for plain-text
  uploads), by extension whitelist like the demo. Files already uploaded stay
  on the service even when removed from a message.
- Voice input needs microphone permission for the Harness window, and stops at
  110 seconds because the ASR endpoint accepts at most 120.
- Read-aloud speaks one answer at a time and caps the text at 9,000 characters.
- Chat history import/export, branching, and math/diagram rendering from the
  original demo are not part of this version.
- Long histories are kept whole in memory and in `localStorage`; very large
  archives can exceed the storage quota, in which case the newest state is
  kept in memory only.
- Direct browser calls require an API service that allows cross-origin
  requests from this GUI's origin. `api.deepseek.com` does for the Messages
  API, the Files API, search, OCR, ASR, and TTS.

## License

[MIT](LICENSE). The visual design follows the MIT-licensed
[deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo); its license
text is reproduced in [NOTICE](NOTICE).
