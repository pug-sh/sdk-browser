// Pure, testable logic for publishing the CDN bundle to Cloudflare R2 (see scripts/publish-cdn.mjs
// for the side-effectful CLI): the immutable-path upload plan and SigV4 signing for R2's S3 API.
import { createHash, createHmac } from 'node:crypto'

// One-year immutable cache: every path is version-pinned (v<x.y.z>/…), so the bytes at a given URL
// never change and browsers/edges may cache them forever.
export const CACHE_CONTROL = 'public, max-age=31536000, immutable'

// The artifacts scripts/build-cdn.mjs emits into dist/cdn/, in upload order. Content types are set
// explicitly because R2 does not infer them: pug.min.js must serve as JavaScript, the sourcemap as
// JSON, and the Apache-2.0 attribution sidecar as text.
export const CDN_ARTIFACTS = [
  { name: 'pug.min.js', contentType: 'text/javascript' },
  { name: 'pug.min.js.map', contentType: 'application/json' },
  { name: 'pug.min.js.LEGAL.txt', contentType: 'text/plain; charset=utf-8' },
]

// R2 object key for an artifact of a given release, e.g. objectKey('0.0.3', 'pug.min.js') →
// 'v0.0.3/pug.min.js'. The documented `<script>` URL is https://cdn.pugs.dev/<key>.
export const objectKey = (version, name) => `v${version}/${name}`

// Subresource Integrity hash of some bytes, matching the value scripts/build-cdn.mjs prints, so the
// publish step can reprint an SRI guaranteed to describe the uploaded pug.min.js.
export const sriHash = bytes => `sha384-${createHash('sha384').update(bytes).digest('base64')}`

// Decide what to do with one artifact whose immutable key may already exist remotely.
//   remoteHash === null      → object absent → 'upload'
//   remoteHash === localHash → identical bytes already published → 'skip' (idempotent; this is how an
//                              interrupted prior publish is completed — only the missing files upload)
//   otherwise                → refuse: the path is immutable and the bytes differ, so overwriting would
//                              silently change what already-cached clients fetch. Throw; bump the version.
export const planUpload = (key, localHash, remoteHash) => {
  if (remoteHash === null) return 'upload'
  if (remoteHash === localHash) return 'skip'
  throw new Error(
    `Refusing to overwrite ${key}: it is already published with different bytes ` +
      `(remote ${remoteHash} ≠ local ${localHash}). CDN paths are immutable — bump the version instead of overwriting.`,
  )
}

// Plan every artifact before any upload: `readLocal(name)` → Buffer or null, `fetchRemote(key)` → a
// promise of Buffer or null. Rejects before returning any plan on a missing artifact or an immutable
// path holding different bytes, so a mismatch on artifact N never leaves artifacts 1..N-1 uploaded.
export const planAll = async (artifacts, version, { readLocal, fetchRemote }) => {
  const plans = []
  for (const { name, contentType } of artifacts) {
    const localBytes = readLocal(name)
    if (localBytes === null) throw new Error(`Missing build artifact ${name} — run \`bun run build\` first.`)
    const key = objectKey(version, name)
    const remoteBytes = await fetchRemote(key)
    const action = planUpload(key, sriHash(localBytes), remoteBytes === null ? null : sriHash(remoteBytes))
    plans.push({ key, name, contentType, size: localBytes.length, action })
  }
  return plans
}

// True when a version string is a shape we're willing to mint into an immutable, public CDN path
// (cdn.pugs.dev/v<version>/…). Guards against publishing "vundefined/…" from a missing or garbage
// package.json version; it is a path-shape check, NOT full semver validation (the publish never
// compares or ranges versions). Prerelease/build metadata (1.2.0-rc.1, 1.2.0+build) is allowed.
export const isPublishableVersion = version => /^\d+\.\d+\.\d+(?:[-+].+)?$/.test(version ?? '')

// A 404 is an absent object only with S3's NoSuchKey code: NoSuchBucket and every other failure stay
// fatal, so a misconfigured publish never reads as "nothing published yet".
export const isMissingKey = (status, body) => status === 404 && body.includes('<Code>NoSuchKey</Code>')

const encodeSegment = segment =>
  encodeURIComponent(segment).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

// Path-style URL on the account's R2 S3 endpoint, each segment encoded as SigV4 canonicalizes it.
export const objectUrl = (accountId, bucket, key) =>
  `https://${accountId}.r2.cloudflarestorage.com/${[bucket, ...key.split('/')].map(encodeSegment).join('/')}`

const sha256Hex = data => createHash('sha256').update(data).digest('hex')
const hmac = (key, data) => createHmac('sha256', key).update(data).digest()

// AWS Signature Version 4 over every header sent. Returns the headers to send; host is signed but left
// to fetch, which derives it from `url`, whose path must already be encoded.
export const signRequest = ({
  method,
  url,
  headers = {},
  body = '',
  accessKeyId,
  secretAccessKey,
  region = 'auto',
  now = new Date(),
}) => {
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, '')
  const scope = `${amzDate.slice(0, 8)}/${region}/s3/aws4_request`
  const { host, pathname } = new URL(url)
  const payloadHash = sha256Hex(body)
  const sent = { ...headers, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate }
  const canonical = Object.entries({ ...sent, host })
    .map(([name, value]) => [name.toLowerCase(), String(value).trim().replace(/\s+/g, ' ')])
    .sort(([a], [b]) => (a < b ? -1 : 1))
  const signedHeaders = canonical.map(([name]) => name).join(';')
  const canonicalRequest = [
    method,
    pathname,
    '',
    ...canonical.map(([name, value]) => `${name}:${value}`),
    '',
    signedHeaders,
    payloadHash,
  ].join('\n')
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n')
  const signingKey = scope.split('/').reduce(hmac, `AWS4${secretAccessKey}`)
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')
  return {
    ...sent,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  }
}
