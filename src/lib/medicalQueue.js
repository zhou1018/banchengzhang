// 医疗上传队列：File 只按队列项 id 登记。
// 手机相册里多张照片经常同名（image.jpg），按文件名登记会互相覆盖。

export function createQueueId(index) {
  return `uq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${index}`
}

/**
 * @param {Array<{ name: string, size?: number }>} files
 * @param {(file: { name: string }) => string | null} [validate] 返回错误码则该文件不登记
 */
export function bindFilesToQueue(files, validate) {
  const registry = new Map()
  const items = []
  files.forEach((file, index) => {
    const id = createQueueId(index)
    const error = validate ? validate(file) : null
    if (!error) registry.set(id, file)
    items.push({
      id,
      fileName: file.name,
      errorReason: error,
      state: error ? 'failed' : 'pending',
    })
  })
  return { registry, items }
}

export function resolveQueuedFile(registry, item) {
  if (!item || !registry) return null
  return registry.get(item.id) ?? null
}
