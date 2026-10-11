import { Link } from 'react-router-dom'
import { MunchingPanda } from '../../components/MunchingPanda'
import { studyLevels } from '../../data/studyDemo'
import { TodayPanel } from './TodayPanel.jsx'

export function StudyHome({ user }) {
  return <main className="app-shell">
    <header className="topbar"><div className="brand"><span>Sino</span></div></header>
    {user ? <TodayPanel user={user} /> : <section className="study-hero" aria-labelledby="study-title">
      <div className="study-hero-copy"><h1 id="study-title">Путь в тысячу ли начинается с первого шага.</h1>
        <p className="lead">Для новичков и опытных переводчиков. Платформа для комфортного изучения китайского языка.</p>
      </div>
    </section>}
    <MunchingPanda />
    <section aria-labelledby="levels-title">
      <div className="section-heading"><h2 id="levels-title">{user ? 'Каталог курсов' : 'Выберите уровень'}</h2></div>
      <div className="levels">{studyLevels.map((level) => <Link to={`/study/${level.id}`} key={level.id} className={`level-card ${level.status === 'free' ? 'is-free' : ''}`}>
        <span className="level-meta"><strong>{level.name}</strong><span className={`label ${level.status === 'free' ? 'free' : 'available'}`}>{level.status === 'free' ? 'Бесплатно' : 'Открыто в MVP'}</span></span>
        <h3>{level.title}</h3><p>{level.description}</p>
      </Link>)}</div>
    </section>
    <section className="reading-preview" aria-labelledby="texts-title">
      <div><p className="eyebrow">Чтение</p><h2 id="texts-title">Тексты</h2><p>Короткие истории, значения по нажатию и новые слова в ваших папках.</p></div>
      <Link to="/texts" className="study-primary-button">Открыть библиотеку →</Link>
    </section>
  </main>
}
