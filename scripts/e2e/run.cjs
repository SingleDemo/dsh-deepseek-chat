/**
 * E2E runner for the DeepSeek chat bundle.
 *
 *   node scripts/e2e/run.cjs --list              list every check
 *   node scripts/e2e/run.cjs --only panel        run one check (repeatable, comma ok)
 *   node scripts/e2e/run.cjs                     run every check
 *
 * Each check gets a fresh page state: plugin conversations cleared, settings
 * seeded from the credentials file, chat panel reopened. The runner prints
 * PASS/FAIL with the first failing assertion, always writes docs/e2e/<name>.png,
 * and exits non-zero when any check failed.
 *
 * Check files live in scripts/e2e/checks/*.cjs and export:
 *   { name, description, timeoutMs?, cost?, settings?, run(ctx) }
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { openPage, DOCS_DIR } = require('./harness.cjs');

const CHECKS_DIR = path.join(__dirname, 'checks');
const DEFAULT_CHECK_TIMEOUT = 120000;
const USAGE = [
  '用法:',
  '  node scripts/e2e/run.cjs --list',
  '  node scripts/e2e/run.cjs --only <name>[,<name>]',
  '  node scripts/e2e/run.cjs                 # 跑全部检查项',
  '',
  '可选参数:',
  '  --check-timeout <ms>   单项检查超时，默认 ' + DEFAULT_CHECK_TIMEOUT,
  '  --fresh-profile        冷启动 profile 并在结束后删除（密钥不在磁盘留存）',
  '  --no-shot              不自动补截图（检查项自己写的仍保留）',
  '  -h, --help             显示本帮助',
].join('\n');

/* ------------------------------------------------------------------ checks */

function loadChecks() {
  if (!fs.existsSync(CHECKS_DIR)) throw new Error('缺少检查项目录: ' + CHECKS_DIR);
  const files = fs.readdirSync(CHECKS_DIR)
    .filter((file) => file.endsWith('.cjs'))
    .sort();
  const checks = [];
  for (const file of files) {
    const full = path.join(CHECKS_DIR, file);
    let check;
    try {
      check = require(full);
    } catch (error) {
      throw new Error('装载检查项失败 ' + file + ': ' + error.message);
    }
    if (!check || (!check.skip && typeof check.run !== 'function')) {
      throw new Error('检查项 ' + file + ' 必须导出 { name, run(ctx) }（或 { skip: true, skipReason }）');
    }
    if (check.skip && !check.skipReason) {
      throw new Error('检查项 ' + file + ' 标记 skip 时必须写 skipReason');
    }
    const name = check.name || path.basename(file, '.cjs');
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(name)) {
      throw new Error('检查项名字只能包含字母数字和连字符: ' + name);
    }
    checks.push(Object.assign({}, check, { name, file }));
  }
  return checks;
}

/* ------------------------------------------------------------------- args */

function parseArgs(argv) {
  const options = { list: false, help: false, only: [], checkTimeout: DEFAULT_CHECK_TIMEOUT, shot: true, freshProfile: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--list') { options.list = true; continue; }
    if (arg === '-h' || arg === '--help') { options.help = true; continue; }
    if (arg === '--no-shot') { options.shot = false; continue; }
    if (arg === '--fresh-profile') { options.freshProfile = true; continue; }
    if (arg === '--check-timeout') {
      const value = Number(argv[index + 1]);
      if (!Number.isFinite(value) || value <= 0) throw new Error('--check-timeout 需要毫秒数');
      options.checkTimeout = value;
      index += 1;
      continue;
    }
    if (arg === '--only') {
      const value = argv[index + 1];
      if (!value) throw new Error('--only 需要检查项名字');
      options.only.push.apply(options.only, value.split(',').map((item) => item.trim()).filter(Boolean));
      index += 1;
      continue;
    }
    if (arg.startsWith('--')) throw new Error('未知参数: ' + arg);
    // A bare word is treated as --only for convenience.
    options.only.push(arg);
  }
  return options;
}

function selectChecks(checks, only) {
  if (!only.length) return checks;
  const wanted = new Set(only);
  const known = new Set(checks.map((check) => check.name));
  const missing = only.filter((name) => !known.has(name));
  if (missing.length) {
    throw new Error('未知检查项: ' + missing.join(', ') + '\n可用: ' + Array.from(known).join(', '));
  }
  return checks.filter((check) => wanted.has(check.name));
}

/* ------------------------------------------------------------------ runner */

/** Assertion helpers handed to every check. */
function createContext(session, check) {
  const steps = session.steps;
  const context = {
    steps,
    page: session.page,
    name: check.name,
    dir: DOCS_DIR,
    log(message) { console.log('        ' + message); },
    assert(ok, message) {
      if (!ok) throw new Error('断言失败: ' + message);
    },
    assertEqual(actual, expected, message) {
      if (actual !== expected) {
        throw new Error('断言失败: ' + message
          + '（期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual) + '）');
      }
    },
    assertMatch(value, pattern, message) {
      if (!pattern.test(String(value))) {
        throw new Error('断言失败: ' + message + '（实际 ' + JSON.stringify(value) + '）');
      }
    },
    assertIncludes(haystack, needle, message) {
      if (String(haystack).indexOf(needle) < 0) {
        throw new Error('断言失败: ' + message
          + '（找不到 ' + JSON.stringify(needle) + '，实际 ' + JSON.stringify(String(haystack).slice(0, 300)) + '）');
      }
    },
    fail(message) { throw new Error('断言失败: ' + message); },
  };
  return context;
}

function withTimeout(promise, timeoutMs, name) {
  let timer = null;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('检查项超时（' + timeoutMs + 'ms）: ' + name)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function errorText(error) {
  if (!error) return '未知错误';
  const message = error.message || String(error);
  return message.split('\n').slice(0, 6).join('\n        ');
}

async function runCheck(session, check, options) {
  const steps = session.steps;
  const started = Date.now();
  const canonicalShot = path.join(DOCS_DIR, check.name + '.png');
  const shotExisted = fs.existsSync(canonicalShot);
  const shotMtime = shotExisted ? fs.statSync(canonicalShot).mtimeMs : 0;
  const context = createContext(session, check);
  steps.shotName = check.name;

  // Fresh, deterministic state for every check; panel is where all checks start.
  await steps.seedSettings(check.settings || {});
  await steps.openPanel();

  let failure = null;
  try {
    await withTimeout(Promise.resolve().then(() => check.run(context)), check.timeoutMs || options.checkTimeout, check.name);
  } catch (error) {
    failure = error;
  }

  // Always leave visual evidence, even for a failure: docs/e2e/<name>.png.
  // A passed check that already wrote its own canonical screenshot keeps it.
  const checkShotItself = fs.existsSync(canonicalShot) && fs.statSync(canonicalShot).mtimeMs > shotMtime;
  let shotPath = checkShotItself ? canonicalShot : null;
  if (options.shot && (failure || !checkShotItself)) {
    try {
      shotPath = await steps.shot(check.name);
    } catch (error) {
      context.log('截图失败: ' + error.message);
    }
  }
  return { check, failure, shotPath, durationMs: Date.now() - started, context };
}

function printList(checks) {
  console.log('E2E 检查项（' + CHECKS_DIR + '）');
  if (!checks.length) {
    console.log('  (空)');
    return;
  }
  const width = Math.max.apply(null, checks.map((check) => check.name.length));
  for (const check of checks) {
    const cost = check.cost === 'api' ? ' [真实 API]' : '';
    const state = check.skip ? ' [SKIP: ' + check.skipReason + ']' : '';
    console.log('  ' + check.name.padEnd(width) + '  ' + (check.description || '') + cost + state);
  }
  console.log('\n共 ' + checks.length + ' 项。' + USAGE);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const checks = loadChecks();
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  if (options.list) {
    printList(checks);
    return 0;
  }

  const selected = selectChecks(checks, options.only);
  if (!selected.length) {
    console.log('没有可运行的检查项。');
    return 0;
  }

  console.log('E2E：' + selected.length + ' 项检查'
    + '（headless Chrome → DSH GUI，截图写入 docs/e2e/）');
  let session = null;
  let passed = 0;
  let skipped = 0;
  const failures = [];

  const shutdown = async () => {
    if (!session) return;
    try { await session.close(); } catch (error) { console.error('关闭浏览器失败: ' + error.message); }
    session = null;
  };
  process.once('SIGINT', () => {
    console.log('\n收到中断，关闭浏览器…');
    Promise.resolve(shutdown()).then(() => process.exit(130));
  });

  try {
    session = await openPage({
      width: 1440,
      height: 900,
      freshProfile: options.freshProfile,
    });
    for (let index = 0; index < selected.length; index += 1) {
      const check = selected[index];
      const cost = check.cost === 'api' ? '（会消耗一次真实 API 调用）' : '';
      console.log('\n[' + (index + 1) + '/' + selected.length + '] ' + check.name + ' — ' + (check.description || '') + cost);

      // Skipped checks are documented instead of executed (usually a feature was
      // removed or the interaction is too costly on the new DOM).
      if (check.skip) {
        skipped += 1;
        console.log('  SKIP  ' + check.name + ' — ' + check.skipReason);
        continue;
      }

      // A headless renderer can die mid-suite (CDP socket closes). That is not a
      // product failure: reboot Chrome and retry the check once before giving up.
      let result = null;
      let setupError = null;
      for (let attempt = 1; attempt <= 2 && !result; attempt += 1) {
        try {
          result = await runCheck(session, check, options);
        } catch (error) {
          setupError = error;
          if (attempt === 1) {
            console.log('  准备阶段失败，重启浏览器后重试一次: ' + errorText(error).split('\n')[0]);
            await shutdown();
            try {
              session = await openPage({
                width: 1440,
                height: 900,
                freshProfile: options.freshProfile,
              });
            } catch (reopenError) {
              console.log('  重启浏览器失败: ' + errorText(reopenError).split('\n')[0]);
              break;
            }
          }
        }
      }
      if (!result) {
        failures.push(check.name);
        console.log('  FAIL  ' + check.name + ' — 准备阶段失败（浏览器无法恢复）');
        console.log('        ' + errorText(setupError));
        break;
      }

      const seconds = (result.durationMs / 1000).toFixed(1);
      if (result.failure) {
        failures.push(check.name);
        console.log('  FAIL  ' + check.name + ' (' + seconds + 's)'
          + (result.shotPath ? '  → ' + path.relative(process.cwd(), result.shotPath) : ''));
        console.log('        ' + errorText(result.failure));
        const pageErrors = session.steps.consoleErrors();
        if (pageErrors.length) {
          console.log('        页面错误: ' + pageErrors.slice(-3).join(' | '));
        }
      } else {
        passed += 1;
        console.log('  PASS  ' + check.name + ' (' + seconds + 's)'
          + (result.shotPath ? '  → ' + path.relative(process.cwd(), result.shotPath) : ''));
      }
    }
  } finally {
    await shutdown();
  }

  console.log('\n结果: ' + passed + ' 通过, ' + failures.length + ' 失败'
    + (skipped ? ', ' + skipped + ' 跳过' : '')
    + (failures.length ? '（' + failures.join(', ') + '）' : ''));
  return failures.length ? 1 : 0;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch(async (error) => {
    console.error('运行失败: ' + errorText(error));
    try { await require('./harness.cjs').close(); } catch (closeError) { /* ignore */ }
    process.exitCode = 1;
  });
