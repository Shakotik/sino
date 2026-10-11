// Small course descriptions used by the home page. The large word catalogues
// themselves are loaded only when a learner enters a particular HSK course.
export const studyLevels = [
  {
    id: 'hsk-1',
    name: 'HSK 1',
    title: 'Первые слова',
    description: 'Свободный старт: слова, значения и базовая практика.',
    status: 'free',
    available: true,
    totalWords: 300,
    // A multi-character word contributes one practice cell for each hanzi.
    totalCharacters: 482,
  },
  {
    id: 'hsk-2',
    name: 'HSK 2',
    title: 'Базовые диалоги',
    description: '200 слов для простых разговоров и повседневных ситуаций.',
    status: 'available',
    available: true,
    totalWords: 200,
    totalCharacters: 330,
  },
  {
    id: 'hsk-3',
    name: 'HSK 3',
    title: 'Повседневные темы',
    description: '973 слова для уверенного общения в знакомых жизненных темах.',
    status: 'available',
    available: true,
    totalWords: 973,
    totalCharacters: 1918,
  },
  {
    id: 'hsk-4',
    name: 'HSK 4',
    title: 'Свободнее в общении',
    description: '1 000 слов для объяснений, историй и обсуждений.',
    status: 'available',
    available: true,
    totalWords: 1000,
    totalCharacters: 1928,
  },
  {
    id: 'hsk-5',
    name: 'HSK 5',
    title: 'Сложные темы',
    description: '1 071 слово для учёбы, работы и более точной речи.',
    status: 'available',
    available: true,
    totalWords: 1071,
    totalCharacters: 2046,
  },
  {
    id: 'hsk-6',
    name: 'HSK 6',
    title: 'Продвинутый уровень',
    description: '1 140 слов для глубокого понимания современного языка.',
    status: 'available',
    available: true,
    totalWords: 1140,
    totalCharacters: 2219,
  },
]

export function findStudyLevel(levelId) {
  return studyLevels.find((level) => level.id === levelId)
}
