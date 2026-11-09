// 伴成长 · AI 代理（Cloudflare Worker）
//
// 前端是纯静态站点，不能持有模型密钥。云端调用经这里转发，
// 密钥只放在 Worker 的 secret 里（wrangler secret put）。
//
// POST /api/medical/extract  { image: dataURL, kind, pageCount }
//   → { text, documentType, summary, documentDate, fields, confidence? }
// POST /api/asr              音频二进制
//   → { transcript }
//
// AI_PROXY_TOKEN 未配置时不校验调用方，方便本地 wrangler dev。
// 配了之后才要求请求头 X-Proxy-Token。这个 token 会进前端包，
// 只能挡住随便扫到地址的请求，不能代替账号登录。
// 每分钟 20 次的计数只存在当前 Worker 实例里，不是全局限流。

import { passThroughConfidence } from '../../src/lib/aiConfidence.js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Proxy-Token',
  'Access-Control-Max-Age': '86400',
}

const MAX_MEDICAL_IMAGE_CHARS = 8 * 1024 * 1024
const MAX_ASR_BYTES = 15 * 1024 * 1024
const RATE_LIMIT = 20
const RATE_WINDOW_MS = 60_000

/** @type {Map<string, number[]>} */
const rateBuckets = new Map()

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  })
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

const MEDICAL_PROMPT = `你在整理一份中文医疗单据（化验单 / 门诊病历 / 影像报告）。
只根据图片中真实存在的文字作答，绝对不要猜测、补充或编造任何内容。
最核心的两项是「病情（诊断 / 主诉）」和「就诊时间」，务必优先准确摘录原文。
类型判定要看整份单据的结构：出现主诉 / 现病史 / 初步诊断的是门诊病历(record)，
不要因为「处理意见：查血常规」就把整份病历判成化验单(lab)。

请输出且只输出一个 JSON 对象，格式如下：
{
  "text": "图片上识别到的完整原文，按原有顺序，保留换行",
  "documentType": "lab | record | imaging | other",
  "summary": "一句话摘要，只能摘录原文里出现的内容；没有就填 null",
  "documentDate": "YYYY-MM-DD 格式的报告/就诊日期；识别不到填 null",
  "fields": {
    "diagnosis": "病情/诊断，只填原件上「初步诊断/临床诊断/印象」后的原文；识别不到就不要写这个键",
    "chiefComplaint": "主诉，只填「主诉」后的原文；识别不到就不要写这个键",
    "visitDate": "就诊时间，YYYY-MM-DD，优先取「就诊日期」，其次「报告日期」；识别不到就不要写这个键",
    "hospital": "医院名称，识别不到就不要写这个键",
    "lab_panel": "检验项目，如血常规；识别不到就不要写这个键",
    "specimen": "标本类型；识别不到就不要写这个键",
    "department": "科室；识别不到就不要写这个键",
    "visit_type": "门诊/急诊/住院；识别不到就不要写这个键",
    "body_part": "检查部位；识别不到就不要写这个键",
    "modality": "CT/X线/超声等；识别不到就不要写这个键"
  },
  "confidence": 0.9
}

不要输出 Markdown 代码块、解释文字或任何额外内容。识别不到的字段一律省略。`

function normalizeType(value) {
  return ['lab', 'record', 'imaging', 'other'].includes(value) ? value : 'other'
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown'
}

function allowRate(ip, bucket) {
  const now = Date.now()
  const key = `${bucket}:${ip}`
  const hits = (rateBuckets.get(key) ?? []).filter((ts) => now - ts < RATE_WINDOW_MS)
  if (hits.length >= RATE_LIMIT) {
    rateBuckets.set(key, hits)
    return false
  }
  hits.push(now)
  rateBuckets.set(key, hits)
  return true
}

function tokenOk(request, env) {
  const expected = env.AI_PROXY_TOKEN
  if (!expected) return true
  return request.headers.get('X-Proxy-Token') === expected
}

function contentLength(request) {
  const raw = request.headers.get('content-length')
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

async function handleMedical(request, env) {
  const declared = contentLength(request)
  if (declared != null && declared > MAX_MEDICAL_IMAGE_CHARS + 65_536) {
    return json({ error: 'payload_too_large' }, 413)
  }
  const body = await request.json().catch(() => null)
  const image = body?.image
  if (!image || typeof image !== 'string') return json({ error: 'missing_image' }, 400)
  if (image.length > MAX_MEDICAL_IMAGE_CHARS) return json({ error: 'payload_too_large' }, 413)

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
  const confidence = passThroughConfidence(parsed.confidence)
  const result = {
    text: typeof parsed.text === 'string' ? parsed.text : '',
    documentType: normalizeType(parsed.documentType),
    summary: parsed.summary ?? null,
    documentDate: parsed.documentDate ?? null,
    fields: parsed.fields && typeof parsed.fields === 'object' ? parsed.fields : {},
  }
  if (confidence != null) result.confidence = confidence
  return json(result)
}

async function handleAsr(request, env) {
  const declared = contentLength(request)
  if (declared != null && declared > MAX_ASR_BYTES) return json({ error: 'payload_too_large' }, 413)
  const bytes = await request.arrayBuffer()
  if (!bytes.byteLength) return json({ error: 'empty_audio' }, 400)
  if (bytes.byteLength > MAX_ASR_BYTES) return json({ error: 'payload_too_large' }, 413)

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
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })
  if (!upstream.ok) return json({ error: `upstream_${upstream.status}` }, 502)
  const data = await upstream.json().catch(() => null)
  return json({ transcript: typeof data?.text === 'string' ? data.text : '' })
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
    if (!tokenOk(request, env ?? {})) return json({ error: 'unauthorized' }, 401)
    const path = new URL(request.url).pathname
    const bucket = path === '/api/asr' ? 'asr' : 'medical'
    if (!allowRate(clientIp(request), bucket)) return json({ error: 'rate_limited' }, 429)
    try {
      if (path === '/api/medical/extract') return await handleMedical(request, env ?? {})
      if (path === '/api/asr') return await handleAsr(request, env ?? {})
      return json({ error: 'not_found' }, 404)
    } catch {
      return json({ error: 'internal_error' }, 500)
    }
  },
}
