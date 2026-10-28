import { describe, expect, it } from 'vitest'
import {
  CACHE_CONTROL,
  CDN_ARTIFACTS,
  isMissingKey,
  isPublishableVersion,
  objectKey,
  objectUrl,
  planAll,
  planUpload,
  signRequest,
  sriHash,
} from './publish-cdn.lib.mjs'

describe('objectKey', () => {
  it('version-pins the path with a leading v', () => {
    expect(objectKey('0.0.3', 'pug.min.js')).toBe('v0.0.3/pug.min.js')
    expect(objectKey('1.2.0', 'pug.min.js.map')).toBe('v1.2.0/pug.min.js.map')
  })
})

describe('sriHash', () => {
  it('matches the sha384 SRI format build-cdn.mjs prints (known vectors)', () => {
    // Independently computed: `printf '' | openssl dgst -sha384 -binary | base64`, likewise 'abc'.
    expect(sriHash(Buffer.from(''))).toBe('sha384-OLBgp1GsljhM2TJ+sbHjaiH9txEUvgdDTAzHv2P24donTt6/529l+9Ua0vFImLlb')
    expect(sriHash(Buffer.from('abc'))).toBe('sha384-ywB1P0WjXou1oD1pmsZQBycsMqsO3tFjGotgWkP/W+2AhgcroefMI1i67KE0yCWn')
  })

  it('is sensitive to a single-byte change', () => {
    expect(sriHash(Buffer.from('abc'))).not.toBe(sriHash(Buffer.from('abd')))
  })
})

describe('planUpload', () => {
  it('uploads when the object is absent', () => {
    expect(planUpload('v0.0.3/pug.min.js', 'sha384-abc', null)).toBe('upload')
  })

  it('skips when the published bytes are identical (idempotent re-run / interrupted publish)', () => {
    expect(planUpload('v0.0.3/pug.min.js', 'sha384-abc', 'sha384-abc')).toBe('skip')
  })

  it('refuses to overwrite an immutable path whose bytes differ', () => {
    expect(() => planUpload('v0.0.3/pug.min.js', 'sha384-abc', 'sha384-xyz')).toThrow(/immutable/i)
    expect(() => planUpload('v0.0.3/pug.min.js', 'sha384-abc', 'sha384-xyz')).toThrow(/v0\.0\.3\/pug\.min\.js/)
  })
})

describe('planAll', () => {
  // A local fixture that mirrors CDN_ARTIFACTS, kept independent on purpose: planAll takes `artifacts`
  // as a parameter, so these logic tests stay pinned to a fixed set even if the real manifest grows.
  // (CDN_ARTIFACTS's own contents are asserted separately in the "artifact manifest" block below.)
  const artifacts = [
    { name: 'pug.min.js', contentType: 'text/javascript' },
    { name: 'pug.min.js.map', contentType: 'application/json' },
    { name: 'pug.min.js.LEGAL.txt', contentType: 'text/plain; charset=utf-8' },
  ]
  // Inject the two I/O seams as plain maps: local bytes keyed by artifact name, remote bytes keyed by
  // object key. Absent from the map → null, matching the real readLocal/fetchRemote contract.
  const deps = (local, remote) => ({
    readLocal: name => (name in local ? Buffer.from(local[name]) : null),
    fetchRemote: async key => (key in remote ? Buffer.from(remote[key]) : null),
  })

  it('plans an upload for every artifact when nothing is published yet (fresh release)', async () => {
    const plans = await planAll(
      artifacts,
      '0.0.3',
      deps({ 'pug.min.js': 'js', 'pug.min.js.map': 'map', 'pug.min.js.LEGAL.txt': 'legal' }, {}),
    )
    expect(plans.map(p => p.action)).toEqual(['upload', 'upload', 'upload'])
    expect(plans.map(p => p.key)).toEqual(['v0.0.3/pug.min.js', 'v0.0.3/pug.min.js.map', 'v0.0.3/pug.min.js.LEGAL.txt'])
    // The plan carries exactly what Phase 2 needs to upload: artifact name, content type, and size.
    expect(plans[0]).toMatchObject({ name: 'pug.min.js', contentType: 'text/javascript', size: 2 })
  })

  it('skips already-published identical bytes and uploads the rest (interrupted publish resumes)', async () => {
    const plans = await planAll(
      artifacts,
      '0.0.3',
      deps(
        { 'pug.min.js': 'js', 'pug.min.js.map': 'map', 'pug.min.js.LEGAL.txt': 'legal' },
        { 'v0.0.3/pug.min.js': 'js' }, // only pug.min.js landed before the prior run was interrupted
      ),
    )
    expect(plans.map(p => p.action)).toEqual(['skip', 'upload', 'upload'])
  })

  it('aborts the WHOLE release — rejecting before any plan is returned — when an immutable path differs', async () => {
    // The load-bearing ordering guarantee behind Phase 1 / Phase 2 in publish-cdn.mjs: planAll plans
    // every artifact and throws on a mismatch, so it never hands Phase 2 a partial plans array to act
    // on. A mismatch on the SECOND artifact must still abort the whole run — no upload can precede it.
    let plans
    await expect(
      (async () => {
        plans = await planAll(
          artifacts,
          '0.0.3',
          deps(
            { 'pug.min.js': 'js', 'pug.min.js.map': 'map-NEW', 'pug.min.js.LEGAL.txt': 'legal' },
            { 'v0.0.3/pug.min.js.map': 'map-OLD' }, // 2nd artifact already published with different bytes
          ),
        )
      })(),
    ).rejects.toThrow(/immutable/i)
    expect(plans).toBeUndefined() // nothing handed to Phase 2 → no artifact can have been uploaded
  })

  it('rejects when a build artifact is missing locally (so a half-built dist never half-publishes)', async () => {
    await expect(
      planAll(
        artifacts,
        '0.0.3',
        deps({ 'pug.min.js': 'js' }, {}), // .map and .LEGAL.txt were not built
      ),
    ).rejects.toThrow(/missing build artifact/i)
  })
})

describe('isMissingKey', () => {
  it('treats only a 404 carrying NoSuchKey as an absent object', () => {
    const noSuchKey =
      '<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>'
    expect(isMissingKey(404, noSuchKey)).toBe(true)
  })

  it('fails closed: a wrong bucket, an auth error or a bare 404 is not an absent object', () => {
    expect(isMissingKey(404, '<Error><Code>NoSuchBucket</Code></Error>')).toBe(false)
    expect(isMissingKey(403, '<Error><Code>AccessDenied</Code></Error>')).toBe(false)
    expect(isMissingKey(404, '')).toBe(false)
  })
})

describe('isPublishableVersion', () => {
  it('accepts the semver shapes we mint into a CDN path', () => {
    expect(isPublishableVersion('0.0.3')).toBe(true)
    expect(isPublishableVersion('1.2.0')).toBe(true)
    expect(isPublishableVersion('1.0.0-rc.1')).toBe(true) // prerelease
    expect(isPublishableVersion('1.0.0+build.5')).toBe(true) // build metadata
  })

  it('rejects missing/garbage versions so a publish never mints "vundefined/…"', () => {
    expect(isPublishableVersion(undefined)).toBe(false)
    expect(isPublishableVersion('')).toBe(false)
    expect(isPublishableVersion('latest')).toBe(false)
    expect(isPublishableVersion('1.2')).toBe(false)
  })
})

describe('objectUrl', () => {
  it('addresses the bucket path-style on the account R2 endpoint', () => {
    expect(objectUrl('acct', 'pugs-dev-cdn', 'v0.0.3/pug.min.js')).toBe(
      'https://acct.r2.cloudflarestorage.com/pugs-dev-cdn/v0.0.3/pug.min.js',
    )
  })

  it('encodes each segment as SigV4 canonicalizes it, keeping the separators', () => {
    expect(objectUrl('acct', 'b', "a b/c$d!'()*")).toBe(
      'https://acct.r2.cloudflarestorage.com/b/a%20b/c%24d%21%27%28%29%2A',
    )
  })
})

describe('signRequest', () => {
  // The worked examples in AWS's "Signature Calculations for the Authorization Header" for S3.
  const example = {
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1',
    now: new Date('2013-05-24T00:00:00Z'),
  }

  it('signs the GET Object example', () => {
    const headers = signRequest({
      ...example,
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      headers: { Range: 'bytes=0-9' },
    })
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    )
    expect(headers['x-amz-date']).toBe('20130524T000000Z')
    expect(headers['x-amz-content-sha256']).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('signs the PUT Object example, payload hash and encoded key included', () => {
    const headers = signRequest({
      ...example,
      method: 'PUT',
      url: 'https://examplebucket.s3.amazonaws.com/test%24file.text',
      headers: { Date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' },
      body: Buffer.from('Welcome to Amazon S3.'),
    })
    expect(headers['x-amz-content-sha256']).toBe('44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072')
    expect(headers.authorization).toMatch(/Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd$/)
  })

  it('leaves host to fetch and defaults to the R2 region', () => {
    const headers = signRequest({
      accessKeyId: 'k',
      secretAccessKey: 's',
      method: 'GET',
      url: objectUrl('acct', 'pugs-dev-cdn', 'v0.0.3/pug.min.js'),
    })
    expect(Object.keys(headers).map(name => name.toLowerCase())).not.toContain('host')
    expect(headers.authorization).toMatch(/\/auto\/s3\/aws4_request, SignedHeaders=host;/)
  })
})

describe('artifact manifest', () => {
  it('lists exactly the three files build-cdn.mjs emits, pug.min.js first as JavaScript', () => {
    expect(CDN_ARTIFACTS.map(a => a.name)).toEqual(['pug.min.js', 'pug.min.js.map', 'pug.min.js.LEGAL.txt'])
    expect(CDN_ARTIFACTS[0].contentType).toBe('text/javascript')
  })

  it('caches immutably for a year', () => {
    expect(CACHE_CONTROL).toMatch(/\bimmutable\b/)
    expect(CACHE_CONTROL).toMatch(/max-age=31536000/)
  })
})
