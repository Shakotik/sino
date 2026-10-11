import { randomUUID } from 'node:crypto'
import { Router } from 'express'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const badRequest = (message, status = 400) => Object.assign(new Error(message), { status })

export function validateFolderTitle(value) {
  if (typeof value !== 'string' || value.includes('\0')) throw badRequest('Укажите тему папки.')
  const title = value.normalize('NFC').trim().replace(/\s+/gu, ' ')
  if (title.length < 2 || title.length > 80 || !/\p{L}/u.test(title)
    || /^(?:(?:новая\s+)?(?:папка|курс|тема)(?:\s*\d+)?|без\s+(?:темы|названия))$/iu.test(title)) {
    throw badRequest('Назовите конкретную тему: например, «Путешествия» или «Китайская кухня» (2–80 символов).')
  }
  return title
}

export async function requireOwnedFolder(database, ownerId, folderId) {
  if (typeof folderId !== 'string' || !UUID_PATTERN.test(folderId)) throw badRequest('Выберите тематическую папку для слова.')
  const result = await database.query('SELECT id FROM personal.folders WHERE id = $1 AND owner_id = $2', [folderId, ownerId])
  if (!result.rowCount) throw badRequest('Папка не найдена в вашей коллекции.', 404)
  return folderId
}

export function summarizeFolderCards(cards, now = new Date()) {
  const allCharacters = new Set()
  const learnedCharacters = new Set()
  const summary = { total: cards.length, learned: 0, learning: 0, new: 0, due: 0, attempts: 0, correctAnswers: 0, accuracy: 0, characters: 0, learnedCharacters: 0, lastReviewedAt: null }
  for (const card of cards) {
    for (const character of card.hanzi.match(/\p{Script=Han}/gu) ?? []) {
      allCharacters.add(character)
      if (card.known) learnedCharacters.add(character)
    }
    if (card.known) summary.learned += 1
    if (!card.attempts) summary.new += 1
    if (card.attempts > 0 && new Date(card.due_at) <= now) summary.due += 1
    summary.attempts += card.attempts ?? 0
    summary.correctAnswers += card.correct_answers ?? 0
    if (card.last_reviewed_at && (!summary.lastReviewedAt || new Date(card.last_reviewed_at) > new Date(summary.lastReviewedAt))) summary.lastReviewedAt = card.last_reviewed_at
  }
  summary.learning = summary.total - summary.learned
  summary.accuracy = summary.attempts ? Math.round(summary.correctAnswers / summary.attempts * 100) : 0
  summary.characters = allCharacters.size
  summary.learnedCharacters = learnedCharacters.size
  return summary
}

export function createPersonalFoldersRouter(pool) {
  // Mounted AFTER personal-account authentication, never trusts a browser owner ID.
  const router = Router()
  router.get('/folders', async (request, response) => {
    const ownerId = request.personalOwnerId
    const [folders, cards] = await Promise.all([
      pool.query('SELECT id, title, enrolled_at, created_at FROM personal.folders WHERE owner_id = $1 ORDER BY created_at, id', [ownerId]),
      pool.query(`SELECT cards.id, cards.folder_id, cards.hanzi, progress.* FROM personal.cards AS cards
        LEFT JOIN personal.card_progress AS progress ON progress.card_id = cards.id AND progress.owner_id = cards.owner_id
        WHERE cards.owner_id = $1 AND cards.folder_id IS NOT NULL`, [ownerId]),
    ])
    const groupedCards = new Map()
    for (const card of cards.rows) {
      if (!groupedCards.has(card.folder_id)) groupedCards.set(card.folder_id, [])
      groupedCards.get(card.folder_id).push(card)
    }
    response.json({ folders: folders.rows.map((folder) => {
      const words = groupedCards.get(folder.id) ?? []
      return {
        id: folder.id, title: folder.title, enrolledAt: folder.enrolled_at, createdAt: folder.created_at,
        statistics: summarizeFolderCards(words),
        // Dates stay UTC; the browser groups them using the learner's timezone.
        learnedWords: words.filter((word) => word.first_learned_at).map((word) => ({ id: word.id, hanzi: word.hanzi, learnedAt: word.first_learned_at })),
      }
    }) })
  })

  router.post('/folders', async (request, response) => {
    const title = validateFolderTitle(request.body?.title)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT id FROM personal.accounts WHERE id = $1 FOR UPDATE', [request.personalOwnerId])
      const count = await client.query('SELECT count(*)::integer AS total FROM personal.folders WHERE owner_id = $1', [request.personalOwnerId])
      if (count.rows[0].total >= 100) throw badRequest('Доступно до 100 тематических папок.', 409)
      const result = await client.query('INSERT INTO personal.folders (id, owner_id, title) VALUES ($1, $2, $3) RETURNING id, title', [randomUUID(), request.personalOwnerId, title])
      await client.query('COMMIT')
      response.status(201).json({ folder: result.rows[0] })
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  })

  router.patch('/folders/:folderId', async (request, response) => {
    const title = validateFolderTitle(request.body?.title)
    await requireOwnedFolder(pool, request.personalOwnerId, request.params.folderId)
    await pool.query('UPDATE personal.folders SET title = $3 WHERE id = $1 AND owner_id = $2', [request.params.folderId, request.personalOwnerId, title])
    response.json({ ok: true })
  })

  router.put('/folders/:folderId/enrollment', async (request, response) => {
    const enrolled = request.body?.enrolled
    if (typeof enrolled !== 'boolean') throw badRequest('Укажите, нужно ли добавить курс в профиль.')
    await requireOwnedFolder(pool, request.personalOwnerId, request.params.folderId)
    const result = await pool.query(`UPDATE personal.folders AS folders
      SET enrolled_at = CASE WHEN $3 THEN COALESCE(enrolled_at, now()) ELSE NULL END
      WHERE id = $1 AND owner_id = $2
      AND (NOT $3 OR EXISTS (SELECT 1 FROM personal.cards WHERE folder_id = folders.id AND owner_id = $2)) RETURNING id`,
    [request.params.folderId, request.personalOwnerId, enrolled])
    if (!result.rowCount) throw badRequest('Сначала добавьте хотя бы одно слово в папку.', 409)
    response.json({ ok: true })
  })

  router.post('/folders/:folderId/move-cards', async (request, response) => {
    const ids = request.body?.cardIds
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 2000 || ids.some((id) => typeof id !== 'string' || !UUID_PATTERN.test(id))) throw badRequest('Выберите слова для переноса.')
    const uniqueIds = [...new Set(ids)]
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await requireOwnedFolder(client, request.personalOwnerId, request.params.folderId)
      const result = await client.query(`UPDATE personal.cards SET folder_id = $3, updated_at = now()
        WHERE owner_id = $1 AND id = ANY($2::uuid[]) RETURNING id`, [request.personalOwnerId, uniqueIds, request.params.folderId])
      if (result.rowCount !== uniqueIds.length) throw badRequest('Некоторые слова не найдены в вашей коллекции.', 404)
      await client.query('COMMIT')
      response.json({ moved: result.rowCount })
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  })

  router.use((error, _request, response, next) => {
    if (error.code === '23505') response.status(409).json({ message: 'Папка с такой темой уже существует.' })
    else next(error)
  })
  return router
}
