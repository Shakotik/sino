import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import express from 'express'
import { Pool } from 'pg'
import { getDatabaseUrl, loadLocalEnvironment } from './config.mjs'
import { createDictionarySegmentationRouter, prepareSentence, resolveSentence } from './dictionarySegmentation.mjs'

const makeEntries = (words) => words.map((word, index) => ({ id: index + 1, headword_normalized: word, pinyin: 'test' }))

test('Chinese sentences preserve punctuation, whitespace, emoji and repeated-word positions', () => {
  const text = '  我喜欢学习中文。\n我喜欢中文！🙂 test 123 𠀀'
  const { segments, candidates } = prepareSentence(text)
  const tokens = resolveSentence(segments, makeEntries(['我', '喜欢', '学习', '中文']))
  assert.equal(tokens.map((token) => token.text).join(''), text)
  for (const token of tokens) assert.equal(text.slice(token.start, token.end), token.text)
  assert.equal(new Set(tokens.map((token) => token.start)).size, tokens.length)
  assert.deepEqual(tokens.filter((token) => token.kind === 'word').map((token) => token.text), ['我', '喜欢', '学习', '中文', '我', '喜欢', '中文', '𠀀'])
  assert.equal(tokens.at(-1).entryId, null)
  assert.equal(tokens.at(-1).end - tokens.at(-1).start, 2, 'supplementary Han character is never cut into surrogates')
  assert.ok(!candidates.includes('🙂'))
  assert.ok(!candidates.includes('test'))
})

test('fallback favours complete dictionary coverage over a greedy longest prefix', () => {
  const segments = [{ text: '研究生命', start: 0, end: 4, kind: 'word' }]
  const tokens = resolveSentence(segments, makeEntries(['研究生', '研究', '生命']))
  assert.deepEqual(tokens.map((token) => token.text), ['研究', '生命'])
  assert.ok(tokens.every((token) => token.entryId))
  const exact = resolveSentence(segments, makeEntries(['研究生命', '研究', '生命']))
  assert.equal(exact.length, 1, 'an exact ICU word is preserved')
})

test('fallback never invents a definition and prefers longer words on equal coverage', () => {
  const segment = [{ text: '甲乙丙丁', start: 3, end: 7, kind: 'word' }]
  const tokens = resolveSentence(segment, makeEntries(['甲乙', '甲', '乙', '丙']))
  assert.deepEqual(tokens.map((token) => token.text), ['甲乙', '丙', '丁'])
  assert.equal(tokens.at(-1).entryId, null)
  assert.equal(tokens[0].start, 3)
  assert.equal(tokens.at(-1).end, 7)
})

test('candidate work is bounded and deduplicated for long pasted text', () => {
  const text = '我喜欢学习中文。'.repeat(125)
  const { candidates } = prepareSentence(text)
  assert.equal(new Set(candidates).size, candidates.length)
  assert.ok(candidates.length <= text.length * 13)
  assert.ok(candidates.length < 20, 'repeated phrases are looked up only once')
})

async function withApi(pool, callback) {
  const app = express()
  app.use('/segment', createDictionarySegmentationRouter(pool))
  app.use((_error, _request, response, _next) => response.status(503).json({ message: 'Словарь временно недоступен.' }))
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    await callback(async (body, raw = false) => fetch(`http://127.0.0.1:${server.address().port}/segment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw ? body : JSON.stringify(body),
    }))
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

test('sentence API validates input before querying and returns JSON for oversized/broken bodies', async () => {
  let calls = 0
  await withApi({ query: async () => { calls += 1; return { rows: [] } } }, async (request) => {
    for (const body of [{}, { text: '' }, { text: '  ' }, { text: 'hello' }, { text: '中文'.repeat(501) }, { text: [] }]) {
      const response = await request(body)
      assert.equal(response.status, 400)
      assert.ok((await response.json()).message)
      assert.equal(response.headers.get('cache-control'), 'no-store')
    }
    assert.equal((await request('{broken', true)).status, 400)
    assert.equal((await request({ text: '中'.repeat(9000) })).status, 413)
    assert.equal(calls, 0)
  })
})

test('sentence API performs one parameterised lookup and does not return full articles', async () => {
  const calls = []
  await withApi({ query: async (query) => { calls.push(query); return { rows: makeEntries(['我', '喜欢', '学习', '中文']) } } }, async (request) => {
    const response = await request({ text: '我喜欢学习中文。' })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const { tokens } = await response.json()
    assert.ok(tokens.filter((token) => token.kind === 'word').every((token) => token.entryId))
    assert.ok(tokens.every((token) => !('article' in token)))
    assert.equal(calls.length, 1)
    assert.match(calls[0].text, /ANY\(\$1::text\[\]\)/)
    assert.ok(calls[0].values[0].includes('学习'))
  })
})

test('database failure is reported without fake successful segmentation', async () => {
  await withApi({ query: async () => { throw new Error('database unavailable') } }, async (request) => {
    const response = await request({ text: '中文' })
    assert.equal(response.status, 503)
    assert.ok((await response.json()).message)
  })
})

// Read-only integration test against the imported BKRS, never changes entries.
test('real BKRS resolves sentence words to matching full articles', { skip: process.env.DICTIONARY_DB_TESTS !== '1' }, async () => {
  loadLocalEnvironment()
  const pool = new Pool({ connectionString: getDatabaseUrl(), max: 2 })
  try {
    await withApi(pool, async (request) => {
      const response = await request({ text: '我喜欢学习中文。今天我想去北京。' })
      assert.equal(response.status, 200)
      const { tokens } = await response.json()
      const words = tokens.filter((token) => token.kind === 'word')
      assert.deepEqual(words.map((token) => token.text), ['我', '喜欢', '学习', '中文', '今天', '我', '想', '去', '北京'])
      assert.ok(words.every((word) => word.entryId))
      const { rows } = await pool.query('SELECT id, headword_normalized, article FROM dictionary.entries WHERE id = ANY($1::bigint[])', [words.map((word) => word.entryId)])
      for (const word of words) {
        const entry = rows.find((row) => String(row.id) === word.entryId)
        assert.equal(entry.headword_normalized, word.text)
        assert.ok(entry.article.length > 0)
      }
    })
  } finally {
    await pool.end()
  }
})
