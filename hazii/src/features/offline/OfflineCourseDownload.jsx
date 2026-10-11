import { useEffect, useRef, useState } from 'react'
import { downloadOfflineCourse, listOfflineCourses, removeOfflineCourse } from './offlineCourses.js'

const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} МБ`

export function OfflineCourseDownload({ levelId }) {
  const [saved, setSaved] = useState(null)
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState('')
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine)
  const request = useRef(null)
  useEffect(() => {
    let active = true
    listOfflineCourses().then((courses) => { if (active) setSaved(courses.find((course) => course.levelId === levelId) ?? null) }).catch(() => { if (active) setError('Хранилище браузера недоступно.') })
    const changeNetwork = () => setOnline(navigator.onLine)
    window.addEventListener('online', changeNetwork)
    window.addEventListener('offline', changeNetwork)
    return () => {
      active = false
      request.current?.abort()
      window.removeEventListener('online', changeNetwork)
      window.removeEventListener('offline', changeNetwork)
    }
  }, [levelId])

  async function download() {
    const controller = new AbortController()
    request.current = controller
    setError(''); setProgress({ completed: 0, total: 1, bytes: 0 })
    try {
      const result = await downloadOfflineCourse(levelId, { signal: controller.signal, onProgress: setProgress })
      setSaved(result)
    } catch (problem) {
      if (problem.name !== 'AbortError') setError(problem.message)
    } finally { setProgress(null); request.current = null }
  }

  return <section className="offline-course" aria-label="Занятия без интернета">
    <h2>Курс с собой</h2>
    <p>{online ? 'Подключение есть.' : 'Вы без интернета.'} {saved ? `Курс сохранён: ${megabytes(saved.bytes)} · ${saved.words} слов, ${saved.characters} знаков.` : 'Сохраните карточки, задания и данные прописей на этом устройстве.'}</p>
    {progress ? <div role="status"><progress value={progress.completed} max={progress.total} aria-label="Загрузка курса" /><p>Загружено {progress.completed} из {progress.total} файлов · {megabytes(progress.bytes)}</p><button type="button" className="study-secondary-button" onClick={() => request.current?.abort()}>Отменить загрузку</button></div> : <div className="today-actions">
      <button type="button" className="study-secondary-button" disabled={!online || !import.meta.env.PROD} onClick={download}>{saved ? 'Обновить копию курса' : 'Скачать для занятий без интернета'}</button>
      {saved && <button type="button" className="study-secondary-button" onClick={async () => { try { await removeOfflineCourse(levelId); setSaved(null); setError('') } catch { setError('Не удалось удалить копию.') } }}>Удалить загрузку</button>}
    </div>}
    {error && <p role="alert">{error}</p>}
    <p className="study-note">{!import.meta.env.PROD && 'Скачивание доступно в собранной версии сайта. '}Прогресс хранится в этом браузере, удаление загрузки его не сбрасывает. Словарь, личные папки и некоторые голоса требуют интернета. Браузер может очистить файлы при нехватке места.</p>
  </section>
}
