# Porting the vendored chat-demo into the plugin

The plugin UI is the upstream DeepSeek chat demo, not a re-implementation. This
note records how the two fit together and what is still open.

## Layout

| Path | Role |
| --- | --- |
| `vendor/chat-demo/src` | Upstream demo sources, unmodified where possible (MIT, see `LICENSE`, `UPSTREAM.md`) |
| `src/entry.tsx` | Plugin shell: module factory, sidebar launcher, locale, stylesheet injection |
| `src/demo-panel.tsx` | Lazy-mounted demo app plus the panel-local theme bridge |
| `scripts/build-client.mjs` | esbuild pipeline that emits `client.js` |
| `src/generated/css.ts` | CSS collected in the first build pass, scoped to `.dsc-demo-host`, inlined in the second |
| `client.legacy.js` | The previous hand-written client, kept for reference until the port is fully verified |

## Build

```
npm install            # once
npm run build          # writes client.js
node scripts/smoke.cjs # module/registration/stylesheet checks
```

`client.js` is a build artifact that is committed, because the bundle installs
straight from the repository and must not need a build step to run.

## What the build changes

- React and react-dom stay external: the host module table provides them, so
  hooks and portals keep the same instance as the rest of the page.
- CSS is collected, then rewritten so `:root`, `html` and `body` selectors apply
  to `.dsc-demo-host`; the demo's palettes therefore cannot repaint the host.
- `__API_ORIGIN__` is defined at build time (default `https://api.deepseek.com`).

## Local patches to the vendored sources

Kept deliberately small, and listed here so an upstream sync can reapply them:

| File | Patch |
| --- | --- |
| `src/plugin/portal.tsx` | New file: portals dialogs into the panel instead of `document.body` |
| `components/base/Modal.tsx` | Renders through `PanelPortal` |
| `components/base/Modal.module.css` | `.overlay` is `position: absolute`, so it dims the panel only |

## Done

- Dialog overlays stay inside the panel: the overlay rect now equals the panel
  rect, and the Harness sidebar stays untouched behind it.
- The panel follows the Harness theme when the demo preference is `system`
  (`html[data-ds-theme-source]`, watched with a `MutationObserver`), so the
  palette switches with DSH instead of the OS.
- Scoped tokens use a doubled class so they beat the host's `html`-level rules.

- The plugin extras are back on top of the vendored app, in the demo's own
  Settings → General list: **思考强度** (low/high/max, sent as
  `output_config.effort` while DeepThink is on) and **API 地址** (overrides the
  build-time origin at request time). Their patches are listed below.

## Extra patches (beyond the portal/theme ones)

| File | Patch |
| --- | --- |
| `services/settings.ts` | `apiBaseUrl`, `thinkingEffort` fields, storage keys and setters |
| `services/api/client.ts` | `apiBaseUrl()` reads the setting per request instead of a build constant |
| `services/api/types.ts` | `CreateMessageRequest.output_config` |
| `services/chat/store.ts` | sends `output_config.effort` when DeepThink is enabled |
| `components/settings/SettingsDialog.tsx` | 思考强度 and API 地址 rows |
| `i18n/zh.ts`, `i18n/en.ts` | five new strings each |

## Verified end to end

A real request through the ported app returns a streamed answer with markdown
and KaTeX (`docs/screenshots/demo-ported-chat.png`), and the two extra rows
appear in the demo's General settings tab
(`docs/screenshots/demo-ported-extras.png`).

## Open work

1. The bundle is ~8 MB because katex, mermaid and prism are inlined; move
   mermaid back to a lazy CDN load and check the KaTeX font subset.
2. Rewrite the e2e checks for the new DOM (they currently target the retired
   hand-written UI in `client.legacy.js`).
3. Decide how the demo's own sider interacts with the Harness rail (both are
   visible today; the demo sider is part of the app and stays for parity).