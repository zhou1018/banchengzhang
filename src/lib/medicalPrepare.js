// medical.prepare：就医整理。只标记相关度，不删除节点，不做诊断。

const RESPIRATORY = ['呼吸', '咳嗽', '喘息', '肺', '支气管']
const DIAGNOSIS_RE = /是不是|是吗|确诊|什么病|算不算|要不要吃|吃什么药|用什么药|诊断一下|是不是某种/
const REFUSAL = '我不能判断是不是某种疾病，也不能建议用药。下面只整理档案里已有的资料，请由医生评估。'
const FILLER_RE = /我要|帮我|请帮|请|一下|一下子|所有|之前|历史|记录|资料|整理|就医|孩子|去看|看看|看/g

export function isDiagnosisQuestion(query) {
  return DIAGNOSIS_RE.test(String(query || ''))
}

export function queryTerms(query) {
  const raw = String(query || '').trim()
  const stripped = raw.replace(FILLER_RE, ' ').replace(DIAGNOSIS_RE, ' ')
  const exact = stripped.match(/[\u4e00-\u9fff]{2,}/g) || []
  const synonyms = []
  if (RESPIRATORY.some((word) => raw.includes(word))) {
    for (const word of RESPIRATORY) {
      if (!exact.some((term) => term.includes(word))) synonyms.push(word)
    }
  }
  return { exact, synonyms, diagnosis: isDiagnosisQuestion(raw) }
}

function fieldText(record) {
  return [
    record.hospital,
    record.department,
    record.diagnosis,
    record.chiefComplaint,
    record.summary,
    record.labPanel,
    record.bodyPart,
    record.ocrText,
  ].filter(Boolean).join('\n')
}

function usableText(text) {
  return (text.match(/[\u4e00-\u9fff]/g) || []).length >= 2
}

function exactHit(text, term) {
  if (!term || !text) return false
  if (text.includes(term)) return true
  if (term.endsWith('科') && term.length > 2 && text.includes(term.slice(0, -1))) return true
  return false
}

export function scoreRelevance(record, terms) {
  const text = fieldText(record)
  if (!usableText(text)) return 'unknown'
  if (!terms.exact.length && !terms.synonyms.length) return 'unknown'
  if (terms.exact.some((term) => exactHit(text, term))) return 'high'
  if (terms.synonyms.some((term) => text.includes(term))) return 'possible'
  return 'low'
}

function quoteFact(record) {
  const quote = [record.chiefComplaint, record.diagnosis, record.summary].find((value) => value && String(value).trim())
  return quote ? String(quote).trim() : null
}

function capture(text, pattern) {
  const match = String(text || '').match(pattern)
  if (!match) return null
  const value = match[1].trim()
  if (!value || value.length > 40) return null
  return value
}

function safetyFromRecords(records) {
  const allergyRe = /过敏(?:史)?[:：]\s*([^\n，。；]{1,40})/
  const medRe = /(?:当前用药|用药)[:：]\s*([^\n，。；]{1,40})/
  let allergy = null
  let medication = null
  for (const record of records) {
    const text = fieldText(record)
    if (!allergy) {
      const value = capture(text, allergyRe)
      if (value) allergy = { text: value, assetId: record.assetId }
    }
    if (!medication) {
      const value = capture(text, medRe)
      if (value) medication = { text: value, assetId: record.assetId }
    }
  }
  return { allergy, medication }
}

function toNode(record, terms) {
  const relevance = scoreRelevance(record, terms)
  return {
    assetId: record.assetId,
    date: record.documentDate || null,
    hospital: record.hospital || null,
    department: record.department || null,
    relevance,
    expanded: relevance === 'high' || relevance === 'possible' || relevance === 'unknown',
    summary: quoteFact(record),
  }
}

function journalHits(journals, terms) {
  const needles = [...terms.exact, ...terms.synonyms]
  if (!needles.length) return []
  return (journals || []).filter((item) => needles.some((word) => String(item.text || '').includes(word))).map((item) => ({
    id: item.id,
    label: '家长记录',
    excerpt: String(item.text || '').trim(),
  }))
}

/**
 * 返回该孩子的全部就诊节点。相关度只是展开状态，低相关仍留在原日期位置。
 * 没有单据日期的进「就诊日期未确认」，不用上传日冒充就诊日。
 */
export function prepareMedical({ query, records, journals }) {
  const terms = queryTerms(query)
  const list = records || []
  const dated = []
  const undated = []
  for (const record of list) {
    const node = toNode(record, terms)
    if (record.documentDate) dated.push(node)
    else undated.push(node)
  }
  dated.sort((a, b) => String(a.date).localeCompare(String(b.date)))
  return {
    diagnosisRefusal: terms.diagnosis ? REFUSAL : null,
    ...safetyFromRecords(list),
    dated,
    undated,
    journals: journalHits(journals, terms),
  }
}
