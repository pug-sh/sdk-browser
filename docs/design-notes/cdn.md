# `cdn.ts` / `cdn-install.ts` — the script-tag install

`scripts/build-cdn.mjs` (plain node — `npm publish` runs `prepublishOnly` under node, not bun) bundles
`src/cdn.ts` with esbuild into `dist/cdn/pug.min.js`, prints gzip size + SRI hash, and **fails the build
over `GZIP_BUDGET_KB`** (45; ~42.9 KB today). Raising it is a deliberate, reviewable change.

---

## Why the bundle lives under `dist/cdn/`

`tsc` emits `dist/pug.js` from `src/pug.ts`. A root-level bundle would overwrite that module and break
the ESM package.

## Why the docs load from `cdn.pugs.dev`, not jsDelivr

A `pkg@version` in a customer's HTML matches **Cloudflare Email Address Obfuscation** and gets rewritten
to `[email protected]`, breaking the URL. So the documented installs use an `@`-free, version-in-path URL:
`cdn.pugs.dev/vX.Y.Z/pug.min.js`.

`package.json`'s `jsdelivr` / `unpkg` fields still point at the bundle, keeping jsDelivr a `<script>`
fallback. `npm install` / bundler users resolve via `exports` / `main` and are unaffected either way.

Snippet URLs pin exact versions pre-1.0, and the fixture test asserts every doc-pinned
`cdn.pugs.dev/vX.Y.Z` equals `package.json`'s version, so a forgotten bump fails CI. At 1.0 the docs
switch to a rolling major alias (`cdn.pugs.dev/v1/`).

## `src/cdn.ts` is deliberately absent from `index.ts`

Importing the SDK stays side-effect-free; only *executing* the bundle installs the global.

---

## `installPug(w, api)`

Mutates the loader-snippet stub **in place** (object identity survives, so early-captured references
stay live), drains `_q` preserving array identity, and overrides `queue.push` so stub methods captured
pre-load dispatch live afterwards.

Two guards:

- `__loaded` already set → duplicate script load (GTM double-fire, SPA re-mount): warn + no-op, first
  install wins
- `window.pug` without a `_q` array → foreign global (e.g. the pug template engine): warn + never
  clobber

## `replayQueue` — strict FIFO, no init-hoisting

Per-call try/catch, so a throwing queued `init('')` must not kill the rest.

**No init-hoisting**: reordering would change consent semantics — autocapture's page view firing before
a queued `optOutTracking`.

Emits one aggregate warning for calls queued before the first `init`, because the docs tell integrators
to start denied via the `trackingConsent` init option, never a queued pre-init `optOutTracking()`.

## `autoInitFromScript` — the one-tag install

`data-project-id` / `data-api-key` required, `data-endpoint`, `data-options` JSON with flat attributes
winning.

**Fails closed** on any malformed input — never init with half a privacy config. Runs before replay when
no queued `init` exists (so queued calls land after init); a queued `init` always wins. Inert under GTM
or eval, where there is no `document.currentScript`.

---

## The snippet contract

The canonical loader snippet lives in `README.md`. `src/cdn-install.test.ts` extracts it, executes it
against fakes, and asserts `examples/cdn/index.html` embeds a byte-identical copy (only its `src`
differs).

Load-bearing details:

- stub shape `{ _q, _v: 1 }`
- the method list — single-sourced as `STUB_METHODS` in `cdn-install.ts`, which the `cdn.ts` api object
  `satisfies`, so adding a method in one place makes the compiler and the fixture test flag the others
- the 1,000-entry queue cap, which bounds memory when the bundle is blocked and is inert after load
  since live dispatch keeps the queue empty
- the `s.onerror` console breadcrumb
- the foreign-`window.pug` guard: `if (w.pug)` bails, but warns `[Pug SDK] …` when the existing global
  is *not* our stub (no `_q`), so a foreign global fails loud like `installPug`'s matching guard while a
  re-run over our own stub returns silently

`ready(cb)` is CDN-only: it runs `cb` post-load, and is the documented way to read getters or chain
promises, since queued calls return `undefined`.

Manual harness: `examples/cdn/index.html` — build, `bun run serve`, open `/examples/cdn/`.
