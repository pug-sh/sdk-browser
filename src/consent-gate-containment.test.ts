import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * `GrantedGate`/`TrackingGate` are nominal brands whose phantom `__gate` member is a plain property:
 * an `as GrantedGate` cast or an `Object.assign` mints one, and no type can stop that. The design
 * therefore rests on *containment* — every mint lives in tracking-consent.ts, the module that owns
 * the brand, which is why `deferredGrantedGate` exists at all rather than the cast being written
 * inline in `init()`, where it is textually indistinguishable from the wrapper-arrow laundering
 * consent-gate.test-d.ts rejects.
 *
 * Nothing enforced that containment. A shipped module minting its own `((): boolean => true) as
 * GrantedGate` typechecks, passes every runtime suite and passes test-utils-imports.test.ts, while
 * silently bypassing the consent system on the paths those gates guard — identity writes. This spec
 * is the enforcement, the same source-text discipline test-utils-imports.test.ts applies to helper
 * imports and cdn-install.test.ts applies to the README snippet.
 */

// A variable, not a literal: Vite's asset-URL transform statically rewrites a literal
// `new URL('…', import.meta.url)` into a dev-server URL node:fs rejects. See the same note in
// test-utils-imports.test.ts.
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

/** The module that owns the brand, and the only place a mint may appear. */
const BRAND_OWNER = 'tracking-consent.ts'

describe('consent gate mint containment', () => {
  it('no shipped module outside tracking-consent.ts mints a gate', () => {
    // `as <Brand>` catches the cast in every spacing; `__gate` catches an object literal or
    // Object.assign that supplies the phantom member directly. Type-position uses (`isGranted:
    // GrantedGate`, `import type { GrantedGate }`) are deliberately not matched — they are how
    // consumers are *supposed* to name the brand.
    const mintsGate = /\bas\s+(?:Granted|Tracking)Gate\b|\bas\s+ConsentGate\b|__gate/
    const offenders = shippedSources()
      .filter(rel => rel !== BRAND_OWNER)
      .filter(rel => mintsGate.test(readFileSync(srcUrl(rel), 'utf8')))
    expect(offenders).toEqual([])
  })

  it('the discipline has something to guard (the owner really does mint, and the walk works)', () => {
    // Without these the scan passes vacuously if the brand is renamed, the mints move, or the
    // directory walk returns nothing — the same anti-vacuity canary test-utils-imports.test.ts uses.
    const owner = readFileSync(srcUrl(`./${BRAND_OWNER}`), 'utf8')
    expect(owner).toMatch(/as GrantedGate/)
    expect(owner).toMatch(/__gate/)
    expect(shippedSources()).toContain('pug.ts')
    expect(shippedSources()).toContain(BRAND_OWNER)
  })
})
