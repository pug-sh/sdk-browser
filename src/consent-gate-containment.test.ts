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

/**
 * The spellings of "produce a branded gate here" that a source-text rule can see. Each is a way
 * *around* the one before it, which is the whole risk with this kind of rule: the discipline is only
 * as good as its evasions are closed, and a rule that names one syntax reads as complete while the
 * others sail past.
 *
 * This set is a speed bump, NOT a proof. Two evasions are known-open and cannot be closed by
 * scanning, because they produce a *genuinely* branded gate with no cast and no phantom member to
 * grep for:
 *
 *   1. Borrowing a controller's own gate — `createTrackingConsent('x', 'granted').isGranted` — which
 *      is a real gate answering to a controller the calling module invented.
 *   2. Deriving the type without naming the brand — `ReturnType<typeof createTrackingConsent>
 *      ['isGranted']` — then casting to that alias.
 *
 * What actually contains those is that both entry points are internal (absent from index.ts), so a
 * new call site is a reviewable addition in this repo rather than something a consumer can reach.
 * The rules below exist to catch the *accidental* swap, which is what the brand was built for.
 *
 * Type-position uses (`isGranted: GrantedGate`, `import type { GrantedGate }`) are deliberately not
 * matched — naming the brand is how consumers are *supposed* to use it.
 */
const MINT_PATTERNS: readonly RegExp[] = [
  // The `as` cast, in every spacing.
  /\bas\s+(?:Granted|Tracking|Consent)Gate\b/,
  // The angle-bracket cast `<GrantedGate>fn`, which the `as` rule never saw. The lookbehind keeps
  // ordinary generic arguments out — `Set<GrantedGate>` is preceded by an identifier character, a
  // cast never is.
  /(?<![\w$])<\s*(?:Granted|Tracking|Consent)Gate\s*>/,
  // The phantom member supplied directly, by object literal or Object.assign.
  /__gate/,
  // Aliasing the brand at the import (`import type { GrantedGate as GG }`), which renames it out of
  // all three rules above and leaves `as GG` looking like an ordinary cast. No shipped module has a
  // reason to rename it.
  /\b(?:Granted|Tracking|Consent)Gate\s+as\s+\w/,
]

/**
 * The cast-free evasion: `deferredGrantedGate` is exported, so any module could call it with its own
 * `() => controller` and get a real branded gate answering to a controller it chose — no cast, no
 * phantom member, nothing for the mint rules above to match. It is exported because the wiring
 * genuinely spans two modules (the controller needs the store, the store needs the cookie layer).
 *
 * Two patterns, for the reason the mint set has four: the bare call, and the call *aliased at the
 * import*. Aliasing is closed for the brand (mint pattern 4) but was open here — the identical move
 * against the other half of the discipline. `import { deferredGrantedGate as mint }` renames every
 * call to `mint(`, and the mint rules never fired either, since their `\b` cannot match inside
 * `deferredGrantedGate`.
 */
const FACTORY_PATTERNS: readonly RegExp[] = [/deferredGrantedGate\s*\(/, /\bdeferredGrantedGate\s+as\s+\w/]

/** The owner plus pug.ts, the single wiring site — the owner is listed because it defines the factory. */
const GATE_FACTORY_CALLERS = new Set([BRAND_OWNER, 'pug.ts'])

describe('consent gate mint containment', () => {
  it('no shipped module outside tracking-consent.ts mints a gate', () => {
    const offenders = shippedSources()
      .filter(rel => rel !== BRAND_OWNER)
      .filter(rel => {
        const source = readFileSync(srcUrl(rel), 'utf8')
        return MINT_PATTERNS.some(pattern => pattern.test(source))
      })
    expect(offenders).toEqual([])
  })

  it('only the documented wiring site calls the gate factory', () => {
    // A comment naming deferredGrantedGate (session.ts has one) is not a mint; a *call* is.
    const offenders = shippedSources()
      .filter(rel => !GATE_FACTORY_CALLERS.has(rel))
      .filter(rel => FACTORY_PATTERNS.some(pattern => pattern.test(readFileSync(srcUrl(rel), 'utf8'))))
    expect(offenders).toEqual([])
  })

  it('every factory pattern actually matches the evasion it names', () => {
    // The brand rules close import-aliasing (pattern 4); the factory rule did not, which is the
    // identical move against the other half of the discipline. `import { deferredGrantedGate as
    // mint }` renames the call to `mint(`, and the `\b` in the brand rules does not fire inside
    // `deferredGrantedGate` (the G is preceded by a word character), so nothing matched at all.
    const evasions = [
      'const g = deferredGrantedGate(() => controller)',
      "import { deferredGrantedGate as mint } from './tracking-consent.js'",
    ]
    for (const [i, evasion] of evasions.entries()) {
      expect(FACTORY_PATTERNS.some(pattern => pattern.test(evasion))).toBe(true)
      expect(FACTORY_PATTERNS[i]?.test(evasion)).toBe(true)
    }
  })

  it('the discipline has something to guard (the owner really does mint, and the walk works)', () => {
    // Without these the scan passes vacuously if the brand is renamed, the mints move, or the
    // directory walk returns nothing — the same anti-vacuity canary test-utils-imports.test.ts uses.
    const owner = readFileSync(srcUrl(`./${BRAND_OWNER}`), 'utf8')
    expect(owner).toMatch(/as GrantedGate/)
    expect(owner).toMatch(/__gate/)
    expect(shippedSources()).toContain('pug.ts')
    expect(shippedSources()).toContain(BRAND_OWNER)
    // And the factory rule: the one permitted caller really does call it.
    expect(readFileSync(srcUrl('./pug.ts'), 'utf8')).toMatch(/deferredGrantedGate\s*\(/)
  })

  it('every mint pattern actually matches the evasion it names', () => {
    // Each rule exists because the previous one missed something, so each needs its own canary: a
    // rule that silently stops matching (a renamed brand, a broken lookbehind) leaves the scan
    // green while the hole it closed is open again.
    const evasions = [
      'const g = fn as GrantedGate',
      'const g = <GrantedGate>fn',
      'const g = Object.assign(fn, { __gate: "granted" })',
      "import type { GrantedGate as GG } from './tracking-consent.js'",
    ]
    for (const [i, evasion] of evasions.entries()) {
      expect(MINT_PATTERNS.some(pattern => pattern.test(evasion))).toBe(true)
      // And the rule it names is the one that catches it, so a rule cannot quietly go dead behind
      // another's match.
      expect(MINT_PATTERNS[i]?.test(evasion)).toBe(true)
    }
    // The lookbehind's job: an ordinary generic argument is not a cast.
    expect(MINT_PATTERNS[1]?.test('const gates = new Set<GrantedGate>()')).toBe(false)
  })
})
