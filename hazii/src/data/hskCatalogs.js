// One place that knows where each level's local catalogue is stored.
// Dynamic imports let the browser download only the course a learner opens.
const catalogLoaders = {
  'hsk-1': () => import('./hsk1Vocabulary'),
  'hsk-2': () => import('./hsk2Vocabulary'),
  'hsk-3': () => import('./hsk3Vocabulary'),
  'hsk-4': () => import('./hsk4Vocabulary'),
  'hsk-5': () => import('./hsk5Vocabulary'),
  'hsk-6': () => import('./hsk6Vocabulary'),
}

export const hskLevelIds = Object.keys(catalogLoaders)

export async function loadHskCatalog(levelId) {
  const loadCatalogModule = catalogLoaders[levelId]

  if (!loadCatalogModule) {
    throw new Error(`Unknown HSK course: ${levelId}`)
  }

  const catalogModule = await loadCatalogModule()
  const levelNumber = levelId.replace('hsk-', '')
  const words = catalogModule[`hsk${levelNumber}Vocabulary`]
  const meta = catalogModule[`hsk${levelNumber}CatalogMeta`]

  if (!words || !meta) {
    throw new Error(`The catalogue for ${levelId} has an invalid shape.`)
  }

  return { words, meta }
}

// The dictionary needs to search across every currently bundled course. The
// individual course pages still use loadHskCatalog, so they remain lightweight.
export async function loadAllHskCatalogs() {
  const catalogs = await Promise.all(
    hskLevelIds.map(async (levelId) => {
      const { words, meta } = await loadHskCatalog(levelId)

      return words.map((word) => ({
        ...word,
        levelId,
        levelName: meta.name ?? levelId.replace('hsk-', 'HSK '),
      }))
    }),
  )

  return catalogs.flat()
}
