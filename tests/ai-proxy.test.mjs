import assert from 'node:assert/strict'
import test from 'node:test'
import worker, { resetProxyLimits } from '../deploy/ai-proxy/worker.js'
import { cloudConfidence, proxyHeaders } from '../src/lib/proxyHeaders.js'

function post(path, body, headers = {}, ip = '203.0.113.10') {
  return worker.fetch(new Request(`https://proxy.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip, ...headers },
    body: JSON.stringify(body),
  }), {})
}

test('oversized medical image is rejected before a model call', async () => {
  resetProxyLimits()
  const response = await post('/api/medical/extract', { image: 'x'.repeat(8_000_001) })
  assert.equal(response.status, 413)
  assert.equal((await response.json()).error, 'payload_too_large')
})

test('missing confidence is omitted and errors stay generic', async () => {
  resetProxyLimits()
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: '{"text":"门诊病历","documentType":"record","summary":"咳嗽","fields":{}}' } }],
  }), { status: 200 })
  try {
    const response = await worker.fetch(new Request('https://proxy.test/api/medical/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.11' },
      body: JSON.stringify({ image: 'data:image/jpeg;base64,abc' }),
    }), { AI_API_KEY: 'test-key' })
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(body.text, '门诊病历')
    assert.equal(Object.hasOwn(body, 'confidence'), false)
  } finally {
    globalThis.fetch = original
  }
})

test('upstream failure does not leak the exception text', async () => {
  resetProxyLimits()
  const original = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('secret upstream detail') }
  try {
    const response = await worker.fetch(new Request('https://proxy.test/api/medical/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.12' },
      body: JSON.stringify({ image: 'data:image/jpeg;base64,abc' }),
    }), { AI_API_KEY: 'test-key' })
    const body = await response.json()
    assert.equal(response.status, 500)
    assert.equal(body.error, 'internal_error')
    assert.equal(JSON.stringify(body).includes('secret'), false)
  } finally {
    globalThis.fetch = original
  }
})

test('token is required only when configured', async () => {
  resetProxyLimits()
  const denied = await worker.fetch(new Request('https://proxy.test/api/medical/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.13' },
    body: JSON.stringify({ image: 'abc' }),
  }), { AI_PROXY_TOKEN: 'door' })
  assert.equal(denied.status, 401)
  const open = await post('/api/medical/extract', {}, {}, '203.0.113.14')
  assert.equal(open.status, 400)
})

test('each route allows 20 calls per minute on one instance', async () => {
  resetProxyLimits()
  let last = 0
  for (let i = 0; i < 21; i += 1) {
    const response = await post('/api/medical/extract', {}, {}, '203.0.113.15')
    last = response.status
  }
  assert.equal(last, 429)
})

test('unconfigured key still answers ai_api_key_not_configured', async () => {
  resetProxyLimits()
  const response = await post('/api/medical/extract', { image: 'data:image/png;base64,aa' }, {}, '203.0.113.16')
  assert.equal(response.status, 503)
  assert.equal((await response.json()).error, 'ai_api_key_not_configured')
})

test('proxy header and confidence helpers', () => {
  const previous = globalThis.__BCZ_AI_PROXY_TOKEN
  delete globalThis.__BCZ_AI_PROXY_TOKEN
  assert.deepEqual(proxyHeaders({ 'Content-Type': 'application/json' }), { 'Content-Type': 'application/json' })
  globalThis.__BCZ_AI_PROXY_TOKEN = 'door'
  assert.equal(proxyHeaders({})['X-Proxy-Token'], 'door')
  globalThis.__BCZ_AI_PROXY_TOKEN = previous
  assert.equal(cloudConfidence(0.9), 0.9)
  assert.equal(cloudConfidence(undefined), 0.5)
  assert.equal(cloudConfidence(2), 0.5)
})
