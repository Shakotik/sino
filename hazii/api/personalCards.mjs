import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { Router, json } from 'express'
import { createPersonalFoldersRouter, requireOwnedFolder } from './personalFolders.mjs'

const MAXIMUM_CARDS_PER_ACCOUNT = 2000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CARD_COLUMNS = `cards.id, cards.folder_id, cards.hanzi, cards.pinyin, cards.translation_ru, cards.notes,
  cards.created_at, cards.updated_at, progress.known, progress.attempts,
  progress.correct_answers, progress.repetitions, progress.interval_days,
  progress.due_at, progress.last_reviewed_at`

function hashCapability(token) {
  return createHash('sha256').update(token).digest('hex')
}

function toCard(row) {
  return {
    id: row.id,
    folderId: row.folder_id ?? null,
    hanzi: row.hanzi,
    pinyin: row.pinyin,
    translationRu: row.translation_ru,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    known: row.known ?? false,
    attempts: row.attempts ?? 0,
    correctAnswers: row.correct_answers ?? 0,
    repetitions: row.repetitions ?? 0,
    intervalDays: row.interval_days ?? 0,
    dueAt: row.due_at,
    lastReviewedAt: row.last_reviewed_at,
  }
}

function validateCard(body) {
  const limits = { hanzi: 64, pinyin: 160, translationRu: 1000, notes: 2000 }
  const card = {}
  for (const [field, limit] of Object.entries(limits)) {
    const value = body?.[field] ?? ''
    if (typeof value !== 'string' || value.length > limit || value.includes('\0')) {
      throw Object.assign(new Error(`Некорректное поле ${field}: не более ${limit} символов.`), { status: 400 })
    }
    card[field] = value.trim().normalize('NFC')
  }
  if (!card.hanzi || !/\p{Script=Han}/u.test(card.hanzi)) {
    throw Object.assign(new Error('Впишите китайское слово или иероглиф.'), { status: 400 })
  }
  if (!card.translationRu) {
    throw Object.assign(new Error('Добавьте значение слова на русском языке.'), { status: 400 })
  }
  return card
}

// Separate from HTTP so scheduling remains easy to inspect and test.
export function calculatePersonalReview(progress, grade, now = new Date()) {
  if (!['again', 'good', 'easy'].includes(grade)) {
    throw Object.assign(new Error('Выберите оценку ответа.'), { status: 400 })
  }
  const correct = grade !== 'again'
  const repetitions = correct ? progress.repetitions + 1 : 0
  const intervalDays = !correct ? 0 : Math.min(180,
    repetitions === 1 ? (grade === 'easy' ? 3 : 1)
      : Math.max(3, Math.round(progress.interval_days * (grade === 'easy' ? 2.5 : 1.8))))
  return {
    known: correct,
    repetitions,
    intervalDays,
    correctAnswers: progress.correct_answers + Number(correct),
    attempts: progress.attempts + 1,
    dueAt: new Date(now.getTime() + (correct ? intervalDays * 86_400_000 : 600_000)),
    reviewedAt: now,
  }
}

export function createPersonalCardsRouter(pool) {
  const router = Router()
  const accountCreationWindows = new Map()
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'private, no-store')
    next()
  })
  router.use(json({ limit: '16kb' }))

  router.post('/accounts', async (request, response) => {
    const now = Date.now()
    // Bounded, per-process protection for anonymous local-profile provisioning.
    // A public deployment should additionally rate-limit at its reverse proxy.
    for (const [ip, window] of accountCreationWindows) {
      if (window.expiresAt < now) accountCreationWindows.delete(ip)
    }
    const window = accountCreationWindows.get(request.ip) ?? { count: 0, expiresAt: now + 3_600_000 }
    if (window.count >= 20 || accountCreationWindows.size > 10_000) {
      response.status(429).json({ message: 'Слишком много новых коллекций. Попробуйте позже.' })
      return
    }
    window.count += 1
    accountCreationWindows.set(request.ip, window)
    const token = randomBytes(32).toString('hex')
    const accountId = randomUUID()
    await pool.query('INSERT INTO personal.accounts (id, capability_hash) VALUES ($1, $2)', [accountId, hashCapability(token)])
    response.status(201).json({ accountId, token })
  })

  router.use(async (request, response, next) => {
    const token = request.get('authorization')?.match(/^Bearer ([0-9a-f]{64})$/)?.[1]
    if (!token) {
      response.status(401).json({ message: 'Откройте свою коллекцию из личного кабинета.' })
      return
    }
    const result = await pool.query('SELECT id FROM personal.accounts WHERE capability_hash = $1', [hashCapability(token)])
    if (!result.rows[0]) {
      response.status(401).json({ message: 'Ключ коллекции больше не действует. Доступ к ней нужно восстановить.' })
      return
    }
    request.personalOwnerId = result.rows[0].id
    next()
  })

  router.get('/cards', async (request, response) => {
    const result = await pool.query(`SELECT ${CARD_COLUMNS} FROM personal.cards AS cards
      LEFT JOIN personal.card_progress AS progress ON progress.card_id = cards.id AND progress.owner_id = cards.owner_id
      WHERE cards.owner_id = $1 ORDER BY cards.created_at DESC`, [request.personalOwnerId])
    response.json({ cards: result.rows.map(toCard) })
  })

  router.use(createPersonalFoldersRouter(pool))

  router.get('/statistics', async (request, response) => {
    const result = await pool.query(`SELECT count(*)::integer AS total,
      count(*) FILTER (WHERE progress.known)::integer AS learned,
      count(*) FILTER (WHERE progress.attempts > 0 AND progress.due_at <= now())::integer AS due,
      count(*) FILTER (WHERE COALESCE(progress.attempts, 0) = 0)::integer AS new,
      COALESCE(sum(progress.attempts), 0)::integer AS attempts,
      COALESCE(sum(progress.correct_answers), 0)::integer AS correct_answers,
      max(progress.last_reviewed_at) AS last_reviewed_at
      FROM personal.cards AS cards LEFT JOIN personal.card_progress AS progress
      ON progress.card_id = cards.id AND progress.owner_id = cards.owner_id WHERE cards.owner_id = $1`, [request.personalOwnerId])
    const summary = result.rows[0]
    response.json({ statistics: {
      total: summary.total, learned: summary.learned, learning: summary.total - summary.learned,
      due: summary.due, new: summary.new, attempts: summary.attempts, correctAnswers: summary.correct_answers,
      accuracy: summary.attempts ? Math.round(summary.correct_answers / summary.attempts * 100) : 0,
      lastReviewedAt: summary.last_reviewed_at,
    } })
  })

  router.post('/cards', async (request, response) => {
    const card = validateCard(request.body)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      // Lock this owner, not the whole table, so two simultaneous create requests
      // cannot bypass the per-collection limit.
      await client.query('SELECT id FROM personal.accounts WHERE id = $1 FOR UPDATE', [request.personalOwnerId])
      const folderId = await requireOwnedFolder(client, request.personalOwnerId, request.body?.folderId)
      const count = await client.query('SELECT count(*)::integer AS count FROM personal.cards WHERE owner_id = $1', [request.personalOwnerId])
      if (count.rows[0].count >= MAXIMUM_CARDS_PER_ACCOUNT) {
        throw Object.assign(new Error('В одной коллекции доступно до 2000 карточек.'), { status: 409 })
      }
      const result = await client.query(`INSERT INTO personal.cards (id, owner_id, hanzi, pinyin, translation_ru, notes, folder_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [randomUUID(), request.personalOwnerId, card.hanzi, card.pinyin, card.translationRu, card.notes, folderId])
      const progress = await client.query('INSERT INTO personal.card_progress (card_id, owner_id) VALUES ($1, $2) RETURNING *', [result.rows[0].id, request.personalOwnerId])
      await client.query('COMMIT')
      response.status(201).json({ card: toCard({ ...result.rows[0], ...progress.rows[0] }) })
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  })

  router.param('cardId', (request, response, next, value) => {
    if (!UUID_PATTERN.test(value)) {
      response.status(400).json({ message: 'Некорректный номер карточки.' })
      return
    }
    next()
  })

  router.patch('/cards/:cardId', async (request, response) => {
    const card = validateCard(request.body)
    const folderId = request.body?.folderId === undefined ? null
      : await requireOwnedFolder(pool, request.personalOwnerId, request.body.folderId)
    const result = await pool.query(`UPDATE personal.cards SET hanzi = $3, pinyin = $4,
      translation_ru = $5, notes = $6, folder_id = COALESCE($7, folder_id), updated_at = now() WHERE id = $1 AND owner_id = $2 RETURNING id`,
    [request.params.cardId, request.personalOwnerId, card.hanzi, card.pinyin, card.translationRu, card.notes, folderId])
    if (!result.rowCount) {
      response.status(404).json({ message: 'Карточка не найдена в вашей коллекции.' })
      return
    }
    response.json({ ok: true })
  })

  router.delete('/cards/:cardId', async (request, response) => {
    const result = await pool.query('DELETE FROM personal.cards WHERE id = $1 AND owner_id = $2', [request.params.cardId, request.personalOwnerId])
    if (!result.rowCount) {
      response.status(404).json({ message: 'Карточка не найдена в вашей коллекции.' })
      return
    }
    response.status(204).end()
  })

  router.post('/cards/:cardId/reviews', async (request, response) => {
    const requestId = request.body?.requestId
    if (typeof requestId !== 'string' || !UUID_PATTERN.test(requestId)) {
      response.status(400).json({ message: 'Не удалось определить попытку. Перезапустите занятие.' })
      return
    }
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const current = await client.query('SELECT * FROM personal.card_progress WHERE card_id = $1 AND owner_id = $2 FOR UPDATE', [request.params.cardId, request.personalOwnerId])
      if (!current.rows[0]) {
        await client.query('ROLLBACK')
        response.status(404).json({ message: 'Карточка не найдена в вашей коллекции.' })
        return
      }
      const receipt = await client.query('SELECT card_id, result FROM personal.review_receipts WHERE owner_id = $1 AND request_id = $2', [request.personalOwnerId, requestId])
      if (receipt.rows[0]) {
        await client.query('COMMIT')
        if (receipt.rows[0].card_id !== request.params.cardId) {
          response.status(409).json({ message: 'Эта попытка уже относится к другой карточке. Перезапустите занятие.' })
          return
        }
        response.json({ review: receipt.rows[0].result })
        return
      }
      const review = calculatePersonalReview(current.rows[0], request.body?.grade)
      await client.query(`UPDATE personal.card_progress SET known = $3, attempts = $4,
        correct_answers = $5, repetitions = $6, interval_days = $7, due_at = $8, last_reviewed_at = $9,
        first_learned_at = CASE WHEN $3 THEN COALESCE(first_learned_at, $9) ELSE first_learned_at END
        WHERE card_id = $1 AND owner_id = $2`, [request.params.cardId, request.personalOwnerId,
        review.known, review.attempts, review.correctAnswers, review.repetitions, review.intervalDays, review.dueAt, review.reviewedAt])
      await client.query('INSERT INTO personal.review_receipts (request_id, owner_id, card_id, result) VALUES ($1, $2, $3, $4)',
        [requestId, request.personalOwnerId, request.params.cardId, JSON.stringify(review)])
      await client.query('COMMIT')
      response.json({ review })
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  })

  router.use((error, _request, response, _next) => {
    if (error.code === '23505') {
      response.status(409).json({ message: 'Такое слово уже есть в вашей коллекции. Отредактируйте его карточку.' })
      return
    }
    const status = error.status && error.status >= 400 && error.status < 500 ? error.status : 503
    if (status === 503) console.error('Personal cards request failed:', error.code ?? error.name)
    response.status(status).json({ message: status === 503
      ? 'Коллекция временно недоступна. Проверьте, что сервер и база данных запущены, и повторите попытку.'
      : error.type === 'entity.parse.failed' ? 'Не удалось прочитать запрос.' : error.message })
  })
  return router
}
