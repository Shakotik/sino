import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeWritingColor } from '../writing/writingColors.js'

test('production alpha-hex colours remain compatible with HanziWriter', () => {
  assert.equal(normalizeWritingColor(' #de947773 '), `rgba(222, 148, 119, ${115 / 255})`)
  assert.equal(normalizeWritingColor('#abcd'), `rgba(170, 187, 204, ${221 / 255})`)
  assert.equal(normalizeWritingColor('#abc'), '#abc')
  assert.equal(normalizeWritingColor('rgba(1, 2, 3, 0.45)'), 'rgba(1, 2, 3, 0.45)')
})
