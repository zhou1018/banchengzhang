import fs from 'fs'
import path from 'path'
import { failExtractRecord, mergeExtractResult } from '../src/lib/medicalFieldMerge.js'

const assetDir = new URL('../assets/', import.meta.url)
const bundleName = fs.readdirSync(assetDir).find((name) => name.startsWith('index-') && name.endsWith('.js'))
const bundle = fs.readFileSync(path.join(assetDir.pathname, bundleName), 'utf8')
let failed = 0
function check(name, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
  if (!ok) failed += 1
}

const latest = {
  id: 'rec_1',
  editedByUser: true,
  version: 3,
  documentDate: '2026-10-22',
  hospital: '市儿童医院',
  summary: '家长改过的病情',
  documentType: 'record',
  ocrText: '原文',
}
const existing = [
  { key: 'documentDate', value: '2026-10-22', source: 'user', locked: true },
  { key: 'hospital', value: '市儿童医院', source: 'user', locked: true },
  { key: 'summary', value: '家长改过的病情', source: 'user', locked: false },
  { key: 'department', value: null, source: null, locked: false },
]
const aiFields = [
  { key: 'documentDate', value: '2020-01-01', source: 'ai', locked: false },
  { key: 'hospital', value: '另一家医院', source: 'ai', locked: false },
  { key: 'summary', value: 'AI 摘要', source: 'ai', locked: false },
  { key: 'department', value: '儿科', source: 'ai', locked: false },
]
const merged = mergeExtractResult(latest, existing, aiFields, {
  documentType: 'lab',
  documentDate: '2020-01-01',
  hospital: '另一家医院',
  summary: 'AI 摘要',
  extractionState: 'ready',
  extractionCompletedAt: '2026-11-09T01:00:00.000Z',
  updatedAt: '2026-11-09T01:00:00.000Z',
})

check('locked date stays', merged.record.documentDate === '2026-10-22')
check('locked hospital stays', merged.fields.find((f) => f.key === 'hospital').value === '市儿童医院')
check('user summary stays while edited', merged.record.summary === '家长改过的病情')
check('empty field is filled', merged.fields.find((f) => f.key === 'department').value === '儿科')
check('version follows the latest record', merged.record.version === 4)
check('ocr text from the latest record remains', merged.record.ocrText === '原文')
check('edited flag stays', merged.record.editedByUser === true)

const fresh = mergeExtractResult(
  { id: 'rec_2', editedByUser: false, version: 1, documentDate: null },
  [{ key: 'documentDate', value: null, source: null, locked: false }],
  [{ key: 'documentDate', value: '2026-10-22', source: 'ai', locked: false }],
  { documentDate: '2026-10-22', extractionState: 'ready', updatedAt: 't' },
)
check('unlocked field takes AI value', fresh.record.documentDate === '2026-10-22')

const failedRecord = failExtractRecord(
  { id: 'rec_1', editedByUser: true, summary: '家长改过的病情', extractionState: 'processing' },
  'extract_provider_error',
  '2026-11-09T02:00:00.000Z',
)
check('failure keeps the user edit', failedRecord.summary === '家长改过的病情' && failedRecord.editedByUser === true)
check('failure only changes state', failedRecord.extractionState === 'failed' && failedRecord.extractionErrorReason === 'extract_provider_error')
check('bundle writes through the merge helper', bundle.includes('mergeExtractResult(') && bundle.includes('failExtractRecord('))

console.log(failed ? `RESULT: FAIL ${failed}` : 'RESULT: PASS')
process.exit(failed ? 1 : 0)
