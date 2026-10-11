import { useEffect } from 'react'
import { writeProfileValue } from '../profile/profileStorage.js'

export function useSessionCompletion(finished) {
  useEffect(() => {
    if (finished) writeProfileValue('last-session-completed', Date.now())
  }, [finished])
}
