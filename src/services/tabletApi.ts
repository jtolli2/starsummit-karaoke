export type TabletQueueItem = {
  id: string
  sequence: number
  status: 'queued' | 'playing' | 'completed' | 'failed'
  failureReason?: string
  requestedAt?: string
  requesterLabel?: string
  fairPosition?: number
  song?: { id: string; youtubeId: string; title: string; artist: string }
}

export type TabletStatus = {
  party: {
    id: string
    code?: string
    codeHint?: string
    expiresAt: string
    status?: string
    joinCount?: number
  }
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
  playlistSourceId?: string
  playlistSnapshotFingerprint?: string
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
  modeledCost: {
    playlistsList: number
    playlistItemsList: number
    videosList: number
    total: number
  }
}

export type PublicPlaylistPreview = PlaylistImportPreview & {
  playlistName?: string
  ownerChannelTitle?: string
  visibility?: string
  itemCount?: number
  expectedQuota?: number
  identityWarning?: string
  source: PlaylistImportPreview['source'] & { policyVersion?: string }
  playlist?: { id: string; title: string; visibility?: string; itemCount?: number; hiddenCount?: number }
  owner?: { channelId: string; title: string; avatarUrl?: string }
  trust?: 'known_parser' | 'admin_confirmed_public' | 'unknown_public'
  knownParser?: boolean
  quota?: { expectedUnits: number; spentUnits?: number; cached?: boolean }
  confirmationToken?: string
  confirmationId?: string
  expiresAt?: string
  importCap?: number
  duplicateEstimate?: number
  unavailableEstimate?: number
  warning?: string
}

export type ApprovalSelectionSnapshot = {
  selectionId: string
  digest?: string
  source?: string
  filter?: Record<string, string>
  selectedCount: number
  excludedCount?: number
  exclusions?: Record<string, number>
  recordIds?: string[]
  expiresAt?: string
}

export type PlaylistUnavailableReasons = {
  total: number
  metadataMissing: number
  nonEmbeddable: number
  privacy: Record<string, number>
  uploadStatus: Record<string, number>
}

export type LegacyPlaylistJob = {
  jobKey: string
  playlistId: string
  bindingKind?: string
  inputDigest?: string
  status: string
  cursor: number
  count?: number
  initiatedBy?: string
  report?: Array<{ id: string; decision: string; reason?: string; confidence?: number; recordingId?: string }>
}

async function request<T>(url: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('accept', 'application/json')
  if (init.body) headers.set('content-type', 'application/json')
  if (token) headers.set('authorization', `Bearer ${token}`)
  const response = await fetch(url, { ...init, headers })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.message || 'Request failed') as Error & {
      code?: string
      status?: number
    }
    error.code = payload.error
    error.status = response.status
    throw error
  }
  return payload as T
}

export function authenticateTablet(identity: string, password: string) {
  return request<{ token: string; record?: { id: string; role?: string } }>(
    '/api/collections/users/auth-with-password',
    {
      method: 'POST',
      body: JSON.stringify({ identity: identity.trim(), password }),
    },
  )
}

export function createParty(token: string) {
  return request<{ id: string; code: string; expiresAt: string }>(
    '/api/karaoke/parties',
    { method: 'POST', body: '{}' },
    token,
  )
}

export function loadTabletStatus(token: string, partyId: string) {
  const params = new URLSearchParams({ partyId })
  return request<TabletStatus>(`/api/karaoke/tablet/status?${params}`, {}, token)
}

export function bindAvailableController(token: string, partyId: string) {
  return request<{ partyId: string; bound: boolean }>(
    '/api/karaoke/tablet/controller/bind',
    {
      method: 'POST',
      body: JSON.stringify({ partyId }),
    },
    token,
  )
}

export function issuePlaybackCommand(
  token: string,
  partyId: string,
  action: 'play' | 'pause',
  idempotencyKey: string,
) {
  return request<{
    id: string
    action: 'play' | 'pause'
    sequence: number
    status: string
    idempotent?: boolean
  }>(
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

export function transitionQueue(
  token: string,
  queueId: string,
  from: TabletQueueItem['status'],
  to: 'playing' | 'completed' | 'failed',
  failureReason?: string,
) {
  return request<{ id: string; status: string; idempotent?: boolean }>(
    '/api/karaoke/queue/transition',
    {
      method: 'POST',
      body: JSON.stringify({ queueId, from, to, ...(failureReason ? { failureReason } : {}) }),
    },
    token,
  )
}

export function loadCatalog(
  token: string,
  options: {
    review?: CatalogSong['reviewState']
    classification?: string
    youtubeId?: string
    page?: number
    perPage?: number
  } = {},
) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(options)) if (value) params.set(key, String(value))
  return request<{
    songs: CatalogSong[]
    page: number
    perPage: number
    totalItems: number
    totalPages: number
  }>(`/api/karaoke/tablet/catalog${params.toString() ? `?${params}` : ''}`, {}, token)
}

export function reviewCatalogSong(
  token: string,
  id: string,
  reviewState: CatalogSong['reviewState'],
  note?: string,
) {
  return request<CatalogSong>(
    `/api/karaoke/tablet/catalog/${encodeURIComponent(id)}/review`,
    {
      method: 'POST',
      body: JSON.stringify({ reviewState, ...(note?.trim() ? { note: note.trim() } : {}) }),
    },
    token,
  )
}

export function approveCatalogSongs(token: string, ids: string[]) {
  return request<{ approved: number; ids: string[]; batchId: string }>(
    '/api/karaoke/tablet/catalog/review/batch',
    {
      method: 'POST',
      body: JSON.stringify({ ids }),
    },
    token,
  )
}

export function correctCatalogIdentity(
  token: string,
  id: string,
  correction: { title: string; artist: string; reason: string },
) {
  return request<CatalogSong>(
    `/api/karaoke/tablet/catalog/${encodeURIComponent(id)}/identity`,
    {
      method: 'POST',
      body: JSON.stringify(correction),
    },
    token,
  )
}

export function loadCatalogReport(token: string) {
  return request<CatalogReport>('/api/karaoke/tablet/catalog/report', {}, token)
}

export function assumeLegacyPlaylist(token: string) {
  return request<LegacyPlaylistJob>('/api/karaoke/tablet/catalog/legacy-playlist/assume', { method: 'POST', body: '{}' }, token)
}

export function loadLegacyPlaylistJob(token: string, jobKey: string) {
  const params = new URLSearchParams({ jobKey })
  return request<LegacyPlaylistJob>(`/api/karaoke/tablet/catalog/legacy-playlist/assume?${params}`, {}, token)
}

export type MusicBrainzMatchResponse = {
  dryRun: boolean
  bounded: number
  results: Array<{ id: string; decision: string; reason: string; confidence?: number }>
  report: { processed: number; deferred: number; cursor?: number; resumable?: boolean; retryable?: boolean; replay?: boolean }
  cache?: { hits?: number; misses?: number; requests?: number }
}

export function runMusicBrainzMatch(token: string, ids: string[], options: { dryRun?: boolean; sourceId?: string; snapshotFingerprint?: string } = {}) {
  return request<MusicBrainzMatchResponse>('/api/karaoke/tablet/catalog/musicbrainz/match', {
    method: 'POST',
    body: JSON.stringify({ ids, dryRun: options.dryRun !== false, ...(options.sourceId ? { sourceId: options.sourceId } : {}), ...(options.snapshotFingerprint ? { snapshotFingerprint: options.snapshotFingerprint } : {}) }),
  }, token)
}

export function previewTrustedPlaylist(
  token: string,
  sourceKey: string,
  maxItems = 25,
  pageToken = '',
) {
  return request<PlaylistImportPreview>(
    '/api/karaoke/tablet/catalog/playlists/import',
    {
      method: 'POST',
      body: JSON.stringify({ sourceKey, maxItems, pageToken, dryRun: true }),
    },
    token,
  )
}

/** Preview an arbitrary public playlist; server validates URL/owner/visibility. */
export function previewPublicPlaylist(
  token: string,
  input: { playlist: string; maxItems?: number; pageToken?: string; rangeStart?: number; rangeEnd?: number },
) {
  return request<PublicPlaylistPreview>('/api/karaoke/tablet/catalog/playlists/import', {
    method: 'POST',
    body: JSON.stringify({ playlistUrl: input.playlist, maxItems: input.maxItems ?? 25, pageToken: input.pageToken ?? '', dryRun: true, ...(input.rangeStart == null ? {} : { rangeStart: input.rangeStart }), ...(input.rangeEnd == null ? {} : { rangeEnd: input.rangeEnd }) }),
  }, token)
}

export async function importConfirmedPlaylist(token: string, preview: PublicPlaylistPreview, operationId?: string) {
  const confirmationToken = preview.confirmationToken
  if (!confirmationToken) throw Object.assign(new Error('Preview confirmation expired'), { code: 'playlist_preview_stale', status: 409 })
  return request<{ imported: number; duplicates: number; unavailable: number; replay?: boolean; nextPageToken?: string; operationId?: string; completed?: boolean; progress?: { completed: number; total: number } }>(
    '/api/karaoke/tablet/catalog/playlists/import',
    { method: 'POST', body: JSON.stringify({ confirmationToken, snapshotFingerprint: preview.snapshotFingerprint, dryRun: false, ...(operationId ? { operationId } : {}) }) }, token,
  )
}

export function createApprovalSelection(token: string, input: { source: string; filter?: Record<string, string>; page?: number; perPage?: number }) {
  return request<ApprovalSelectionSnapshot & { digest?: string }>('/api/karaoke/tablet/catalog/review/selection', {
    method: 'POST', body: JSON.stringify(input),
  }, token).then((result) => ({ ...result, selectionId: result.selectionId || result.digest || '' }))
}

export function commitApprovalSelection(token: string, selectionId: string, operationId?: string) {
  return request<{ approved: number; excluded?: number; exclusions?: Record<string, number>; completed?: boolean; operationId?: string }>(
    '/api/karaoke/tablet/catalog/review/selection/commit',
    { method: 'POST', body: JSON.stringify({ digest: selectionId, ...(operationId ? { operationId } : {}) }) }, token,
  )
}

export function updateApprovalSelection(token: string, digest: string, recordIds: string[]) {
  return request<ApprovalSelectionSnapshot & { digest?: string }>('/api/karaoke/tablet/catalog/review/selection', {
    method: 'PATCH', body: JSON.stringify({ digest, recordIds }),
  }, token).then((result) => ({ ...result, selectionId: result.selectionId || result.digest || digest }))
}

export function importTrustedPlaylist(
  token: string,
  sourceKey: string,
  snapshotFingerprint: string,
  maxItems = 25,
  pageToken = '',
) {
  return request<{
    imported: number
    duplicates: number
    unavailable: number
    unavailableReasons?: PlaylistUnavailableReasons
    nextPageToken: string
  }>(
    '/api/karaoke/tablet/catalog/playlists/import',
    {
      method: 'POST',
      body: JSON.stringify({ sourceKey, snapshotFingerprint, maxItems, pageToken, dryRun: false }),
    },
    token,
  )
}

export function revalidateTrustedPlaylist(
  token: string,
  sourceKey: string,
  snapshotFingerprint: string,
  maxItems = 25,
  pageToken = '',
) {
  return request<{
    unavailable: number
    unavailableReasons: PlaylistUnavailableReasons
    revalidated: boolean
    replay: boolean
  }>('/api/karaoke/tablet/catalog/playlists/import', {
    method: 'POST',
    body: JSON.stringify({ sourceKey, snapshotFingerprint, maxItems, pageToken, dryRun: false, revalidate: true }),
  }, token)
}

export function replaceCatalogSong(
  token: string,
  id: string,
  candidate: { candidateId?: string; youtubeId?: string },
) {
  return request<CatalogSong>(
    `/api/karaoke/tablet/catalog/${encodeURIComponent(id)}/replace`,
    {
      method: 'POST',
      body: JSON.stringify(candidate),
    },
    token,
  )
}
