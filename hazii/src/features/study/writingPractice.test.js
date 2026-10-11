import test from 'node:test'
import assert from 'node:assert/strict'
import { createWritingPlan, getWordCharacters, getWritingWordResult, normalizeWritingOptions, recordCharacterResult } from '../writing/writingPractice.js'

const father = { id: 1, hanzi: '爸爸', pinyin: 'bàba', translationRu: 'папа' }
const love = { id: 2, hanzi: '爱', pinyin: 'ài', translationRu: 'любить' }
const study = { id: 3, hanzi: '学习', pinyin: 'xuéxí', translationRu: 'учиться' }

test('default learning alternates a stencil and a blank memory task for every position', () => {
  const { characters, steps } = createWritingPlan([father, love])
  assert.equal(characters.length, 3)
  assert.deepEqual(steps.map(({ id, phase }) => `${id}:${phase}`), [
    '1-0:trace', '1-0:memory', '1-1:trace', '1-1:memory', '2-0:trace', '2-0:memory',
  ])
})

test('a batch traces N consecutive characters then repeats the same characters in order', () => {
  const { steps } = createWritingPlan([father, love, study], { batchSize: 3 })
  assert.deepEqual(steps.map(({ character, phase }) => `${character}:${phase}`), [
    '爸:trace', '爸:trace', '爱:trace', '爸:memory', '爸:memory', '爱:memory',
    '学:trace', '习:trace', '学:memory', '习:memory',
  ])
  assert.equal(steps[6].batchLength, 2)
  assert.equal(steps[6].batchIndex, 1)
})

test('memory-only mode contains no guided steps and does not reorder a word', () => {
  const { steps } = createWritingPlan([father, study], { practice: 'memory', batchSize: 3 })
  assert.deepEqual(steps.map(({ character }) => character), ['爸', '爸', '学', '习'])
  assert.ok(steps.every(({ phase }) => phase === 'memory'))
})

test('tracing, a missing character and a skipped memory task never mark the whole word learned', () => {
  assert.equal(getWritingWordResult(father, {}).mastered, false)
  const correct = recordCharacterResult(undefined, { correct: true })
  assert.equal(getWritingWordResult(father, { '1-0': correct }).resolved, false)
  const skipped = recordCharacterResult(undefined, { correct: false, skipped: true })
  const result = getWritingWordResult(father, { '1-0': correct, '1-1': skipped })
  assert.equal(result.resolved, true)
  assert.equal(result.mastered, false)
  assert.equal(result.score, 50)
})

test('successful retries count mastery but preserve the incorrect first attempt', () => {
  const wrong = recordCharacterResult(undefined, { correct: false })
  const retried = recordCharacterResult(wrong, { correct: true })
  const result = getWritingWordResult(father, { '1-0': retried, '1-1': recordCharacterResult(undefined, { correct: true }) })
  assert.equal(result.mastered, true)
  assert.equal(result.firstTryCorrect, false)
  assert.equal(result.score, 50)
})

test('unavailable data cannot grant mastery, even with a conflicting success flag', () => {
  const result = recordCharacterResult(undefined, { correct: true, unavailable: true })
  assert.equal(result.mastered, false)
  assert.equal(result.firstTryCorrect, false)
})

test('punctuation is not a writing task; original Unicode character positions are retained', () => {
  const word = { id: 'phrase', hanzi: '一，二𠮷' }
  assert.deepEqual(getWordCharacters(word).map(({ id }) => id), ['phrase-0', 'phrase-2', 'phrase-3'])
  assert.equal(createWritingPlan([{ id: 'empty', hanzi: '…' }]).steps.length, 0)
  assert.equal(getWritingWordResult({ id: 'empty', hanzi: '…' }, {}).mastered, false)
})

test('URL options are bounded and invalid modes use safe defaults', () => {
  assert.deepEqual(normalizeWritingOptions({ practice: 'unknown', batchSize: 500, count: -5, filter: 'bad', order: 'bad' }), {
    practice: 'learn', batchSize: 10, count: 1, filter: 'all', order: 'sequential',
  })
  assert.equal(normalizeWritingOptions({ batchSize: 'NaN', count: 'NaN' }).batchSize, 1)
  assert.equal(normalizeWritingOptions({ batchSize: 2.9 }).batchSize, 2)
})
