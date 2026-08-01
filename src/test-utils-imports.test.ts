import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The *.test-utils.ts files are excluded from tsconfig.json, but `exclude` only prunes roots: a
 * production module importing one pulls it back into the build and emits it to dist/. For
 * consent-gate.test-utils.ts that means shipping pre-minted GrantedGate values — a consent-system
 * bypass that compiles, typechecks, and leaves every runtime suite green, since the brand's whole
 * job is done at build time. The files' own headers state the rule ("nothing under src/ outside
 * tests may import this"); with Biome's linter disabled there is no import-restriction rule, so
 * this spec is the enforcement, the same way cdn-install.test.ts enforces the README snippet by
 * reading source text.
 */

// The argument must reach `new URL` as a *variable*: with a string literal in place, Vite's
// asset-URL transform statically rewrites `new URL('…', import.meta.url)` to an http dev-server
// URL that node:fs rejects (ERR_INVALID_URL_SCHEME). A function parameter is opaque to the
// transform — the same reason well-known-events-doc.test.ts routes its paths through `read(rel)`.
const srcUrl = (rel: string): URL => new URL(rel, import.meta.url)

const isTestFile = (name: string): boolean =>
  name.endsWith('.test.ts') || name.endsWith('.test-d.ts') || name.endsWith('.test-utils.ts')

/** Every shipped .ts under src/, path relative to src/ — recursion covers events/ and gen/. */
const shippedSources = (prefix = ''): string[] =>
  readdirSync(srcUrl(`./${prefix}`), { withFileTypes: true }).flatMap(entry => {
    if (entry.isDirectory()) {
      return shippedSources(`${prefix}${entry.name}/`)
    }
    return entry.name.endsWith('.ts') && !isTestFile(entry.name) ? [`${prefix}${entry.name}`] : []
  })

describe('test-utils import discipline', () => {
  it('no shipped module under src/ imports a *.test-utils file', () => {
    // `from '…'` covers import-from and export-from; `import '…'` a bare side-effect import;
    // `import('…')`/`require('…')` the dynamic forms — tsc emits a dynamically-imported module to
    // dist/ exactly like a static one. A text-level guard can false-positive on a comment quoting
    // such a path; acceptable, since the fix is rewording the comment and the alternative is
    // missing a real import.
    const importsTestUtils = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"][^'"]*test-utils[^'"]*['"]/
    const offenders = shippedSources().filter(rel => importsTestUtils.test(readFileSync(srcUrl(rel), 'utf8')))
    expect(offenders).toEqual([])
  })

  it('the discipline has something to guard (the test-utils files and the walk both work)', () => {
    // If the helpers are ever renamed — or the directory walk silently returns nothing — the
    // import scan above matches nothing and passes vacuously; these canaries fail instead,
    // pointing here.
    const names = readdirSync(srcUrl('./'))
    expect(names).toContain('consent-gate.test-utils.ts')
    expect(names).toContain('storage-envelope.test-utils.ts')
    expect(shippedSources()).toContain('pug.ts')
  })
})
