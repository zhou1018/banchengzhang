// 结构化提取写回：以等待期间的最新记录为准。
// 用户锁定的字段，或「已手动修改」且来源是用户的非空字段，不被 AI 整份覆盖。

const RECORD_KEYS = ['documentType', 'documentDate', 'hospital', 'summary']

export function fieldKept(field, editedByUser) {
  if (!field) return false
  if (field.locked === true) return true
  return editedByUser === true && field.source === 'user' && field.value != null && field.value !== ''
}

/**
 * @param {object} latest 提取返回后重新读到的记录
 * @param {object[]} existingFields
 * @param {object[]} aiFields
 * @param {object} patch AI 打算写到记录上的字段（不含版本号）
 */
export function mergeExtractResult(latest, existingFields, aiFields, patch) {
  const protect = latest?.editedByUser === true
  const existingByKey = new Map((existingFields ?? []).map((field) => [field.key, field]))
  const fields = []
  const seen = new Set()
  for (const ai of aiFields ?? []) {
    const prev = existingByKey.get(ai.key)
    seen.add(ai.key)
    fields.push(fieldKept(prev, protect) ? prev : ai)
  }
  for (const prev of existingFields ?? []) {
    if (!seen.has(prev.key) && fieldKept(prev, protect)) fields.push(prev)
  }
  const record = {
    ...latest,
    ...patch,
    editedByUser: latest?.editedByUser === true,
    version: (latest?.version ?? 0) + 1,
    updatedAt: patch.updatedAt ?? patch.extractionCompletedAt ?? latest?.updatedAt,
  }
  for (const key of RECORD_KEYS) {
    const kept = fields.find((field) => field.key === key && fieldKept(field, protect))
    if (kept) record[key] = kept.value
  }
  return { record, fields }
}

/** 提取失败只改状态，沿用最新记录，不用开始时的快照。 */
export function failExtractRecord(latest, errorReason, now) {
  return {
    ...latest,
    extractionState: 'failed',
    extractionErrorReason: errorReason,
    updatedAt: now,
  }
}
