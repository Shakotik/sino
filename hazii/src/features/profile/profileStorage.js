// Local learning data belongs to a profile, including when several people
// use the same browser. Server-backed personal cards have their own API.
export function profileStorageKey(suffix) {
  let profileId = 'guest'
  try {
    profileId = JSON.parse(localStorage.getItem('sino:profile') || 'null')?.id || 'guest'
  } catch { /* A damaged profile must never expose another profile's data. */ }
  return `sino:user:${profileId}:${suffix}`
}

export function readProfileValue(suffix, fallback, legacyKey) {
  try {
    const key = profileStorageKey(suffix)
    const current = localStorage.getItem(key)
    if (current !== null) return JSON.parse(current)
    // Adopt pre-account progress once, for the existing owner only.
    const legacyOwner = localStorage.getItem('sino:legacy-progress-owner')
    const owner = key.split(':')[2]
    if (legacyKey && (!legacyOwner || legacyOwner === owner)) {
      const legacy = localStorage.getItem(legacyKey)
      if (legacy !== null) {
        const parsed = JSON.parse(legacy)
        localStorage.setItem('sino:legacy-progress-owner', owner)
        localStorage.setItem(key, legacy)
        return parsed
      }
    }
  } catch { /* Unreadable browser storage is treated as an empty history. */ }
  return fallback
}

export function writeProfileValue(suffix, value) {
  localStorage.setItem(profileStorageKey(suffix), JSON.stringify(value))
  window.dispatchEvent(new Event('sino:progress-changed'))
}

// Notify React only after all related counters have changed, so a reset never
// renders a mixture of old course statistics and a new calendar.
export function writeProfileValues(values, expectedProfileId) {
  const prefix = profileStorageKey('')
  if (expectedProfileId && prefix !== `sino:user:${expectedProfileId}:`) {
    throw new Error('Профиль изменился. Обновите страницу и повторите действие.')
  }
  for (const [suffix, value] of Object.entries(values)) {
    localStorage.setItem(`${prefix}${suffix}`, JSON.stringify(value))
  }
  window.dispatchEvent(new Event('sino:progress-changed'))
}

export function readProfileArray(suffix, legacyKey) {
  const value = readProfileValue(suffix, [], legacyKey)
  return Array.isArray(value) ? value : []
}
