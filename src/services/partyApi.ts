export type QueueSong = {
  id: string
  sequence: number
  status: 'queued' | 'playing'
  requestedAt: string
  song: { id: string; youtubeId: string; title: string; artist: string }
}

export type LibrarySong = { id: string; youtubeId: string; title: string; artist: string; channelTitle?: string; channelId?: string; requestable?: boolean; source?: 'local' | 'youtube'; eligible?: boolean; reviewState?: string }
export type CatalogIndex = { version: string; songs: LibrarySong[] }

const credentialKey = (code: string) => `karaoke:party:${code.trim().toUpperCase()}:credential`

async function request<T>(url: string, init: RequestInit = {}, credential?: string): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('accept', 'application/json')
  if (init.body) headers.set('content-type', 'application/json')
  if (credential) headers.set('authorization', `Bearer ${credential}`)
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

export function partyCredential(code: string) {
  try {
    return sessionStorage.getItem(credentialKey(code))
  } catch {
    return null
  }
}
export function clearPartyCredential(code: string) { try { sessionStorage.removeItem(credentialKey(code)) } catch {} }

function saveCredential(code: string, credential: string) {
  try {
    sessionStorage.setItem(credentialKey(code), credential)
  } catch {
    // Storage can be disabled; the in-memory session still works for this visit.
  }
}

export async function joinParty(code: string) {
  const result = await request<{ credential: string; expiresAt: string }>('/api/karaoke/parties/join', {
    method: 'POST',
    body: JSON.stringify({ code: code.trim().toUpperCase() }),
  })
  saveCredential(code, result.credential)
  return result
}

export function loadQueue(credential: string) {
  return request<{ expiresAt: string; queue: QueueSong[] }>('/api/karaoke/parties/queue', {}, credential)
}

export function searchSongs(credential: string, query: string) {
  const params = new URLSearchParams()
  if (query.trim()) params.set('q', query.trim())
  return request<{ songs: LibrarySong[]; total?: number }>(`/api/karaoke/parties/songs?${params}`, {}, credential)
}

const catalogCacheKey = 'karaoke:catalog:index'
export const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000
let catalogCache: CatalogIndex | null = null
let catalogCachedAt = 0

/** Normalize labels for accent/punctuation/spacing tolerant client-side matching. */
export function normalizeSearchText(value: string) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
}

export function normalizeCatalogSong(raw: Partial<LibrarySong> & { youtube_id?: string; youtubeId?: string; id?: string }): LibrarySong {
  const title = String(raw.title || '').trim() || 'Untitled song'
  const artist = String(raw.artist || '').trim() || 'Unknown artist'
  const youtubeId = String(raw.youtubeId || raw.youtube_id || '').trim()
  return { id: String(raw.id || youtubeId), youtubeId, title, artist, channelTitle: String(raw.channelTitle || ''), channelId: String(raw.channelId || ''), requestable: raw.requestable !== false, source: raw.source || 'local' }
}

function deterministicSongs(songs: LibrarySong[]) {
  return songs.map(normalizeCatalogSong).filter((song) => /^[A-Za-z0-9_-]{11}$/.test(song.youtubeId))
    .sort((a, b) => normalizeSearchText(a.title).localeCompare(normalizeSearchText(b.title)) || normalizeSearchText(a.artist).localeCompare(normalizeSearchText(b.artist)) || a.youtubeId.localeCompare(b.youtubeId))
}

export async function loadCatalogIndex(credential: string, force = false): Promise<CatalogIndex> {
  const fresh = catalogCache && Date.now() - catalogCachedAt < CATALOG_CACHE_TTL_MS
  if (!force && fresh) return catalogCache as CatalogIndex
  if (!force) {
    try {
      const cached = sessionStorage.getItem(catalogCacheKey)
      if (cached) {
        const parsed = JSON.parse(cached) as { cachedAt?: number; index?: CatalogIndex } | CatalogIndex
        if ('index' in parsed && parsed.index) { catalogCache = parsed.index; catalogCachedAt = Number(parsed.cachedAt) || 0 }
        else { catalogCache = parsed as CatalogIndex; catalogCachedAt = 0 }
      }
    } catch { /* ignore unavailable storage */ }
    if (catalogCache && Date.now() - catalogCachedAt < CATALOG_CACHE_TTL_MS) return catalogCache
  }
  try {
    const payload = await request<{ version?: string; indexVersion?: string; songs?: LibrarySong[] }>('/api/karaoke/parties/catalog', {}, credential)
    catalogCache = { version: String(payload.version || payload.indexVersion || 'v1'), songs: deterministicSongs(payload.songs || []) }
    catalogCachedAt = Date.now()
    try { sessionStorage.setItem(catalogCacheKey, JSON.stringify({ cachedAt: catalogCachedAt, index: catalogCache })) } catch { /* cache is best effort */ }
    return catalogCache
  } catch (error) {
    // A stale sanitized index is preferable to an empty search while offline.
    if (catalogCache) return catalogCache
    throw error
  }
}

/** Explicit party-scoped fallback; server owns YouTube credentials and quota. */
export function fallbackSearchSongs(credential: string, query: string) {
  return request<{ songs?: LibrarySong[]; candidates?: LibrarySong[]; quota?: 'cached' | 'live' | 'unavailable'; cached?: boolean; replay?: boolean }>('/api/karaoke/parties/songs/fallback', { method: 'POST', body: JSON.stringify({ query: query.trim().slice(0, 100) }) }, credential).then((result) => ({ ...result, songs: (result.songs || result.candidates || []).map((song) => ({ ...song, source: 'youtube' as const })) }))
}

export function requestSong(credential: string, youtubeId: string) {
  return request<QueueSong>('/api/karaoke/requests', {
    method: 'POST',
    body: JSON.stringify({ youtubeId }),
  }, credential)
}

/** Request a high-confidence cached fallback candidate through its audited party path. */
export function requestFallbackSong(credential: string, youtubeId: string, idempotencyKey: string) {
  return request<QueueSong>('/api/karaoke/parties/songs/fallback/request', {
    method: 'POST',
    body: JSON.stringify({ youtubeId, idempotencyKey }),
  }, credential)
}

/** Custom sanitized wake topic; every event is followed by an authoritative HTTPS read. */
export async function startQueueWakeHint(credential: string, reconcile: () => void) {
  const controller = new AbortController()
  const fallback = setInterval(reconcile, 30000)
  let stopped = false
  void (async () => {
    let attempt = 0
    while (!stopped) {
      try {
        const response = await fetch('/api/realtime', { headers: { authorization: `Bearer ${credential}` }, signal: controller.signal })
        if (!response.ok || !response.body) throw new Error('realtime_unavailable')
        const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let subscribed = false
        while (!stopped) {
          const chunk = await reader.read(); if (chunk.done) throw new Error('realtime_closed')
          buffer += decoder.decode(chunk.value, { stream: true })
          const frames = buffer.split(/\r?\n\r?\n/); buffer = frames.pop() || ''
          for (const frame of frames) {
           if (frame.includes('PB_CONNECT') && !subscribed) {
            const clientId = /"clientId"\s*:\s*"([^"]+)"/.exec(frame)?.[1]
            if (!clientId) throw new Error('realtime_connect_invalid')
            const subscription = await fetch('/api/realtime', { method: 'POST', headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }, body: JSON.stringify({ clientId, subscriptions: ['karaoke_party_wake'] }), signal: controller.signal })
            if (!subscription.ok) throw new Error('realtime_subscribe_rejected')
            subscribed = true; attempt = 0; reconcile()
          }
           if (subscribed && frame.includes('karaoke_party_wake')) reconcile()
          }
        }
      } catch {
        if (stopped) break
        await new Promise((resolve) => setTimeout(resolve, Math.min(30000, 500 * 2 ** attempt)))
        attempt = Math.min(attempt + 1, 6)
      }
    }
  })()
  return () => { stopped = true; controller.abort(); clearInterval(fallback) }
}
