import fs from 'fs'
import path from 'path'
import { enqueueMedicalFiles } from '../src/lib/medicalUploadQueue.js'

const assetDir = new URL('../assets/', import.meta.url)
const bundleName = fs.readdirSync(assetDir).find((name) => name.startsWith('index-') && name.endsWith('.js'))
const bundle = fs.readFileSync(path.join(assetDir.pathname, bundleName), 'utf8')
let failed = 0
function check(name, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
  if (!ok) failed += 1
}

const registered = []
let n = 0
const planned = enqueueMedicalFiles(
  [
    { name: 'image.jpg', type: 'image/jpeg', size: 11 },
    { name: 'image.jpg', type: 'image/jpeg', size: 22 },
  ],
  {
    childId: 'c1',
    validateBatch: (files) => ({ ok: true, accepted: files }),
    validateFile: () => null,
    cleanName: (name) => name,
    now: () => '2026-11-09T00:00:00.000Z',
    createId: () => `uq_test_${++n}`,
  },
)
for (const item of planned.items) {
  if (item.file) registered.push([item.entry.id, item.file])
}

check('accepted both same-name files', planned.ok && planned.accepted === 2 && planned.rejected === 0)
check('distinct queue ids', planned.items[0].entry.id !== planned.items[1].entry.id)
check('registry keeps both payloads', registered.length === 2 && registered[0][1].size === 11 && registered[1][1].size === 22)
check('ids match registry keys', registered[0][0] === 'uq_test_1' && registered[1][0] === 'uq_test_2')
check('bundle registers by queue id', bundle.includes('fh(B.entry.id,B.file)'))
check('bundle no longer registers by file name', !bundle.includes('fh(w.name,w)') && !bundle.includes('bi.get(C.fileName)') && !bundle.includes('bi.get(A.fileName)'))
check('missing file is not a network error', bundle.includes('MISSING_UPLOAD_REASON') && bundle.includes('原文件已不在本次会话，请重新选择'))

console.log(failed ? `RESULT: FAIL ${failed}` : 'RESULT: PASS')
process.exit(failed ? 1 : 0)
