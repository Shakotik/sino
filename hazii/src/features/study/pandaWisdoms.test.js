import test from 'node:test'
import assert from 'node:assert/strict'
import { pandaWisdoms } from '../../data/pandaWisdoms.js'

test('panda has exactly 100 distinct thoughts, 50 for each tradition', () => {
  assert.equal(pandaWisdoms.length, 100)
  assert.equal(new Set(pandaWisdoms.map((wisdom) => wisdom.id)).size, 100)
  assert.equal(new Set(pandaWisdoms.map((wisdom) => wisdom.text)).size, 100)
  for (const tradition of ['confucian', 'buddhist']) {
    assert.equal(pandaWisdoms.filter((wisdom) => wisdom.tradition === tradition).length, 50)
  }
})

test('each thought is short, sourced and alternates with the other tradition', () => {
  const sources = {
    confucian: { title: 'Луньюй', path: '/cache/epub/3330/pg3330-images.html' },
    buddhist: { title: 'Дхаммапада', path: '/cache/epub/2017/pg2017-images.html' },
  }
  for (const [index, wisdom] of pandaWisdoms.entries()) {
    assert.equal(wisdom.tradition, index % 2 === 0 ? 'confucian' : 'buddhist')
    assert.equal(wisdom.text, wisdom.text.trim())
    assert.ok(wisdom.text.length > 20 && wisdom.text.length <= 120, wisdom.id)
    assert.match(wisdom.reference, /^\d+(?:[.–]\d+)*$/)
    assert.equal(wisdom.sourceTitle, sources[wisdom.tradition].title)
    const sourceUrl = new URL(wisdom.sourceUrl)
    assert.equal(sourceUrl.origin, 'https://www.gutenberg.org')
    assert.equal(sourceUrl.pathname, sources[wisdom.tradition].path)
  }
})
