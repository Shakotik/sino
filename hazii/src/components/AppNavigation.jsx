import { NavLink, useLocation } from 'react-router-dom'

const destinations = [
  ['/', 'Сегодня', '◉'], ['/dictionary', 'Словарь', '⌕'],
  ['/my-cards', 'Мои слова', '▱'], ['/profile', 'Профиль', '○'],
]

export function AppNavigation({ user, onLogOut }) {
  const { pathname } = useLocation()
  // Exercises are intentionally free of global navigation. Their back button
  // remains available, so concentration mode never traps the learner.
  if (/^\/study\/hsk-\d+\/(cards|learning|knowledge|anki|writing)/u.test(pathname)) return null
  return <nav className="app-navigation" aria-label="Основные разделы">
    <NavLink to="/" className="app-navigation-brand" aria-label="Sino — главная">Sino</NavLink>
    {destinations.map(([path, label, icon]) => <NavLink key={path} end={path === '/'} to={path} className={({ isActive }) => `app-navigation-item ${isActive ? 'is-active' : ''}`}>
      <span aria-hidden="true">{icon}</span><span>{label}</span>
    </NavLink>)}
    {user && <button className="app-navigation-logout" type="button" onClick={onLogOut}>Выйти</button>}
  </nav>
}
