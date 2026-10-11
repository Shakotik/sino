import { spawnSync } from 'node:child_process'
import { hsk2Vocabulary } from '../src/data/hsk2Vocabulary.js'
import { hsk3Vocabulary } from '../src/data/hsk3Vocabulary.js'
import { hsk4Vocabulary } from '../src/data/hsk4Vocabulary.js'
import { hsk5Vocabulary } from '../src/data/hsk5Vocabulary.js'
import { hsk6Vocabulary } from '../src/data/hsk6Vocabulary.js'

// These data sets use the same schema as HSK 1. Keeping one importer per
// group makes the initial database load simple and repeatable for a beginner.
const catalogues = [
  { levelNumber: 2, words: hsk2Vocabulary },
  { levelNumber: 3, words: hsk3Vocabulary },
  { levelNumber: 4, words: hsk4Vocabulary },
  { levelNumber: 5, words: hsk5Vocabulary },
  { levelNumber: 6, words: hsk6Vocabulary },
]

function makeLevelUuid(levelNumber) {
  return `00000000-0000-4000-9001-${String(levelNumber).padStart(12, '0')}`
}

function makeUuid(group, number) {
  return `00000000-0000-4000-${group}-${String(number).padStart(12, '0')}`
}

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function sqlOptionalText(value) {
  return value == null ? 'NULL' : sqlText(value)
}

function buildSeedSql() {
  const statements = ['BEGIN;']

  for (const catalogue of catalogues) {
    const { levelNumber, words } = catalogue
    const levelId = makeLevelUuid(levelNumber)
    const group = String(levelNumber).padStart(3, '0')

    statements.push(`INSERT INTO catalog.hsk_levels (id, version, level_number, title)
      VALUES (${sqlText(levelId)}, 'HSK 3.0', ${levelNumber}, 'HSK ${levelNumber}')
      ON CONFLICT (version, level_number) DO UPDATE
      SET title = EXCLUDED.title, updated_at = now();`)

    // Earlier development imports used a larger English-only source. These
    // two statements make a re-run match the supplied Russian PDF exactly.
    // `lexeme_senses` is removed automatically for rows deleted below.
    statements.push(`DELETE FROM catalog.lexemes
      WHERE hsk_level_id = ${sqlText(levelId)} AND source_number > ${words.length};`)
    statements.push(`DELETE FROM catalog.lexeme_senses AS sense
      USING catalog.lexemes AS lexeme
      WHERE sense.lexeme_id = lexeme.id
        AND lexeme.hsk_level_id = ${sqlText(levelId)}
        AND sense.language = 'en';`)

    for (const word of words) {
      const lexemeId = makeUuid(`a${group}`, word.sourcePosition)
      // `b...` identifiers were used by the previous English-only seed.
      // Russian meanings receive their own stable identifiers instead.
      const senseId = makeUuid(`c${group}`, word.sourcePosition)

      statements.push(`INSERT INTO catalog.lexemes (
        id, hsk_level_id, source_number, written_form, pinyin, part_of_speech, source_english_gloss
      ) VALUES (
        ${sqlText(lexemeId)}, ${sqlText(levelId)}, ${word.sourcePosition}, ${sqlText(word.hanzi)},
        ${sqlText(word.pinyin)}, NULL, ${sqlOptionalText(word.translationEn)}
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
  }

  statements.push('COMMIT;')
  statements.push(`SELECT h.level_number, count(l.id) AS words
    FROM catalog.hsk_levels AS h
    LEFT JOIN catalog.lexemes AS l ON l.hsk_level_id = h.id
    WHERE h.version = 'HSK 3.0'
    GROUP BY h.level_number
    ORDER BY h.level_number;`)

  return statements.join('\n')
}

const processResult = spawnSync(
  'docker',
  ['compose', 'exec', '-T', 'postgres', 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'hazii_app', '-d', 'hazii_dev'],
  {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    input: buildSeedSql(),
    maxBuffer: 10 * 1024 * 1024,
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
