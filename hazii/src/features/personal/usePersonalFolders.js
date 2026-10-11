import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchPersonalFolders, PERSONAL_CARDS_CHANGED_EVENT } from './personalCardsApi.js'

export function usePersonalFolders(user) {
  const [folders, setFolders] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const requestVersion = useRef(0)
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current
    try {
      const result = await fetchPersonalFolders(user)
      if (version !== requestVersion.current) return
      setFolders(result)
      setError('')
    } catch (requestError) {
      if (version === requestVersion.current) setError(requestError.message)
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [user])
  useEffect(() => {
    const version = ++requestVersion.current
    fetchPersonalFolders(user).then((result) => {
      if (version !== requestVersion.current) return
      setFolders(result)
      setError('')
      setLoading(false)
    }, (requestError) => {
      if (version !== requestVersion.current) return
      setError(requestError.message)
      setLoading(false)
    })
    function changed(event) { if (event.detail.userId === user.id) void refresh() }
    window.addEventListener(PERSONAL_CARDS_CHANGED_EVENT, changed)
    return () => { requestVersion.current += 1; window.removeEventListener(PERSONAL_CARDS_CHANGED_EVENT, changed) }
  }, [refresh, user])
  return { folders, error, loading, refresh }
}
