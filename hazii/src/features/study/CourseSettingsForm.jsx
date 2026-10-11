import { useState } from 'react'
import { requestStudyNotifications, downloadReviewCalendar } from './reminderNotifications'
import { LearningReminderSettings } from './LearningReminderSettings'

export function CourseSettingsForm({ section, initialSettings, onStart, user, levelId }) {
  const [settings, setSettings] = useState(initialSettings)
  const [notificationStatus, setNotificationStatus] = useState('')
  function update(key, value) { setSettings((current) => ({ ...current, [key]: value })) }
  const isExercise = ['learning', 'knowledge', 'settings'].includes(section)
  const isWriting = section === 'writing' || (isExercise && settings.mode === 'writing')
  const isMemoryOnly = section === 'knowledge' || (section === 'writing' && settings.writingPractice === 'memory')

  return <form className="study-options" onSubmit={(event) => { event.preventDefault(); onStart(settings) }}>
    {section === 'personal' ? <>
      <p>Создавайте карточки с иероглифами, пиньинем и своими вариантами перевода. Прогресс личного набора отображается отдельно в профиле.</p>
      <p>{user ? `Набор профиля «${user.displayName}». Карточки сохраняются в базе данных.` : 'Для создания собственного набора сначала потребуется создать профиль.'}</p>
      <button type="submit" className="study-primary">Открыть мои карточки</button>
    </> : <>
      {isExercise && <label>Как будем заниматься?
        <select value={settings.mode} onChange={(event) => update('mode', event.target.value)}>
          <option value="meaning">Иероглиф → перевод на русский</option><option value="typing">Перевод → ввод иероглифов</option><option value="listening">На слух → значение</option><option value="writing">Прописи с проверкой порядка черт</option>
        </select>
      </label>}
      {section === 'writing' && <label>Режим прописей
        <select value={settings.writingPractice} onChange={(event) => update('writingPractice', event.target.value)}>
          <option value="learn">Изучение</option>
          <option value="memory">Проверка знаний</option>
        </select>
      </label>}
      {section !== 'words' && <label>Слов за занятие<input type="number" min="1" max="100" required value={settings.count} onChange={(event) => update('count', event.target.value)} /></label>}
      <details className="study-advanced-options" open={section === 'settings' || section === 'words'}><summary>Дополнительно</summary>
      {isWriting && !isMemoryOnly && <>
        <label>Иероглифов в серии
          <input type="number" min="1" max="10" step="1" required value={settings.writingBatchSize} onChange={(event) => update('writingBatchSize', event.target.value)} aria-describedby="writing-batch-help" />
        </label>
        <p id="writing-batch-help">Сначала обведите выбранное количество иероглифов, затем напишите эту же серию по памяти. Начните с 1: трафарет сразу сменится пустым полем. В конце занятия серия может быть короче.</p>
      </>}
      {isWriting && <p>Каждый знак слова пишется отдельно, слева направо. Проверяем форму, направление и порядок черт. Слово засчитывается только после самостоятельного написания всех его иероглифов.</p>}
      <label>Какие слова включить?<select value={settings.filter} onChange={(event) => update('filter', event.target.value)}>
        <option value="all">Все слова</option><option value="unlearned">Неизученные слова</option><option value="learned">Изученные слова</option>
      </select></label>
      {section !== 'words' && <div className="study-option-pair">
        {section === 'anki' ? <label>Новых в день<input type="number" min="0" max="100" required value={settings.newPerDay} onChange={(event) => update('newPerDay', event.target.value)} /></label> : <label>Порядок<select value={settings.order} onChange={(event) => update('order', event.target.value)}><option value="sequential">По списку</option><option value="shuffle">Вперемешку</option></select></label>}
      </div>}
      {isExercise && !isWriting && section !== 'knowledge' && <label className="study-checkbox"><input type="checkbox" checked={settings.hints} onChange={(event) => update('hints', event.target.checked)} />Подсказки во время обучения</label>}
      {section === 'knowledge' && <p>При вводе и в прописях ответ скрыт. Результат появится после вашей попытки. Подсказки отключены.</p>}
      {(section === 'learning' || section === 'settings') && <LearningReminderSettings levelId={levelId} settings={settings} onChange={update} />}
      {(section === 'anki' || section === 'settings') && <>
        <label className="study-checkbox"><input type="checkbox" checked={settings.reminders} onChange={(event) => update('reminders', event.target.checked)} />Напоминать о повторении ANKI</label>
        <p>Напоминание появится, когда подойдёт срок повторения. Системные уведомления работают, пока Sino открыт. Для закрытого приложения добавьте ежедневное напоминание в календарь.</p>
        <button type="button" className="study-secondary" onClick={async () => { setNotificationStatus(await requestStudyNotifications()); update('reminders', true) }}>Разрешить системные уведомления</button>
        <button type="button" className="study-secondary" onClick={() => { downloadReviewCalendar(); setNotificationStatus('Откройте скачанный файл и подтвердите импорт в календарь. Напоминание: ежедневно в 18:00, начиная с завтра.') }}>В календарь: ежедневно в 18:00</button>
        {notificationStatus && <p role="status">{notificationStatus}</p>}
      </>}
      </details>
      <button type="submit" className="study-primary">{section === 'settings' ? 'Сохранить настройки' : section === 'words' ? 'Открыть список' : 'Начать занятие'}</button>
    </>}
  </form>
}
