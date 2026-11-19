/**
 * Validate `market/index.json` against the DSH plugin index format.
 *
 * Usage:
 *   node scripts/validate-index.mjs [path/to/index.json]
 *
 * Exit code 0 when the index is valid, 1 otherwise. Every rule mirrors what the
 * Harness index reader accepts: `format: 1`, a localized `title` that has `en`,
 * unique npm package names, exact-SemVer versions that are unique per plugin,
 * integer `publishTimestamp`, `source.type` of `git` (https URL + full
 * 40-character lowercase sha, optional relative `path`) or `npm`, a legal
 * `engines.dsh` range, an icon that exists next to the index and stays under
 * 32 KiB, and a valid `homepage` / `repository.url`.
 *
 * `publish-index.mjs` imports validateIndex() from this module, so the
 * generator and the checker can never drift apart.
 */
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** The Harness caps an inline (data:) icon at 32 KiB; a file icon obeys the same cap. */
export const ICON_MAX_BYTES = 32 * 1024

const INDEX_FORMAT = 1
const IMAGE_EXTENSIONS = /\.(?:svg|png|jpe?g|webp|gif|avif)$/i
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
const SHA = /^[0-9a-f]{40}$/
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/
const COMPARATOR =
  /^(?:(\^|~>?|>=|<=|>|<|=)\s*)?v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** True for an exact SemVer version such as `1.2.3-rc.1` (no `v`, no range). */
export function isSemver(value) {
  return typeof value === 'string' && SEMVER.test(value)
}

/** True for a SemVer range such as `^1.2.3`, `>=0.2.2-rc.3 <0.3.0`, `1.x`, `*`. */
export function isSemverRange(value) {
  if (typeof value !== 'string') return false
  const text = value.trim()
  if (!text) return false
  return text.split('||').every((alternative) => isComparatorSet(alternative.trim()))
}

function isComparatorSet(set) {
  if (!set) return false
  if (set === '*' || set === 'x' || set === 'X' || set === 'latest') return true
  const hyphen = set.split(/\s+-\s+/)
  if (hyphen.length === 2) {
    return isVersionToken(hyphen[0].trim()) && isVersionToken(hyphen[1].trim())
  }
  if (hyphen.length > 2) return false
  return set.split(/\s+/).every((token) => isComparator(token))
}

function isComparator(token) {
  if (token === '*' || token === 'x' || token === 'X' || token === 'latest') return true
  return COMPARATOR.test(token)
}

function isVersionToken(token) {
  return COMPARATOR.test(token)
}

/** Compare two exact SemVer versions; returns <0, 0 or >0. */
export function compareSemver(left, right) {
  const first = parseSemver(left)
  const second = parseSemver(right)
  if (!first || !second) return String(left).localeCompare(String(right))
  for (let index = 0; index < 3; index += 1) {
    if (first.parts[index] !== second.parts[index]) return first.parts[index] - second.parts[index]
  }
  if (!first.prerelease && second.prerelease) return 1
  if (first.prerelease && !second.prerelease) return -1
  if (!first.prerelease && !second.prerelease) return 0
  const length = Math.max(first.prerelease.length, second.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = first.prerelease[index]
    const rightPart = second.prerelease[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    const leftNumber = /^\d+$/.test(leftPart)
    const rightNumber = /^\d+$/.test(rightPart)
    if (leftNumber && rightNumber && Number(leftPart) !== Number(rightPart)) {
      return Number(leftPart) - Number(rightPart)
    }
    if (leftNumber !== rightNumber) return leftNumber ? -1 : 1
    if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1
  }
  return 0
}

function parseSemver(value) {
  if (!isSemver(value)) return null
  const match = SEMVER.exec(value)
  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split('.') : [],
  }
}

function parseUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    return new URL(value.trim())
  } catch {
    return null
  }
}

function defaultResolveIcon(baseDir) {
  return (relative) => {
    try {
      const info = statSync(path.resolve(baseDir, relative))
      return info.isFile() ? info.size : null
    } catch {
      return null
    }
  }
}

/**
 * Check one parsed index object.
 *
 * @param {unknown} index parsed JSON of market/index.json
 * @param {{ baseDir?: string, resolveIcon?: (relative: string) => number | null }} [options]
 *   `baseDir` is the directory the index is served from (defaults to cwd);
 *   `resolveIcon` returns the byte size of a relative icon or null when it is
 *   missing — publish-index.mjs passes one that also sees not-yet-written icons.
 * @returns {{ errors: { at: string, message: string }[], warnings: { at: string, message: string }[] }}
 */
export function validateIndex(index, options = {}) {
  const errors = []
  const warnings = []
  const baseDir = path.resolve(options.baseDir ?? process.cwd())
  const resolveIcon = options.resolveIcon ?? defaultResolveIcon(baseDir)
  const now = Math.floor(Date.now() / 1000)

  const report = (at, message) => errors.push({ at, message })
  const warn = (at, message) => warnings.push({ at, message })

  function checkLocalized(value, at, required) {
    if (value === undefined) {
      if (required) report(at, 'is required and must contain at least the "en" text')
      return
    }
    if (!isPlainObject(value)) {
      report(at, 'must be an object of language tags, e.g. { "en": "...", "zh": "..." }')
      return
    }
    const languages = Object.keys(value)
    if (languages.length === 0) report(at, 'must contain at least the "en" text')
    for (const language of languages) {
      if (typeof value[language] !== 'string' || !value[language].trim()) {
        report(`${at}.${language}`, 'must be a non-empty string')
      }
    }
    if (typeof value.en !== 'string' || !value.en.trim()) {
      report(`${at}.en`, 'English text ("en") is required')
    }
  }

  function checkIcon(value, at) {
    if (value === undefined) return
    if (typeof value !== 'string' || !value.trim()) {
      report(at, 'must be a non-empty string')
      return
    }
    const icon = value.trim()
    if (icon.startsWith('data:')) {
      const match = /^data:image\/(?:svg\+xml|png|jpeg|webp|gif|avif);base64,([A-Za-z0-9+/=\s]+)$/.exec(icon)
      if (!match) {
        report(at, 'a data: icon must be a base64 image: data:image/<type>;base64,<payload>')
        return
      }
      const bytes = Buffer.from(match[1].replace(/\s+/g, ''), 'base64').length
      if (bytes > ICON_MAX_BYTES) {
        report(at, `inline icon is ${bytes} bytes; the limit is ${ICON_MAX_BYTES}`)
      }
      return
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(icon)) {
      report(at, 'must be a path relative to this index or a data: URL, not an absolute URL')
      return
    }
    if (icon.startsWith('/') || icon.startsWith('\\')) {
      report(at, 'must be a path relative to this index, not an absolute path')
      return
    }
    if (icon.includes('\\')) {
      report(at, 'must use forward slashes in the path')
      return
    }
    if (icon.split('/').some((segment) => segment === '..')) {
      report(at, 'must not escape the index directory with ".."')
      return
    }
    if (!IMAGE_EXTENSIONS.test(icon)) {
      report(at, `must point at an image file (.svg/.png/.webp/.gif): ${icon}`)
    }
    let bytes = null
    try {
      bytes = resolveIcon(icon)
    } catch {
      bytes = null
    }
    if (bytes === null || bytes === undefined) {
      report(at, `icon file not found next to the index: ${icon}`)
    } else if (bytes > ICON_MAX_BYTES) {
      report(at, `icon is ${bytes} bytes; the limit is ${ICON_MAX_BYTES}`)
    }
  }

  function checkAuthor(value, at) {
    if (value === undefined) return
    if (typeof value === 'string') {
      if (!value.trim()) report(at, 'must be a non-empty string')
      return
    }
    if (isPlainObject(value)) {
      if (typeof value.name !== 'string' || !value.name.trim()) {
        report(`${at}.name`, 'author.name must be a non-empty string')
      }
      return
    }
    report(at, 'must be a string or { "name": "..." }')
  }

  function checkUrlLike(value, at, { required = false } = {}) {
    if (value === undefined) {
      if (required) report(at, 'is required and must be an http(s) URL')
      return
    }
    if (typeof value !== 'string' || !value.trim()) {
      report(at, 'must be a non-empty http(s) URL')
      return
    }
    const url = value.trim()
    if (/^git\+/.test(url)) {
      report(at, 'must be a plain https URL; drop the "git+" prefix')
      return
    }
    const parsed = parseUrl(url)
    if (!parsed) {
      report(at, `is not a valid URL: ${url}`)
      return
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      report(at, `must use http or https, not ${parsed.protocol}`)
    }
  }

  function checkRelativePath(value, at) {
    if (typeof value !== 'string' || !value.trim()) {
      report(at, 'must be a non-empty relative path')
      return
    }
    if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
      report(at, 'must be relative to the repository root')
      return
    }
    if (value.includes('\\')) {
      report(at, 'must use forward slashes')
      return
    }
    const segments = value.split('/')
    if (segments.some((segment) => segment === '..')) {
      report(at, 'must not contain ".."')
      return
    }
    if (segments.some((segment) => segment === '')) {
      report(at, 'must not contain empty path segments')
      return
    }
    if (value === '.') warn(at, 'is redundant; omit it to mean the repository root')
  }

  function checkSource(value, at) {
    if (!isPlainObject(value)) {
      report(at, 'is required and must be { "type": "git", ... } or { "type": "npm" }')
      return
    }
    if (value.type === 'git') {
      const url = value.url
      if (typeof url !== 'string' || !url.trim()) {
        report(`${at}.url`, 'is required for a git source')
      } else if (/^git\+/.test(url.trim())) {
        report(`${at}.url`, 'must be the plain https URL; the Harness adds the "git+" prefix itself')
      } else if (!/^https:\/\/[^\s]+$/.test(url.trim())) {
        report(`${at}.url`, `must be an https:// URL (got ${url})`)
      } else {
        if (/\.git\/?$/i.test(url.trim())) {
          report(`${at}.url`, 'must not end in ".git"; the Harness appends it when it installs')
        }
        if (/\/$/.test(url.trim())) report(`${at}.url`, 'must not end with a slash')
      }
      if (typeof value.commit !== 'string' || !SHA.test(value.commit)) {
        report(`${at}.commit`, 'must be a full 40-character lowercase commit sha')
      }
      if (value.path !== undefined) checkRelativePath(value.path, `${at}.path`)
      return
    }
    if (value.type === 'npm') {
      if (value.registry !== undefined) checkUrlLike(value.registry, `${at}.registry`)
      return
    }
    report(`${at}.type`, 'must be "git" or "npm"')
  }

  function checkVersion(value, at, seenVersions) {
    if (!isPlainObject(value)) {
      report(at, 'must be a version object')
      return
    }
    if (!isSemver(value.version)) {
      report(`${at}.version`, `must be an exact SemVer version like "1.2.3" (got ${JSON.stringify(value.version)})`)
    } else if (seenVersions.has(value.version)) {
      report(`${at}.version`, `duplicate version ${value.version}; already used by ${seenVersions.get(value.version)}`)
    } else {
      seenVersions.set(value.version, at)
    }
    if (!Number.isInteger(value.publishTimestamp)) {
      report(`${at}.publishTimestamp`, 'is required and must be an integer number of seconds since the Unix epoch')
    } else if (value.publishTimestamp < 946684800) {
      warn(`${at}.publishTimestamp`, 'is before 2000-01-01; check that it is Unix seconds, not milliseconds')
    } else if (value.publishTimestamp > now + 86400) {
      warn(`${at}.publishTimestamp`, 'is in the future')
    }
    checkSource(value.source, `${at}.source`)
    if (value.engines !== undefined) {
      if (!isPlainObject(value.engines)) {
        report(`${at}.engines`, 'must be an object like { "dsh": ">=0.2.0 <0.3.0" }')
      } else if (value.engines.dsh !== undefined) {
        if (!isSemverRange(value.engines.dsh)) {
          report(`${at}.engines.dsh`, `must be a SemVer range (got ${JSON.stringify(value.engines.dsh)})`)
        }
      }
    }
  }

  function checkPlugin(value, at, seenNames) {
    if (!isPlainObject(value)) {
      report(at, 'must be a plugin object')
      return
    }
    if (typeof value.name !== 'string' || !value.name.trim()) {
      report(`${at}.name`, 'is required (the npm package name)')
    } else {
      if (!PACKAGE_NAME.test(value.name)) {
        report(`${at}.name`, `is not a valid npm package name: ${value.name}`)
      }
      if (seenNames.has(value.name)) {
        report(`${at}.name`, `duplicate plugin name; already used by ${seenNames.get(value.name)}`)
      } else {
        seenNames.set(value.name, at)
      }
    }
    if (value.title !== undefined) checkLocalized(value.title, `${at}.title`, false)
    if (value.description !== undefined) checkLocalized(value.description, `${at}.description`, false)
    checkIcon(value.icon, `${at}.icon`)
    checkAuthor(value.author, `${at}.author`)
    if (value.homepage !== undefined) checkUrlLike(value.homepage, `${at}.homepage`)
    if (value.repository !== undefined) {
      if (!isPlainObject(value.repository)) {
        report(`${at}.repository`, 'must be an object like { "url": "https://...", "directory": "packages/x" }')
      } else {
        checkUrlLike(value.repository.url, `${at}.repository.url`, { required: true })
        if (value.repository.directory !== undefined) {
          checkRelativePath(value.repository.directory, `${at}.repository.directory`)
        }
      }
    }
    if (!Array.isArray(value.versions) || value.versions.length === 0) {
      report(`${at}.versions`, 'must be a non-empty array of versions')
      return
    }
    const seenVersions = new Map()
    value.versions.forEach((version, index) => checkVersion(version, `${at}.versions[${index}]`, seenVersions))
  }

  if (!isPlainObject(index)) {
    report('$', 'the index must be a JSON object')
    return { errors, warnings }
  }
  if (index.format !== INDEX_FORMAT) {
    report('$.format', `must be the number ${INDEX_FORMAT} (the only format the Harness reads)`)
  }
  checkLocalized(index.title, '$.title', true)
  if (index.description !== undefined) checkLocalized(index.description, '$.description', false)

  if (!Array.isArray(index.plugins)) {
    report('$.plugins', 'must be an array of plugin objects')
    return { errors, warnings }
  }
  if (index.plugins.length === 0) report('$.plugins', 'must list at least one plugin')
  const seenNames = new Map()
  index.plugins.forEach((plugin, index) => checkPlugin(plugin, `$.plugins[${index}]`, seenNames))

  return { errors, warnings }
}

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const target = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(here, '..', 'market', 'index.json')
  const label = path.relative(process.cwd(), target) || target

  let index
  try {
    index = JSON.parse(readFileSync(target, 'utf8').replace(/^\uFEFF/, ''))
  } catch (cause) {
    console.error(`✗ $  cannot read ${label}: ${cause.message}`)
    process.exitCode = 1
    return
  }

  const { errors, warnings } = validateIndex(index, { baseDir: path.dirname(target) })
  for (const { at, message } of errors) console.error(`✗ ${at}  ${message}`)
  for (const { at, message } of warnings) console.warn(`! ${at}  ${message}`)

  const plugins = Array.isArray(index?.plugins) ? index.plugins.length : 0
  const versions = Array.isArray(index?.plugins)
    ? index.plugins.reduce(
        (total, plugin) => total + (Array.isArray(plugin?.versions) ? plugin.versions.length : 0),
        0,
      )
    : 0
  const verdict = errors.length === 0 ? 'ok' : 'invalid'
  if (errors.length === 0) {
    console.log(
      `${verdict} · ${label} · ${plugins} plugin(s), ${versions} version(s), ${warnings.length} warning(s)`,
    )
  } else {
    console.error(
      `${verdict} · ${label} · ${plugins} plugin(s), ${versions} version(s) · ${errors.length} error(s), ${warnings.length} warning(s)`,
    )
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
