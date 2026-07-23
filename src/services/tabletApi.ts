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

export type CatalogSong = {
  id: string
  youtubeId: string
  title: string
  artist: string
  eligible?: boolean
  classification?: string
  classificationConfidence?: number
  alternativeCount?: number
  classificationReason?: string
  source?: string
  sourceId?: string
  sourceList?: string
  sourceRank?: number
  identityStatus?: 'verified_source' | 'operator_corrected' | 'missing' | 'uncertain'
  identityReason?: string
  videoTitle?: string
  videoChannelTitle?: string
  videoChannelId?: string
  reviewState: 'unreviewed' | 'needs_review' | 'approved' | 'rejected'
  reviewNote?: string
}

export type CatalogReport = {
  total: number
  bySource: Record<string, number>
  byClassification: Record<string, number>
  byReviewState: Record<string, number>
  byIdentityStatus: Record<string, number>
  byDecade: Record<string, number>
  byConfidenceBand: Record<string, number>
  missingIdentity: number
  unavailable: number
  alternatives: number
  unresolvedReviewBacklog: number
}

export type PlaylistImportPreview = {
  source: { sourceKey: string; channelName: string; playlistName: string; rationale: string }
  expectedItems: number
  pageToken: string
  nextPageToken: string
  snapshotFingerprint: string
  modeledCost: { playlistsList: number; playlistItemsList: number; videosList: number; total: number }
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

export function bindAvailableController(token: string, partyId: string) {
  return request<{ partyId: string; bound: boolean }>('/api/karaoke/tablet/controller/bind', {
    method: 'POST',
    body: JSON.stringify({ partyId }),
  }, token)
}

export function issuePlaybackCommand(
  token: string,
  partyId: string,
  action: 'play' | 'pause',
  idempotencyKey: string,
) {
  return request<{ id: string; action: 'play' | 'pause'; sequence: number; status: string; idempotent?: boolean }>(
    '/api/karaoke/tablet/controller/playback',
    {
      method: 'POST',
      body: JSON.stringify({ partyId, action, idempotencyKey }),
    },
    token,
  )
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

export function loadCatalog(token: string, options: { review?: CatalogSong['reviewState']; classification?: string; page?: number; perPage?: number } = {}) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(options)) if (value) params.set(key, String(value))
  return request<{ songs: CatalogSong[]; page: number; perPage: number; totalItems: number; totalPages: number }>(
    `/api/karaoke/tablet/catalog${params.toString() ? `?${params}` : ''}`, {}, token,
  )
}

export function reviewCatalogSong(token: string, id: string, reviewState: CatalogSong['reviewState'], note?: string) {
  return request<CatalogSong>(`/api/karaoke/tablet/catalog/${encodeURIComponent(id)}/review`, {
    method: 'POST',
    body: JSON.stringify({ reviewState, ...(note?.trim() ? { note: note.trim() } : {}) }),
  }, token)
}

export function approveCatalogSongs(token: string, ids: string[]) {
  return request<{ approved: number; ids: string[]; batchId: string }>('/api/karaoke/tablet/catalog/review/batch', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  }, token)
}

export function correctCatalogIdentity(token: string, id: string, correction: { title: string; artist: string; reason: string }) {
  return request<CatalogSong>(`/api/karaoke/tablet/catalog/${encodeURIComponent(id)}/identity`, {
    method: 'POST',
    body: JSON.stringify(correction),
  }, token)
}

export function loadCatalogReport(token: string) {
  return request<CatalogReport>('/api/karaoke/tablet/catalog/report', {}, token)
}

export function previewTrustedPlaylist(token: string, sourceKey: string, maxItems = 25) {
  return request<PlaylistImportPreview>('/api/karaoke/tablet/catalog/playlists/import', {
    method: 'POST',
    body: JSON.stringify({ sourceKey, maxItems, dryRun: true }),
  }, token)
}

export function importTrustedPlaylist(token: string, sourceKey: string, snapshotFingerprint: string, maxItems = 25, pageToken = '') {
  return request<{ imported: number; duplicates: number; unavailable: number; nextPageToken: string }>(
    '/api/karaoke/tablet/catalog/playlists/import',
    { method: 'POST', body: JSON.stringify({ sourceKey, snapshotFingerprint, maxItems, pageToken, dryRun: false }) }, token,
  )
}

export function replaceCatalogSong(token: string, id: string, candidate: { candidateId?: string; youtubeId?: string }) {
  return request<CatalogSong>(`/api/karaoke/tablet/catalog/${encodeURIComponent(id)}/replace`, {
    method: 'POST',
    body: JSON.stringify(candidate),
  }, token)
}
