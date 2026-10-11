import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { usePageNavigation } from '../study/usePageNavigation'
import { PersonalDialog } from './PersonalDialog'
import { deletePersonalCard, fetchPersonalCards, reviewPersonalCard, savePersonalCard, movePersonalCards } from './personalCardsApi'
import { usePersonalFolders } from './usePersonalFolders.js'
import { PersonalFolders } from './PersonalFolders.jsx'
import { ReadableText } from '../../components/ReadableText.jsx'
import './personal-cards.css'
import { useSessionCompletion } from '../study/useSessionCompletion.js'

// crypto.randomUUID exists only in secure contexts (HTTPS or localhost), so a
// phone opening the dev server by its Wi-Fi address needs this v4 fallback.
function createRequestId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const EMPTY_CARD = { hanzi: '', pinyin: '', translationRu: '', notes: '', folderId: '' }
const FILTERS = [
  { value: 'all', label: 'Все слова' },
  { value: 'new', label: 'Неизученные слова' },
  { value: 'learned', label: 'Изученные слова' },
  { value: 'due', label: 'Пора повторить' },
]

function matchesFilter(card, filter) {
  if (filter === 'new') return !card.known
  if (filter === 'learned') return card.known
  if (filter === 'due') return card.attempts > 0 && new Date(card.dueAt) <= new Date()
  return true
}

function ErrorMessage({ message }) {
  return message ? <p className="personal-error" role="alert">{message}</p> : null
}

function PersonalCardForm({ user, card, folders, initialFolderId, onSaved, onClose }) {
  const [values, setValues] = useState(() => ({ ...EMPTY_CARD, ...card, folderId: card?.folderId ?? initialFolderId ?? '' }))
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    setIsSaving(true)
    setError('')
    try {
      await savePersonalCard(user, values, card?.id)
      onSaved()
      onClose()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setIsSaving(false)
    }
  }

  function fieldChanged(field, value) {
    setValues((current) => ({ ...current, [field]: value }))
  }

  return (
    <form className="personal-form" onSubmit={submit}>
      <label>Тематическая папка
        <select required value={values.folderId} onChange={(event) => fieldChanged('folderId', event.target.value)}>
          <option value="">Выберите тему</option>
          {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.title}</option>)}
        </select>
      </label>
      <label>Слово на китайском
        <input lang="zh" value={values.hanzi} maxLength={64} required placeholder="Например, 爱"
          onChange={(event) => fieldChanged('hanzi', event.target.value)} />
      </label>
      <label>Пиньинь <small>необязательно</small>
        <input value={values.pinyin} maxLength={160} placeholder="ài" onChange={(event) => fieldChanged('pinyin', event.target.value)} />
      </label>
      <label>Значения на русском
        <textarea rows={2} value={values.translationRu} maxLength={1000} required placeholder="любить; нравиться"
          onChange={(event) => fieldChanged('translationRu', event.target.value)} />
      </label>
      <label>Пример или заметка <small>необязательно</small>
        <textarea rows={3} value={values.notes} maxLength={2000} placeholder="我爱学习中文。 — Я люблю изучать китайский."
          onChange={(event) => fieldChanged('notes', event.target.value)} />
      </label>
      {card && <p className="personal-muted">Изменение текста сохраняет ваш прогресс по этой карточке.</p>}
      <ErrorMessage message={error} />
      <div className="personal-actions">
        <button type="button" className="personal-secondary" disabled={isSaving} onClick={onClose}>Отмена</button>
        <button type="submit" className="personal-primary" disabled={isSaving}>{isSaving ? 'Сохраняем…' : 'Сохранить карточку'}</button>
      </div>
    </form>
  )
}

function DeleteConfirmation({ user, card, onDeleted, onClose }) {
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState('')
  async function confirmDelete() {
    setIsDeleting(true)
    try {
      await deletePersonalCard(user, card.id)
      onDeleted()
      onClose()
    } catch (requestError) {
      setError(requestError.message)
      setIsDeleting(false)
    }
  }
  return <>
    <p>Удалить <strong lang="zh">{card.hanzi}</strong> из вашей коллекции? Вместе с карточкой удалится её статистика. Отменить удаление нельзя.</p>
    <ErrorMessage message={error} />
    <div className="personal-actions">
      <button type="button" className="personal-secondary" disabled={isDeleting} onClick={onClose}>Оставить</button>
      <button type="button" className="personal-danger" disabled={isDeleting} onClick={confirmDelete}>{isDeleting ? 'Удаляем…' : 'Удалить карточку'}</button>
    </div>
  </>
}

function PracticeSettings({ cards, onStart, onClose, initialFilter = 'all' }) {
  const [filter, setFilter] = useState(initialFilter)
  const [direction, setDirection] = useState('zh-ru')
  const [limit, setLimit] = useState(10)
  const availableCards = cards.filter((card) => matchesFilter(card, filter))
  return <form className="personal-form" onSubmit={(event) => {
    event.preventDefault()
    onStart({ cards: availableCards.slice(0, Number(limit)), direction })
    onClose()
  }}>
    <label>Какие слова повторить
      <select value={filter} onChange={(event) => setFilter(event.target.value)}>
        {FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
    <label>Что показывать первым
      <select value={direction} onChange={(event) => setDirection(event.target.value)}>
        <option value="zh-ru">Иероглиф → значение</option>
        <option value="ru-zh">Значение → иероглиф</option>
      </select>
    </label>
    <label>Слов за занятие
      <select value={limit} onChange={(event) => setLimit(event.target.value)}>
        {[5, 10, 20, 50].map((count) => <option key={count} value={count}>{count}</option>)}
      </select>
    </label>
    <p className="personal-muted">Доступно: {availableCards.length}. Переверните карточку, проверьте себя и оцените ответ. Срок следующего повторения сохранится автоматически.</p>
    <button className="personal-primary" type="submit" disabled={!availableCards.length}>Начать повторение</button>
  </form>
}

function PersonalPractice({ user, session, onExit, onReviewed }) {
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [remembered, setRemembered] = useState(0)
  const [lastReview, setLastReview] = useState(null)
  const reviewRequestRef = useRef(null)
  const card = session.cards[index]
  useSessionCompletion(Boolean(session.cards.length && !card))

  async function gradeAnswer(grade) {
    if (isSaving) return
    setIsSaving(true)
    setError('')
    try {
      // Keep the same identifier when retrying after an uncertain connection.
      // The server returns the first saved result rather than counting it twice.
      if (!reviewRequestRef.current) reviewRequestRef.current = { requestId: createRequestId(), grade }
      const review = await reviewPersonalCard(user, card.id, reviewRequestRef.current.grade, reviewRequestRef.current.requestId)
      if (review.known) setRemembered((current) => current + 1)
      setLastReview(review)
      setRevealed(false)
      setIndex((current) => current + 1)
      reviewRequestRef.current = null
      onReviewed()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setIsSaving(false)
    }
  }

  if (!card) return <section className="personal-practice personal-complete" aria-live="polite">
    <span className="personal-complete-mark" aria-hidden="true">✓</span>
    <h2>Повторение завершено</h2>
    <p>Вспомнили {remembered} из {session.cards.length} слов. Все ответы сохранены в вашей коллекции.</p>
    <button type="button" className="personal-primary" onClick={onExit}>К своим карточкам</button>
  </section>

  const chineseFirst = session.direction === 'zh-ru'
  return <section className="personal-practice" aria-labelledby="personal-practice-title">
    <header className="personal-section-heading">
      <div><h2 id="personal-practice-title"><ReadableText text={session.title || 'Мои слова'} /></h2><p>{index + 1} / {session.cards.length}</p></div>
      <button type="button" className="personal-secondary" onClick={onExit} disabled={isSaving}>Завершить</button>
    </header>
    <progress aria-label="Пройдено карточек" value={index} max={session.cards.length} />
    <button type="button" className={`personal-flip-card ${revealed ? 'is-revealed' : ''}`}
      aria-label={revealed ? 'Скрыть ответ' : 'Показать ответ'} aria-pressed={revealed}
      onClick={() => setRevealed((current) => !current)} disabled={isSaving}>
      <span className="personal-flip-inner">
        <span className="personal-card-face personal-card-front" aria-hidden={revealed}>
          <strong className={chineseFirst ? 'hanzi' : ''}><ReadableText text={chineseFirst ? card.hanzi : card.translationRu} /></strong>
          <small>Нажмите, чтобы проверить себя</small>
        </span>
        <span className="personal-card-face personal-card-back" aria-hidden={!revealed}>
          <strong className={chineseFirst ? '' : 'hanzi'}><ReadableText text={chineseFirst ? card.translationRu : card.hanzi} /></strong>
          {card.pinyin && <span className="pinyin">{card.pinyin}</span>}
          {card.notes && <small><ReadableText text={card.notes} /></small>}
        </span>
      </span>
    </button>
    {revealed ? <div className="personal-grade-actions">
      <button type="button" className="personal-secondary" disabled={isSaving} onClick={() => gradeAnswer('again')}>Ещё учу <small>через 10 минут</small></button>
      <button type="button" className="personal-primary" disabled={isSaving} onClick={() => gradeAnswer('good')}>Помню <small>увеличить интервал</small></button>
      <button type="button" className="personal-secondary" disabled={isSaving} onClick={() => gradeAnswer('easy')}>Легко <small>повторить позже</small></button>
    </div> : <button type="button" className="personal-primary" onClick={() => setRevealed(true)}>Показать ответ</button>}
    {lastReview && <p className="personal-muted" aria-live="polite">Предыдущий ответ сохранён. Повторение: {new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(lastReview.dueAt))}.</p>}
    <ErrorMessage message={error} />
  </section>
}

function PersonalCollection({ user }) {
  const navigate = usePageNavigation()
  const [searchParams, setSearchParams] = useSearchParams()
  const folderId = searchParams.get('folder') || 'all'
  const { folders, error: foldersError, refresh: refreshFolders } = usePersonalFolders(user)
  const selectedFolder = folders.find((folder) => folder.id === folderId)
  const [selectedCards, setSelectedCards] = useState([])
  const [moveTarget, setMoveTarget] = useState('')
  const [moving, setMoving] = useState(false)
  const [cards, setCards] = useState([])
  const [requestState, setRequestState] = useState('loading')
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [dialog, setDialog] = useState(() => searchParams.get('practice') === '1' ? { type: 'practice' } : null)
  const [session, setSession] = useState(null)

  const refreshCards = useCallback(async () => {
    try {
      const savedCards = await fetchPersonalCards(user)
      setCards(savedCards)
      setError('')
      setRequestState('ready')
    } catch (requestError) {
      setError(requestError.message)
      setRequestState('error')
    }
  }, [user])

  useEffect(() => {
    let isMounted = true
    fetchPersonalCards(user).then((savedCards) => {
      if (!isMounted) return
      setCards(savedCards)
      setRequestState('ready')
    }, (requestError) => {
      if (!isMounted) return
      setError(requestError.message)
      setRequestState('error')
    })
    return () => { isMounted = false }
  }, [user])

  const folderCards = useMemo(() => cards.filter((card) => folderId === 'all'
    || (folderId === 'unfiled' ? !card.folderId : card.folderId === folderId)), [cards, folderId])
  const visibleCards = useMemo(() => {
    const query = search.toLocaleLowerCase('ru-RU').trim()
    return folderCards.filter((card) => matchesFilter(card, filter)
      && `${card.hanzi} ${card.pinyin} ${card.translationRu}`.toLocaleLowerCase('ru-RU').includes(query))
  }, [folderCards, filter, search])
  const learned = folderCards.filter((card) => card.known).length

  function selectFolder(id) {
    setSearchParams(id === 'all' ? {} : { folder: id })
    setSelectedCards([])
    setSearch('')
    setFilter('all')
  }

  return <main className="personal-shell">
    <button className="back-button" type="button" onClick={() => navigate('/')}>← К учёбе</button>
    <header className="personal-header">
      <p className="eyebrow">Личная коллекция</p>
      <h1>Свои карточки</h1>
      <p>Слова, которые нужны именно вам. Сохраняйте примеры, повторяйте и наблюдайте за прогрессом.</p>
    </header>
    <p className="personal-local-note">Карточки хранятся на сервере. Доступ привязан к этому профилю в браузере — не очищайте данные сайта, пока не подключён полноценный вход.</p>
    {session ? <PersonalPractice key={session.startedAt} user={user} session={session} onExit={() => setSession(null)} onReviewed={refreshCards} /> : <>
      <PersonalFolders user={user} folders={folders} selectedId={folderId} onSelect={selectFolder} unfiledCount={cards.filter((card) => !card.folderId).length} />
      {foldersError && <p className="personal-error" role="alert">{foldersError} <button type="button" className="personal-secondary" onClick={refreshFolders}>Повторить загрузку тем</button></p>}
      {selectedFolder && <h2 className="personal-course-title"><ReadableText text={selectedFolder.title} /></h2>}
      <div className="personal-toolbar">
        <div><strong>{folderCards.length}</strong> слов <span>·</span> <strong>{learned}</strong> изучено</div>
        <div className="personal-actions">
          <button type="button" className="personal-secondary" disabled={!folderCards.length || requestState !== 'ready'} onClick={() => setDialog({ type: 'practice' })}>{selectedFolder ? 'Учить тему' : 'Повторить карточки'}</button>
          <button type="button" className="personal-primary" disabled={!folders.length} onClick={() => setDialog({ type: 'create' })}>+ Создать карточку</button>
        </div>
      </div>
      {visibleCards.length > 0 && <div className="personal-move-toolbar">
        <label><input type="checkbox" checked={visibleCards.every((card) => selectedCards.includes(card.id))}
          onChange={(event) => setSelectedCards(event.target.checked ? visibleCards.map((card) => card.id) : [])} /> Выбрать показанные слова</label>
        {selectedCards.length > 0 && <>
          <label>Перенести {selectedCards.length} слов в тему
            <select value={moveTarget} onChange={(event) => setMoveTarget(event.target.value)}><option value="">Выберите тему</option>
              {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.title}</option>)}</select>
          </label>
          <button type="button" className="personal-primary" disabled={!moveTarget || moving} onClick={async () => {
            setMoving(true)
            try { await movePersonalCards(user, moveTarget, selectedCards); setSelectedCards([]); await refreshCards() }
            catch (requestError) { setError(requestError.message) }
            finally { setMoving(false) }
          }}>Переместить</button>
          <p className="personal-muted">Перенос сохранит весь прогресс слов.</p>
        </>}
      </div>}
      <div className="personal-filters">
        <label>Найти слово<input type="search" placeholder="Иероглиф, пиньинь или перевод" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <label>Показывать<select value={filter} onChange={(event) => setFilter(event.target.value)}>{FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      </div>
      {requestState === 'loading' && <p role="status">Загружаем вашу коллекцию…</p>}
      <ErrorMessage message={error} />
      {requestState === 'error' && <button type="button" className="personal-secondary" onClick={refreshCards}>Повторить загрузку</button>}
      {requestState === 'ready' && !visibleCards.length && <section className="personal-empty">
        <span lang="zh" aria-hidden="true">字</span>
        <h2>{cards.length ? 'По этим условиям слов пока нет' : 'Начните с первого слова'}</h2>
        <p>{cards.length ? 'Выберите другой фильтр или измените поиск.' : 'Добавьте иероглиф, пиньинь и значение — коллекция останется вашей.'}</p>
      </section>}
      <div className="personal-card-grid">
        {visibleCards.map((card) => <article className="personal-word" key={card.id}>
          <label className="personal-card-selection"><input type="checkbox" checked={selectedCards.includes(card.id)} aria-label={`Выбрать слово ${card.hanzi}`}
            onChange={(event) => setSelectedCards((current) => event.target.checked ? [...current, card.id] : current.filter((id) => id !== card.id))} />
            <ReadableText text={folders.find((folder) => folder.id === card.folderId)?.title ?? 'Без темы'} /></label>
          <div className="personal-word-heading"><strong lang="zh"><ReadableText text={card.hanzi} /></strong><span className={card.known ? 'is-known' : ''}>{card.known ? 'Изучено' : 'На изучении'}</span></div>
          {card.pinyin && <p className="pinyin">{card.pinyin}</p>}
          <p><ReadableText text={card.translationRu} /></p>
          {card.notes && <p className="personal-word-note"><ReadableText text={card.notes} /></p>}
          <div className="personal-word-footer"><small>Ответов: {card.attempts}{card.attempts > 0 ? ` · ${Math.round(card.correctAnswers / card.attempts * 100)}% верных` : ''}</small>
            <div><button type="button" aria-label={`Изменить карточку ${card.hanzi}`} onClick={() => setDialog({ type: 'edit', card })}>Изменить</button>
              <button type="button" aria-label={`Удалить карточку ${card.hanzi}`} onClick={() => setDialog({ type: 'delete', card })}>Удалить</button></div>
          </div>
        </article>)}
      </div>
    </>}
    {dialog && requestState === 'ready' && <PersonalDialog title={{ create: 'Создать карточку', edit: 'Изменить карточку', delete: 'Удалить карточку', practice: 'Настройки повторения' }[dialog.type]} onClose={() => setDialog(null)}>
      {(closeDialog) => dialog.type === 'practice'
        ? <PracticeSettings cards={folderCards} initialFilter={searchParams.get('filter') === 'due' ? 'due' : 'all'} onClose={closeDialog} onStart={(configuration) => setSession({ ...configuration, title: selectedFolder?.title, startedAt: Date.now() })} />
        : dialog.type === 'delete'
          ? <DeleteConfirmation user={user} card={dialog.card} onDeleted={refreshCards} onClose={closeDialog} />
          : <PersonalCardForm user={user} card={dialog.card} folders={folders} initialFolderId={selectedFolder?.id} onSaved={refreshCards} onClose={closeDialog} />}
    </PersonalDialog>}
  </main>
}

export function MyCardsPage({ user }) {
  const navigate = usePageNavigation()
  if (!user) return <main className="personal-shell">
    <button className="back-button" type="button" onClick={() => navigate('/')}>← К учёбе</button>
    <section className="personal-empty"><h1>Свои карточки</h1><p>Сначала создайте личный кабинет, чтобы у коллекции был свой владелец.</p>
      <button type="button" className="personal-primary" onClick={() => navigate('/profile')}>Создать профиль</button>
    </section>
  </main>
  return <PersonalCollection key={user.id} user={user} />
}
