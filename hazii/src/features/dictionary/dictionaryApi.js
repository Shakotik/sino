// Same-origin URLs also work on phones: Vite proxies /api in development;
// the production reverse proxy exposes the same paths.
const dictionaryApiBaseUrl = '/api/dictionary'

export function buildSearchUrl(query, direction) {
  const parameters = new URLSearchParams({ q: query, direction, limit: '10' })
  return `${dictionaryApiBaseUrl}/search?${parameters}`
}

export function getEntryUrl(entryId) {
  return `${dictionaryApiBaseUrl}/entries/${entryId}`
}

export async function analyseSentence(text, signal) {
  const response = await fetch(`${dictionaryApiBaseUrl}/segment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal,
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.message || 'Не удалось разобрать предложение.')
  return payload.tokens
}
