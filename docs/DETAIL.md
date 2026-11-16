# DeepSeek chat

A focused DeepSeek chat client inside the DeepSeek Harness Web GUI: a
conversation rail on the left, a thread of streamed Markdown answers in the
middle, and one composer at the bottom. It talks to the Anthropic-compatible
Messages API of [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)
from the browser with your own key, and keeps everything in `localStorage`.

![The panel: conversation rail, streamed answer, and composer](preview.svg)

## Answers

- Streamed replies with a stop control, a three-dot waiting state before the
  first token, and inline error hints.
- Markdown with code highlighting and a copy button; KaTeX math and Mermaid
  diagrams (CDN-loaded, with source/code fallbacks).
- Thinking effort off / low / high / max, with the reasoning drawn as a
  collapsible timeline.
- Server-side web search and link reading: numbered citations, a page-count
  pill, and a drawer listing every query, result, and opened page while the
  reply is still streaming.
- **Edit message** on a user turn re-asks from it; **Continue generating**
  appends to a reply the service cut short; **Regenerate** keeps the old answer
  as a switchable version (`‹ 1 / 2 ›`); every answer can be copied or read
  aloud with an animated waveform.

## Settings

- **Verify** checks the key against the free `GET /models` endpoint and reports
  *Verifying…* → *Key works*, or why it failed.
- API base URL, model, read-aloud voice, and an optional **location** hint that
  is written into the `latest_reminder` row of every request.
- **Data**: export every conversation as a JSON backup (no API key), import a
  backup after a confirmation (it replaces the local archive), or delete all
  conversations after a second tap.

## Files and speech

- Drag, paste, or pick files; images and documents upload through the Files API
  and the model reads them directly — no OCR step.
- The microphone records up to 110 seconds and transcribes it, with the demo's
  listening / recording / transcribing states and inline permission errors.

## Privacy

The key is sent only to the configured API base URL as `x-api-key` (plus one
Bearer request for `/models` verification). Conversations, settings, and file
ids stay in this browser's `localStorage`; uploaded files stay on the API
service; backups never include the key.

See [README](../README.md) for the full capability table and known limits.
