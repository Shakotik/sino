// Presentation only: never rewrite saved dictionary entries or user input.
// NBSP and WORD JOINER prevent isolated punctuation without inserting <br>.
export function formatTypography(value) {
  return String(value ?? '')
    .replace(/\u00ad/gu, '')
    .replace(/(?<=\p{L})-(?=\p{L})/gu, '\u2011')
    .replace(/(?<=[^\s\u2060])[ \t\u00a0\u2060]*([—–])[ \t\u00a0\u2060]*(?=[^\s\u2060])/gu, '\u00a0\u2060$1\u2060\u00a0')
    .replace(/(?<![\p{L}\p{N}])((?:в|во|к|ко|с|со|у|о|об|от|до|из|за|на|по|не|ни|а|и))[ \t]+(?=\S)/giu, '$1\u00a0')
    .replace(/(\d)[ \t]+(?=(?:%|₽|°[CС]|кг|км|мин|ч)(?!\p{L}))/gu, '$1\u00a0')
}

const chineseSegmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('zh', { granularity: 'word' }) : null

export function splitReadableText(value) {
  const text = formatTypography(value)
  return text.split(/(\p{Script=Han}+)/gu).filter(Boolean).flatMap((part) => {
    if (!/^\p{Script=Han}+$/u.test(part)) return [{ text: part, chinese: false }]
    // Older browsers keep the Chinese run together; no dependency on experimental
    // CSS auto-phrase. Modern Safari/Chromium segment Chinese words locally.
    return chineseSegmenter ? [...chineseSegmenter.segment(part)].map(({ segment }) => ({ text: segment, chinese: true }))
      : [{ text: part, chinese: true }]
  })
}
