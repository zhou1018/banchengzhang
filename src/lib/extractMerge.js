// 结构化提取写回：以库里的最新记录为准。
// 用户在等待模型时改过并锁定的字段，不能被旧快照整份盖掉。

const RECORD_FACT_KEYS = ['documentType', 'documentDate', 'documentDateKind', 'hospital', 'summary']

function isEmpty(value) {
  return value == null || value === ''
}

export function mergeExtractWrite({ latestRecord, latestFields, baseRecord, aiRecordPatch, aiFields }) {
  const latest = latestRecord || baseRecord
  const fieldsNow = latestFields || []
  const keepUser = latest.editedByUser === true
  const record = {
    ...latest,
    extractionState: aiRecordPatch.extractionState,
    extractionProviderMode: aiRecordPatch.extractionProviderMode,
    extractionCompletedAt: aiRecordPatch.extractionCompletedAt,
    extractionErrorReason: aiRecordPatch.extractionErrorReason ?? null,
    version: (latest.version || 0) + 1,
    updatedAt: aiRecordPatch.updatedAt,
  }
  for (const key of RECORD_FACT_KEYS) {
    if (keepUser && !isEmpty(latest[key])) continue
    record[key] = aiRecordPatch[key]
  }

  const locked = new Map(fieldsNow.filter((field) => field.locked).map((field) => [field.key, field]))
  const existingByKey = new Map(fieldsNow.map((field) => [field.key, field]))
  const fields = []
  const seen = new Set()
  for (const field of aiFields || []) {
    seen.add(field.key)
    const lockedField = locked.get(field.key)
    if (lockedField) {
      fields.push(lockedField)
      continue
    }
    const existing = existingByKey.get(field.key)
    if (keepUser && existing && !isEmpty(existing.value)) {
      fields.push(existing)
      continue
    }
    fields.push(field)
  }
  for (const [key, field] of locked) {
    if (!seen.has(key)) fields.push(field)
  }
  return { record, fields }
}

export function mergeExtractFailure({ latestRecord, baseRecord, extractionErrorReason, updatedAt }) {
  const latest = latestRecord || baseRecord
  return {
    ...latest,
    extractionState: 'failed',
    extractionErrorReason,
    updatedAt,
  }
}
