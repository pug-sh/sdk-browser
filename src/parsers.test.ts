import { afterEach, describe, expect, it } from 'vitest'
import { parseUserAgentData } from './parsers.js'

const setUserAgentData = (value: unknown) => {
  Object.defineProperty(navigator, 'userAgentData', { value, configurable: true })
}

const withBrands = (brands: { brand: string; version: string }[]) => {
  setUserAgentData({ brands, mobile: false, platform: 'macOS' })
}

const CHROME = [
  { brand: 'Not_A Brand', version: '99' },
  { brand: 'Chromium', version: '151' },
  { brand: 'Google Chrome', version: '151' },
]

const permutations = <T>(items: T[]): T[][] =>
  items.length <= 1
    ? [items]
    : items.flatMap((item, i) =>
        permutations([...items.slice(0, i), ...items.slice(i + 1)]).map(rest => [item, ...rest]),
      )

describe('parseUserAgentData brand selection', () => {
  afterEach(() => {
    setUserAgentData(undefined)
  })

  it('returns the same brand for every ordering of the list', () => {
    const labels = permutations(CHROME).map(brands => {
      withBrands(brands)
      const { $browser, $browserVersion } = parseUserAgentData()
      return `${$browser} ${$browserVersion}`
    })

    expect(new Set(labels)).toEqual(new Set(['Google Chrome 151']))
  })

  it('prefers the specific brand over the engine', () => {
    withBrands([
      { brand: 'Chromium', version: '124' },
      { brand: 'Microsoft Edge', version: '124' },
      { brand: 'Not.A/Brand', version: '24' },
    ])

    expect(parseUserAgentData().$browser).toBe('Microsoft Edge')
  })

  it('prefers an unknown vendor brand over the engine', () => {
    withBrands([
      { brand: 'Not_A Brand', version: '8' },
      { brand: 'Chromium', version: '130' },
      { brand: 'Vivaldi', version: '7' },
    ])

    expect(parseUserAgentData()).toMatchObject({ $browser: 'Vivaldi', $browserVersion: '7' })
  })

  it('falls back to the engine when nothing more specific is present', () => {
    withBrands([
      { brand: 'Chromium', version: '130' },
      { brand: 'Not;A Brand', version: '99' },
    ])

    expect(parseUserAgentData()).toMatchObject({ $browser: 'Chromium', $browserVersion: '130' })
  })

  it.each([';Not A Brand', ' Not A;Brand', 'Not-A.Brand', 'Not/A)Brand', 'Not?A_Brand'])(
    'never selects the GREASE entry %j',
    grease => {
      withBrands([
        { brand: grease, version: '99' },
        { brand: 'Chromium', version: '151' },
      ])

      expect(parseUserAgentData().$browser).toBe('Chromium')
    },
  )

  it('prefers the derived brand over the one it embeds, either way round', () => {
    const pair = [
      { brand: 'Microsoft Edge', version: '124' },
      { brand: 'Microsoft Edge WebView2', version: '125' },
    ]

    withBrands(pair)
    expect(parseUserAgentData()).toMatchObject({
      $browser: 'Microsoft Edge WebView2',
      $browserVersion: '125',
    })

    withBrands([...pair].reverse())
    expect(parseUserAgentData().$browser).toBe('Microsoft Edge WebView2')
  })

  it('omits the browser when every entry is GREASE or empty', () => {
    withBrands([
      { brand: 'Not A Brand', version: '99' },
      { brand: '', version: '1' },
    ])
    const result = parseUserAgentData()

    expect(result.$browser).toBeUndefined()
    expect(result.$browserVersion).toBeUndefined()
  })

  it('returns nothing without userAgentData', () => {
    setUserAgentData(undefined)

    expect(parseUserAgentData()).toEqual({})
  })
})
