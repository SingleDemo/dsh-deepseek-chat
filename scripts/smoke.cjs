/**
 * Smoke test for the DeepSeek chat bundle, run with plain Node:
 *
 *   node scripts/smoke.cjs
 *
 * It loads `client.js` the way the browser module loader does, but with a
 * stubbed runtime: a fake React with mount-only hooks, an in-memory
 * localStorage, and a recording slot registry. The test then:
 *
 *   1. asserts the module shape and the `inject` list;
 *   2. runs `apply(ctx)` and checks both slot registrations;
 *   3. renders the sidebar glyph and the whole panel component tree;
 *   4. fails when any UI string is missing from a locale dictionary.
 *
 * It cannot prove layout or streaming behaviour; the installed panel is the
 * authority for those.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const failures = [];

/** Record a passing or failing assertion. */
function check(name, ok, detail) {
  if (ok) {
    console.log('  ok   ' + name);
    return;
  }
  failures.push(name + (detail ? ' — ' + detail : ''));
  console.log('  FAIL ' + name + (detail ? ' — ' + detail : ''));
}

/* --------------------------------------------------------------- fake React */

function createFakeReact() {
  let current = null;

  /** Allocate the next hook slot for the component being rendered. */
  function slot(initialize) {
    const scope = current;
    const index = scope.index;
    scope.index += 1;
    if (!(index in scope.hooks)) scope.hooks[index] = initialize();
    return index;
  }

  const React = {
    createElement(type, props) {
      const out = Object.assign({}, props || {});
      const children = Array.prototype.slice.call(arguments, 2);
      if (children.length === 1) out.children = children[0];
      else if (children.length > 1) out.children = children;
      return { type, props: out };
    },
    useState(initial) {
      const value = slot(() => (typeof initial === 'function' ? initial() : initial));
      return [current.hooks[value], () => {}];
    },
    useRef(initial) {
      const index = slot(() => ({ current: initial }));
      return current.hooks[index];
    },
    useMemo(factory) {
      const index = slot(() => factory());
      return current.hooks[index];
    },
    useCallback(callback) {
      const index = slot(() => callback);
      return current.hooks[index];
    },
    useEffect() {
      current.index += 1;
    },
  };

  /** Render one component function with its own hook scope and return its tree. */
  function renderComponent(type, props) {
    const previous = current;
    current = { hooks: [], index: 0 };
    try {
      return type(props);
    } finally {
      current = previous;
    }
  }

  /** Expand a React element tree into plain nodes, invoking every component. */
  function expand(node, depth) {
    if (node === null || node === undefined || node === false || node === true) return [];
    if (Array.isArray(node)) {
      const list = [];
      for (const item of node) list.push.apply(list, expand(item, depth));
      return list;
    }
    if (typeof node !== 'object') return [{ text: String(node) }];
    if (typeof node.type === 'function') return expand(renderComponent(node.type, node.props), depth + 1);
    return [{
      tag: typeof node.type === 'string' ? node.type : 'fragment',
      props: node.props,
      children: expand(node.props.children, depth + 1),
    }];
  }

  /** Collect the text content of an expanded tree. */
  function collectText(nodes) {
    const parts = [];
    for (const node of nodes) {
      if (node.text !== undefined) parts.push(node.text);
      else if (node.children) parts.push(collectText(node.children));
    }
    return parts.join(' ');
  }

  /** Collect one prop value from every node that defines it. */
  function collectProp(nodes, key) {
    const values = [];
    for (const node of nodes) {
      if (node.text !== undefined) continue;
      if (node.props && node.props[key] !== undefined) values.push(node.props[key]);
      if (node.children) values.push.apply(values, collectProp(node.children, key));
    }
    return values;
  }

  return { React, expand, collectText, collectProp };
}

/* ------------------------------------------------------------- fake runtime */

function createRuntime(React) {
  const store = new Map();
  const localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
  };
  const mediaList = {
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  };
  const window = {
    localStorage,
    matchMedia: () => mediaList,
    navigator: {},
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: (handle) => clearTimeout(handle),
    __ModuleLoader__: { load(module) { window.captured = module; }, captured: null },
  };
  const document = {
    createElement: () => ({ style: {}, setAttribute() {}, select() {} }),
    body: { appendChild() {}, removeChild() {} },
    execCommand: () => true,
  };
  return { window, document, localStorage, store };
}

/* ------------------------------------------------------------------- runner */

function main() {
  const source = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8');
  const fake = createFakeReact();
  const runtime = createRuntime(fake.React);
  const context = {
    window: runtime.window,
    document: runtime.document,
    console,
    setTimeout,
    clearTimeout,
    TextEncoder,
    TextDecoder,
    Blob: typeof Blob === 'undefined' ? class {} : Blob,
    URL: typeof URL === 'undefined' ? { createObjectURL: () => '', revokeObjectURL: () => {} } : URL,
    fetch: async () => { throw new Error('network is not available in the smoke test'); },
  };
  context.globalThis = context;

  console.log('module');
  vm.runInNewContext(source, context, { filename: 'client.js' });
  const module = runtime.window.captured;
  check('registers itself with the module loader', Boolean(module), 'no module captured');
  check('declares the bundle id', module && module.id === '@local/dsh-deepseek-chat', module && module.id);
  check('exposes a factory', Boolean(module && typeof module.factory === 'function'));

  const api = module.factory(() => fake.React);
  check('declares the slots and locale services', Array.isArray(api.inject) && api.inject.indexOf('slots') >= 0, JSON.stringify(api.inject));
  check('declares the layout service', Array.isArray(api.inject) && api.inject.indexOf('layout') >= 0);
  check('exposes apply()', typeof api.apply === 'function');

  console.log('registrations');
  const registrations = [];
  const dictionaries = [];
  const ctx = {
    effect(factory) {
      const dispose = factory();
      return typeof dispose === 'function' ? dispose : () => {};
    },
    locale: {
      register(namespace, dicts) {
        dictionaries.push([namespace, dicts]);
        return () => {};
      },
      bind(namespace) {
        const dicts = dictionaries[dictionaries.length - 1][1];
        return (key) => {
          const table = dicts.en || {};
          return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : 'MISSING:' + key;
        };
      },
    },
    slots: {
      inject(name, factory) {
        const dispose = factory();
        return typeof dispose === 'function' ? dispose : () => {};
      },
      register(options, component) {
        registrations.push({ options, component });
        return () => {};
      },
    },
    layout: {
      selectPanel() {},
    },
  };
  api.apply(ctx);

  const entry = registrations.find((item) => item.options.name === 'sidebar.panellist');
  const panel = registrations.find((item) => item.options.name === 'main');
  check('registers the sidebar entry', Boolean(entry));
  check('entry id matches the panel id', Boolean(entry) && entry.options.id === 'deepseek-chat', entry && entry.options.id);
  check('entry resolves a localized label', Boolean(entry) && typeof entry.options.label === 'function' && entry.options.label() === 'DeepSeek chat');
  check('registers the main panel', Boolean(panel));
  check('panel key matches the entry id', Boolean(panel) && panel.options.key === 'deepseek-chat', panel && panel.options.key);
  check('panel receives the translator', Boolean(panel) && typeof panel.options.inject === 'function' && typeof panel.options.inject().t === 'function');
  check('panel receives the back navigation', Boolean(panel) && typeof panel.options.inject().backToConversation === 'function');
  check('registers en and zh dictionaries', dictionaries.length === 1 && Boolean(dictionaries[0][1].en) && Boolean(dictionaries[0][1].zh));

  const en = dictionaries[0][1].en;
  const zh = dictionaries[0][1].zh;
  const missingZh = Object.keys(en).filter((key) => !(key in zh));
  const extraZh = Object.keys(zh).filter((key) => !(key in en));
  check('zh covers every en key', missingZh.length === 0, missingZh.join(', '));
  check('zh has no orphan keys', extraZh.length === 0, extraZh.join(', '));

  console.log('sidebar glyph');
  const icon = fake.expand(fake.React.createElement(entry.component, { size: 20, active: false }));
  check('renders an svg', icon.length === 1 && icon[0].tag === 'svg', icon.length ? icon[0].tag : 'none');
  check('uses the requested size', icon[0] && icon[0].props.width === 20, icon[0] && String(icon[0].props.width));

  console.log('panel');
  const t = panel.options.inject().t;
  const tree = fake.expand(fake.React.createElement(panel.component, Object.assign({}, panel.options.inject())));
  const text = fake.collectText(tree);
  check('renders a tree', tree.length === 1 && tree[0].props.className === 'dsc-root', tree.length ? tree[0].props.className : 'none');
  check('shows the new-chat action', text.indexOf('New chat') >= 0);
  check('shows the settings action', text.indexOf('Settings') >= 0);
  check('shows the empty-rail hint', text.indexOf('No conversations yet') >= 0);
  check('shows the welcome headline', text.indexOf('What may I help you with?') >= 0);
  check('shows the missing-key hint', text.indexOf('Add your DeepSeek API key in Settings first.') >= 0);
  check('shows the composer placeholder', fake.collectProp(tree, 'placeholder').indexOf('Send a message…') >= 0,
    fake.collectProp(tree, 'placeholder').join('|'));
  check('offers a textarea', fake.collectProp(tree, 'rows').length > 0);
  const titles = fake.collectProp(tree, 'title');
  check('offers web search', titles.indexOf('Web search') >= 0, titles.join('|').slice(0, 200));
  check('offers thinking strength', titles.indexOf('Thinking') >= 0);
  check('offers voice input', titles.indexOf('Voice input') >= 0);
  check('offers attachments', titles.some((title) => title.indexOf('Paste or pick them too') === 0), titles.join('|').slice(0, 300));
  check('shows the current thinking level', text.indexOf('High') >= 0, text.slice(0, 240));
  check('no UI string is missing from a dictionary', text.indexOf('MISSING:') < 0, text.slice(0, 200));
  check('renders the injected stylesheet', tree[0].children.some((child) => child.tag === 'style' && child.props.dangerouslySetInnerHTML));

  console.log('');
  if (failures.length) {
    console.error('smoke failed: ' + failures.length + ' assertion(s)');
    for (const failure of failures) console.error(' - ' + failure);
    process.exitCode = 1;
    return;
  }
  console.log('smoke passed: ' + registrations.length + ' registrations, ' + Object.keys(en).length + ' strings');
}

main();
