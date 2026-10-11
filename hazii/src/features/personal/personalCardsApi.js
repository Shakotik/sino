const API_ROOT = '/api/personal'
const pendingAccounts = new Map()
export const PERSONAL_CARDS_CHANGED_EVENT = 'sino:personal-cards-changed'

async function request(path, { token, ...options } = {}) {
  let response
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      ...options,
      signal: AbortSignal.timeout(12_000),
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
  } catch {
    throw new Error('Не удалось получить подтверждение от сервера. Проверьте соединение. Перед повторным созданием карточки обновите коллекцию; оценку ответа можно безопасно отправить повторно.')
  }
  const payload = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.message ?? 'Не удалось выполнить действие. Попробуйте ещё раз.')
  return payload
}

// A local profile ID only selects a browser-held key. The server authenticates
// the random secret, never a client-supplied user ID or email address.
async function accountFor(user) {
  if (!user?.id) throw new Error('Сначала создайте личный кабинет.')
  const storageKey = `sino:personal-account:${user.id}`
  let account
  try {
    account = JSON.parse(window.localStorage.getItem(storageKey) ?? 'null')
  } catch {
    throw new Error('Не удалось прочитать ключ коллекции в этом браузере.')
  }
  if (account?.token) return account
  if (!pendingAccounts.has(user.id)) {
    async function provisionAccount() {
      // Another open tab may have provisioned the account while this tab waited.
      const savedAccount = JSON.parse(window.localStorage.getItem(storageKey) ?? 'null')
      if (savedAccount?.token) return savedAccount
      const newAccount = await request('/accounts', { method: 'POST' })
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(newAccount))
      } catch {
        throw new Error('Разрешите сохранение данных сайта в браузере, чтобы не потерять доступ к карточкам.')
      }
      return newAccount
    }
    const operation = navigator.locks?.request
      ? navigator.locks.request(storageKey, provisionAccount)
      : provisionAccount()
    const provision = operation.finally(() => pendingAccounts.delete(user.id))
    pendingAccounts.set(user.id, provision)
  }
  return pendingAccounts.get(user.id)
}

async function authenticatedRequest(user, path, options) {
  const account = await accountFor(user)
  return request(path, { ...options, token: account.token })
}

function notifyCollectionChanged(user) {
  window.dispatchEvent(new CustomEvent(PERSONAL_CARDS_CHANGED_EVENT, { detail: { userId: user.id } }))
}

export async function fetchPersonalCards(user) {
  return (await authenticatedRequest(user, '/cards')).cards
}

export async function fetchPersonalStatistics(user) {
  return (await authenticatedRequest(user, '/statistics')).statistics
}

export async function fetchPersonalFolders(user) {
  return (await authenticatedRequest(user, '/folders')).folders
}

export async function savePersonalFolder(user, title, folderId) {
  const result = await authenticatedRequest(user, folderId ? `/folders/${folderId}` : '/folders', {
    method: folderId ? 'PATCH' : 'POST', body: JSON.stringify({ title }),
  })
  notifyCollectionChanged(user)
  return result.folder
}

export async function enrollPersonalFolder(user, folderId, enrolled) {
  await authenticatedRequest(user, `/folders/${folderId}/enrollment`, { method: 'PUT', body: JSON.stringify({ enrolled }) })
  notifyCollectionChanged(user)
}

export async function movePersonalCards(user, folderId, cardIds) {
  await authenticatedRequest(user, `/folders/${folderId}/move-cards`, { method: 'POST', body: JSON.stringify({ cardIds }) })
  notifyCollectionChanged(user)
}

export async function savePersonalCard(user, card, cardId) {
  const result = await authenticatedRequest(user, cardId ? `/cards/${cardId}` : '/cards', {
    method: cardId ? 'PATCH' : 'POST', body: JSON.stringify(card),
  })
  notifyCollectionChanged(user)
  return result
}

export async function deletePersonalCard(user, cardId) {
  await authenticatedRequest(user, `/cards/${cardId}`, { method: 'DELETE' })
  notifyCollectionChanged(user)
}

export async function reviewPersonalCard(user, cardId, grade, requestId) {
  const result = await authenticatedRequest(user, `/cards/${cardId}/reviews`, {
    method: 'POST', body: JSON.stringify({ grade, requestId }),
  })
  notifyCollectionChanged(user)
  return result.review
}
