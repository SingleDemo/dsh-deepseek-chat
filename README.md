# DeepSeek chat — a DSH plugin

A left-sidebar entry and a main-area page that bring the DeepSeek chat
experience of [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)
into the DeepSeek Harness Web GUI.

The page is a focused, self-contained chat client: conversations on the left,
a thread with streamed Markdown replies in the middle, and one composer at the
bottom. It speaks the same Anthropic-compatible Messages surface as the demo —
`/anthropic/v1/messages` plus the Files API — from the browser with your own
key, and keeps conversations in `localStorage`.

Replies can be edited and continued, regenerated answers keep switchable
versions, the key can be verified before it is used, Settings exports and
imports the archive as JSON, and answers render KaTeX math and Mermaid
diagrams. Requests never go through the DSH Host.

![The chat panel: a conversation rail, a search-backed answer with citations, and the composer toolbar](docs/screenshots/answer.png)

| New chat | Settings |
| --- | --- |
| ![The empty panel with the assistant above the composer](docs/screenshots/welcome.png) | ![The settings dialog with key verification, connection, location, voice, and data management](docs/screenshots/settings.png) |

## Where it appears

- **Left sidebar** — a chat glyph labelled *DeepSeek chat* (中文：*DeepSeek 对话*).
  Selecting it opens the panel.
- **Main area** — the panel itself, replacing the conversation view until you
  return. The back chevron at the top-left of the panel, or any Session row in
  the DSH sidebar, returns to the conversation.
- **Plugins page** — this bundle's row, description, and detail preview.

## Use it

1. Open **Settings** (the gear at the top-right of the panel, or at the foot of
   the conversation rail) and paste your DeepSeek API key (`sk-…`). **Verify**
   checks it against the free `GET /models` endpoint and reports
   *Verifying…* → *Key works* (or the reason it does not) without spending a
   completion.
2. Adjust the **API base URL** (`https://api.deepseek.com` by default), the
   **model** (`deepseek-flash` by default), the read-aloud **voice**, and — if
   you want answers to know your local time and place — the optional
   **location**.
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
| **Microphone** | Records up to 110 seconds, transcribes it with ASR, and drops the text into the draft. The button and the hint above it walk through the states: *Listening… tap to stop*, *Recording 12s*, *Stop and transcribe*, then *Transcribing… tap to cancel*; permission, device, length, and failure errors are reported inline. |
| **Add files** | Same as drag, paste, or the picker: up to 10 attachments per message, 64 MB each (32 MB for plain-text uploads). |
| **Read aloud** | On each answer: synthesizes speech with TTS and plays it; while it plays the button shows animated sound bars and becomes **Stop reading**. |

Before the first token of an answer the thread shows the waiting state — three
bouncing dots in place of the text — so the panel is never blank while the
service thinks.

Above each answer that used the web, a pill shows the sites it read and how many
pages it collected. Selecting the pill opens the **search drawer** — the same
idea as the demo's right-hand panel:

![The search drawer listing the queries that ran, the results, and every page the model read](docs/screenshots/search-drawer.png)

The drawer lists the queries that actually ran, one card per result (site,
date, title, snippet), and the pages the model opened. Every row is a link that
opens in a new tab, and the list fills in while the reply is still streaming —
so you can watch the search happen instead of waiting for the answer.

With thinking on, the reasoning is drawn as a **timeline**: a header such as
*Thought for 3 s*, then one row per search, page read, or reasoning step, in
the order they happened. The timeline is collapsible and stays attached to the
answer it belongs to.

![The reasoning timeline above an answer: searches, page reads, and the reasoning steps in order](docs/screenshots/timeline.png)

## Edit, continue, and versions

- Every user message shows **Edit message** on hover while the panel is idle.
  Choosing it puts the text back in the composer; sending replaces that turn
  and deletes every reply after it (see *Known limits* — this version does not
  keep the demo's switchable branches).
- A reply that stopped early — you pressed **Stop**, or the service hit its
  output limit — offers **Continue generating**. It re-asks with the answer so
  far as an assistant prefill and appends the continuation to the same message.
  Replies that used server tools (search, link reading) do not offer it.
- **Regenerate** keeps the old answer instead of overwriting it: the `‹ 1 / 2 ›`
  pager under the reply switches versions, so you can compare two attempts in
  place. Versions are stored with the conversation.

![A regenerated answer with its 1 / 2 version pager next to the answer actions](docs/screenshots/versions.png)

Each reply also offers **Copy** and **Read aloud**. Conversations are created
automatically on the first message, titled from its first words, and support
rename, delete, and the bulk actions in Settings.

## Math and diagrams

- KaTeX renders inline `$…$` and `\(…\)` and block `$$…$$` and `\[…\]` in
  answers. The stylesheet and script are loaded lazily from jsDelivr the first
  time a reply needs them.
- A fenced ` ```mermaid ` block renders as a diagram with a **Chart / Code**
  switch, plus inline *Rendering the chart…* and *Could not render this chart*
  states.
- If the CDN cannot be reached, formulas stay as their source text and a
  diagram falls back to the code view, so the answer is still readable.

![A reply with an inline formula, a block formula, and a Mermaid flow chart with its Chart / Code switch](docs/screenshots/math.png)

## Settings, data, and location

The Settings dialog has four sections:

- **Connection** — API key (stored masked in `localStorage`), **Verify**, API
  base URL, model, and the optional **location**.
- **Location** — free text such as `中国 · 安徽 · 合肥`. It is written into the
  `latest_reminder` row of every Messages request (date, weekday, location,
  platform, language), so answers can use your local time and place. Empty is
  fine.
- **Speech** — the TTS voice.
- **Data** — **Download** exports every conversation as one JSON file; **Choose
  file** imports a file exported by this plugin after a confirmation and
  replaces all conversations in this browser; **Delete all conversations**
  asks for a second tap, then clears them. The export never contains the API
  key.

## Features

- Streaming replies over the Messages API, folded from `content_block_delta`
  events, with a stop control, a three-dot waiting state before the first
  token, and inline error text.
- Editing, continuation, regeneration, and switchable answer versions, as
  described above.
- Thinking mode: reasoning on/off plus effort off / low / high / max, with the
  reasoning shown as a collapsible timeline.
- Attachments through `/anthropic/v1/files`: images become `image` blocks,
  PDFs/Word/PowerPoint upload for page layout recognition and become `document`
  blocks, everything else uploads as user data. File chips show upload state and
  can be retried or removed; sent messages keep their chips.
- Native web tools: `deepseek_web_search` (toggled) and `deepseek_read_url`,
  with inline citation chips, a page-count pill, and a drawer that shows every
  query, result card, and opened page with live updates while streaming.
- Math and diagrams: KaTeX and Mermaid, lazy-loaded from the CDN, with source
  and code fallbacks and a Chart / Code switch.
- Speech: `/v1/tools/asr` for voice input (Ogg Opus, or WAV resampled to 16 kHz
  in the browser) with the demo's listening/recording/transcribing copy, and
  `/v1/tools/tts` for read-aloud with an animated waveform while it plays.
- Data management: JSON export, import with validation and overwrite, and
  delete-all in Settings.
- Markdown: headings, lists, quotes, tables, links, images, inline code, and
  fenced code blocks with theme-token highlighting and a copy button.
- Simplified Chinese and English through the host locale service; light and
  dark themes through the host design tokens.
- A conversation rail that becomes an overlay on narrow panels.

## Data and privacy

- The API key, base URL, model, voice, thinking level, location, and
  conversations live in this browser's `localStorage`
  (`dsh.deepseekChat.settings.v1`, `dsh.deepseekChat.conversations.v1`).
  Conversations store the file ids of their attachments, not the file bytes.
- The key is sent only to the configured API base URL, as the `x-api-key`
  header (and as a Bearer token for the one-time `/models` check). Nothing is
  sent to the DSH Host, and no other plugin reads it.
- Attachments, recordings, answer text for read-aloud, search queries, and the
  location hint go to the same API base URL and appear on your bill. Uploaded
  files stay on the API service; removing a chip only stops it from being sent.
- The search drawer only lists what the service returned: site initials are
  drawn locally, so opening it makes no extra network requests.
- **Download** writes DeepSeek's own history ZIP (`manifest.json` v3,
  `chat_sessions/*.json`, `chat_session_index.json`), so the file imports into
  DeepSeek too; the API key is never part of it. **Choose file** accepts a
  DeepSeek export ZIP (or an older JSON backup), replaces the conversations
  stored in this browser, and uploads nothing.
- Clearing site data, or **Delete all conversations** in Settings, removes the
  local conversations. Requests already sent to the API service are not
  recalled.
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
- `scripts/e2e/` — a CDP harness that drives the real DSH Web GUI, one check
  per feature, with PASS/FAIL and screenshots.

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
- Math and diagrams depend on the jsDelivr CDN (KaTeX 0.16.22 and mermaid
  11.10.1). Offline, a formula stays as its source text and a diagram falls back
  to the code view; the first reply that needs them waits for the download.
- Backups use DeepSeek's history ZIP format in both directions. Known losses:
  attachment image bytes are not written (our files stay on the API service, so
  the archive carries file names and sizes only), `TOOL_FIND` and
  `PARTIAL_FILE_READ` steps have no UI and are dropped, and reply branches are
  flattened to the selected path until branching support lands. Import replaces
  every conversation stored in this browser instead of merging, and rejects
  newer/incomplete/corrupt files. If `localStorage` is full the import fails with
  an incomplete-file notice and leaves the current archive in place.
- Editing a message deletes the answers after it. The demo keeps branches you
  can switch back to; this version is deliberately simpler, and only
  regenerated answers keep versions.
- Continue generation is offered only when a reply ended unfinished (you
  pressed Stop, or the service hit its output limit) and only if it used no
  server tools; the continuation can be cut short again.
- Verify checks the key against the free `GET /models` request; it proves the
  key is accepted, not that the model id or the account balance is usable.
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
