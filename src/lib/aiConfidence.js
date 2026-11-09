/** 只接受 0 到 1 的有限数字。缺失、越界都不当成高置信度。 */
export function passThroughConfidence(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null
}

/** 没有数字置信度时返回 null，调用方不能把 null 当成 0 再判失败。 */
export function averageKnownConfidence(pages) {
  const nums = (pages ?? [])
    .map((page) => page?.confidence)
    .filter((value) => typeof value === 'number' && Number.isFinite(value))
  if (nums.length === 0) return null
  return nums.reduce((sum, value) => sum + value, 0) / nums.length
}

export function ocrShouldFail(charCount, avgConfidence) {
  if (!charCount) return true
  return typeof avgConfidence === 'number' && avgConfidence < 0.4
}
