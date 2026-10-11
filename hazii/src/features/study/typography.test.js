import test from 'node:test'
import assert from 'node:assert/strict'
import { formatTypography, splitReadableText } from '../../components/typography.js'

test('typography keeps words, dashes, prepositions and manual paragraphs intact', () => {
  const text = formatTypography('Учение — труд. По-китайски и по русски.\nДень — ночь.')
  assert.ok(text.includes('Учение\u00a0\u2060—\u2060\u00a0труд'))
  assert.ok(text.includes('По\u2011китайски'))
  assert.ok(text.includes('по\u00a0русски'))
  assert.ok(text.includes('\nДень'))
  assert.equal(formatTypography('сло\u00adво'), 'слово')
  assert.equal(formatTypography(text), text, 'formatting is idempotent')
  assert.equal(formatTypography('10 км, 5 кг. 20 %'), '10\u00a0км, 5\u00a0кг. 20\u00a0%')
  assert.equal(splitReadableText('我喜欢学习中文。').map((part) => part.text).join(''), '我喜欢学习中文。')
  assert.deepEqual(splitReadableText('我喜欢学习中文。').filter((part) => part.chinese).map((part) => part.text), ['我', '喜欢', '学习', '中文'])
})
