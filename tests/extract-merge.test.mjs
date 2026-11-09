import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { mergeExtractFailure, mergeExtractWrite } from '../src/lib/extractMerge.js'

const base = {
  id: 'r1',
  documentDate: null,
  hospital: null,
  summary: null,
  documentType: null,
  documentDateKind: null,
  editedByUser: false,
  version: 1,
}

test('locked user field survives extract write-back', () => {
  const latest = { ...base, editedByUser: true, documentDate: '2024-03-02', summary: '家长改过的主诉', version: 2 }
  const latestFields = [
    { key: 'diagnosis', value: '家长写的诊断', locked: true, source: 'user' },
    { key: 'department', value: null, locked: false },
  ]
  const aiFields = [
    { key: 'diagnosis', value: '模型诊断', locked: false },
    { key: 'department', value: '呼吸科', locked: false },
  ]
  const merged = mergeExtractWrite({
    latestRecord: latest,
    latestFields,
    baseRecord: { ...base },
    aiRecordPatch: {
      documentDate: '2020-01-01',
      hospital: '市儿童医院',
      summary: '模型摘要',
      documentType: 'record',
      documentDateKind: 'visit',
      extractionState: 'ready',
      extractionProviderMode: 'real',
      extractionCompletedAt: '2026-11-09T00:00:00.000Z',
      extractionErrorReason: null,
      updatedAt: '2026-11-09T00:00:00.000Z',
    },
    aiFields,
  })
  assert.equal(merged.record.documentDate, '2024-03-02')
  assert.equal(merged.record.summary, '家长改过的主诉')
  assert.equal(merged.record.hospital, '市儿童医院')
  assert.equal(merged.record.version, 3)
  assert.equal(merged.fields.find((field) => field.key === 'diagnosis').value, '家长写的诊断')
  assert.equal(merged.fields.find((field) => field.key === 'department').value, '呼吸科')
})

test('failure patches the latest record instead of the stale snapshot', () => {
  const latest = { ...base, summary: '已保存', version: 4 }
  const failed = mergeExtractFailure({
    latestRecord: latest,
    baseRecord: { ...base, summary: null },
    extractionErrorReason: 'extract_provider_error',
    updatedAt: '2026-11-09T00:00:00.000Z',
  })
  assert.equal(failed.summary, '已保存')
  assert.equal(failed.extractionState, 'failed')
})

test('bundle reloads the record before writing extract results', () => {
  const bundle = readFileSync(new URL('../assets/index-medprep.js', import.meta.url), 'utf8')
  assert.match(bundle, /mergeExtractWrite/)
  assert.match(bundle, /mergeExtractFailure/)
  assert.doesNotMatch(bundle, /const R=ie\(\),U=\{\.\.\.j,documentType/)
})
