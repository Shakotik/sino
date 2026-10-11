import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePersonalFolders } from './usePersonalFolders.js'
import { savePersonalCard, savePersonalFolder } from './personalCardsApi.js'

// A dictionary article is not automatically a flashcard. The learner chooses
// a concise sense, and the original article remains available in the dictionary.
export function SaveDictionaryWord({ user, entry, context = '' }) {
  const fieldId = useId()
  const { folders, error: foldersError } = usePersonalFolders(user)
  const [folderId, setFolderId] = useState('')
  const [title, setTitle] = useState('')
  const [meaning, setMeaning] = useState('')
  const [notes, setNotes] = useState(context.slice(0, 2000))
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  return <details className="dictionary-save-word">
    <summary>Добавить в мои слова</summary>
    {saved ? <p role="status">Карточка сохранена. <Link to={`/my-cards?folder=${folderId}`}>Открыть папку →</Link></p> : <form className="personal-form" onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setStatus('')
      try {
        let destination = folderId
        if (destination === 'new') { const folder = await savePersonalFolder(user, title); destination = folder.id; setFolderId(destination) }
        await savePersonalCard(user, { hanzi: entry.headword, pinyin: entry.pinyin || '', translationRu: meaning, notes, folderId: destination })
        setSaved(true)
      } catch (error) { setStatus(error.message) } finally { setBusy(false) }
    }}>
      <p>Выберите одно нужное значение из статьи ниже и впишите его кратко. Полная статья не будет автоматически добавлена на карточку.</p>
      {foldersError && <p role="alert">Не удалось загрузить папки. Проверьте соединение и откройте статью заново.</p>}
      <label><span id={`${fieldId}-meaning`}>Значение для карточки</span><textarea aria-labelledby={`${fieldId}-meaning`} required rows={2} maxLength={1000} value={meaning} onChange={(event) => setMeaning(event.target.value)} placeholder="Например: учиться; изучать" /></label>
      <label><span id={`${fieldId}-folder`}>Тематическая папка</span><select aria-labelledby={`${fieldId}-folder`} required value={folderId} onChange={(event) => setFolderId(event.target.value)}>
        <option value="">Выберите тему</option>{folders.map((folder) => <option value={folder.id} key={folder.id}>{folder.title}</option>)}<option value="new">+ Новая тема</option>
      </select></label>
      {folderId === 'new' && <label><span id={`${fieldId}-title`}>Тема новой папки</span><input aria-labelledby={`${fieldId}-title`} required minLength={2} maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Например: Учёба" /></label>}
      <label><span id={`${fieldId}-context`}>Пример из текста</span><textarea aria-labelledby={`${fieldId}-context`} rows={3} value={notes} maxLength={2000} onChange={(event) => setNotes(event.target.value)} /></label>
      {status && <p className="personal-error" role="alert">{status}</p>}
      <button type="submit" className="personal-primary" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить в папку'}</button>
    </form>}
  </details>
}
