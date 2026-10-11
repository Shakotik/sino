import express from 'express'

export const MAX_SENTENCE_LENGTH = 1000
const MAX_FALLBACK_WORD_LENGTH = 12
const chineseWord = /^\p{Script=Han}+$/u
const wordSegmenter = new Intl.Segmenter('zh', { granularity: 'word' })

// ICU supplies linguistic word boundaries. Keep original offsets and all
// punctuation/whitespace so joining the tokens reproduces the submitted text.
export function prepareSentence(text) {
  const segments = [...wordSegmenter.segment(text)].map(({ segment, index }) => ({
    text: segment,
    start: index,
    end: index + segment.length,
    kind: chineseWord.test(segment) ? 'word' : 'text',
  }))
  const candidates = new Set()
  for (const segment of segments) {
    if (segment.kind !== 'word') continue
    candidates.add(segment.text)
    const characters = Array.from(segment.text)
    // Unknown ICU groups (e.g. 我想去) can be split using exact BKRS entries.
    // Bounded substrings make the amount of database work linear in input size.
    for (let start = 0; start < characters.length; start += 1) {
      for (let length = 1; length <= Math.min(MAX_FALLBACK_WORD_LENGTH, characters.length - start); length += 1) {
        candidates.add(characters.slice(start, start + length).join(''))
      }
    }
  }
  return { segments, candidates: [...candidates] }
}

function tokenFromEntry(text, start, entry) {
  return {
    text, start, end: start + text.length, kind: 'word',
    entryId: entry ? String(entry.id) : null,
    pinyin: entry?.pinyin ?? '',
  }
}

// Prefer full dictionary coverage, then fewer words. This avoids the greedy
// longest-match trap where a long prefix leaves an unrecognised remainder.
function splitUnknownGroup(segment, entriesByWord) {
  const characters = Array.from(segment.text)
  const paths = new Array(characters.length + 1)
  paths[characters.length] = { unknown: 0, words: 0 }
  for (let start = characters.length - 1; start >= 0; start -= 1) {
    for (let length = 1; length <= Math.min(MAX_FALLBACK_WORD_LENGTH, characters.length - start); length += 1) {
      const text = characters.slice(start, start + length).join('')
      const entry = entriesByWord.get(text)
      if (!entry && length > 1) continue
      const remainder = paths[start + length]
      const candidate = { text, entry, length, unknown: remainder.unknown + (entry ? 0 : 1), words: remainder.words + 1 }
      const best = paths[start]
      if (!best || candidate.unknown < best.unknown || (candidate.unknown === best.unknown && candidate.words <= best.words)) {
        paths[start] = candidate
      }
    }
  }
  const tokens = []
  let offset = segment.start
  for (let index = 0; index < characters.length;) {
    const choice = paths[index]
    tokens.push(tokenFromEntry(choice.text, offset, choice.entry))
    offset += choice.text.length
    index += choice.length
  }
  return tokens
}

export function resolveSentence(segments, entries) {
  const entriesByWord = new Map(entries.map((entry) => [entry.headword_normalized, entry]))
  return segments.flatMap((segment) => {
    if (segment.kind !== 'word') return [{ ...segment, entryId: null, pinyin: '' }]
    const entry = entriesByWord.get(segment.text)
    return entry ? [tokenFromEntry(segment.text, segment.start, entry)] : splitUnknownGroup(segment, entriesByWord)
  })
}

export function createDictionarySegmentationRouter(pool) {
  const router = express.Router()
  // POST keeps pasted sentences out of URLs and shared search caches.
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store')
    next()
  })
  router.post('/', express.json({ limit: '8kb' }), async (request, response, next) => {
    const text = request.body?.text
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_SENTENCE_LENGTH) {
      response.status(400).json({ message: `Введите предложение длиной от 1 до ${MAX_SENTENCE_LENGTH} символов.` })
      return
    }
    if (!/\p{Script=Han}/u.test(text)) {
      response.status(400).json({ message: 'Добавьте китайское предложение: в нём должны быть иероглифы.' })
      return
    }
    try {
      const { segments, candidates } = prepareSentence(text)
      // One parameterised indexed lookup, not one request per word. Articles
      // are fetched only when selected via the existing /entries/:id endpoint.
      const { rows } = await pool.query({
        text: `SELECT DISTINCT ON (headword_normalized) id, headword_normalized, pinyin
               FROM dictionary.entries
               WHERE direction = 'zh-ru' AND headword_normalized = ANY($1::text[])
               ORDER BY headword_normalized, id`,
        values: [candidates],
        query_timeout: 5000,
      })
      response.json({ tokens: resolveSentence(segments, rows), method: 'icu-bkrs' })
    } catch (error) {
      next(error)
    }
  })
  router.use((error, _request, response, next) => {
    if (error.type === 'entity.too.large' || error.type === 'entity.parse.failed') {
      response.status(error.status).json({ message: 'Не удалось прочитать предложение. Проверьте текст и его длину.' })
    } else next(error)
  })
  return router
}
