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

## Open work

1. Modals, menus, tooltips and hover cards portal to `document.body`, so they
   cover the whole Harness window; they should portal into the panel host.
2. The panel-local theme bridge follows the demo's own preference; decide
   whether the panel should follow the host theme instead.
3. Re-add the plugin extras on top of the vendored app: thinking-strength
   levels, custom API base URL, and the Harness-side notices.
4. The bundle is ~8 MB because katex, mermaid and prism are inlined; move
   mermaid back to a lazy CDN load and check the KaTeX font subset.
5. Rewrite the e2e checks for the new DOM (they currently target the retired
   hand-written UI in `client.legacy.js`).