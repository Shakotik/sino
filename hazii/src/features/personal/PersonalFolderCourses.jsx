import { useState } from 'react'
import { usePageNavigation } from '../study/usePageNavigation'
import { usePersonalFolders } from './usePersonalFolders.js'
import { enrollPersonalFolder } from './personalCardsApi.js'
import { PersonalDialog } from './PersonalDialog.jsx'
import { StatisticBar } from './PersonalCardsSummary.jsx'
import { ReadableText } from '../../components/ReadableText.jsx'

export function FolderCourseStatistics({ folder }) {
  const stats = folder.statistics
  const days = new Map()
  for (const word of folder.learnedWords) {
    const date = new Date(word.learnedAt)
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    if (!days.has(key)) days.set(key, [])
    days.get(key).push(word.hanzi)
  }
  return <>
    <div className="personal-summary-grid">
      <StatisticBar label="Всего слов" value={stats.total} total={stats.total} />
      <StatisticBar label="Изучено" value={stats.learned} total={stats.total} />
      <StatisticBar label="На изучении" value={stats.learning} total={stats.total} />
      <StatisticBar label="Пора повторить" value={stats.due} total={stats.total} />
      <StatisticBar label="Иероглифы в изученных словах" value={stats.learnedCharacters} total={stats.characters} detail="уникальные знаки; не оценка навыка письма" />
      <StatisticBar label="Успешные самооценки" value={stats.correctAnswers} total={stats.attempts} detail={`${stats.accuracy}% · «Помню» и «Легко»`} />
    </div>
    <p className="personal-muted">Ещё не повторяли: {stats.new}. Ответов: {stats.attempts}.</p>
    <details className="personal-folder-diary"><summary>Дневник темы</summary>
      {days.size ? <ul>{[...days].sort(([a], [b]) => b.localeCompare(a)).map(([day, words]) => <li key={day}>
        <strong>{new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' }).format(new Date(`${day}T12:00:00`))} · {words.length} слов</strong>
        <p><ReadableText text={words.join(' · ')} /></p>
      </li>)}</ul> : <p className="personal-muted">Здесь появятся слова по дате первого успешного повторения.</p>}
    </details>
  </>
}

function CoursesForUser({ user }) {
  const navigate = usePageNavigation()
  const { folders, loading, error, refresh } = usePersonalFolders(user)
  const [removing, setRemoving] = useState(null)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState('')
  const courses = folders.filter((folder) => folder.enrolledAt)
  return <section className="personal-folder-courses" aria-labelledby="personal-folder-courses-title">
    <div className="personal-section-heading"><h2 id="personal-folder-courses-title">Мои тематические курсы</h2>
      <button type="button" className="personal-secondary" onClick={() => navigate('/my-cards')}>Управлять темами</button>
    </div>
    {loading && <p role="status">Загружаем темы…</p>}
    {error && <p className="personal-error" role="alert">{error} <button type="button" className="personal-secondary" onClick={refresh}>Повторить</button></p>}
    {!loading && !error && !courses.length && <p className="personal-muted">Создайте папку со словами и нажмите «Взять как курс». Прогресс появится здесь.</p>}
    {courses.map((folder) => <article key={folder.id} className="personal-summary">
      <div className="personal-section-heading"><h3 className="personal-course-title"><ReadableText text={folder.title} /></h3>
        <button type="button" className="personal-primary" onClick={() => navigate(`/my-cards?folder=${folder.id}&practice=1`)} disabled={!folder.statistics.total}>Продолжить</button>
      </div>
      <FolderCourseStatistics folder={folder} />
      <button type="button" className="personal-text-button" onClick={() => { setActionError(''); setRemoving(folder) }}>Убрать курс из профиля</button>
    </article>)}
    {removing && <PersonalDialog title="Убрать тематический курс?" onClose={() => setRemoving(null)}>
      {(close) => <><p>Папка «<ReadableText text={removing.title} />», её слова и весь прогресс сохранятся. Курс можно взять снова.</p>
        {actionError && <p className="personal-error" role="alert">{actionError}</p>}
        <div className="personal-actions"><button type="button" className="personal-secondary" disabled={saving} onClick={close}>Оставить</button>
          <button type="button" className="personal-primary" disabled={saving} onClick={async () => {
            setSaving(true)
            try { await enrollPersonalFolder(user, removing.id, false); close() }
            catch (requestError) { setActionError(requestError.message) }
            finally { setSaving(false) }
          }}>Убрать из профиля</button></div></>}
    </PersonalDialog>}
  </section>
}

export function PersonalFolderCourses({ user }) {
  return user ? <CoursesForUser key={user.id} user={user} /> : null
}
