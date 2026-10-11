/**
 * Creates browser-ready HSK 2–6 catalogue modules from the reviewable JSON
 * extracted from the Russian-language source PDFs.
 *
 * Run the extractor first after replacing a PDF, then run this file:
 *   python scripts/extractRussianHskPdfCatalogs.py
 *   node scripts/buildHsk2To6Catalogs.mjs
 *
 * Keeping the original JSON outside `src` means that the browser receives only
 * the compact course it needs, while developers still have a clear audit trail.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectDirectory = resolve(scriptDirectory, '..')
const sourcePath = resolve(projectDirectory, 'data', 'sources', 'russian-hsk2-6-from-pdfs.json')
const applicationDataDirectory = resolve(projectDirectory, 'src', 'data')
const levels = [2, 3, 4, 5, 6]

const sourceDocument = JSON.parse(await readFile(sourcePath, 'utf8'))

function createVocabularyEntry(level, sourceRow) {
  return {
    // This identifier is stable for browser progress until the API takes over.
    id: `hsk-${level}-${String(sourceRow.sourcePosition).padStart(4, '0')}`,
    hanzi: sourceRow.hanzi,
    pinyin: sourceRow.pinyin,
    translationRu: sourceRow.translationRu,
    // These PDFs contain Russian translations. `null` is explicit: the card
    // component can safely support a future English-language catalogue too.
    translationEn: null,
    sourcePosition: sourceRow.sourcePosition,
  }
}

for (const level of levels) {
  const pdfCatalogue = sourceDocument.catalogues[String(level)]

  if (!pdfCatalogue?.words?.length) {
    throw new Error(`The extracted PDF catalogue for HSK ${level} is missing or empty.`)
  }

  const vocabulary = pdfCatalogue.words.map((row) => createVocabularyEntry(level, row))
  const outputPath = resolve(applicationDataDirectory, `hsk${level}Vocabulary.js`)
  const moduleText = `// Generated from the user-supplied Russian HSK PDF catalogue.\n// Do not edit individual rows: re-run the extractor and this builder instead.\n\nexport const hsk${level}Vocabulary = ${JSON.stringify(vocabulary, null, 2)}\n\nexport const hsk${level}CatalogMeta = {\n  levelId: 'hsk-${level}',\n  level: 'HSK 3.0 Level ${level}',\n  totalWords: hsk${level}Vocabulary.length,\n  translationLanguage: 'ru',\n  source: {\n    name: ${JSON.stringify(pdfCatalogue.publisher)},\n    file: ${JSON.stringify(pdfCatalogue.sourceFile)},\n    type: 'user-supplied-pdf',\n  },\n}\n`

  await writeFile(outputPath, moduleText, 'utf8')
  console.log(`HSK ${level}: ${vocabulary.length} Russian cards written to src/data/hsk${level}Vocabulary.js`)
}
