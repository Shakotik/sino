import { useState } from 'react'
import { PersonalDialog } from './PersonalDialog.jsx'
import { enrollPersonalFolder, savePersonalFolder } from './personalCardsApi.js'
import { ReadableText } from '../../components/ReadableText.jsx'

export function PersonalFolderForm({ user, folder, onSaved, onClose }) {
  const [title, setTitle] = useState(folder?.title ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  return <form className="personal-form" onSubmit={async (event) => {
    event.preventDefault()
    setSaving(true)
    try {
      const created = await savePersonalFolder(user, title, folder?.id)
      onSaved(created?.id ?? folder.id)
      onClose()
    } catch (requestError) { setError(requestError.message); setSaving(false) }
  }}>
    <label>Тема папки
      <input required minLength={2} maxLength={80} autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Например: Путешествия, Работа, Китайская кухня" />
    </label>
    <p className="personal-muted">Укажите конкретную тему. «Папка 1» не подходит. Эта тема станет названием вашего курса.</p>
    {error && <p className="personal-error" role="alert">{error}</p>}
    <button type="submit" className="personal-primary" disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить тему'}</button>
  </form>
}

export function PersonalFolders({ user, folders, selectedId, onSelect, unfiledCount }) {
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')
  const [pendingId, setPendingId] = useState(null)
  async function enroll(folder) {
    setPendingId(folder.id)
    try { await enrollPersonalFolder(user, folder.id, true); setError('') }
    catch (requestError) { setError(requestError.message) }
    finally { setPendingId(null) }
  }
  return <section className="personal-folders" aria-labelledby="personal-folders-title">
    <div className="personal-section-heading">
      <h2 id="personal-folders-title">Темы моих слов</h2>
      <button type="button" className="personal-primary" onClick={() => setEditing({})}>+ Создать папку</button>
    </div>
    <div className="personal-folder-tabs">
      <button type="button" className="personal-secondary" aria-pressed={selectedId === 'all'} onClick={() => onSelect('all')}>Все темы</button>
      {unfiledCount > 0 && <button type="button" className="personal-secondary" aria-pressed={selectedId === 'unfiled'} onClick={() => onSelect('unfiled')}>Без темы ({unfiledCount})</button>}
    </div>
    {!folders.length && <p className="personal-muted">Создайте первую тематическую папку, затем добавьте в неё слова.</p>}
    <div className="personal-folder-grid">
      {folders.map((folder) => <article className={`personal-folder ${selectedId === folder.id ? 'is-selected' : ''}`} key={folder.id}>
        <button type="button" className="personal-folder-title" aria-pressed={selectedId === folder.id} onClick={() => onSelect(folder.id)}>
          <span aria-hidden="true">▱</span><span><ReadableText text={folder.title} /></span>
        </button>
        <p>{folder.statistics.total} слов · изучено {folder.statistics.learned}</p>
        <div className="personal-actions">
          <button type="button" className="personal-secondary" onClick={() => setEditing(folder)}>Название</button>
          <button type="button" className="personal-primary" disabled={Boolean(folder.enrolledAt) || pendingId === folder.id || !folder.statistics.total}
            onClick={() => enroll(folder)}>{folder.enrolledAt ? 'Курс в профиле' : 'Взять как курс'}</button>
        </div>
      </article>)}
    </div>
    {error && <p className="personal-error" role="alert">{error}</p>}
    {editing && <PersonalDialog title={editing.id ? 'Изменить тему' : 'Создать тематическую папку'} onClose={() => setEditing(null)}>
      {(close) => <PersonalFolderForm user={user} folder={editing.id ? editing : null} onSaved={onSelect} onClose={close} />}
    </PersonalDialog>}
  </section>
}
