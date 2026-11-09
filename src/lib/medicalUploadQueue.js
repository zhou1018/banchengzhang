// 医疗上传入队：File 只按队列项 id 登记。
// 同名文件（手机相册里多张都叫 image.jpg）不能共用一个键。

export const MISSING_UPLOAD_REASON = 'upload_file_expired'
export const MISSING_UPLOAD_MESSAGE = '原文件已不在本次会话，请重新选择'

function defaultId() {
  return `uq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * @param {Array<{name:string,type?:string,size?:number}>} files
 * @param {{
 *   childId: string,
 *   validateBatch: (files: unknown[]) => { ok: boolean, accepted?: unknown[] },
 *   validateFile: (file: unknown) => string | null,
 *   cleanName: (name: string) => string,
 *   now: () => string,
 *   createId?: () => string,
 * }} deps
 */
export function enqueueMedicalFiles(files, deps) {
  const batch = deps.validateBatch(files)
  if (!batch.ok) {
    return { ok: false, accepted: 0, rejected: files.length, items: [] }
  }
  const createId = deps.createId ?? defaultId
  let accepted = 0
  let rejected = 0
  const items = []
  for (const file of batch.accepted ?? []) {
    const reason = deps.validateFile(file)
    const id = createId()
    const entry = {
      id,
      childId: deps.childId,
      fileName: file.name,
      mimeType: file.type ?? '',
      byteSize: file.size ?? 0,
      displayName: deps.cleanName(file.name),
      state: reason ? 'failed' : 'pending',
      errorReason: reason,
      retryCount: 0,
      createdAt: deps.now(),
    }
    if (reason) rejected += 1
    else accepted += 1
    items.push({ entry, file: reason ? null : file })
  }
  return { ok: true, accepted, rejected, items }
}
