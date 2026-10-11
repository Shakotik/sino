// This transparent, local matcher is deliberately conservative. It accepts
// dictionary senses and reviewed synonyms, not arbitrary similar spellings.
// Scores are a learning aid, not a probability or an embedding-model distance.
const synonymGroups = [
  ['любить', 'нравиться', 'люблю', 'любит', 'нравится'],
  ['папа', 'отец', 'папочка'],
  ['мама', 'мать', 'мамочка'],
  ['ребенок', 'дитя'],
  // "Есть" is intentionally not a global synonym: it can mean existence.
  // Catalogues that mean eating already include "кушать" as a separate sense.
  ['кушать', 'принимать пищу'],
  ['учиться', 'обучаться'],
  ['изучать', 'учить', 'осваивать'],
  ['учитель', 'преподаватель', 'педагог'],
  ['ученик', 'учащийся'],
  ['доктор', 'врач'],
  ['компьютер', 'пк'],
  ['машина', 'автомобиль', 'авто'],
  ['велосипед', 'велик'],
  ['фильм', 'кинофильм', 'кинокартина'],
  ['вещь', 'предмет'],
  ['магазин', 'лавка'],
  ['друг', 'приятель'],
  ['радостный', 'счастливый', 'веселый'],
  ['красивый', 'прекрасный'],
  ['большой', 'крупный', 'огромный'],
  ['маленький', 'небольшой'],
  ['быстрый', 'скорый'],
  ['медленный', 'неторопливый'],
  ['холодный', 'прохладный'],
  ['говорить', 'разговаривать'],
  ['спасибо', 'благодарю'],
  ['извините', 'простите', 'извини', 'прости', 'прошу прощения'],
  ['привет', 'здравствуй', 'здравствуйте'],
  ['до свидания', 'пока', 'до встречи'],
  ['сейчас', 'теперь'],
  ['потом', 'затем'],
  ['снова', 'опять'],
  ['очень', 'весьма'],
  ['немного', 'мало'],
  ['покупать', 'купить', 'приобретать', 'приобрести'],
  ['продавать', 'продать'],
  ['видеть', 'увидеть'],
  ['смотреть', 'посмотреть'],
  ['читать', 'прочитать'],
  ['писать', 'написать'],
  ['звонить по телефону', 'позвонить по телефону', 'звонить', 'позвонить'],
  ['самолет', 'аэроплан'],
  ['страна', 'государство'],
  ['университет', 'вуз'],
  ['работа', 'труд'],
]

export function normalizeRussianAnswer(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[«»“”".!?]+/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

function removeDictionaryNotes(value) {
  return value
    .replace(/\([^)]*\)|\[[^\]]*\]/gu, ' ')
    .replace(/^\s*\d+[.)]\s*/u, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

export function getDictionaryMeanings(translation) {
  // Strip notes before splitting: commas inside "носить (одежду, обувь)"
  // separate an explanatory note, not independent dictionary meanings.
  return [...new Set(removeDictionaryNotes(String(translation ?? ''))
    .split(/[;,\n/]+|\s+или\s+/u)
    .map(removeDictionaryNotes)
    .map(normalizeRussianAnswer)
    .filter(Boolean))]
}

function areReviewedSynonyms(answer, meaning) {
  return synonymGroups.some((group) => group.includes(answer) && group.includes(meaning))
}

function containsNegation(phrase) {
  return /(?:^|\s)(?:не|нет|ни|нельзя|без)(?:\s|$)/u.test(phrase)
}

// Levenshtein is only used to suggest a possible typo. Its score never passes
// an answer, because "два" and "дня" can look close but mean different things.
function spellingSimilarity(first, second) {
  let previous = Array.from({ length: second.length + 1 }, (_, index) => index)
  for (let row = 1; row <= first.length; row += 1) {
    const current = [row]
    for (let column = 1; column <= second.length; column += 1) {
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + Number(first[row - 1] !== second[column - 1]),
      )
    }
    previous = current
  }
  return 1 - previous[second.length] / Math.max(first.length, second.length, 1)
}

export function evaluateMeaningAnswer(answer, translation) {
  const normalizedAnswer = normalizeRussianAnswer(answer)
  const meanings = getDictionaryMeanings(translation)
  if (!normalizedAnswer || !meanings.length) {
    return { correct: false, score: 0, kind: 'empty', explanation: 'Введите одно значение слова на русском языке.' }
  }

  if (meanings.includes(normalizedAnswer) || normalizedAnswer === normalizeRussianAnswer(translation)) {
    return { correct: true, score: 100, kind: 'exact', explanation: 'Совпадает с одним из словарных значений.' }
  }

  const matchedMeaning = meanings.find((meaning) => areReviewedSynonyms(normalizedAnswer, meaning))
  if (matchedMeaning) {
    return { correct: true, score: 95, kind: 'synonym', explanation: `Зачтён синоним к значению «${matchedMeaning}».` }
  }

  const suppliedMeanings = normalizedAnswer.split(/[;,]+/u).map((part) => part.trim()).filter(Boolean)
  if (suppliedMeanings.length > 1 && suppliedMeanings.every((supplied) => meanings.some((meaning) => supplied === meaning || areReviewedSynonyms(supplied, meaning)))) {
    return { correct: true, score: 95, kind: 'synonym', explanation: 'Все введённые значения соответствуют словарю или проверенным синонимам.' }
  }

  // Never grant credit for finding just one correct word inside unrelated or
  // contradictory text. All supplied alternatives above must be recognized.
  const comparableMeanings = meanings.filter((meaning) => containsNegation(meaning) === containsNegation(normalizedAnswer))
  const closestSpelling = Math.max(0, ...comparableMeanings.map((meaning) => spellingSimilarity(normalizedAnswer, meaning)))
  const score = closestSpelling >= 0.45 ? Math.min(74, Math.round(closestSpelling * 80)) : 0
  return {
    correct: false,
    score,
    kind: score >= 50 ? 'possible-typo' : 'unmatched',
    explanation: score >= 50
      ? 'Есть сходство в написании, но значение не подтверждено. Проверьте опечатку или попробуйте другое слово.'
      : 'Значение пока не распознано. Попробуйте другое русское слово; неизвестный синоним тоже может не распознаться.',
  }
}

export function normalizeChineseAnswer(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/gu, '').trim()
}

export function evaluateChineseAnswer(answer, expected) {
  const correct = normalizeChineseAnswer(answer) !== ''
    && normalizeChineseAnswer(answer) === normalizeChineseAnswer(expected)
  return {
    correct,
    score: correct ? 100 : 0,
    kind: correct ? 'exact' : 'unmatched',
    explanation: correct ? 'Все иероглифы введены верно и в правильном порядке.' : 'Проверьте сами иероглифы и их порядок. Нужен ответ на китайском, а не пиньинь.',
  }
}
