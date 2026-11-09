import { prepareMedical } from './lib/medicalPrepare.js'

const MEDICAL_KEY = 'banchengzhang:v01:medical'
const VOICE_KEY = 'banchengzhang:v01:f02'
const QUERY_KEY = 'bcz:agent:query'

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null')
  } catch {
    return null
  }
}

function fieldValue(fields, recordId, key) {
  const field = (fields || []).find((item) => item.recordId === recordId && item.key === key)
  const value = field?.value
  return value == null ? '' : String(value).trim()
}

export function recordsForChild(db, childId) {
  if (!db || !childId) return []
  const records = db.records || []
  const assets = db.assets || []
  const fields = db.fields || []
  return records.filter((record) => record.childId === childId && record.notMedical !== true && record.extractionErrorReason !== 'extract_non_medical').map((record) => {
    const asset = assets.find((item) => item.id === record.originalAssetId)
    const date = (record.documentDate || fieldValue(fields, record.id, 'documentDate') || fieldValue(fields, record.id, 'visitDate') || '').trim()
    return {
      assetId: record.originalAssetId,
      documentDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
      hospital: record.hospital || fieldValue(fields, record.id, 'hospital'),
      department: fieldValue(fields, record.id, 'department'),
      diagnosis: fieldValue(fields, record.id, 'diagnosis'),
      chiefComplaint: fieldValue(fields, record.id, 'chiefComplaint'),
      summary: record.summary || fieldValue(fields, record.id, 'summary'),
      labPanel: fieldValue(fields, record.id, 'lab_panel'),
      bodyPart: fieldValue(fields, record.id, 'body_part'),
      ocrText: record.ocrText || '',
      documentType: record.documentType || asset?.kind || '',
    }
  })
}

export function journalsForChild(db, childId) {
  if (!db || !childId) return []
  return (db.events || []).filter((event) => event.childId === childId).map((event) => ({
    id: event.id,
    text: [event.title, event.body, event.transcript].filter(Boolean).join('\n'),
  }))
}

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

function renderSafety(parent, label, item, navigate) {
  const block = el('div', 'med-agent-safety-item')
  block.append(el('h3', null, label))
  if (!item) {
    block.append(el('p', null, '档案未记录'))
  } else {
    const button = el('button', 'med-agent-link', item.text)
    button.type = 'button'
    button.addEventListener('click', () => navigate(`/medical/${item.assetId}`))
    block.append(button)
  }
  parent.append(block)
}

function renderNode(list, node, navigate) {
  const item = el('li', `med-agent-node is-${node.relevance}`)
  item.dataset.relevance = node.relevance
  item.dataset.date = node.date || ''
  item.dataset.asset = node.assetId
  const details = document.createElement('details')
  if (node.expanded) details.open = true
  const summary = document.createElement('summary')
  const when = node.date || '就诊日期未确认'
  const where = [node.hospital, node.department].filter(Boolean).join(' · ')
  summary.textContent = where ? `${when} · ${where}` : when
  details.append(summary)
  const body = el('div', 'med-agent-node-body')
  body.append(el('p', 'med-agent-quote', node.summary || '尚无识别摘要，可查看原件'))
  const open = el('button', 'btn btn--secondary', '查看原件')
  open.type = 'button'
  open.addEventListener('click', () => navigate(`/medical/${node.assetId}`))
  body.append(open)
  details.append(body)
  item.append(details)
  list.append(item)
}

export function mountMedicalAgent(host, ctx) {
  const child = ctx.child
  let query = ''
  try { query = sessionStorage.getItem(QUERY_KEY) || '' } catch { /* ignore */ }
  let expandAll = false

  const paint = () => {
    host.replaceChildren()
    const root = el('div', 'med-agent')
    root.append(el('h1', 'med-agent-title', '整理就医资料'))
    const who = el('p', 'med-agent-child', child ? `当前孩子：${child.nickname}` : '还没有选择孩子')
    root.append(who)
    if (ctx.children && ctx.children.length > 1 && ctx.switchChild) {
      const row = el('div', 'med-agent-switch')
      for (const kid of ctx.children) {
        const button = el('button', kid.id === child?.id ? 'btn btn--primary' : 'btn btn--secondary', kid.nickname)
        button.type = 'button'
        button.addEventListener('click', () => ctx.switchChild(kid.id))
        row.append(button)
      }
      root.append(row)
    }
    root.append(el('p', 'med-agent-note', '以下内容来自已保存的档案。云端模型不可用时，时间轴和原件仍然可以查看。'))

    const form = document.createElement('form')
    form.className = 'med-agent-form'
    const input = document.createElement('input')
    input.className = 'input'
    input.type = 'text'
    input.value = query
    input.placeholder = '例如：看呼吸科'
    input.setAttribute('aria-label', '就医主题')
    const submit = el('button', 'btn btn--primary', '整理')
    submit.type = 'submit'
    form.append(input, submit)
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      query = input.value.trim()
      try { sessionStorage.setItem(QUERY_KEY, query) } catch { /* ignore */ }
      expandAll = false
      paint()
    })
    root.append(form)

    if (!child) {
      host.append(root)
      return
    }

    const medical = readJson(MEDICAL_KEY)
    const voice = readJson(VOICE_KEY)
    const prepared = prepareMedical({
      query,
      records: recordsForChild(medical, child.id),
      journals: journalsForChild(voice, child.id),
    })

    if (prepared.diagnosisRefusal) {
      root.append(el('p', 'med-agent-refusal', prepared.diagnosisRefusal))
    }

    const safety = el('section', 'med-agent-safety')
    safety.setAttribute('aria-label', '过敏与用药')
    renderSafety(safety, '过敏', prepared.allergy, ctx.navigate)
    renderSafety(safety, '当前用药', prepared.medication, ctx.navigate)
    root.append(safety)

    const toggle = el('button', 'btn btn--secondary', expandAll ? '按相关度折叠' : '展开全部')
    toggle.type = 'button'
    toggle.addEventListener('click', () => {
      expandAll = !expandAll
      paint()
    })
    root.append(toggle)

    const dated = el('ol', 'med-agent-list')
    dated.setAttribute('aria-label', '就诊时间轴')
    for (const node of prepared.dated) renderNode(dated, { ...node, expanded: expandAll || node.expanded }, ctx.navigate)
    if (!prepared.dated.length) dated.append(el('li', 'med-agent-empty', query ? '档案里还没有可排列的就诊日期' : '输入主题后再整理，或直接查看医疗档案'))
    root.append(dated)

    const pending = el('section', 'med-agent-undated')
    pending.append(el('h2', null, '就诊日期未确认'))
    if (!prepared.undated.length) pending.append(el('p', null, '没有缺少日期的资料'))
    const pendingList = el('ol', 'med-agent-list')
    for (const node of prepared.undated) renderNode(pendingList, { ...node, expanded: expandAll || node.expanded }, ctx.navigate)
    pending.append(pendingList)
    root.append(pending)

    if (prepared.journals.length) {
      const notes = el('section', 'med-agent-journal')
      notes.append(el('h2', null, '家长记录'))
      const list = el('ul', 'med-agent-list')
      for (const note of prepared.journals) {
        const item = el('li', 'med-agent-journal-item')
        item.append(el('span', 'med-agent-tag', note.label))
        const button = el('button', 'med-agent-link', note.excerpt)
        button.type = 'button'
        button.addEventListener('click', () => ctx.navigate(`/daily/${note.id}`))
        item.append(button)
        list.append(item)
      }
      notes.append(list)
      root.append(notes)
    }

    host.append(root)
  }

  paint()
  return () => { host.replaceChildren() }
}
