import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateChineseAnswer, evaluateMeaningAnswer, getDictionaryMeanings } from './answerEvaluation.js'

test('dictionary alternatives, punctuation, case and ё are accepted', () => {
  assert.equal(evaluateMeaningAnswer(' НРАВИТЬСЯ! ', 'любить; нравиться').correct, true)
  assert.equal(evaluateMeaningAnswer('самолет', 'самолёт').score, 100)
  assert.equal(evaluateMeaningAnswer('носить', 'носить (одежду); надевать').correct, true)
  assert.deepEqual(getDictionaryMeanings('папа, отец / родитель'), ['папа', 'отец', 'родитель'])
})

test('reviewed synonyms are accepted without requiring every dictionary sense', () => {
  assert.equal(evaluateMeaningAnswer('нравится', 'любить').kind, 'synonym')
  assert.equal(evaluateMeaningAnswer('преподаватель', 'учитель').correct, true)
  assert.equal(evaluateMeaningAnswer('стакан', 'чашка; стакан').correct, true)
})

test('dictionary notes and multiple senses do not turn notes into valid meanings', () => {
  const dictionaryEntry = 'носить (одежду, обувь); надевать'
  assert.deepEqual(getDictionaryMeanings(dictionaryEntry), ['носить', 'надевать'])
  assert.equal(evaluateMeaningAnswer('носить', dictionaryEntry).correct, true)
  assert.equal(evaluateMeaningAnswer('обувь', dictionaryEntry).correct, false)
  assert.equal(evaluateMeaningAnswer('нравиться, люблю', 'любить; нравиться').correct, true)
  assert.equal(evaluateMeaningAnswer('любить, ненавидеть', 'любить; нравиться').correct, false)
  assert.equal(evaluateMeaningAnswer('любить; не любить', 'любить; нравиться').correct, false)
  assert.equal(evaluateMeaningAnswer('школа', 'учебное заведение; учиться').correct, false)
})

test('negations, substrings, unrelated words and synonym stuffing never pass', () => {
  for (const answer of ['не любить', 'нет любить', 'нелюбить', 'любить не', 'любить; ненавидеть', 'любить кошек', 'ненавидеть', 'машина', '']) {
    assert.equal(evaluateMeaningAnswer(answer, 'любить; нравиться').correct, false, answer)
  }
  assert.equal(evaluateMeaningAnswer('не любить', 'любить').score, 0)
  assert.equal(evaluateMeaningAnswer('не за что', 'не за что; пожалуйста').correct, true)
  assert.equal(evaluateMeaningAnswer('не надо', 'не надо; нельзя').correct, true)
  assert.equal(evaluateMeaningAnswer('кушать', 'иметь; есть').correct, false)
})

test('a probable typo receives feedback but never automatic semantic credit', () => {
  const result = evaluateMeaningAnswer('любтить', 'любить')
  assert.equal(result.correct, false)
  assert.equal(result.kind, 'possible-typo')
  assert.ok(result.score > 0 && result.score < 80)
  assert.equal(evaluateMeaningAnswer('дня', 'два').correct, false)
})

test('Chinese input ignores spaces but requires all characters in order', () => {
  assert.equal(evaluateChineseAnswer(' 爱 ', '爱').correct, true)
  assert.equal(evaluateChineseAnswer(' 学 校 ', '学校').correct, true)
  for (const answer of ['学', '校学', '学校。', 'xuéxiào', '愛', '']) {
    assert.equal(evaluateChineseAnswer(answer, '学校').correct, false, answer)
  }
})
