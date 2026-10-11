import './App.css'
import './features/study/course-workspace.css'
import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { HskCourseCards } from './features/study/HskCourseCards'
import { HskCourseHub } from './features/study/HskCourseHub'
import { StudyHome } from './features/study/StudyHome'
import { CourseWritingSession, LegacyWritingRedirect } from './features/writing/CourseWritingSession'
import { ProfilePage } from './features/profile/ProfilePage'
import { DictionaryPage } from './features/dictionary/DictionaryPage'
import { StudySession } from './features/study/StudySession'
import { AnkiSession } from './features/study/AnkiSession'
import { CourseWordList } from './features/study/CourseWordList'
import { MyCardsPage } from './features/personal/MyCardsPage'
import { AnkiReminders } from './features/study/AnkiReminders'
import { createLocalProfile, readLocalProfile, removeLocalProfile, resumeLocalProfile, saveLocalProfile } from './features/profile/localProfile'
import { AppNavigation } from './components/AppNavigation.jsx'
import { DifficultWordsPage } from './features/study/DifficultWordsPage.jsx'
import { ReadingPage } from './features/study/ReadingPage.jsx'

function PageTransition({ children }) {
  const location = useLocation()

  return (
    <div key={location.pathname} className="page-transition">
      {children}
    </div>
  )
}

function getInitialTheme() {
  // The first visit starts in the requested dark theme. Afterwards the choice
  // belongs to this browser and is remembered through a page refresh.
  return window.localStorage.getItem('sino:theme') === 'light' ? 'light' : 'dark'
}

function App() {
  const location = useLocation()
  const concentration = /^\/study\/hsk-\d+\/(cards|learning|knowledge|anki|writing)/u.test(location.pathname)
  const [theme, setTheme] = useState(getInitialTheme)
  const [user, setUser] = useState(readLocalProfile)

  useEffect(() => {
    function syncProfile(event) {
      if (event.key === 'sino:profile') setUser(readLocalProfile())
    }
    window.addEventListener('storage', syncProfile)
    return () => window.removeEventListener('storage', syncProfile)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    window.localStorage.setItem('sino:theme', theme)
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      'content',
      theme === 'dark' ? '#15191b' : '#f7f1eb',
    )
  }, [theme])

  const isDarkTheme = theme === 'dark'

  function registerUser(details) {
    setUser(createLocalProfile(details))
  }

  function updateUser(nextUser) {
    saveLocalProfile(nextUser)
    setUser(nextUser)
  }

  function logOutUser() {
    removeLocalProfile()
    setUser(null)
  }

  function enrollUserInCourse(courseId) {
    if (!user || user.enrolledCourseIds.includes(courseId)) return

    updateUser({
      ...user,
      enrolledCourseIds: [...user.enrolledCourseIds, courseId],
    })
  }

  // Routes decide which complete page a person sees for the current URL.
  return (
    <>
      <button
        className="theme-toggle"
        type="button"
        aria-label={isDarkTheme ? 'Включить светлую тему' : 'Включить тёмную тему'}
        title={isDarkTheme ? 'Светлая тема' : 'Тёмная тема'}
        onClick={() => setTheme(isDarkTheme ? 'light' : 'dark')}
      >
        <span aria-hidden="true">{isDarkTheme ? '☀' : '☾'}</span>
        <span>{isDarkTheme ? 'Светло' : 'Темно'}</span>
      </button>

      <AppNavigation user={user} onLogOut={logOutUser} />
      <div className={`sino-workspace ${concentration ? 'is-concentrating' : ''}`}>
      <Routes key={user?.id ?? 'guest'}>
        <Route path="/" element={<PageTransition><StudyHome user={user} onLogOut={logOutUser} /></PageTransition>} />
        <Route
          path="/profile"
          element={(
            <PageTransition>
              <ProfilePage user={user} onRegister={registerUser} onUpdate={updateUser} onLogOut={logOutUser} onResume={(profileId) => setUser(resumeLocalProfile(profileId))} />
            </PageTransition>
          )}
        />
        <Route
          path="/study/:levelId"
          element={<PageTransition><HskCourseHub user={user} onEnroll={enrollUserInCourse} /></PageTransition>}
        />
        <Route path="/study/:levelId/cards" element={<PageTransition><HskCourseCards /></PageTransition>} />
        <Route path="/study/:levelId/anki" element={<PageTransition><AnkiSession /></PageTransition>} />
        <Route path="/study/:levelId/words" element={<PageTransition><CourseWordList /></PageTransition>} />
        <Route path="/study/:levelId/writing" element={<PageTransition><CourseWritingSession /></PageTransition>} />
        <Route path="/study/:levelId/:activity" element={<PageTransition><StudySession /></PageTransition>} />
        <Route path="/my-cards" element={<PageTransition><MyCardsPage user={user} /></PageTransition>} />
        <Route path="/writing" element={<Navigate to="/" replace />} />
        <Route path="/writing/:levelId" element={<LegacyWritingRedirect />} />
        <Route path="/dictionary" element={<PageTransition><DictionaryPage user={user} /></PageTransition>} />
        <Route path="/difficult" element={<PageTransition><DifficultWordsPage /></PageTransition>} />
        <Route path="/texts" element={<PageTransition><ReadingPage user={user} /></PageTransition>} />
        <Route path="/texts/:textId" element={<PageTransition><ReadingPage user={user} /></PageTransition>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </div>
      <AnkiReminders user={user} />
    </>
  )
}

export default App
