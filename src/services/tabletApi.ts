export type TabletQueueItem = {
  id: string
  sequence: number
  status: 'queued' | 'playing' | 'completed' | 'failed'
  failureReason?: string
  requestedAt?: string
  song?: { id: string; youtubeId: string; title: string; artist: string }
}

export type TabletStatus = {
  party: { id: string; code?: string; codeHint?: string; expiresAt: string; status?: string; joinCount?: number }
  queue: TabletQueueItem[]
  controller?: {
    connected: boolean
    connectionState: string
    device?: { id: string; name: string; lastSeenAt?: string | null } | null
    state?: { playerState?: string; videoId?: string | null; observedAt?: string | null } | null
  } | null
}

async function request<T>(url: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('accept', 'application/json')
  if (init.body) headers.set('content-type', 'application/json')
  if (token) headers.set('authorization', `Bearer ${token}`)
  const response = await fetch(url, { ...init, headers })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.message || 'Request failed') as Error & { code?: string; status?: number }
    error.code = payload.error
    error.status = response.status
    throw error
  }
  return payload as T
}

export function authenticateTablet(identity: string, password: string) {
  return request<{ token: string; record?: { id: string; role?: string } }>('/api/collections/users/auth-with-password', {
    method: 'POST',
    body: JSON.stringify({ identity: identity.trim(), password }),
  })
}

export function createParty(token: string) {
  return request<{ id: string; code: string; expiresAt: string }>('/api/karaoke/parties', { method: 'POST', body: '{}' }, token)
}

export function loadTabletStatus(token: string, partyId: string) {
  const params = new URLSearchParams({ partyId })
  return request<TabletStatus>(`/api/karaoke/tablet/status?${params}`, {}, token)
}

export function loadActiveParty(token: string) {
  return request<{ party: TabletStatus['party'] | null }>('/api/karaoke/tablet/active', {}, token)
}

export function loadNext(token: string, partyId: string) {
  const params = new URLSearchParams({ partyId })
  return request<{ queue: TabletQueueItem | null }>(`/api/karaoke/queue/next?${params}`, {}, token)
}

export function transitionQueue(token: string, queueId: string, from: TabletQueueItem['status'], to: 'playing' | 'completed' | 'failed', failureReason?: string) {
  return request<{ id: string; status: string; idempotent?: boolean }>('/api/karaoke/queue/transition', {
    method: 'POST',
    body: JSON.stringify({ queueId, from, to, ...(failureReason ? { failureReason } : {}) }),
  }, token)
}
