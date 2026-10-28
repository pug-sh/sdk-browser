// Publishes the built CDN bundle to Cloudflare R2 (served at https://cdn.pugs.dev): uploads
// dist/cdn/pug.min.js{,.map,.LEGAL.txt} to <bucket>/vX.Y.Z/ with an immutable one-year cache header.
// The release workflow runs it on a version tag; by hand it is `bun run scripts/publish-cdn.mjs` after
// `bun run build` (see RELEASING.md).
//
// Paths are immutable: for each artifact this reads back any object already at the key and compares
// its SHA-384 hash — identical → skip (so an interrupted publish is finished by uploading only the
// missing files), different → abort before uploading anything (bump the version rather than
// overwrite). The plan-everything-then-upload split lives in planAll (publish-cdn.lib.mjs) so a
// mismatch on any artifact aborts before a single upload; its test pins that ordering guarantee. It
// reprints the SRI, now guaranteed to match the live pug.min.js.
//
// Talks to R2's S3 API as R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY, an R2 token with Object Read &
// Write on the bucket only. PUG_CDN_BUCKET and CLOUDFLARE_ACCOUNT_ID override the bucket and account.
import { existsSync, readFileSync } from 'node:fs'
import {
  CACHE_CONTROL,
  CDN_ARTIFACTS,
  isMissingKey,
  isPublishableVersion,
  objectUrl,
  planAll,
  signRequest,
  sriHash,
} from './publish-cdn.lib.mjs'

const DIST_DIR = 'dist/cdn'
const bucket = process.env.PUG_CDN_BUCKET ?? 'pugs-dev-cdn'
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? '958db99f58728f8f2f12d2b503f8a2a7'
const { R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey } = process.env

const fail = message => {
  console.error(message)
  process.exit(1)
}

const s3 = (method, key, { body, headers } = {}) => {
  const url = objectUrl(accountId, bucket, key)
  return fetch(url, {
    method,
    body,
    headers: signRequest({ method, url, headers, body, accessKeyId, secretAccessKey }),
  })
}

// The remote bytes at a key, or null if the object does not exist. Any other failure throws.
const fetchRemote = async key => {
  const res = await s3('GET', key)
  if (res.ok) return Buffer.from(await res.arrayBuffer())
  const body = await res.text()
  if (isMissingKey(res.status, body)) return null
  throw new Error(`Could not read ${bucket}/${key} from R2 (HTTP ${res.status}):\n${body}`)
}

if (!accessKeyId || !secretAccessKey) {
  fail('Set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY to an R2 token with Object Read & Write on the bucket.')
}

let version
try {
  version = JSON.parse(readFileSync('package.json', 'utf8')).version
} catch (err) {
  fail(`Could not read package.json (run this from the repo root): ${err.message}`)
}
// This version becomes an immutable, publicly-loaded path (cdn.pugs.dev/v<version>/…); refuse a missing
// or malformed one here rather than publish "vundefined/…" (isPublishableVersion is pinned in the lib test).
if (!isPublishableVersion(version)) {
  fail(`package.json version ${JSON.stringify(version)} is not valid semver — refusing to publish.`)
}

if (!existsSync(`${DIST_DIR}/pug.min.js`)) {
  fail(`No build at ${DIST_DIR}/pug.min.js — run \`bun run build\` first.`)
}

console.log(`Publishing v${version} to R2 bucket "${bucket}"…`)

// Phase 1: read back every artifact and decide upload/skip/abort. planAll throws on an immutable-path
// content mismatch (or a missing build artifact), so a differing byte on ANY artifact aborts here —
// before Phase 2 runs a single upload.
let plans
try {
  plans = await planAll(CDN_ARTIFACTS, version, {
    readLocal: name => {
      const localPath = `${DIST_DIR}/${name}`
      return existsSync(localPath) ? readFileSync(localPath) : null
    },
    fetchRemote,
  })
} catch (err) {
  fail(err.cause ? `${err.message} (${err.cause.message})` : err.message)
}

// Phase 2: upload only the artifacts that are absent.
let uploaded = 0
for (const { key, name, contentType, size, action } of plans) {
  if (action === 'skip') {
    console.log(`  skip    ${key} (identical bytes already published)`)
    continue
  }
  const res = await s3('PUT', key, {
    body: readFileSync(`${DIST_DIR}/${name}`),
    headers: { 'content-type': contentType, 'cache-control': CACHE_CONTROL },
  })
  if (!res.ok) fail(`Failed to upload ${bucket}/${key} (HTTP ${res.status}):\n${await res.text()}`)
  console.log(`  upload  ${key} (${size} B, ${contentType})`)
  uploaded++
}

console.log(`\nDone: ${uploaded} uploaded, ${plans.length - uploaded} unchanged.`)
console.log(`URL  https://cdn.pugs.dev/v${version}/pug.min.js`)
console.log(`SRI  ${sriHash(readFileSync(`${DIST_DIR}/pug.min.js`))}`)
