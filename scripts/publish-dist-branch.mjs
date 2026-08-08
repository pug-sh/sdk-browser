// Publishes the built package to the `dist` branch, so installs can skip the build:
// `bun add github:pug-sh/sdk-browser#dist`. Bun extracts the raw git tree and never runs `prepare`
// (unlike npm), so the only way it can see dist/ is if a branch carries it. Single orphan commit,
// force-pushed — re-run after every source change or consumers silently get the old build.
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BRANCH = 'dist'
const PAYLOAD = ['dist', 'README.md', 'WELL_KNOWN_EVENTS.md', 'LICENSE'] // package.json's `files`, minus the rewritten package.json

const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim()

const fail = message => {
  console.error(message)
  process.exit(1)
}

if (git(['status', '--porcelain']))
  fail('Working tree is dirty — commit or stash first, so the branch names a real source commit.')

const head = git(['rev-parse', '--short', 'HEAD'])
const origin = git(['remote', 'get-url', 'origin'])

execFileSync('bun', ['run', 'build'], { stdio: 'inherit' })

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
delete pkg.scripts // `prepare` would send npm off to rebuild from sources this branch does not carry
delete pkg.devDependencies

const staging = mkdtempSync(join(tmpdir(), 'pug-dist-'))
for (const entry of PAYLOAD) cpSync(entry, join(staging, entry), { recursive: true })
writeFileSync(join(staging, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)

const stagingGit = args => execFileSync('git', args, { cwd: staging, stdio: 'inherit' })
stagingGit(['init', '--quiet', '--initial-branch', BRANCH])
stagingGit(['add', '--all', '--force']) // a global core.excludesFile may still ignore dist/
stagingGit(['commit', '--quiet', '-m', `dist: v${pkg.version} built from ${head}`])
stagingGit(['push', '--force', '--quiet', origin, `${BRANCH}:${BRANCH}`])
rmSync(staging, { recursive: true, force: true })

console.log(`Pushed ${BRANCH} — v${pkg.version} from ${head}`)
