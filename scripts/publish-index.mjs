/**
 * Regenerate the plugin index served from this repository.
 *
 * Usage:
 *   node scripts/publish-index.mjs                  publish this repository (or every market/plugins.json entry)
 *   node scripts/publish-index.mjs --check          validate and print the plan, write nothing
 *   node scripts/publish-index.mjs --commit <sha>   record <sha> instead of HEAD for this repository
 *   node scripts/publish-index.mjs --config <file>  read another plugins.json
 *
 * Without `market/plugins.json` the script publishes this package alone, exactly
 * as it always has. With a config it publishes every entry:
 *
 *   { "prune": true, "plugins": [
 *       { "path": "." },
 *       { "path": "../other-plugin", "repository": "https://github.com/SingleDemo/other-plugin" } ] }
 *
 * For each entry it reads `<path>/package.json`, records the HEAD of the git
 * repository that directory belongs to, copies `<path>/icon.svg` (or the
 * entry's `icon`) to `market/icons/<package-name>.svg`, and keeps every version
 * that was already in `market/index.json`. Run it after committing the release
 * and before committing `market/`, so the recorded commit is the release
 * commit itself — DSH installs from `git+<url>.git#<commit>`.
 */
import { execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { compareSemver, isSemver, isSemverRange, validateIndex } from './validate-index.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const marketDir = path.join(root, 'market')
const iconsDir = path.join(marketDir, 'icons')
const indexPath = path.join(marketDir, 'index.json')
const defaultConfigPath = path.join(marketDir, 'plugins.json')
const ICON_MAX_BYTES = 32 * 1024
const IMAGE_EXTENSION = /\.(?:svg|png|jpe?g|webp|gif|avif)$/i
const SHA = /^[0-9a-f]{40}$/

/**
 * Curated copy for this repository's own package. Other packages derive their
 * title/description from `package.json`; `market/plugins.json` can override any
 * of these per entry. Keeping this here means `node scripts/publish-index.mjs`
 * with no configuration still produces the index this repository always had.
 */
const REPO_COPY = {
  index: {
    title: { en: 'DeepSeek Chat plugin', zh: 'DeepSeek 对话插件' },
    description: {
      en: 'A DeepSeek chat panel for the DeepSeek Harness Web GUI, built from the upstream chat demo.',
      zh: 'DeepSeek Harness 的对话面板插件，界面来自上游 chat-demo。',
    },
  },
  plugin: {
    title: { en: 'AI Chat', zh: 'AI Chat' },
    description: {
      en: 'Chat with DeepSeek inside Harness: the official demo UI, DeepSeek account login, branch editing, and official history ZIP import/export.',
      zh: '在 Harness 里和 DeepSeek 对话：原版 demo 界面、DeepSeek 账号免 Key 登录、分支编辑、官方历史对话 ZIP 双向导入导出。',
    },
  },
}

const HELP = `Publish packages into market/index.json.

Usage:
  node scripts/publish-index.mjs                 publish this repository (or every market/plugins.json entry)
  node scripts/publish-index.mjs --check         validate and print the plan, write nothing
  node scripts/publish-index.mjs --commit <sha>  record <sha> instead of HEAD for this repository
  node scripts/publish-index.mjs --config <file> read another plugins.json

market/plugins.json (optional):
  { "prune": true, "plugins": [ { "path": "." }, { "path": "../other-plugin" } ] }

Each entry reads <path>/package.json, records that directory's git HEAD, copies
<path>/icon.svg (or the entry's "icon") to market/icons/<package-name>.svg, and
keeps every version that was in market/index.json before. Entry fields: path,
repository, homepage, author, title, description, icon, commit.`

function parseArgs(argv) {
  const options = { check: false, config: null, commit: null, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const equals = argument.startsWith('--') ? argument.indexOf('=') : -1
    const flag = equals > 0 ? argument.slice(0, equals) : argument
    const inline = equals > 0 ? argument.slice(equals + 1) : null
    const takeValue = () => {
      if (inline) return inline
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`)
      index += 1
      return value
    }
    if (flag === '--check') options.check = true
    else if (flag === '--help' || flag === '-h') options.help = true
    else if (flag === '--config') options.config = takeValue()
    else if (flag === '--commit') options.commit = takeValue()
    else throw new Error(`unknown argument: ${argument}`)
  }
  return options
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

function gitOrNull(cwd, args) {
  try {
    return git(cwd, args) || null
  } catch {
    return null
  }
}

/** `git+https://host/x.git` / `git@host:x` / `ssh://git@host/x` → `https://host/x`. */
function normalizeRepositoryUrl(input) {
  if (input === undefined || input === null) return ''
  let url = String(input).trim()
  if (!url) return ''
  url = url.replace(/^git\+/, '')
  url = url.replace(/^ssh:\/\/git@([^/:]+)\//, 'https://$1/')
  url = url.replace(/^git@([^:]+):/, 'https://$1/')
  url = url.replace(/\.git$/i, '')
  return url.replace(/\/+$/, '')
}

function packageRepository(pkg) {
  const value = pkg.repository
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && typeof value.url === 'string') return value.url
  return ''
}

function localized(value) {
  if (typeof value === 'string') {
    const text = value.trim()
    return text ? { en: text } : undefined
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const entries = Object.entries(value)
    .filter(([, text]) => typeof text === 'string' && text.trim())
    .map(([language, text]) => [language, text.trim()])
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function authorOf(pkg, entry) {
  const value = entry.author ?? pkg.author
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (value && typeof value === 'object' && typeof value.name === 'string' && value.name.trim()) {
    return value.name.trim()
  }
  return undefined
}

function iconFileName(name, extension) {
  return `${name.replace(/^@/, '').replace(/[^a-zA-Z0-9._-]+/g, '_')}${extension}`
}

function display(target) {
  return path.relative(root, target).split(path.sep).join('/') || '.'
}

async function loadConfig(configPath) {
  let text
  try {
    text = await readFile(configPath, 'utf8')
  } catch (cause) {
    if (cause.code === 'ENOENT') return null
    throw cause
  }
  let config
  try {
    config = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch (cause) {
    throw new Error(`${display(configPath)} is not valid JSON: ${cause.message}`)
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`${display(configPath)} must contain a JSON object`)
  }
  if (!Array.isArray(config.plugins) || config.plugins.length === 0) {
    throw new Error(`${display(configPath)} must contain a non-empty "plugins" array`)
  }
  const entries = config.plugins.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${display(configPath)} plugins[${index}] must be an object`)
    }
    if (entry.path !== undefined && typeof entry.path !== 'string') {
      throw new Error(`${display(configPath)} plugins[${index}].path must be a string`)
    }
    return { ...entry, path: entry.path ?? '.' }
  })
  return {
    path: configPath,
    prune: config.prune === true,
    title: localized(config.title),
    description: localized(config.description),
    entries,
  }
}

async function readPreviousIndex() {
  let text
  try {
    text = await readFile(indexPath, 'utf8')
  } catch (cause) {
    if (cause.code === 'ENOENT') return null
    throw cause
  }
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    console.warn('! market/index.json is not valid JSON; regenerating it from scratch')
    return null
  }
}

function sameSource(left, right) {
  if (!left || !right) return false
  return (
    left.type === right.type &&
    left.url === right.url &&
    left.commit === right.commit &&
    (left.path ?? '') === (right.path ?? '')
  )
}

/** Merge one freshly generated version into the versions already published. */
function mergeVersions(previousVersions, next) {
  const byVersion = new Map()
  for (const version of Array.isArray(previousVersions) ? previousVersions : []) {
    if (version && typeof version === 'object' && typeof version.version === 'string') {
      byVersion.set(version.version, version)
    }
  }
  const previous = byVersion.get(next.version)
  // Re-running the script without a new release keeps the original timestamp,
  // so committing the index twice does not churn it.
  byVersion.set(next.version, previous && sameSource(previous.source, next.source)
    ? { ...next, publishTimestamp: previous.publishTimestamp }
    : next)
  return [...byVersion.values()].sort((left, right) => compareSemver(right.version, left.version))
}

async function buildPlugin(entry, context) {
  const dir = path.resolve(root, entry.path)
  const label = entry.path

  let rawPackage
  try {
    rawPackage = await readFile(path.join(dir, 'package.json'), 'utf8')
  } catch {
    throw new Error(`no package.json in ${label}`)
  }
  let pkg
  try {
    pkg = JSON.parse(rawPackage.replace(/^\uFEFF/, ''))
  } catch (cause) {
    throw new Error(`${label}/package.json is not valid JSON: ${cause.message}`)
  }

  const name = typeof pkg.name === 'string' ? pkg.name.trim() : ''
  if (!name) throw new Error(`${label}/package.json has no "name"`)
  if (pkg.private === true) {
    throw new Error(`${name} still sets "private": true; the Harness skips private packages`)
  }
  if (!pkg.dsh || typeof pkg.dsh !== 'object' || !pkg.dsh.bundle) {
    throw new Error(`${name}/package.json does not declare "dsh.bundle"`)
  }
  if (!isSemver(pkg.version)) {
    throw new Error(`${name} has version ${JSON.stringify(pkg.version)}; the index needs an exact SemVer like 1.2.3`)
  }
  const enginesDsh = pkg.engines && typeof pkg.engines === 'object' ? pkg.engines.dsh : undefined
  if (enginesDsh === undefined || enginesDsh === null || enginesDsh === '') {
    throw new Error(`${name}/package.json needs "engines.dsh" so the index says which Harness runs it`)
  }
  if (!isSemverRange(enginesDsh)) {
    throw new Error(`${name}/package.json has engines.dsh ${JSON.stringify(enginesDsh)}; that is not a SemVer range`)
  }

  const repoRoot = gitOrNull(dir, ['rev-parse', '--show-toplevel'])
  if (!repoRoot) throw new Error(`${label} is not inside a git repository; the index records a commit`)
  let commit = typeof entry.commit === 'string' ? entry.commit.trim() : null
  let usedCommitOverride = false
  if (commit) {
    if (!cleanSha(commit)) throw new Error(`${name}: commit override must be a full 40-character lowercase sha`)
  } else if (context.commitOverride && path.resolve(dir) === root) {
    commit = context.commitOverride
    usedCommitOverride = true
  } else {
    commit = gitOrNull(dir, ['rev-parse', 'HEAD'])
    if (!commit) throw new Error(`${name}: the git repository in ${label} has no commit yet`)
  }
  if (!cleanSha(commit)) throw new Error(`${name}: git HEAD is not a full 40-character lowercase sha: ${commit}`)

  const relative = path.relative(repoRoot, dir)
  const sourcePath = relative === '' ? '' : relative.split(path.sep).join('/')

  const repositoryInput =
    entry.repository && typeof entry.repository === 'object' ? entry.repository.url : entry.repository
  const repositoryUrl = normalizeRepositoryUrl(
    repositoryInput || packageRepository(pkg) || gitOrNull(dir, ['remote', 'get-url', 'origin']) || '',
  )
  if (!/^https:\/\//.test(repositoryUrl)) {
    throw new Error(
      `${name} needs an https repository URL (set "repository" in market/plugins.json); got ${JSON.stringify(repositoryUrl)}`,
    )
  }

  const homepage =
    (typeof entry.homepage === 'string' && entry.homepage.trim()) ||
    (typeof pkg.homepage === 'string' && pkg.homepage.trim()) ||
    repositoryUrl
  const curated = path.resolve(dir) === root ? REPO_COPY.plugin : undefined
  const title = localized(entry.title) ?? curated?.title ?? localized(pkg.title) ?? { en: name }
  const description = localized(entry.description) ?? curated?.description ?? localized(pkg.description)
  const author = authorOf(pkg, entry)

  const iconSource = path.resolve(
    dir,
    typeof entry.icon === 'string' && entry.icon.trim() ? entry.icon.trim() : 'icon.svg',
  )
  let iconBytes
  try {
    iconBytes = await readFile(iconSource)
  } catch {
    throw new Error(`${name} is missing its icon: ${display(iconSource)} (add icon.svg or set "icon" in the entry)`)
  }
  const extension = path.extname(iconSource).toLowerCase()
  if (!IMAGE_EXTENSION.test(extension)) {
    throw new Error(`${name}: icon must be an .svg/.png/.webp/.gif file, not ${extension || 'an extensionless file'}`)
  }
  if (iconBytes.length > ICON_MAX_BYTES) {
    throw new Error(`${name}: icon is ${iconBytes.length} bytes; the index allows at most ${ICON_MAX_BYTES}`)
  }
  const iconRel = `icons/${iconFileName(name, extension)}`

  const version = {
    version: pkg.version,
    publishTimestamp: Math.floor(context.now / 1000),
    source: { type: 'git', url: repositoryUrl, commit, ...(sourcePath ? { path: sourcePath } : {}) },
    ...(typeof enginesDsh === 'string' ? { engines: { dsh: enginesDsh } } : {}),
  }

  const plugin = {
    name,
    title,
    ...(description ? { description } : {}),
    icon: iconRel,
    ...(author ? { author } : {}),
    ...(homepage ? { homepage } : {}),
    repository: { url: repositoryUrl, ...(sourcePath ? { directory: sourcePath } : {}) },
    versions: [version],
  }

  return { entryPath: label, plugin, icon: { rel: iconRel, bytes: iconBytes }, commit, usedCommitOverride }
}

function cleanSha(value) {
  return typeof value === 'string' && SHA.test(value.trim())
}

function serveUrl() {
  const remote = gitOrNull(root, ['remote', 'get-url', 'origin'])
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/.exec(normalizeRepositoryUrl(remote ?? ''))
  if (!match) return null
  return `https://cdn.jsdelivr.net/gh/${match[1]}/${match[2]}@main/market/index.json`
}

function resolveIcon(market, iconSizes) {
  return (relative) => {
    const known = iconSizes.get(relative)
    if (known !== undefined) return known
    try {
      const info = statSync(path.join(market, relative))
      return info.isFile() ? info.size : null
    } catch {
      return null
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(HELP)
    return
  }
  if (options.commit !== null && !cleanSha(options.commit)) {
    throw new Error(`--commit needs a full 40-character lowercase sha, got ${JSON.stringify(options.commit)}`)
  }

  const configPath = options.config ? path.resolve(options.config) : defaultConfigPath
  const config = await loadConfig(configPath)
  const entries = config ? config.entries : [{ path: '.' }]
  const now = Date.now()

  const built = []
  const problems = []
  for (const entry of entries) {
    try {
      built.push(await buildPlugin(entry, { now, commitOverride: options.commit }))
    } catch (cause) {
      problems.push(`✗ ${entry.path}  ${cause.message}`)
    }
  }
  const seenNames = new Map()
  for (const { entryPath, plugin } of built) {
    if (seenNames.has(plugin.name)) {
      problems.push(`✗ ${entryPath}  ${plugin.name} is also published from ${seenNames.get(plugin.name)}; names must be unique`)
    } else {
      seenNames.set(plugin.name, entryPath)
    }
  }
  if (options.commit && !built.some((item) => item.usedCommitOverride)) {
    problems.push('✗ --commit  applies to this repository, but market/plugins.json has no {"path":"."} entry')
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem)
    console.error(`nothing was written · ${problems.length} problem(s)`)
    process.exitCode = 1
    return
  }

  const previous = await readPreviousIndex()
  const freshByName = new Map(built.map((item) => [item.plugin.name, item.plugin]))
  const plugins = []
  const emitted = new Set()
  for (const previousPlugin of Array.isArray(previous?.plugins) ? previous.plugins : []) {
    if (!previousPlugin || typeof previousPlugin !== 'object' || typeof previousPlugin.name !== 'string') continue
    if (emitted.has(previousPlugin.name)) continue
    const fresh = freshByName.get(previousPlugin.name)
    if (fresh) {
      emitted.add(previousPlugin.name)
      plugins.push({ ...fresh, versions: mergeVersions(previousPlugin.versions, fresh.versions[0]) })
    } else if (!config?.prune) {
      // Keep plugins that were published earlier but are not in this run's config.
      emitted.add(previousPlugin.name)
      plugins.push(previousPlugin)
    }
  }
  for (const { plugin } of built) {
    if (emitted.has(plugin.name)) continue
    emitted.add(plugin.name)
    plugins.push(plugin)
  }

  const index = {
    format: 1,
    title: config?.title ?? REPO_COPY.index.title,
    description: config?.description ?? REPO_COPY.index.description,
    plugins,
  }

  const iconSizes = new Map(built.map((item) => [item.icon.rel, item.icon.bytes.length]))
  const { errors, warnings } = validateIndex(index, {
    baseDir: marketDir,
    resolveIcon: resolveIcon(marketDir, iconSizes),
  })
  for (const { at, message } of warnings) console.warn(`! ${at}  ${message}`)
  if (errors.length > 0) {
    for (const { at, message } of errors) console.error(`✗ ${at}  ${message}`)
    throw new Error(`the generated index is invalid (${errors.length} problem(s)); nothing was written`)
  }

  const versionCount = plugins.reduce(
    (total, plugin) => total + (Array.isArray(plugin.versions) ? plugin.versions.length : 0),
    0,
  )
  const lines = built.map(
    ({ plugin, commit }) =>
      `market/index.json · ${plugin.name} ${plugin.versions[0].version} · commit ${commit.slice(0, 12)}` +
      (plugin.repository.directory ? ` · path ${plugin.repository.directory}` : ''),
  )

  if (options.check) {
    for (const line of lines) console.log(line)
    console.log(`check ok · ${plugins.length} plugin(s), ${versionCount} version(s) · nothing written`)
    return
  }

  await mkdir(iconsDir, { recursive: true })
  for (const { icon } of built) await writeFile(path.join(marketDir, icon.rel), icon.bytes)
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8')

  const referenced = new Set(
    plugins.map((plugin) => (typeof plugin.icon === 'string' ? plugin.icon : '')).filter(Boolean),
  )
  for (const file of await readdir(iconsDir)) {
    if (referenced.has(`icons/${file}`)) continue
    const filePath = path.join(iconsDir, file)
    const info = await stat(filePath).catch(() => null)
    if (!info || !info.isFile()) continue
    await rm(filePath)
    console.log(`removed unused icon market/icons/${file}`)
  }

  for (const line of lines) console.log(line)
  console.log(`${config ? display(config.path) : 'no config'} · ${plugins.length} plugin(s), ${versionCount} version(s)`)
  const serve = serveUrl()
  if (serve) console.log(`serve it at: ${serve}`)
  console.log('next: commit market/ together with the release')
}

try {
  await main()
} catch (cause) {
  console.error(`✗ ${cause.message}`)
  process.exitCode = 1
}
