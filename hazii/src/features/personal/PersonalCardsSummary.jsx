import { useCallback, useEffect, useState } from 'react'
import { usePageNavigation } from '../study/usePageNavigation'
import { PersonalDialog } from './PersonalDialog'
import { fetchPersonalStatistics, PERSONAL_CARDS_CHANGED_EVENT } from './personalCardsApi'
import './personal-cards.css'

export function StatisticBar({ label, value, total, detail }) {
  const percent = total ? Math.min(100, Math.round(value / total * 100)) : 0
  return <div className="personal-statistic">
    <div><span>{label}</span><strong>{value}{total !== undefined ? ` / ${total}` : ''}</strong></div>
    <progress aria-label={label} max={100} value={percent} />
    {detail && <small>{detail}</small>}
  </div>
}

function SummaryForUser({ user }) {
  const navigate = usePageNavigation()
  const [statistics, setStatistics] = useState(null)
  const [error, setError] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const refresh = useCallback(async () => {
    try {
      setStatistics(await fetchPersonalStatistics(user))
      setError('')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setIsLoading(false)
    }
  }, [user])

  useEffect(() => {
    let isMounted = true
    fetchPersonalStatistics(user).then((result) => {
      if (!isMounted) return
      setStatistics(result)
      setError('')
      setIsLoading(false)
    }, (requestError) => {
      if (!isMounted) return
      setError(requestError.message)
      setIsLoading(false)
    })
    function collectionChanged(event) {
      if (event.detail.userId === user.id) void refresh()
    }
    window.addEventListener(PERSONAL_CARDS_CHANGED_EVENT, collectionChanged)
    return () => {
      isMounted = false
      window.removeEventListener(PERSONAL_CARDS_CHANGED_EVENT, collectionChanged)
    }
  }, [refresh, user])

  return <section className="personal-summary" aria-labelledby="personal-summary-title">
    <div className="personal-section-heading">
      <div><p className="eyebrow">Индивидуальный прогресс</p><h2 id="personal-summary-title">Мои карточки</h2></div>
      <button className="personal-secondary" type="button" onClick={() => navigate('/my-cards')}>Открыть коллекцию →</button>
    </div>
    {isLoading && !statistics && <p role="status">Загружаем статистику…</p>}
    {error && <div className="personal-error" role="alert"><p>{error}</p><button type="button" className="personal-secondary" onClick={refresh}>Повторить загрузку</button></div>}
    {statistics && <>
      <div className="personal-summary-grid">
        <StatisticBar label="Изучено" value={statistics.learned} total={statistics.total} detail="слов из вашей коллекции" />
        <StatisticBar label="На изучении" value={statistics.learning} total={statistics.total} detail="осталось освоить" />
        <StatisticBar label="Пора повторить" value={statistics.due} total={statistics.total} detail="наступил срок повторения" />
      </div>
      <button type="button" className="personal-text-button" onClick={() => setIsOpen(true)}>Подробная статистика ↗</button>
    </>}
    {isOpen && statistics && <PersonalDialog title="Прогресс по своим словам" onClose={() => setIsOpen(false)}>
      <div className="personal-detail-statistics">
        <StatisticBar label="Всего карточек" value={statistics.total} total={statistics.total} />
        <StatisticBar label="Изучено" value={statistics.learned} total={statistics.total} />
        <StatisticBar label="На изучении" value={statistics.learning} total={statistics.total} />
        <StatisticBar label="Пора повторить" value={statistics.due} total={statistics.total} />
        <StatisticBar label="Правильные самооценки" value={statistics.correctAnswers} total={statistics.attempts} detail={`${statistics.accuracy}% ответов отмечено «Помню» или «Легко»`} />
      </div>
      <p className="personal-muted">Ещё не повторяли: {statistics.new}. {statistics.lastReviewedAt
        ? `Последнее повторение: ${new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(statistics.lastReviewedAt))}.`
        : 'Статистика появится после первого занятия.'}</p>
    </PersonalDialog>}
  </section>
}

export function PersonalCardsSummary({ user }) {
  return user ? <SummaryForUser key={user.id} user={user} /> : null
}
