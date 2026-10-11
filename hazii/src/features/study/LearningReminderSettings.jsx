import { useState } from 'react'
import { findStudyLevel } from '../../data/studyDemo'
import { normalizeLearningReminder } from './learningReminderSchedule'
import { requestStudyNotifications, downloadReviewCalendar } from './reminderNotifications'
import { saveCourseSettings } from './studyStorage'

export function LearningReminderSettings({ levelId, settings, onChange }) {
  const [status, setStatus] = useState('')
  const [requesting, setRequesting] = useState(false)

  function saveReminder() {
    try {
      const reminder = normalizeLearningReminder(settings)
      saveCourseSettings(levelId, reminder)
      setStatus(reminder.learningReminders ? `Напоминание сохранено: ежедневно в ${reminder.learningReminderTime}, цель — ${reminder.learningDailyGoal} слов.` : 'Напоминание об изучении отключено.')
    } catch { setStatus('Не удалось сохранить настройки в браузере. Проверьте доступ к хранилищу.') }
  }

  async function enableNotifications() {
    setRequesting(true)
    try { setStatus(await requestStudyNotifications()) }
    finally { setRequesting(false) }
  }

  function addCalendar() {
    const reminder = normalizeLearningReminder(settings)
    const [hour, minute] = reminder.learningReminderTime.split(':').map(Number)
    downloadReviewCalendar({ levelId, levelName: findStudyLevel(levelId)?.name, kind: 'learning', goal: reminder.learningDailyGoal, hour, minute })
    setStatus(`Откройте скачанный файл и подтвердите импорт. Календарь напомнит ежедневно в ${reminder.learningReminderTime}, начиная с завтра. Удалять и менять это событие нужно в самом календаре.`)
  }

  return <fieldset className="learning-reminder-settings">
    <legend>Напоминания об изучении</legend>
    <label className="study-checkbox"><input type="checkbox" checked={settings.learningReminders} onChange={(event) => onChange('learningReminders', event.target.checked)} />Напоминать выучить слова</label>
    {settings.learningReminders && <>
      <div className="study-option-pair">
        <label>Время<input type="time" required value={settings.learningReminderTime} onChange={(event) => onChange('learningReminderTime', event.target.value)} /></label>
        <label>Новых слов в день<input type="number" min="1" max="100" step="1" required value={settings.learningDailyGoal} onChange={(event) => onChange('learningDailyGoal', event.target.value)} /></label>
      </div>
      <p>Время — по вашему устройству. После выполнения дневной цели напоминание не появится. Системные уведомления работают, пока Sino открыт; фоновая вкладка может задержать показ.</p>
      <button type="button" className="study-secondary" disabled={requesting} onClick={enableNotifications}>{requesting ? 'Проверяем разрешение…' : 'Разрешить системные уведомления'}</button>
      <button type="button" className="study-secondary" onClick={addCalendar}>Добавить в календарь для закрытого Sino</button>
    </>}
    <button type="button" className="study-secondary" disabled={!levelId} onClick={saveReminder}>Сохранить напоминания</button>
    {status && <p role="status">{status}</p>}
  </fieldset>
}
