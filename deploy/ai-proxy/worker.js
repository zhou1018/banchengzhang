// 伴成长 · AI 代理
// 密钥只放在 Worker 环境变量里。前端静态包不持有模型 Key。
// 配了 AI_PROXY_TOKEN 才校验 X-Proxy-Token；没配时保持本地 wrangler 可直接调用。
// 这个 token 若写进前端包，只能挡住随便扫到地址的调用，不能代替账号登录。

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Proxy-Token',
  'Access-Control-Max-Age': '86400',
}

const MAX_IMAGE_CHARS = 8_000_000
const MAX_AUDIO_BYTES = 15 * 1024 * 1024
const RATE_LIMIT = 20
const RATE_WINDOW_MS = 60_000

const buckets = new Map()

export function resetProxyLimits() {
  buckets.clear()
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  })
}

function clientIp(request) {
  return request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'local'
}

function allow(ip, route) {
  const now = Date.now()
  const key = `${ip}|${route}`
  const recent = (buckets.get(key) || []).filter((stamp) => now - stamp < RATE_WINDOW_MS)
  if (recent.length >= RATE_LIMIT) {
    buckets.set(key, recent)
    return false
  }
  recent.push(now)
  buckets.set(key, recent)
  return true
}

function authorize(request, env) {
  const expected = env.AI_PROXY_TOKEN
  if (!expected) return null
  if (request.headers.get('x-proxy-token') !== expected) return json({ error: 'unauthorized' }, 401)
  return null
}

function parseJsonLoose(raw) {
  if (!raw) return {}
  const cleaned = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try { return JSON.parse(cleaned.slice(start, end + 1)) } catch { /* ignore */ }
    }
    return { text: cleaned }
  }
}

function normalizeType(value) {
  return ['lab', 'record', 'imaging', 'other'].includes(value) ? value : 'other'
}

function confidenceOrOmit(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined
}

const MEDICAL_PROMPT = `你在整理一份中文医疗单据（化验单 / 门诊病历 / 影像报告）。
只根据图片中真实存在的文字作答，绝对不要猜测、补充或编造任何内容。
不要做诊断，不要建议用药。
请输出且只输出一个 JSON 对象，字段：text, documentType(lab|record|imaging|other), summary, documentDate, fields, confidence。
识别不到的字段省略。confidence 只在你能给出 0 到 1 的数字时填写。`

async function handleMedical(request, env) {
  const body = await request.json().catch(() => null)
  const image = body?.image
  if (!image || typeof image !== 'string') return json({ error: 'missing_image' }, 400)
  if (image.length > MAX_IMAGE_CHARS) return json({ error: 'payload_too_large' }, 413)
  const apiKey = env.AI_API_KEY
  if (!apiKey) return json({ error: 'ai_api_key_not_configured' }, 503)

  const base = (env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
  const model = env.AI_MODEL || 'gpt-4o-mini'
  const upstream = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: MEDICAL_PROMPT },
          { type: 'image_url', image_url: { url: image } },
        ],
      }],
    }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!upstream.ok) return json({ error: `upstream_${upstream.status}` }, 502)
  const data = await upstream.json().catch(() => null)
  const raw = data?.choices?.[0]?.message?.content ?? ''
  const parsed = parseJsonLoose(raw)
  const result = {
    text: typeof parsed.text === 'string' ? parsed.text : '',
    documentType: normalizeType(parsed.documentType),
    summary: parsed.summary ?? null,
    documentDate: parsed.documentDate ?? null,
    fields: parsed.fields && typeof parsed.fields === 'object' ? parsed.fields : {},
  }
  const confidence = confidenceOrOmit(parsed.confidence)
  if (confidence !== undefined) result.confidence = confidence
  return json(result)
}

async function handleAsr(request, env) {
  const length = Number(request.headers.get('content-length') || 0)
  if (length > MAX_AUDIO_BYTES) return json({ error: 'payload_too_large' }, 413)
  const bytes = await request.arrayBuffer()
  if (!bytes.byteLength) return json({ error: 'empty_audio' }, 400)
  if (bytes.byteLength > MAX_AUDIO_BYTES) return json({ error: 'payload_too_large' }, 413)
  const apiKey = env.ASR_API_KEY || env.AI_API_KEY
  if (!apiKey) return json({ error: 'asr_api_key_not_configured' }, 503)

  const contentType = request.headers.get('content-type') || 'audio/webm'
  const ext = contentType.includes('mp4') ? 'mp4' : contentType.includes('ogg') ? 'ogg' : 'webm'
  const form = new FormData()
  form.append('file', new Blob([bytes], { type: contentType }), `audio.${ext}`)
  form.append('model', env.ASR_MODEL || 'whisper-1')
  form.append('language', 'zh')
  const base = (env.ASR_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
  const upstream = await fetch(`${base}/audio/transcriptions`, {
    method: 'POST',
    body: form,
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!upstream.ok) return json({ error: `upstream_${upstream.status}` }, 502)
  const data = await upstream.json().catch(() => null)
  return json({ transcript: typeof data?.text === 'string' ? data.text : '' })
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
    const denied = authorize(request, env || {})
    if (denied) return denied
    const path = new URL(request.url).pathname
    const route = path === '/api/asr' ? 'asr' : 'medical'
    if (!allow(clientIp(request), route)) return json({ error: 'rate_limited' }, 429)
    try {
      if (path === '/api/medical/extract') return await handleMedical(request, env || {})
      if (path === '/api/asr') return await handleAsr(request, env || {})
      return json({ error: 'not_found' }, 404)
    } catch {
      return json({ error: 'internal_error' }, 500)
    }
  },
}
