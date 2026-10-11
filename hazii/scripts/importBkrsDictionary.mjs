import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { once } from 'node:events'
import { finished } from 'node:stream/promises'
import { createInterface } from 'node:readline'
import { from as copyFrom } from 'pg-copy-streams'
import { Pool } from 'pg'
import { getDatabaseUrl, loadLocalEnvironment } from '../api/config.mjs'

const sourcePath = process.argv[2] ? resolve(process.argv[2]) : null
const isDryRun = process.argv.includes('--dry-run')
const limitArgument = process.argv.find((argument) => argument.startsWith('--limit='))
const entryLimit = limitArgument ? Number.parseInt(limitArgument.slice('--limit='.length), 10) : Number.POSITIVE_INFINITY

if (!sourcePath || !existsSync(sourcePath)) {
  console.error('Укажите путь к распакованному файлу dabkrs_dabruks.html.')
  console.error('Пример: npm run dictionary:import -- "C:\\Users\\Legion\\Downloads\\html_dabkrs_bruks\\dabkrs_dabruks.html"')
  process.exit(1)
}

if (limitArgument && (!Number.isFinite(entryLimit) || entryLimit < 1)) {
  console.error('Параметр --limit должен быть положительным числом.')
  process.exit(1)
}

function normalizeForSearch(value = '') {
  return value
    .toLocaleLowerCase('ru-RU')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replaceAll('ü', 'u')
    .trim()
}

function decodeEscape(source, cursor) {
  const next = source[cursor + 1]
  const simpleEscapes = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' }

  if (next in simpleEscapes) return { value: simpleEscapes[next], cursor: cursor + 2 }
  if (next === '\r' && source[cursor + 2] === '\n') return { value: '', cursor: cursor + 3 }
  if (next === '\n') return { value: '', cursor: cursor + 2 }

  if (next === 'x') {
    const hex = source.slice(cursor + 2, cursor + 4)
    if (!/^[\da-f]{2}$/iu.test(hex)) throw new Error('Некорректная \\x-последовательность')
    return { value: String.fromCodePoint(Number.parseInt(hex, 16)), cursor: cursor + 4 }
  }

  if (next === 'u') {
    if (source[cursor + 2] === '{') {
      const closingIndex = source.indexOf('}', cursor + 3)
      const hex = source.slice(cursor + 3, closingIndex)
      if (closingIndex === -1 || !/^[\da-f]+$/iu.test(hex)) throw new Error('Некорректная \\u{}-последовательность')
      return { value: String.fromCodePoint(Number.parseInt(hex, 16)), cursor: closingIndex + 1 }
    }

    const hex = source.slice(cursor + 2, cursor + 6)
    if (!/^[\da-f]{4}$/iu.test(hex)) throw new Error('Некорректная \\u-последовательность')
    return { value: String.fromCharCode(Number.parseInt(hex, 16)), cursor: cursor + 6 }
  }

  // For escaped quotes, slash, and legacy source escapes, JavaScript returns
  // the next character literally. We do the same without evaluating the file.
  return { value: next, cursor: cursor + 2 }
}

// This parser accepts only an array of quoted string literals. It intentionally
// cannot execute functions, templates, assignments, or other HTML/JS content.
function parseStaticEntry(line) {
  let cursor = 0
  const values = []

  function skipWhitespace() {
    while (/\s/u.test(line[cursor] ?? '')) cursor += 1
  }

  skipWhitespace()
  if (line[cursor] !== '[') return null
  cursor += 1

  while (cursor < line.length) {
    skipWhitespace()
    const quote = line[cursor]
    if (quote === ']') {
      cursor += 1
      skipWhitespace()
      if (line[cursor] === ',') cursor += 1
      skipWhitespace()
      if (cursor !== line.length) throw new Error('После записи найдены лишние символы')
      return values
    }

    if (quote !== "'" && quote !== '"') throw new Error('В записи ожидалась строка')
    cursor += 1
    let value = ''
    let isClosed = false

    while (cursor < line.length) {
      const character = line[cursor]
      if (character === quote) {
        cursor += 1
        isClosed = true
        break
      }
      if (character === '\\') {
        const decoded = decodeEscape(line, cursor)
        value += decoded.value
        cursor = decoded.cursor
        continue
      }
      value += character
      cursor += 1
    }

    if (!isClosed) throw new Error('Строка в записи не закрыта')
    values.push(value)
    skipWhitespace()

    if (line[cursor] === ',') {
      cursor += 1
      continue
    }
    if (line[cursor] !== ']') throw new Error('В записи ожидалась запятая или закрывающая скобка')
  }

  throw new Error('Запись не закрыта')
}

async function* extractEntries(filePath, requiredDirection, maxEntries) {
  const reader = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Number.POSITIVE_INFINITY,
  })

  let activeDirection = null
  let readsData = false
  let lineNumber = 0
  let producedEntries = 0

  for await (const line of reader) {
    lineNumber += 1

    if (line.includes('id="dabkrs_ids_')) {
      activeDirection = 'zh-ru'
      readsData = false
      continue
    }

    if (line.includes('id="dabruks_ids_')) {
      activeDirection = 'ru-zh'
      readsData = false
      continue
    }

    if (!activeDirection) continue
    const trimmed = line.trim()

    if (!readsData && trimmed === 'let db_temp = [') {
      readsData = true
      continue
    }

    if (readsData && trimmed === '];') {
      readsData = false
      activeDirection = null
      continue
    }

    if (!readsData || activeDirection !== requiredDirection || !trimmed.startsWith('[')) continue

    let fields
    try {
      fields = parseStaticEntry(trimmed)
    } catch (error) {
      throw new Error(`Не удалось прочитать запись в строке ${lineNumber}: ${error.message}`)
    }

    const expectedLength = requiredDirection === 'zh-ru' ? 3 : 2
    if (fields.length !== expectedLength) {
      throw new Error(`Неожиданное число полей в строке ${lineNumber}: ожидалось ${expectedLength}, получено ${fields.length}`)
    }

    const [headword, pinyinOrArticle, article] = fields
    const pinyin = requiredDirection === 'zh-ru' && pinyinOrArticle !== '_' ? pinyinOrArticle : null
    const resolvedArticle = requiredDirection === 'zh-ru' ? article : pinyinOrArticle

    // A handful of source records are deliberately placeholders with no
    // definition yet. Keep their heading rather than silently dropping it.
    if (!headword) {
      throw new Error(`Пустой заголовок в строке ${lineNumber}`)
    }

    const entryHash = createHash('sha256')
      .update([requiredDirection, headword, pinyin ?? '', resolvedArticle].join('\u0000'))
      .digest('hex')

    yield {
      direction: requiredDirection,
      headword,
      headwordNormalized: normalizeForSearch(headword),
      pinyin,
      pinyinNormalized: pinyin ? normalizeForSearch(pinyin) : null,
      article: resolvedArticle,
      entryHash,
    }

    producedEntries += 1
    if (producedEntries >= maxEntries) return
  }
}

function toCsvCell(value) {
  if (value === null || value === undefined) return ''
  return `"${String(value).replaceAll('"', '""')}"`
}

async function fileSha256(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

async function inspect() {
  const totals = { 'zh-ru': 0, 'ru-zh': 0 }
  const previews = []

  for (const direction of Object.keys(totals)) {
    for await (const entry of extractEntries(sourcePath, direction, entryLimit)) {
      totals[direction] += 1
      if (previews.length < 4) previews.push({ direction, headword: entry.headword, pinyin: entry.pinyin })
    }
  }

  console.log(JSON.stringify({ dryRun: true, totals, previews }, null, 2))
}

async function copyDirection(client, direction, sourceId) {
  const copyStream = client.query(copyFrom(`
    COPY import_stage
      (source_id, direction, headword, headword_normalized, pinyin, pinyin_normalized, article, entry_hash)
    FROM STDIN WITH (FORMAT csv)
  `))
  const completeCopy = finished(copyStream)
  let count = 0

  for await (const entry of extractEntries(sourcePath, direction, entryLimit)) {
    const row = [
      sourceId,
      entry.direction,
      entry.headword,
      entry.headwordNormalized,
      entry.pinyin,
      entry.pinyinNormalized,
      entry.article,
      entry.entryHash,
    ].map(toCsvCell).join(',') + '\n'

    if (!copyStream.write(row)) await once(copyStream, 'drain')
    count += 1
  }

  copyStream.end()
  await completeCopy
  return count
}

async function rebuildSearchIndexes(client) {
  // Building GIN indexes once after COPY is dramatically quicker than updating
  // four indexes for each of the millions of imported rows.
  await client.query(`
    DROP INDEX IF EXISTS dictionary.dictionary_entries_direction_headword_index;
    DROP INDEX IF EXISTS dictionary.dictionary_entries_headword_trgm_index;
    DROP INDEX IF EXISTS dictionary.dictionary_entries_pinyin_trgm_index;
    DROP INDEX IF EXISTS dictionary.dictionary_entries_article_search_index;
  `)
}

async function createSearchIndexes(client) {
  await client.query(`
    CREATE INDEX dictionary_entries_direction_headword_index
      ON dictionary.entries (direction, headword_normalized text_pattern_ops);
    CREATE INDEX dictionary_entries_headword_trgm_index
      ON dictionary.entries USING gin (headword_normalized gin_trgm_ops);
    CREATE INDEX dictionary_entries_pinyin_trgm_index
      ON dictionary.entries USING gin (pinyin_normalized gin_trgm_ops)
      WHERE pinyin_normalized IS NOT NULL;
    CREATE INDEX dictionary_entries_article_search_index
      ON dictionary.entries USING gin (article_search);
  `)
}

async function importIntoDatabase() {
  loadLocalEnvironment()
  const sourceHash = await fileSha256(sourcePath)
  const pool = new Pool({ connectionString: getDatabaseUrl(), max: 1 })
  const client = await pool.connect()
  let importRunId = null

  try {
    await client.query('BEGIN')
    const source = await client.query(
      `
        INSERT INTO dictionary.sources (code, title, version, source_file_sha256, license_note)
        VALUES ('bkrs-offline', '大БКРС и БРуКС', '250314', $1, $2)
        ON CONFLICT (code) DO UPDATE SET
          version = EXCLUDED.version,
          source_file_sha256 = EXCLUDED.source_file_sha256,
          imported_at = now(),
          is_active = true
        RETURNING id
      `,
      [sourceHash, 'Импорт из пользовательской офлайн-выгрузки БКРС. Перед production-публикацией подтвердите условия использования у правообладателя.'],
    )
    const sourceId = source.rows[0].id

    const importRun = await client.query(
      `INSERT INTO dictionary.import_runs (source_file_name, source_file_sha256, status) VALUES ($1, $2, 'started') RETURNING id`,
      [basename(sourcePath), sourceHash],
    )
    importRunId = importRun.rows[0].id

    await client.query(`
      CREATE TEMP TABLE import_stage (
        source_id bigint NOT NULL,
        direction varchar(10) NOT NULL,
        headword text NOT NULL,
        headword_normalized text NOT NULL,
        pinyin text,
        pinyin_normalized text,
        article text NOT NULL,
        entry_hash char(64) NOT NULL
      ) ON COMMIT DROP
    `)

    console.log('Импортирую китайско-русские статьи БКРС…')
    const zhRuEntries = await copyDirection(client, 'zh-ru', sourceId)
    console.log(`Добавлено во временную таблицу: ${zhRuEntries}`)
    console.log('Импортирую русско-китайские статьи БРуКС…')
    const ruZhEntries = await copyDirection(client, 'ru-zh', sourceId)
    console.log(`Добавлено во временную таблицу: ${ruZhEntries}`)

    // Old entries are removed only after both directions fully reached the
    // staging table. A parsing/copy error therefore leaves the old dictionary.
    await rebuildSearchIndexes(client)
    await client.query('DELETE FROM dictionary.entries WHERE source_id = $1', [sourceId])
    await client.query(`
      INSERT INTO dictionary.entries
        (source_id, direction, headword, headword_normalized, pinyin, pinyin_normalized, article, entry_hash)
      SELECT source_id, direction, headword, headword_normalized, pinyin, pinyin_normalized, article, entry_hash
      FROM import_stage
      ON CONFLICT (source_id, direction, entry_hash) DO NOTHING
    `)
    await createSearchIndexes(client)
    await client.query('ANALYZE dictionary.entries')

    await client.query(
      `UPDATE dictionary.import_runs
       SET status = 'completed', zh_ru_entries = $2, ru_zh_entries = $3, finished_at = now()
       WHERE id = $1`,
      [importRunId, zhRuEntries, ruZhEntries],
    )
    await client.query('COMMIT')
    console.log(`Готово: БКРС ${zhRuEntries}, БРуКС ${ruZhEntries}.`)
  } catch (error) {
    await client.query('ROLLBACK')
    if (importRunId) {
      await client.query(
        `UPDATE dictionary.import_runs SET status = 'failed', error_message = $2, finished_at = now() WHERE id = $1`,
        [importRunId, String(error.message).slice(0, 4000)],
      ).catch(() => {})
    }
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

if (isDryRun) {
  await inspect()
} else {
  await importIntoDatabase()
}
