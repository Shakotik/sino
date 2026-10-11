import { useEffect, useRef, useState } from 'react'
import { usePageNavigation } from '../study/usePageNavigation'
import { DictionarySentenceReader } from './DictionarySentenceReader.jsx'
import { buildSearchUrl, getEntryUrl } from './dictionaryApi.js'
import { ReadableText } from '../../components/ReadableText.jsx'
import { SaveDictionaryWord } from '../personal/SaveDictionaryWord.jsx'
import { Link } from 'react-router-dom'

const SEARCH_DELAY_MS = 220
const DIALOG_CLOSE_MS = 420

const directionOptions = [
  { value: 'auto', label: 'Авто' },
  { value: 'zh-ru', label: 'Китайский → русский' },
  { value: 'ru-zh', label: 'Русский → китайский' },
]

export function DictionaryArticleDialog({ dialog, onClose, sentenceSelection, onSelectSentenceWord, user }) {
  const isVisible = dialog.lifecycle !== 'closed'
  const dialogRef = useRef(null)

  useEffect(() => {
    // A new word should always open at the beginning of its article.
    if (dialogRef.current) dialogRef.current.scrollTop = 0
  }, [dialog.entry?.id, sentenceSelection?.index])

  useEffect(() => {
    if (!isVisible) return undefined
    const previousFocus = document.activeElement
    const dialogElement = dialogRef.current
    dialogElement.focus()
    function containFocus(event) {
      if (event.key !== 'Tab') return
      const controls = [...dialogElement.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [href], [tabindex="0"]')].filter((element) => element.getClientRects().length > 0)
      const first = controls[0]
      const last = controls.at(-1)
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogElement)) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    dialogElement.addEventListener('keydown', containFocus)
    return () => {
      dialogElement.removeEventListener('keydown', containFocus)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [isVisible])

  useEffect(() => {
    if (!isVisible) return undefined

    function closeOnEscape(event) {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [isVisible, onClose])

  if (!isVisible) return null

  const entry = dialog.entry

  return (
    <div
      className={`dictionary-dialog-backdrop is-${dialog.lifecycle}`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <article ref={dialogRef} tabIndex={-1} className="dictionary-dialog" role="dialog" aria-modal="true" aria-labelledby="dictionary-dialog-title">
        <button className="dictionary-dialog-close" type="button" onClick={onClose} aria-label="Закрыть словарную статью">
          ×
        </button>

        {sentenceSelection && (
          <nav className="sentence-navigation" aria-label="Переход между словами предложения">
            <button type="button" disabled={sentenceSelection.index === 0}
              onClick={() => onSelectSentenceWord(sentenceSelection.words, sentenceSelection.index - 1)}>← Предыдущее</button>
            <span>{sentenceSelection.index + 1} / {sentenceSelection.words.length}</span>
            <button type="button" disabled={sentenceSelection.index === sentenceSelection.words.length - 1}
              onClick={() => onSelectSentenceWord(sentenceSelection.words, sentenceSelection.index + 1)}>Следующее →</button>
          </nav>
        )}

        {dialog.requestState === 'loading' && (
          <div className="dictionary-dialog-status" aria-live="polite">
            <span aria-hidden="true">⌕</span>
            <p id="dictionary-dialog-title">Открываем полную словарную статью…</p>
          </div>
        )}

        {dialog.requestState === 'missing' && (
          <div className="dictionary-dialog-status" aria-live="polite">
            <h2 id="dictionary-dialog-title" className="hanzi">{sentenceSelection?.words[sentenceSelection.index].text}</h2>
            <p>Точной статьи в загруженной базе БКРС нет. Можно перейти к следующему слову или уточнить запрос в поиске.</p>
          </div>
        )}

        {dialog.requestState === 'error' && (
          <div className="dictionary-dialog-status dictionary-dialog-error" aria-live="polite">
            <h2 id="dictionary-dialog-title">Не удалось открыть статью</h2>
            <p>{dialog.errorMessage}</p>
          </div>
        )}

        {entry && (
          <>
            <header className="dictionary-dialog-heading">
              <h2 id="dictionary-dialog-title" className={entry.direction === 'zh-ru' ? 'hanzi' : 'dictionary-russian-headword'}>
                <ReadableText text={entry.headword} />
              </h2>
              {entry.pinyin && <p className="pinyin">{entry.pinyin}</p>}
            </header>

            {entry.direction === 'zh-ru' && (user ? <SaveDictionaryWord key={entry.id} user={user} entry={entry} context={sentenceSelection?.context} /> : <p className="dictionary-source-note"><Link to="/profile">Войдите в профиль</Link>, чтобы сохранить слово в свою папку.</p>)}
            <section className="dictionary-dialog-article" aria-labelledby="dictionary-article-title">
              <h3 id="dictionary-article-title">Полная статья</h3>
              <p><ReadableText text={entry.article || 'В исходной выгрузке для этой статьи пока нет описания.'} /></p>
            </section>

            <p className="dictionary-source-note">
              Источник: {entry.source.title}, версия {entry.source.version}.
            </p>
          </>
        )}
      </article>
    </div>
  )
}

function DictionarySuggestions({ query, searchState, suggestions, errorMessage, onSelect }) {
  if (!query) return null

  return (
    <section className="dictionary-suggestions" aria-label="Варианты слов">
      {searchState === 'loading' && <p className="dictionary-suggestion-state">Ищем варианты…</p>}
      {searchState === 'error' && <p className="dictionary-error">{errorMessage}</p>}
      {searchState === 'ready' && suggestions.length === 0 && (
        <p className="dictionary-suggestion-state">Ничего не нашли. Попробуйте сократить запрос или сменить направление.</p>
      )}
      {suggestions.map((suggestion) => (
        <button
          key={suggestion.id}
          className="dictionary-suggestion"
          type="button"
          onClick={() => onSelect(suggestion.id)}
        >
          <span className={suggestion.direction === 'zh-ru' ? 'dictionary-suggestion-hanzi' : 'dictionary-suggestion-russian'}>
            <ReadableText text={suggestion.headword} />
          </span>
          <span className="dictionary-suggestion-description">
            {suggestion.pinyin && <strong className="pinyin">{suggestion.pinyin}</strong>}
            <small><ReadableText text={suggestion.preview || 'Статья без краткого описания'} /></small>
          </span>
        </button>
      ))}
    </section>
  )
}

export function DictionaryPage({ user, reading }) {
  const navigate = usePageNavigation()
  const [query, setQuery] = useState('')
  const [direction, setDirection] = useState('auto')
  const [searchMode, setSearchMode] = useState(reading ? 'sentence' : 'word')
  const [sentenceSelection, setSentenceSelection] = useState(null)
  const [suggestions, setSuggestions] = useState([])
  const [searchState, setSearchState] = useState('idle')
  const [searchError, setSearchError] = useState('')
  const [articleDialog, setArticleDialog] = useState({
    lifecycle: 'closed',
    requestState: 'idle',
    entry: null,
    errorMessage: '',
  })
  const searchQuery = query.trim()
  const closeDialogTimerRef = useRef(null)
  const entryRequestRef = useRef(null)

  useEffect(() => {
    if (!searchQuery || searchMode !== 'word') return undefined

    const abortController = new AbortController()
    const searchTimerId = window.setTimeout(async () => {
      setSearchState('loading')
      setSearchError('')

      try {
        const response = await fetch(buildSearchUrl(searchQuery, direction), { signal: abortController.signal })
        if (!response.ok) throw new Error('dictionary-search-failed')

        const payload = await response.json()
        if (abortController.signal.aborted) return

        setSuggestions(payload.entries)
        setSearchState('ready')
      } catch (error) {
        if (error.name === 'AbortError') return
        setSuggestions([])
        setSearchState('error')
        setSearchError('Словарь временно недоступен. Проверьте, что сервер Sino запущен, и повторите попытку.')
      }
    }, SEARCH_DELAY_MS)

    return () => {
      window.clearTimeout(searchTimerId)
      abortController.abort()
    }
  }, [searchQuery, direction, searchMode])

  useEffect(() => () => {
    window.clearTimeout(closeDialogTimerRef.current)
    entryRequestRef.current?.abort()
  }, [])

  function resetSearch() {
    setQuery('')
    setSuggestions([])
    setSearchState('idle')
    setSearchError('')
  }

  function changeDirection(nextDirection) {
    if (direction === nextDirection) return
    setDirection(nextDirection)
    setSuggestions([])
    setSearchState(query.trim() ? 'loading' : 'idle')
  }

  function changeQuery(nextQuery) {
    setQuery(nextQuery)
    if (nextQuery.trim() === searchQuery) return
    setSuggestions([])
    setSearchError('')
    setSearchState(nextQuery.trim() ? 'loading' : 'idle')
  }

  function changeSearchMode(mode) {
    if (mode === searchMode) return
    setSearchMode(mode)
    setSentenceSelection(null)
  }

  async function openArticle(entryId, selection = null) {
    window.clearTimeout(closeDialogTimerRef.current)
    entryRequestRef.current?.abort()
    setSentenceSelection(selection)

    if (!entryId) {
      setArticleDialog({ lifecycle: 'open', requestState: 'missing', entry: null, errorMessage: '' })
      return
    }

    const abortController = new AbortController()
    entryRequestRef.current = abortController
    setArticleDialog({ lifecycle: 'open', requestState: 'loading', entry: null, errorMessage: '' })

    try {
      const response = await fetch(getEntryUrl(entryId), { signal: abortController.signal })
      if (!response.ok) throw new Error('dictionary-entry-failed')

      const payload = await response.json()
      if (abortController.signal.aborted) return

      setArticleDialog({ lifecycle: 'open', requestState: 'ready', entry: payload.entry, errorMessage: '' })
    } catch (error) {
      if (error.name === 'AbortError') return
      setArticleDialog({
        lifecycle: 'open',
        requestState: 'error',
        entry: null,
        errorMessage: 'Не получилось загрузить статью. Попробуйте выбрать слово ещё раз.',
      })
    }
  }

  function closeArticle() {
    if (articleDialog.lifecycle === 'closed' || articleDialog.lifecycle === 'closing') return

    entryRequestRef.current?.abort()
    setArticleDialog((currentDialog) => ({ ...currentDialog, lifecycle: 'closing' }))
    closeDialogTimerRef.current = window.setTimeout(() => {
      setArticleDialog({ lifecycle: 'closed', requestState: 'idle', entry: null, errorMessage: '' })
    }, DIALOG_CLOSE_MS)
  }

  function selectSentenceWord(words, index, context) {
    if (index < 0 || index >= words.length) return
    void openArticle(words[index].entryId, { words, index, context: context ?? sentenceSelection?.context ?? '' })
  }

  return (
    <main className="dictionary-shell">
      <button className="back-button" type="button" onClick={() => navigate(reading ? '/texts' : '/')}>
        {reading ? '← К текстам' : '← К учёбе'}
      </button>

      <header className="dictionary-header">
        <h1>{reading ? reading.title : 'БОЛЬШОЙ СЛОВАРЬ'}</h1>
        {reading && <p>{reading.level} · Авторский текст Sino</p>}
      </header>

      <section className="dictionary-search-panel" aria-label="Поиск по словарю">
        <div className="dictionary-mode-switch" aria-label="Режим словаря">
          <button type="button" aria-pressed={searchMode === 'word'} onClick={() => changeSearchMode('word')}>Слово</button>
          <button type="button" aria-pressed={searchMode === 'sentence'} onClick={() => changeSearchMode('sentence')}>Предложение</button>
        </div>
        {searchMode === 'sentence' ? (
          <DictionarySentenceReader initialText={reading?.text} onSelect={selectSentenceWord}
            onReset={() => setSentenceSelection(null)}
            selectedStart={sentenceSelection?.words[sentenceSelection.index].start} />
        ) : <>
        <label className="dictionary-search-label" htmlFor="dictionary-search">
          <span aria-hidden="true">⌕</span>
          <input
            id="dictionary-search"
            type="text"
            inputMode="search"
            enterKeyHint="search"
            aria-label="Поиск слова, пиньиня или перевода"
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
            placeholder="Например: 你好, xuexi или учиться"
            autoComplete="off"
            maxLength={120}
          />
          {query && (
            <button className="dictionary-clear" type="button" onClick={resetSearch} aria-label="Очистить поиск">
              ×
            </button>
          )}
        </label>

        <DictionarySuggestions
          query={query.trim()}
          searchState={searchState}
          suggestions={suggestions}
          errorMessage={searchError}
          onSelect={openArticle}
        />

        <div className="dictionary-filters" aria-label="Направление словаря">
          {directionOptions.map((option) => (
            <button
              key={option.value}
              className={direction === option.value ? 'is-active' : ''}
              type="button"
              onClick={() => changeDirection(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        </>}
      </section>

      {reading && <details className="reading-translation"><summary>Посмотреть перевод текста</summary><p><ReadableText text={reading.translation} /></p></details>}
      <DictionaryArticleDialog user={user} dialog={articleDialog} onClose={closeArticle}
        sentenceSelection={sentenceSelection} onSelectSentenceWord={selectSentenceWord} />
    </main>
  )
}
