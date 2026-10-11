import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { studyLevels } from '../../data/studyDemo.js'
import { readDailyActivity } from '../profile/localProfile.js'
import { usePersonalFolders } from '../personal/usePersonalFolders.js'
import { getDueCount } from './ankiStorage.js'
import { readKnownWordIds } from './studyStorage.js'
import { readDifficultWords, readSkillSummary } from './learningInsights.js'
import { ReadableText } from '../../components/ReadableText.jsx'

export function TodayPanel({ user }) {
  const [, refresh] = useState(0)
  const { folders, error } = usePersonalFolders(user)
  useEffect(() => {
    const changed = () => refresh((value) => value + 1)
    window.addEventListener('sino:progress-changed', changed)
    return () => window.removeEventListener('sino:progress-changed', changed)
  }, [])
  const courses = studyLevels.filter((level) => user.enrolledCourseIds.includes(level.id))
  const dueCourse = courses.find((level) => getDueCount(level.id) > 0)
  const newCourse = courses.find((level) => readKnownWordIds(level.id).size < level.totalWords)
  const topics = folders.filter((folder) => folder.enrolledAt && folder.statistics.total)
  const dueTopic = topics.find((folder) => folder.statistics.due > 0)
  const daily = readDailyActivity()
  const due = courses.reduce((sum, level) => sum + getDueCount(level.id), 0) + topics.reduce((sum, folder) => sum + folder.statistics.due, 0)
  const primary = dueCourse ? `/study/${dueCourse.id}/anki?count=15&due=1`
    : dueTopic ? `/my-cards?folder=${dueTopic.id}&practice=1&filter=due`
      : newCourse ? `/study/${newCourse.id}/learning?mode=meaning&filter=unlearned&count=5&hints=1`
        : topics[0] ? `/my-cards?folder=${topics[0].id}&practice=1` : '#levels-title'
  const difficult = courses.reduce((sum, level) => sum + readDifficultWords(level.id).length, 0)
  return <section className="today-panel" aria-labelledby="today-title">
    <p className="eyebrow">Ваш спокойный учебный ритм</p>
    <h1 id="today-title">Сегодня, <ReadableText text={user.displayName} /></h1>
    <p>{due ? 'Начнём со слов, которые подошли к повторению.' : 'Небольшое занятие — ещё один уверенный шаг.'}</p>
    <div className="today-statistics">
      <div><strong>{due}</strong><span>пора повторить</span></div>
      <div><strong>{newCourse ? Math.min(5, newCourse.totalWords - readKnownWordIds(newCourse.id).size) : 0}</strong><span>новых в коротком занятии</span></div>
      <div><strong>{daily.completedCards}</strong><span>слов HSK изучено сегодня</span></div>
    </div>
    <div className="today-actions">{primary.startsWith('#') ? <a className="study-primary-button" href={primary}>Выбрать первый курс</a> : <Link className="study-primary-button" to={primary}>Начать занятие</Link>}
      <Link className="study-secondary-button" to="/difficult">Мои трудности{difficult ? ` · ${difficult}` : ''}</Link>
      <Link className="study-secondary-button" to="/texts">Почитать</Link></div>
    {error && <p role="status">Темы временно не загрузились. Доступны занятия HSK.</p>}
    {courses.length > 0 && <div className="today-courses">{courses.map((level) => <article key={level.id}>
      <Link to={`/study/${level.id}`}>{level.name} →</Link>
      <div className="skill-indicators">{readSkillSummary(level.id).map((skill) => <div key={skill.skill}><span>{skill.label}</span><strong>{skill.successful} / {level.totalWords}</strong>
        <progress value={skill.successful} max={level.totalWords} aria-label={`${level.name}: ${skill.label}`} /></div>)}</div>
    </article>)}</div>}
    <p className="study-note">Навыки учитываются отдельно по последним проверкам. Прежние отметки «Знаю» не считаются подтверждением всех навыков.</p>
  </section>
}
