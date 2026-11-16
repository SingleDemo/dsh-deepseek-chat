/**
 * Regenerate the plugin index served from the repository.
 *
 * Usage: node scripts/publish-index.mjs [--commit <sha>]
 *
 * The index lists this package's version together with the exact commit that
 * contains it, which is what DSH installs from (`git+<url>.git#<commit>`).
 * Run it after committing the release and before committing `market/index.json`,
 * so the recorded commit is the release commit itself.
 */
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))

const args = process.argv.slice(2)
const commitFlag = args.indexOf('--commit')
const commit =
  commitFlag >= 0 && args[commitFlag + 1]
    ? args[commitFlag + 1].trim()
    : execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()

if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`not a commit sha: ${commit}`)
if (!pkg.dsh || !pkg.dsh.bundle) throw new Error('package.json does not declare dsh.bundle')
if (pkg.private === true) throw new Error('package.json still sets "private": true')

const repositoryUrl = String(pkg.repository?.url || '')
  .replace(/^git\+/, '')
  .replace(/\.git$/, '')
if (!/^https:\/\//.test(repositoryUrl)) throw new Error(`repository url must be https: ${repositoryUrl}`)

const index = {
  format: 1,
  title: { en: 'DeepSeek Chat plugin', zh: 'DeepSeek 对话插件' },
  description: {
    en: 'A DeepSeek chat panel for the DeepSeek Harness Web GUI, built from the upstream chat demo.',
    zh: 'DeepSeek Harness 的对话面板插件，界面来自上游 chat-demo。',
  },
  plugins: [
    {
      name: pkg.name,
      title: { en: 'AI Chat', zh: 'AI Chat' },
      description: {
        en: 'Chat with DeepSeek inside Harness: the official demo UI, DeepSeek account login, branch editing, and official history ZIP import/export.',
        zh: '在 Harness 里和 DeepSeek 对话：原版 demo 界面、DeepSeek 账号免 Key 登录、分支编辑、官方历史对话 ZIP 双向导入导出。',
      },
      icon: 'icons/icon.svg',
      author: typeof pkg.author === 'string' ? pkg.author : 'SingleDemo',
      homepage: String(pkg.homepage || repositoryUrl),
      repository: { url: repositoryUrl },
      versions: [
        {
          version: pkg.version,
          publishTimestamp: Math.floor(Date.now() / 1000),
          source: { type: 'git', url: repositoryUrl, commit },
          ...(pkg.engines?.dsh ? { engines: { dsh: pkg.engines.dsh } } : {}),
        },
      ],
    },
  ],
}

const marketDir = path.join(root, 'market')
await mkdir(path.join(marketDir, 'icons'), { recursive: true })
await writeFile(path.join(marketDir, 'index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8')

// The icon is served next to the index, so copy the bundle icon under icons/.
try {
  const icon = await readFile(path.join(root, 'icon.svg'))
  await writeFile(path.join(marketDir, 'icons', 'icon.svg'), icon)
} catch {
  throw new Error('icon.svg is missing; the index points at icons/icon.svg')
}

console.log(`market/index.json · ${pkg.name} ${pkg.version} · commit ${commit.slice(0, 12)}`)
console.log('serve it at: https://cdn.jsdelivr.net/gh/SingleDemo/dsh-deepseek-chat@main/market/index.json')
console.log('next: commit market/ together with the release')
