import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { prepareMedical } from '../src/lib/medicalPrepare.js'

const records = [
  {
    assetId: 'resp-1',
    documentDate: '2024-03-02',
    hospital: '市儿童医院',
    department: '呼吸科',
    diagnosis: '急性支气管炎',
    chiefComplaint: '咳嗽三天',
    summary: '咳嗽三天',
    ocrText: '呼吸科 门诊病历 咳嗽三天 急性支气管炎',
  },
  {
    assetId: 'bone-1',
    documentDate: '2024-11-01',
    hospital: '市骨科医院',
    department: '骨科',
    diagnosis: '左桡骨骨折',
    chiefComplaint: '摔倒后肿痛',
    summary: '摔倒后肿痛',
    ocrText: '骨科 左桡骨骨折',
  },
  {
    assetId: 'resp-2',
    documentDate: '2025-02-14',
    hospital: '市儿童医院',
    department: '呼吸内科',
    diagnosis: '支气管肺炎',
    chiefComplaint: '发热咳嗽',
    summary: '发热咳嗽',
    ocrText: '呼吸内科 支气管肺炎',
  },
  {
    assetId: 'undated-1',
    documentDate: null,
    hospital: '',
    department: '',
    diagnosis: '',
    chiefComplaint: '',
    summary: '',
    ocrText: '',
  },
]

test('AT-MED-01 respiratory query keeps every visit in date order', () => {
  const view = prepareMedical({
    query: '看呼吸科',
    records,
    journals: [{ id: 'j1', text: '今晚又咳嗽了，没去医院' }],
  })
  assert.equal(view.diagnosisRefusal, null)
  assert.deepEqual(view.dated.map((node) => node.assetId), ['resp-1', 'bone-1', 'resp-2'])
  assert.deepEqual(view.dated.map((node) => node.date), ['2024-03-02', '2024-11-01', '2025-02-14'])
  const byId = Object.fromEntries(view.dated.map((node) => [node.assetId, node]))
  assert.equal(byId['resp-1'].expanded, true)
  assert.equal(byId['resp-2'].expanded, true)
  assert.equal(byId['bone-1'].relevance, 'low')
  assert.equal(byId['bone-1'].expanded, false)
  assert.equal(view.undated.length, 1)
  assert.equal(view.undated[0].assetId, 'undated-1')
  assert.equal(view.allergy, null)
  assert.equal(view.medication, null)
  assert.equal(view.journals[0].label, '家长记录')
  assert.equal(view.journals[0].id, 'j1')
  for (const node of view.dated) {
    assert.equal(node.assetId.length > 0, true)
    if (node.summary) assert.equal(node.summary.includes('建议'), false)
  }
})

test('a diagnosis question is refused and does not invent a disease', () => {
  const view = prepareMedical({ query: '是不是哮喘', records, journals: [] })
  assert.match(view.diagnosisRefusal, /不能判断是不是某种疾病/)
  assert.match(view.diagnosisRefusal, /不能建议用药/)
  assert.equal(view.dated.length, 3)
  const text = JSON.stringify(view)
  assert.equal(text.includes('确诊'), false)
  assert.equal(text.includes('建议服用'), false)
})

test('allergy quote stays attached to its original and absence is not denial', () => {
  const view = prepareMedical({
    query: '看呼吸科',
    records: [{
      ...records[0],
      ocrText: '呼吸科\n过敏：青霉素\n用药：孟鲁司特',
    }],
    journals: [],
  })
  assert.equal(view.allergy.text, '青霉素')
  assert.equal(view.allergy.assetId, 'resp-1')
  assert.equal(view.medication.text, '孟鲁司特')
  const empty = prepareMedical({ query: '看呼吸科', records: [records[1]], journals: [] })
  assert.equal(empty.allergy, null)
  assert.equal(JSON.stringify(empty).includes('没有过敏'), false)
  assert.equal(JSON.stringify(empty).includes('不存在'), false)
})

test('agent page no longer claims it cannot answer', () => {
  const bundle = readFileSync(new URL('../assets/index-medprep.js', import.meta.url), 'utf8')
  assert.equal(bundle.includes('AI 助手正在建设中'), false)
  assert.equal(bundle.includes('不会提供任何问答或建议'), false)
  assert.match(bundle, /medicalAgent\.js/)
})
