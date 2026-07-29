// Privacy controls example — `data-pug-no-capture`, `beforeSend`, and the default `redactUrlParams`
// pass that runs before both.
//
// Run from the repo root: `bun run build && bun run serve`, then open
// http://localhost:3000/examples/privacy/. index.html loads the single-file bundle, so this drives
// window.pug rather than importing the dev build. dryRun means nothing is ever sent.

// ── 1. URL masking: route masking + PII query-param stripping ──
//
// The SDK can't know your routes, so the pattern list lives here, in your app. `token` and `email`
// are already redacted by `redactUrlParams` before beforeSend runs — kept here to show them compose.
const ROUTE_PATTERNS = [
  [/\/orders\/\d+/g, '/orders/:orderId'],
  [/\/users\/[0-9a-f-]{36}/g, '/users/:userId'],
  [/\/invoices\/[A-Z0-9-]+/g, '/invoices/:invoiceId'],
]
const STRIP_PARAMS = ['email', 'token', 'name']

const maskUrl = url => {
  // A referrer-less page view has '', which would resolve to the page origin — a fabricated
  // self-referral. Guard before parsing.
  if (typeof url !== 'string' || !url) {
    return url
  }
  let u
  try {
    u = new URL(url, window.location.origin)
  } catch {
    return '' // unparseable → fail closed rather than leak
  }
  for (const [pattern, replacement] of ROUTE_PATTERNS) {
    u.pathname = u.pathname.replace(pattern, replacement)
  }
  for (const param of STRIP_PARAMS) {
    u.searchParams.delete(param)
  }
  return u.toString()
}

// ── 2. Initialize the SDK with the privacy controls wired in ──
//
// `data-pug-no-capture` (in index.html) needs no config — the trackers consult it automatically.
//
// This and renderPairTable below must be declared *above* init(): it fires a page_view
// synchronously, so beforeSend runs before anything declared after it exists. beforeSend failures
// are caught and drop the event, so a TDZ error there costs the first row, not the page.
const seenUrls = []

// Built with DOM APIs, not innerHTML: some of these strings come from the address bar and must
// never be parsed as markup.
const renderPairTable = (tableId, pairs) => {
  const table = document.getElementById(tableId)
  if (!table) {
    return
  }
  table.replaceChildren(
    ...pairs.map(([left, right]) => {
      const row = document.createElement('tr')
      for (const [className, text] of [
        ['raw', left],
        ['arrow', '→'],
        ['masked', right],
      ]) {
        const cell = document.createElement('td')
        cell.className = className
        cell.textContent = text
        row.append(cell)
      }
      return row
    }),
  )
}

// Section 3: the real $url each event carried into beforeSend — after redactUrlParams, before maskUrl.
const renderRedactionTable = () =>
  renderPairTable(
    'redaction-table',
    seenUrls.map(({ kind, received }) => [kind, received]),
  )

window.pug.init('privacy-example', {
  apiKey: 'demo-api-key', // required by init(); unused here since dryRun never delivers
  dryRun: true, // demo only — never deliver
  maxAgeDays: 390, // CNIL's 13 months; the deadline is absolute, not extended by later visits
  // redactUrlParams: ['token', 'orderId'],  // an array replaces the default list
  // redactUrlParams: false,                 // or opt out and capture URLs verbatim
  beforeSend: event => {
    // Recorded before masking, so section 3 shows the SDK's own redaction rather than asserting it.
    seenUrls.push({ kind: event.kind, received: event.autoProperties.$url })
    renderRedactionTable()

    event.autoProperties.$url = maskUrl(event.autoProperties.$url)
    event.autoProperties.$referrer = maskUrl(event.autoProperties.$referrer)
    // A form's action is a custom property, not an auto one.
    if (event.kind === 'form_submit') {
      event.customProperties.action = maskUrl(event.customProperties.action)
    }
    return event
  },
})

// ── Visualization (mirrors the functions above; not part of the SDK) ──

const SAMPLE_URLS = [
  'https://shop.example.com/orders/12345?ref=email',
  'https://shop.example.com/users/4f1d2c3b-1111-2222-3333-444455556666',
  'https://shop.example.com/invoices/INV-2026-042?token=abc123',
  'https://shop.example.com/reset?email=jane@example.com&name=Jane',
  'https://shop.example.com/pricing',
]

const renderUrlTable = () =>
  renderPairTable(
    'url-table',
    SAMPLE_URLS.map(raw => [raw, maskUrl(raw)]),
  )

// Mirrors utils.isCaptureSuppressed — the attribute takes no function, so the panel reimplements it.
const isSuppressed = el => !!el?.closest('[data-pug-no-capture]')

// Mirrors utils.getSafeElementText: the element's *own* direct child text nodes, never the whole
// subtree. innerText here would overstate what the SDK captures.
const ownText = el =>
  Array.from(el.childNodes)
    .filter(node => node.nodeType === Node.TEXT_NODE)
    .map(node => node.textContent)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()

const logEl = document.getElementById('capture-log')
const logClick = target => {
  const suppressed = isSuppressed(target)
  const text = ownText(target).substring(0, 50) // 50 mirrors click.ts's capture length

  // DOM APIs, never innerHTML: `text` is page-derived. A privacy example should model safe handling
  // of captured content, not an XSS foot-gun.
  const entry = document.createElement('div')
  entry.className = `log-entry ${suppressed ? 'redacted' : 'captured'}`

  const tag = document.createElement('code')
  tag.textContent = `<${target.tagName.toLowerCase()}>`

  const value = document.createElement('span')
  value.className = suppressed ? 'tag' : 'val'
  value.textContent = suppressed ? '"" (redacted)' : `"${text}"`

  entry.append(tag, document.createTextNode(' text → '), value)
  logEl.prepend(entry)
}

document.addEventListener('click', e => {
  if (e.target instanceof HTMLElement && e.target.closest('.capture-zone')) {
    logClick(e.target)
  }
})

renderUrlTable()
