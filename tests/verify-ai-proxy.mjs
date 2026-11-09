import fs from 'fs'
import path from 'path'
import worker from '../deploy/ai-proxy/worker.js'

let failed = 0
function check(name, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
  if (!ok) failed += 1
}

function medicalRequest(image, { ip = '203.0.113.10', token, extra = {} } = {}) {
  const headers = { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...extra }
  if (token) headers['x-proxy-token'] = token
  return new Request('https://proxy.test/api/medical/extract', {
    method: 'POST',
    headers,
    body: JSON.stringify({ image, kind: 'medical_image', pageCount: 1 }),
  })
}

const small = 'data:image/jpeg;base64,abc'
const noKey = await worker.fetch(medicalRequest(small), {})
const noKeyBody = await noKey.json()
check('missing key still reaches ai_api_key_not_configured', noKey.status === 503 && noKeyBody.error === 'ai_api_key_not_configured')

const denied = await worker.fetch(medicalRequest(small, { ip: '203.0.113.11' }), { AI_PROXY_TOKEN: 'secret' })
const deniedBody = await denied.json()
check('token required when configured', denied.status === 401 && deniedBody.error === 'unauthorized')

const allowed = await worker.fetch(
  medicalRequest(small, { ip: '203.0.113.12', token: 'secret' }),
  { AI_PROXY_TOKEN: 'secret' },
)
const allowedBody = await allowed.json()
check('matching token still reaches the key check', allowed.status === 503 && allowedBody.error === 'ai_api_key_not_configured')

const huge = 'x'.repeat(8 * 1024 * 1024 + 1)
const tooBig = await worker.fetch(medicalRequest(huge, { ip: '203.0.113.13' }), {})
const tooBigBody = await tooBig.json()
check('oversized image is rejected', tooBig.status === 413 && tooBigBody.error === 'payload_too_large')

const originalFetch = globalThis.fetch
globalThis.fetch = async () => new Response(JSON.stringify({
  choices: [{ message: { content: JSON.stringify({
    text: '血常规',
    documentType: 'lab',
    summary: null,
    documentDate: '2026-10-22',
    fields: { lab_panel: '血常规' },
  }) } }],
}), { status: 200, headers: { 'content-type': 'application/json' } })

try {
  const missingConf = await worker.fetch(medicalRequest(small, { ip: '203.0.113.14' }), { AI_API_KEY: 'test-key' })
  const missingBody = await missingConf.json()
  check('missing confidence is omitted', missingConf.status === 200 && !Object.hasOwn(missingBody, 'confidence') && missingBody.text === '血常规')
} finally {
  globalThis.fetch = originalFetch
}

globalThis.fetch = async () => new Response(JSON.stringify({
  choices: [{ message: { content: JSON.stringify({
    text: '病历',
    documentType: 'record',
    confidence: 0.42,
    fields: {},
  }) } }],
}), { status: 200 })
try {
  const withConf = await worker.fetch(medicalRequest(small, { ip: '203.0.113.15' }), { AI_API_KEY: 'test-key' })
  const withBody = await withConf.json()
  check('in-range confidence is kept', withBody.confidence === 0.42)
} finally {
  globalThis.fetch = originalFetch
}

globalThis.fetch = async () => new Response(JSON.stringify({
  choices: [{ message: { content: JSON.stringify({ text: '病历', documentType: 'record', confidence: 9, fields: {} }) } }],
}), { status: 200 })
try {
  const badConf = await worker.fetch(medicalRequest(small, { ip: '203.0.113.16' }), { AI_API_KEY: 'test-key' })
  const badBody = await badConf.json()
  check('out-of-range confidence is omitted', !Object.hasOwn(badBody, 'confidence'))
} finally {
  globalThis.fetch = originalFetch
}

globalThis.fetch = async () => { throw new Error('upstream secret detail') }
try {
  const boom = await worker.fetch(medicalRequest(small, { ip: '203.0.113.17' }), { AI_API_KEY: 'test-key' })
  const boomText = await boom.text()
  check('errors do not leak the exception', boom.status === 500 && boomText.includes('internal_error') && !boomText.includes('secret'))
} finally {
  globalThis.fetch = originalFetch
}

const rateIp = '203.0.113.18'
let limited = 0
for (let i = 0; i < 21; i++) {
  const res = await worker.fetch(medicalRequest(small, { ip: rateIp }), {})
  if (res.status === 429) limited += 1
  await res.arrayBuffer()
}
check('21st medical request on one instance is rate limited', limited === 1)

const bundleDir = new URL('../assets/', import.meta.url)
const bundleFile = fs.readdirSync(bundleDir).find((name) => name.startsWith('index-') && name.endsWith('.js'))
const bundle = fs.readFileSync(path.join(bundleDir.pathname, bundleFile), 'utf8')
check('page sends proxy token only from build env', bundle.includes('pw.VITE_AI_PROXY_TOKEN?{"X-Proxy-Token":pw.VITE_AI_PROXY_TOKEN}:{}'))
check('page does not default cloud confidence to 0.9', bundle.includes('passThroughConfidence(u.confidence)') && !bundle.includes('u.confidence:.9'))

console.log(failed ? `RESULT: FAIL ${failed}` : 'RESULT: PASS')
process.exit(failed ? 1 : 0)
