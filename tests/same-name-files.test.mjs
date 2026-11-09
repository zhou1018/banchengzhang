import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { bindFilesToQueue, resolveQueuedFile } from '../src/lib/medicalQueue.js'

test('two files named image.jpg stay distinct originals', () => {
  const files = [
    { name: 'image.jpg', size: 10, body: 'respiratory' },
    { name: 'image.jpg', size: 20, body: 'fracture' },
  ]
  const { registry, items } = bindFilesToQueue(files)
  assert.equal(items.length, 2)
  assert.notEqual(items[0].id, items[1].id)
  assert.equal(resolveQueuedFile(registry, items[0]).body, 'respiratory')
  assert.equal(resolveQueuedFile(registry, items[1]).body, 'fracture')
})

test('a file that fails validation is not registered', () => {
  const { registry, items } = bindFilesToQueue(
    [{ name: 'notes.txt' }],
    () => 'upload_unsupported_type',
  )
  assert.equal(items[0].state, 'failed')
  assert.equal(resolveQueuedFile(registry, items[0]), null)
})

test('published page registers medical files by queue id', () => {
  const bundle = readFileSync(new URL('../assets/index-medprep.js', import.meta.url), 'utf8')
  assert.equal(bundle.includes('fh(w.name,w)'), false)
  assert.equal(bundle.includes('fh(id,B)'), true)
  assert.equal(bundle.includes('bi.get(C.fileName)'), false)
  assert.equal(bundle.includes('bi.get(A.fileName)'), false)
  assert.equal(bundle.includes('upload_file_gone'), true)
  assert.match(bundle, /upload_file_gone:"原文件已不在本次会话，请重新选择"/)
})
