# Releasing

Pushing a version tag publishes, through `.github/workflows/release.yml`. A release ships **two** things:

- the **npm package** (`npm publish`) — for `npm install` / bundler users; jsDelivr also serves it from npm as a fallback.
- the **CDN bundle** to **`cdn.pugs.dev`** (first-party Cloudflare R2) — the URL the documented `<script>` installs point at: `https://cdn.pugs.dev/vX.Y.Z/pug.min.js`. It's an **`@`-free, version-in-path** URL on purpose: a `pkg@version` substring in a customer's HTML matches Cloudflare Email Address Obfuscation and gets rewritten to `[email protected]`, breaking the load — the path form avoids that on every customer's Cloudflare zone.

## Installing without a release

`dist/` is not committed, so a git install has to build. npm does that itself — `npm i github:pug-sh/sdk-browser` (optionally `#<branch|sha>`) installs the devDependencies, runs `prepare`, and packs per the `files` allowlist. That is what the `prepare` script is for.

**Bun does not.** It extracts the repo tarball verbatim — no `prepare`, no build, no `files` filtering — so it would install a package carrying `src/` and `proto/` and no `dist/`, with `main` resolving to nothing. Neither a full `git+https://` URL nor the consumer's `trustedDependencies` changes that (checked on bun 1.3.14), and it is not specific to this repo: `github:sindresorhus/ky` builds under npm and not under bun.

So the build output has to be in the tree bun extracts. The **`dist`** branch is that tree, and it installs with any package manager:

```bash
bun add github:pug-sh/sdk-browser#dist
```

CI republishes it on every push to `main` (the `publish-dist` job, gated behind `build`); `bun run publish:dist` does it by hand. Either way it is one orphan commit, force-pushed, carrying what `npm pack` would ship plus a `package.json` with `scripts` and `devDependencies` stripped — leaving `prepare` on the branch would send npm off to rebuild from sources the branch does not carry. An identical rebuild is not republished, since lockfiles pin the branch by commit sha and a docs-only commit shouldn't churn them.

This is **not** a release: the branch tracks `main`, so it carries unreleased work under whatever version `package.json` had at build time. It is for the pre-launch window; consumers who need a stable artifact want the npm package or a pinned CDN bundle.

## One-time setup

**Cloudflare**

1. Create the R2 bucket (default `pugs-dev-cdn`; override with `PUG_CDN_BUCKET`): `bunx wrangler r2 bucket create pugs-dev-cdn`.
2. Attach the custom domain: R2 → `pugs-dev-cdn` → Settings → **Custom Domains** → add `cdn.pugs.dev` (Cloudflare creates the proxied DNS record + edge cert automatically).
3. **Only if** you want integrators to use `integrity`/`crossorigin`: add a bucket **CORS** rule allowing `Access-Control-Allow-Origin: *`. A plain `<script src>` needs no CORS.
4. Create the upload token: R2 → **Manage API tokens** → create an API token with **Object Read & Write**, applied to `pugs-dev-cdn` only. Store its S3 credentials as the repository secrets `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` (`gh secret set R2_ACCESS_KEY_ID`). wrangler rejects a token scoped to a bucket, which is why `scripts/publish-cdn.mjs` speaks R2's S3 API itself.

**npm**

5. Add a trusted publisher: npmjs.com → `@pug-sh/browser` → Settings → **Trusted publishing** → GitHub Actions, organization `pug-sh`, repository `sdk-browser`, workflow `release.yml`, no environment. The CLI equivalent, `npm trust github @pug-sh/browser --repo pug-sh/sdk-browser --file release.yml --allow-publish`, needs 2FA on the account and refuses a bypass-2FA token. A new trusted publisher must make its first publish within 2 days, so add it shortly before a release.

## Each release

0. **Clear the proto pin**: `make check-proto-pin`. The release workflow runs it too and fails the release on a divergence; running it first saves a dead tag. It re-downloads the pinned BSR commit and diffs it against the committed `proto/` mirror, proving nothing is hand-patched ahead of the pin.

   If it fails, `proto/` is hand-patched ahead of the pin: merge the backend branch, `make proto-latest`, bump `PROTO_COMMIT` in the `Makefile`, then `make sync-protos && make protos` and commit the diff.

   No other check catches this. CI runs `make protos` against the *committed* mirror, so a hand-patched `proto/` regenerates consistently and `make check-codegen` stays green — only a fresh BSR download can tell, which is why this check needs network access and runs at release time rather than in CI.

1. **Bump the version** in `package.json` (semver; pre-1.0 minors may break).
2. **Update the pinned snippet URLs** in `README.md` (`cdn.pugs.dev/vX.Y.Z/pug.min.js`) — enforced: the test suite fails if any pinned URL differs from `package.json`'s version. While pre-1.0 the documented snippet pins exact versions; at 1.0 switch the docs to a rolling major alias (`cdn.pugs.dev/v1/…`) and this step mostly goes away.
3. **Build**: `bun run build`. The `prebuild` hook stamps `src/version.ts`, which the release commit must carry. The build fails if the bundle exceeds the gzip budget (`GZIP_BUDGET_KB` in `scripts/build-cdn.mjs`).
4. **Check**: `make ci`, the gate the release workflow runs.
5. **Commit** as `Release vX.Y.Z` — `package.json`, the restamped `src/version.ts` and the doc URL bumps. Tag `vX.Y.Z` and push the commit and the tag.
6. **The tag runs `release.yml`**: it checks that the tag names `package.json`'s version, runs `make check-proto-pin ci` and fails on any uncommitted change, then packs the package once. The `cdn` job uploads the bundle inside that package to `pugs-dev-cdn/vX.Y.Z/` with a one-year immutable cache header, and the `npm` job then publishes the same tarball, with provenance. Paths are immutable, so the upload hashes any already-present object and **aborts if the bytes differ** (bump the version rather than overwrite). A failed job can be re-run: identical files are skipped, and npm publishes only after the CDN upload succeeds.
7. **Verify the CDN**: `curl -I https://cdn.pugs.dev/vX.Y.Z/pug.min.js` — expect `200`, `content-type: text/javascript`, and an `immutable` `cache-control`. If paranoid, confirm the served hash matches the SRI in the run summary: `curl -s https://cdn.pugs.dev/vX.Y.Z/pug.min.js | openssl dgst -sha384 -binary | base64`. (jsDelivr fallback URL: `curl -I https://cdn.jsdelivr.net/npm/@pug-sh/browser@X.Y.Z/dist/cdn/pug.min.js`.)
8. **Release notes**: create a GitHub release for the tag; include the URL and `sha384-…` SRI block from the run's summary so strict-CSP integrators can pin it.

Immutable, version-pinned paths need no cache purge. (A rolling alias — `/v1/`, once the docs use one post-1.0 — would: publish it separately with a short cache and purge on each release.)

## Publishing by hand

The fallback when CI cannot run: `npm publish` (needs a bypass-2FA token in `~/.npmrc`; `prepublishOnly` runs the proto pin check and rebuilds), then `R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… bun run scripts/publish-cdn.mjs` against the same build.
