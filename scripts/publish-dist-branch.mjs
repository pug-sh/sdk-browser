// Builds the package and force-pushes it to the `dist` branch as a single orphan commit, so
// `bun add github:pug-sh/sdk-browser#dist` installs without a build step — bun never runs `prepare`.
// Runs on every main push (CI) and by hand as `bun run publish:dist`. See RELEASING.md.
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BRANCH = 'dist'
const PAYLOAD = ['dist', 'README.md', 'WELL_KNOWN_EVENTS.md', 'LICENSE'] // package.json's `files`, minus the rewritten package.json

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

const fail = message => {
  console.error(message)
  process.exit(1)
}

if (git(['status', '--porcelain']))
  fail('Working tree is dirty — commit or stash first, so the branch names a real source commit.')

const head = git(['rev-parse', '--short', 'HEAD'])

execFileSync('bun', ['run', 'build'], { stdio: 'inherit' })

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
delete pkg.scripts // `prepare` would send npm off to rebuild from sources this branch does not carry
delete pkg.devDependencies

const staging = mkdtempSync(join(tmpdir(), 'pug-dist-'))
for (const entry of PAYLOAD) cpSync(entry, join(staging, entry), { recursive: true })
writeFileSync(join(staging, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)

git(['init', '--quiet', '--initial-branch', BRANCH], staging)
git(['add', '--all', '--force'], staging) // a global core.excludesFile may still ignore dist/
git(['commit', '--quiet', '-m', `dist: v${pkg.version} built from ${head}`], staging)
const tree = git(['rev-parse', `${BRANCH}^{tree}`], staging)

const done = message => {
  rmSync(staging, { recursive: true, force: true })
  console.log(message)
}

// Consumers' lockfiles pin this branch by commit sha, so republishing a byte-identical build would
// churn them for nothing — skip it. The build is deterministic, so a docs-only commit lands here.
if (git(['ls-remote', 'origin', `refs/heads/${BRANCH}`])) {
  git(['fetch', '--quiet', 'origin', `refs/heads/${BRANCH}`])
  if (git(['rev-parse', 'FETCH_HEAD^{tree}']) === tree) {
    done(`${BRANCH} already carries this build — nothing to push.`)
    process.exit(0)
  }
}

// Push through the main repo's remote, so this works wherever `git push` already does: SSH locally,
// the checkout's token in CI. The staging repo has no credentials of its own.
git(['fetch', '--quiet', staging, BRANCH])
git(['push', '--force', '--quiet', 'origin', `FETCH_HEAD:refs/heads/${BRANCH}`])
done(`Pushed ${BRANCH} — v${pkg.version} from ${head}`)
