import { spawnSync } from 'node:child_process'
import { hsk1Vocabulary } from '../src/data/hsk1Vocabulary.js'

// These fixed identifiers make repeated imports safe: the same word always
// receives the same database ID in the local development database.
const hsk1LevelId = '00000000-0000-4000-9001-000000000001'

function makeUuid(group, number) {
  return `00000000-0000-4000-${group}-${String(number).padStart(12, '0')}`
}

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function buildSeedSql() {
  const statements = [
    'BEGIN;',
    `INSERT INTO catalog.hsk_levels (id, version, level_number, title)
     VALUES (${sqlText(hsk1LevelId)}, 'HSK 3.0', 1, 'HSK 1')
     ON CONFLICT (version, level_number) DO UPDATE
     SET title = EXCLUDED.title, updated_at = now();`,
  ]

  for (const word of hsk1Vocabulary) {
    const lexemeId = makeUuid('a001', word.id)
    const senseId = makeUuid('b001', word.id)

    statements.push(`INSERT INTO catalog.lexemes (
      id, hsk_level_id, source_number, written_form, pinyin, part_of_speech, source_english_gloss
    ) VALUES (
      ${sqlText(lexemeId)}, ${sqlText(hsk1LevelId)}, ${word.id}, ${sqlText(word.hanzi)},
      ${sqlText(word.pinyin)}, ${sqlText(word.partOfSpeech)}, ${sqlText(word.translationEn)}
    ) ON CONFLICT (hsk_level_id, source_number) DO UPDATE SET
      written_form = EXCLUDED.written_form,
      pinyin = EXCLUDED.pinyin,
      part_of_speech = EXCLUDED.part_of_speech,
      source_english_gloss = EXCLUDED.source_english_gloss,
      updated_at = now();`)

    statements.push(`INSERT INTO catalog.lexeme_senses (id, lexeme_id, language, meaning, position)
      VALUES (${sqlText(senseId)}, ${sqlText(lexemeId)}, 'ru', ${sqlText(word.translationRu)}, 1)
      ON CONFLICT (lexeme_id, language, position) DO UPDATE SET
        meaning = EXCLUDED.meaning;`)
  }

  statements.push('COMMIT;')
  statements.push(`SELECT
    (SELECT count(*) FROM catalog.lexemes WHERE hsk_level_id = '${hsk1LevelId}') AS hsk_1_words,
    (SELECT count(*) FROM catalog.lexeme_senses WHERE language = 'ru') AS russian_meanings;`)

  return statements.join('\n')
}

const processResult = spawnSync(
  'docker',
  ['compose', 'exec', '-T', 'postgres', 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'hazii_app', '-d', 'hazii_dev'],
  {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    input: buildSeedSql(),
  },
)

if (processResult.error) {
  throw processResult.error
}

if (processResult.status !== 0) {
  console.error(processResult.stderr)
  process.exit(processResult.status ?? 1)
}

console.log(processResult.stdout)
