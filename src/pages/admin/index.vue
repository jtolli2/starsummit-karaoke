<!-- Advanced administration intentionally remains separate from the party-facing operator route. -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import QrcodeVue from 'qrcode.vue'
import {
  authenticateTablet,
  approveCatalogSongs,
  bindAvailableController,
  correctCatalogIdentity,
  createParty,
  issuePlaybackCommand,
  loadActiveParty,
  loadCatalog,
  loadCatalogReport,
  importTrustedPlaylist,
  revalidateTrustedPlaylist,
  loadNext,
  loadTabletStatus,
  replaceCatalogSong,
  previewTrustedPlaylist,
  reviewCatalogSong,
  transitionQueue,
  type CatalogReport,
  type CatalogSong,
  type PlaylistImportPreview,
  type PlaylistUnavailableReasons,
  type TabletQueueItem,
  type TabletStatus,
} from '@/services/tabletApi'

const storageKey = 'karaoke:tablet:session'
const playbackStorageKey = 'karaoke:tablet:pending-playback'
type StoredSession = { token: string; partyId?: string; partyCode?: string }
type PendingPlayback = {
  partyId: string
  queueId: string
  action: 'play' | 'pause'
  key: string
}

const token = ref<string | null>(null)
const identity = ref('')
const password = ref('')
const status = ref<TabletStatus | null>(null)
const partyId = ref('')
const loading = ref(false)
const busy = ref(false)
const message = ref('')
const error = ref(false)
const confirmFailure = ref<TabletQueueItem | null>(null)
const failureReason = ref('Playback failed')
const pendingPlayback = ref<PendingPlayback | null>(null)
const catalog = ref<CatalogSong[]>([])
const catalogLoading = ref(false)
const catalogShown = ref(false)
const catalogReview = ref<CatalogSong['reviewState']>('unreviewed')
const catalogPage = ref(1)
const catalogTotalPages = ref(1)
const catalogReport = ref<CatalogReport | null>(null)
const correction = ref<Record<string, { title: string; artist: string; reason: string }>>({})
const replacementId = ref<Record<string, string>>({})
const selectedApprovals = ref<string[]>([])
const playlistSourceKey = ref('')
const playlistPreview = ref<PlaylistImportPreview | null>(null)
const playlistContinuation = ref<{ sourceKey: string; pageToken: string } | null>(null)
let refreshTimer: ReturnType<typeof setInterval> | undefined

const activeQueue = computed(() => status.value?.queue || [])
const playing = computed(() => activeQueue.value.find((item) => item.status === 'playing'))
const nextQueued = computed(() => activeQueue.value.find((item) => item.status === 'queued'))
const selectedApprovalCount = computed(() => selectedApprovals.value.length)
const selectedApprovalNames = computed(() => catalog.value.filter((song) => selectedApprovals.value.includes(song.id)).map((song) => `${song.artist} — ${song.title}`))
const partyCode = computed(() => status.value?.party?.code || '')
const joinUrl = computed(() =>
  partyCode.value ? `${window.location.origin}/party/${partyCode.value}` : '',
)
const partyExpired = computed(() => {
  const party = status.value?.party
  return Boolean(
    party && (party.status !== 'active' || new Date(party.expiresAt).getTime() <= Date.now()),
  )
})
const controllerReady = computed(() =>
  Boolean(
    status.value?.controller?.connected &&
    status.value.controller.connectionState === 'connected' &&
    status.value.controller.state,
  ),
)
const playerState = computed(() => status.value?.controller?.state?.playerState || 'unknown')
const controllerMatchesPlaying = computed(() =>
  Boolean(
    playing.value?.song?.youtubeId &&
      status.value?.controller?.state?.videoId === playing.value.song.youtubeId,
  ),
)
const canPlay = computed(
  () => controllerReady.value && controllerMatchesPlaying.value && playerState.value === 'paused',
)
const canPause = computed(
  () => controllerReady.value && controllerMatchesPlaying.value && playerState.value === 'playing',
)

function youtubeWatchUrl(youtubeId: string) {
  return /^[A-Za-z0-9_-]{11}$/.test(youtubeId)
    ? `https://www.youtube.com/watch?v=${youtubeId}`
    : null
}

function storedSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(storageKey)
    if (!raw) return null
    const saved = JSON.parse(raw) as StoredSession
    return typeof saved.token === 'string' && saved.token.length > 0 ? saved : null
  } catch {
    return null
  }
}

function saveSession() {
  if (!token.value) return
  try {
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        token: token.value,
        partyId: partyId.value || undefined,
        partyCode: partyCode.value || undefined,
      }),
    )
  } catch {}
}

function clearSession() {
  try {
    sessionStorage.removeItem(storageKey)
    sessionStorage.removeItem(playbackStorageKey)
  } catch {}
}

function loadPendingPlayback() {
  try {
    const raw = sessionStorage.getItem(playbackStorageKey)
    if (!raw) return
    const saved = JSON.parse(raw) as PendingPlayback
    if (
      saved.partyId === partyId.value &&
      typeof saved.queueId === 'string' &&
      ['play', 'pause'].includes(saved.action) &&
      typeof saved.key === 'string'
    )
      pendingPlayback.value = saved
  } catch {}
}

function savePendingPlayback(value: PendingPlayback | null) {
  pendingPlayback.value = value
  try {
    if (value) sessionStorage.setItem(playbackStorageKey, JSON.stringify(value))
    else sessionStorage.removeItem(playbackStorageKey)
  } catch {}
}

function reconcilePendingPlayback() {
  const pending = pendingPlayback.value
  if (!pending) return ''
  if (pending.partyId !== partyId.value || pending.queueId !== playing.value?.id) {
    savePendingPlayback(null)
    return ''
  }
  const confirmed =
    controllerMatchesPlaying.value &&
    ((pending.action === 'play' && playerState.value === 'playing') ||
      (pending.action === 'pause' && playerState.value === 'paused'))
  if (!confirmed) return `${pending.action === 'play' ? 'Play' : 'Pause'} requested; waiting for controller confirmation.`
  savePendingPlayback(null)
  return pending.action === 'play' ? 'Playback resumed.' : 'Playback paused.'
}

function explain(value: unknown, fallback: string) {
  const code = (value as { code?: string })?.code
  return (
    (
      {
        bad_password: 'The tablet account or password is incorrect.',
        forbidden: 'This account is not allowed to operate the tablet.',
        party_expired: 'This party has expired. Create a new party to continue.',
        stale_transition: 'The queue changed on another device. State was refreshed.',
        not_next: 'Fair rotation selected another song. State was refreshed.',
        party_already_playing: 'A song is already playing.',
        controller_ambiguous: 'More than one current controller is available.',
        controller_unavailable: 'No current controller is available.',
        controller_state_mismatch:
          'Controller playback does not match the active queue. State was refreshed.',
        nothing_playing: 'No active queue item is available to control.',
        idempotency_conflict: 'That playback action conflicts with an earlier request.',
        playlist_source_key_invalid: 'Enter a valid source key in channel ID:playlist ID format.',
        playlist_source_not_allowed: 'That playlist is not configured as a trusted source.',
        playlist_allowlist_invalid: 'Trusted playlist configuration is invalid. Contact an administrator.',
        playlist_unavailable: 'The configured playlist is unavailable or no longer public.',
        youtube_http_401: 'The configured YouTube source rejected server authentication.',
        youtube_http_403: 'The configured YouTube source denied this server request.',
        youtube_http_404: 'The configured YouTube playlist is unavailable or no longer public.',
        youtube_http_429: 'YouTube is rate-limiting playlist retrieval. Try again later.',
        youtube_http_500: 'YouTube is temporarily unavailable. Try again later.',
        youtube_http_503: 'YouTube is temporarily unavailable. Try again later.',
        youtube_http_unavailable: 'The server cannot currently reach the YouTube API adapter.',
        youtube_network_error: 'The server could not reach YouTube after bounded retries.',
        youtube_request_failed: 'The YouTube playlist request did not return a usable result.',
        playlist_owner_mismatch: 'Playlist ownership or public visibility no longer matches the allowlist.',
        playlist_preview_stale: 'The playlist changed after preview. Review the refreshed preview first.',
        playlist_import_in_progress: 'An identical playlist fetch is already running.',
        playlist_snapshot_not_found: 'The retained preview is no longer available. Run a new trusted-playlist preview first.',
        playlist_snapshot_invalid: 'The retained preview has no usable video identities. Run a new trusted-playlist preview first.',
        playlist_revalidation_in_progress: 'Unavailable-item revalidation is already running. Wait briefly and try again.',
        playlist_revalidation_state_invalid: 'The retained revalidation state is invalid. Run a new trusted-playlist preview first.',
        playlist_revalidation_failed: 'Unavailable-item revalidation failed safely. Try again later or preview the playlist again.',
        youtube_quota_exhausted: 'The configured YouTube request limit has been reached.',
        playlist_claim_failed: 'The playlist fetch could not reserve its operation ledger entry.',
        playlist_import_failed: 'Trusted playlist retrieval failed safely before any songs were approved.',
        playlist_import_owner_fetch_failed: 'Trusted playlist owner lookup failed safely. Try again later.',
        playlist_import_playlist_items_fetch_failed: 'Trusted playlist item lookup failed safely. Try again later.',
        playlist_import_snapshot_verify_failed: 'Trusted playlist preview verification failed. Preview again before importing.',
        playlist_import_video_metadata_fetch_failed: 'Trusted playlist video metadata lookup failed safely. Try again later.',
        playlist_import_persist_results_failed: 'Trusted playlist results could not be recorded. No songs were approved; try again later.',
        playlist_import_snapshot_save_failed: 'Trusted playlist snapshot could not be recorded. No songs were approved; try again later.',
        playlist_import_song_save_failed: 'A trusted playlist song could not be recorded. No songs were approved; try again later.',
        playlist_import_snapshot_identity_save_failed: 'Trusted playlist identity could not be recorded. No songs were approved; try again later.',
        playlist_import_snapshot_page_save_failed: 'Trusted playlist page state could not be recorded. No songs were approved; try again later.',
        playlist_import_snapshot_digest_save_failed: 'Trusted playlist metadata digest could not be recorded. No songs were approved; try again later.',
        playlist_import_snapshot_ids_save_failed: 'Trusted playlist video identities could not be recorded. No songs were approved; try again later.',
        playlist_import_snapshot_dates_save_failed: 'Trusted playlist timestamps could not be recorded. No songs were approved; try again later.',
        playlist_snapshot_schema_mismatch: 'Trusted playlist snapshot storage is unavailable. Contact an administrator.',
        playlist_snapshot_token_too_long: 'The trusted playlist returned an invalidly long page token. Preview again later.',
        playlist_snapshot_data_invalid: 'The trusted playlist returned invalid snapshot data. Preview again later.',
        playlist_snapshot_ambiguous: 'Multiple retained previews match this playlist page. Preview again before importing.',
        playlist_snapshot_lookup_failed: 'Trusted playlist snapshot lookup is unavailable. Try again later.',
        playlist_import_settle_success_failed: 'Trusted playlist results were not finalized. No songs were approved; try again later.',
      } as Record<string, string>
    )[code || ''] || fallback
  )
}

function formatPlaylistUnavailableBreakdown(reasons?: Partial<PlaylistUnavailableReasons>) {
  const privacy = reasons?.privacy && typeof reasons.privacy === 'object'
    ? reasons.privacy as Record<string, number>
    : {}
  const uploadStatus = reasons?.uploadStatus && typeof reasons.uploadStatus === 'object'
    ? reasons.uploadStatus as Record<string, number>
    : {}
  const count = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0
  const nonPublic = Object.entries(privacy)
    .filter(([key]) => key !== 'public')
    .reduce((sum, [, value]) => sum + count(value), 0)
  const unprocessed = Object.entries(uploadStatus)
    .filter(([key]) => key !== 'processed')
    .reduce((sum, [, value]) => sum + count(value), 0)
  return ` (${count(reasons?.metadataMissing)} metadata missing, ${nonPublic} non-public, ${unprocessed} unprocessed; ${count(reasons?.nonEmbeddable)} non-embeddable signal)`
}

async function refreshCatalog() {
  if (!token.value) return
  catalogLoading.value = true
  try {
    const [result, report] = await Promise.all([
      loadCatalog(token.value, {
        review: catalogReview.value,
        page: catalogPage.value,
        perPage: 20,
      }),
      loadCatalogReport(token.value),
    ])
    catalog.value = result.songs || []
    selectedApprovals.value = selectedApprovals.value.filter((songId) => catalog.value.some((song) => song.id === songId))
    catalogTotalPages.value = result.totalPages || 1
    catalogReport.value = report
    for (const song of catalog.value)
      correction.value[song.id] ||= { title: song.title, artist: song.artist, reason: '' }
    catalogShown.value = true
  } catch (cause) {
    message.value = explain(cause, 'Could not load the catalog for review.')
    error.value = true
  } finally {
    catalogLoading.value = false
  }
}

async function correctIdentity(song: CatalogSong) {
  if (!token.value || catalogLoading.value) return
  const value = correction.value[song.id]
  if (!value?.title.trim() || !value.artist.trim() || !value.reason.trim()) return
  catalogLoading.value = true
  try {
    await correctCatalogIdentity(token.value, song.id, {
      title: value.title.trim(),
      artist: value.artist.trim(),
      reason: value.reason.trim(),
    })
    await refreshCatalog()
  } catch (cause) {
    message.value = explain(cause, 'Canonical identity correction could not be saved.')
    error.value = true
  } finally {
    catalogLoading.value = false
  }
}

function changeCatalogReview() {
  catalogPage.value = 1
  selectedApprovals.value = []
  void refreshCatalog()
}

function previousCatalogPage() {
  catalogPage.value--
  selectedApprovals.value = []
  void refreshCatalog()
}

function nextCatalogPage() {
  catalogPage.value++
  selectedApprovals.value = []
  void refreshCatalog()
}

async function setCatalogReview(
  song: CatalogSong,
  reviewState: Extract<CatalogSong['reviewState'], 'approved' | 'rejected'>,
) {
  if (!token.value || catalogLoading.value) return
  catalogLoading.value = true
  try {
    await reviewCatalogSong(token.value, song.id, reviewState)
    selectedApprovals.value = selectedApprovals.value.filter((songId) => songId !== song.id)
    await refreshCatalog()
  } catch (cause) {
    message.value = explain(cause, 'Catalog review could not be saved.')
    error.value = true
  } finally {
    catalogLoading.value = false
  }
}

async function approveSelectedCatalogSongs() {
  if (!token.value || !selectedApprovals.value.length || catalogLoading.value) return
  const count = selectedApprovals.value.length
  if (!window.confirm(`Approve ${count} selected rendition${count === 1 ? '' : 's'}?\n\n${selectedApprovalNames.value.join('\n')}`)) return
  catalogLoading.value = true
  try {
    const result = await approveCatalogSongs(token.value, selectedApprovals.value)
    selectedApprovals.value = []
    message.value = `Approved ${result.approved} selected karaoke rendition${result.approved === 1 ? '' : 's'}.`
    error.value = false
    await refreshCatalog()
  } catch (cause) {
    message.value = explain(cause, 'Selected songs could not be approved.')
    error.value = true
  } finally {
    catalogLoading.value = false
  }
}

function invalidatePlaylistContinuation() {
  playlistContinuation.value = null
}

async function previewPlaylist(pageToken = '', sourceKey = playlistSourceKey.value.trim(), continuation = false) {
  if (!token.value || !sourceKey) return
  catalogLoading.value = true
  // A first-page/source preview invalidates any prior continuation immediately.
  // For a continuation retry, keep the token until the preview succeeds.
  if (!continuation) {
    playlistContinuation.value = null
    playlistPreview.value = null
  }
  try {
    playlistPreview.value = await previewTrustedPlaylist(token.value, sourceKey, 25, pageToken)
    if (continuation) playlistContinuation.value = null
    message.value = `Playlist preview${pageToken ? ' (next page)' : ''}: ${playlistPreview.value.expectedItems} items; modeled ${playlistPreview.value.modeledCost.total} API units.`
    error.value = false
  } catch (cause) { message.value = explain(cause, 'Playlist preview could not be loaded.'); error.value = true } finally { catalogLoading.value = false }
}

async function importPlaylist() {
  if (!token.value || !playlistPreview.value || catalogLoading.value) return
  catalogLoading.value = true
  try {
    const result = await importTrustedPlaylist(token.value, playlistPreview.value.source.sourceKey, playlistPreview.value.snapshotFingerprint, 25, playlistPreview.value.pageToken)
    playlistContinuation.value = result.nextPageToken
      ? { sourceKey: playlistPreview.value.source.sourceKey, pageToken: result.nextPageToken }
      : null
    const reasons = result.unavailableReasons
    const breakdown = reasons ? formatPlaylistUnavailableBreakdown(reasons) : ''
    message.value = `Imported ${result.imported}; ${result.duplicates} duplicates and ${result.unavailable} unavailable${breakdown}. Non-embeddable is informational for native playback. Revalidate unavailable items if needed.${playlistContinuation.value ? ' Preview next page when ready.' : ' This was the final page.'}`
    error.value = false
    await refreshCatalog()
  } catch (cause) { message.value = explain(cause, 'Playlist import could not be completed.'); error.value = true } finally { catalogLoading.value = false }
}

async function previewNextPlaylistPage() {
  const continuation = playlistContinuation.value
  if (!continuation || catalogLoading.value) return
  await previewPlaylist(continuation.pageToken, continuation.sourceKey, true)
}

async function revalidatePlaylist() {
  if (!token.value || !playlistPreview.value || catalogLoading.value) return
  catalogLoading.value = true
  try {
    const result = await revalidateTrustedPlaylist(token.value, playlistPreview.value.source.sourceKey, playlistPreview.value.snapshotFingerprint, 25, playlistPreview.value.pageToken)
    message.value = `Revalidated ${result.unavailable} unavailable items: ${result.unavailableReasons.metadataMissing} metadata missing; ${result.unavailableReasons.nonEmbeddable} non-embeddable informational signals.`
    error.value = false
  } catch (cause) { message.value = explain(cause, 'Playlist revalidation could not be completed.'); error.value = true } finally { catalogLoading.value = false }
}

async function replaceSong(song: CatalogSong) {
  const candidate = replacementId.value[song.id]?.trim()
  if (!token.value || !candidate || catalogLoading.value) return
  catalogLoading.value = true
  try {
    await replaceCatalogSong(
      token.value,
      song.id,
      candidate.length === 11 ? { youtubeId: candidate } : { candidateId: candidate },
    )
    replacementId.value = { ...replacementId.value, [song.id]: '' }
    await refreshCatalog()
  } catch (cause) {
    message.value = explain(cause, 'Catalog replacement could not be saved.')
    error.value = true
  } finally {
    catalogLoading.value = false
  }
}

async function refresh() {
  if (!token.value || !partyId.value) return
  try {
    const knownCode = partyCode.value
    status.value = await loadTabletStatus(token.value, partyId.value)
    if (knownCode && status.value.party && !status.value.party.code)
      status.value.party.code = knownCode
    saveSession()
    if (partyExpired.value) {
      message.value = 'This party has expired. Create a new party to continue.'
      error.value = true
      return
    }
    message.value = reconcilePendingPlayback()
    error.value = false
  } catch (cause) {
    const statusCode = (cause as { status?: number }).status
    if (statusCode === 401 || statusCode === 403) {
      token.value = null
      status.value = null
      partyId.value = ''
      clearSession()
      message.value = 'Your tablet session expired. Sign in again.'
      error.value = true
      return
    }
    message.value = explain(cause, 'Could not refresh tablet state. Retrying…')
    error.value = true
  }
}

async function signIn() {
  loading.value = true
  message.value = ''
  try {
    const result = await authenticateTablet(identity.value, password.value)
    token.value = result.token
    password.value = ''
    saveSession()
    await restoreActiveParty()
  } catch (cause) {
    message.value = explain(cause, 'Sign-in failed. Check your connection and try again.')
    error.value = true
  } finally {
    loading.value = false
  }
}

async function restoreActiveParty() {
  if (!token.value) return
  try {
    const result = await loadActiveParty(token.value)
    if (!result.party) {
      partyId.value = ''
      status.value = null
      saveSession()
      return
    }
    partyId.value = result.party.id
    await refresh()
  } catch (cause) {
    const statusCode = (cause as { status?: number }).status
    if (statusCode === 401 || statusCode === 403) {
      token.value = null
      partyId.value = ''
      clearSession()
      message.value = 'Your tablet session expired. Sign in again.'
      error.value = true
      return
    }
    message.value = explain(cause, 'Could not restore the active party. Use Refresh to retry.')
    error.value = true
  }
}

async function createActiveParty() {
  if (!token.value) return
  loading.value = true
  try {
    const party = await createParty(token.value)
    partyId.value = party.id
    status.value = { party: { ...party, status: 'active' }, queue: [], controller: null }
    saveSession()
    await refresh()
    // The server may intentionally omit the full code from later sanitized reads;
    // retain this one-time creation response in memory for the QR display.
    if (status.value?.party && !status.value.party.code) status.value.party.code = party.code
    saveSession()
    message.value = 'Party is ready. Guests can scan the QR code.'
    error.value = false
  } catch (cause) {
    message.value = explain(cause, 'Could not create a party.')
    error.value = true
  } finally {
    loading.value = false
  }
}

async function startNext() {
  if (!token.value || !partyId.value || busy.value || partyExpired.value || !controllerReady.value)
    return
  busy.value = true
  try {
    const preview = await loadNext(token.value, partyId.value)
    if (!preview.queue) {
      message.value = 'No queued songs are waiting.'
      return
    }
    await transitionQueue(token.value, preview.queue.id, 'queued', 'playing')
    await refresh()
    message.value = `${preview.queue.song?.title || 'Song'} is now playing.`
    error.value = false
  } catch (cause) {
    await refresh()
    message.value = explain(cause, 'Start was uncertain; the authoritative state was refreshed.')
    error.value = true
  } finally {
    busy.value = false
  }
}

async function bindController() {
  if (!token.value || !partyId.value || busy.value) return
  busy.value = true
  try {
    await bindAvailableController(token.value, partyId.value)
    await refresh()
    message.value = 'Controller binding refreshed.'
    error.value = false
  } catch (cause) {
    message.value = explain(cause, 'Could not bind the available controller.')
    error.value = true
  } finally {
    busy.value = false
  }
}

function playbackIdempotencyKey(action: 'play' | 'pause') {
  const unique =
    typeof crypto?.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `tablet:${partyId.value}:${playing.value?.id}:${action}:${unique}`.slice(0, 128)
}

async function controlPlayback(action: 'play' | 'pause') {
  if (!token.value || !partyId.value || busy.value || partyExpired.value) return
  if ((action === 'play' && !canPlay.value) || (action === 'pause' && !canPause.value)) return
  const queueId = playing.value?.id
  if (!queueId) return
  const existing = pendingPlayback.value
  const operation =
    existing?.partyId === partyId.value &&
    existing.queueId === queueId &&
    existing.action === action
      ? existing
      : { partyId: partyId.value, queueId, action, key: playbackIdempotencyKey(action) }
  savePendingPlayback(operation)
  busy.value = true
  try {
    await issuePlaybackCommand(token.value, partyId.value, action, operation.key)
    await refresh()
    if (pendingPlayback.value)
      message.value = `${action === 'play' ? 'Play' : 'Pause'} requested; waiting for controller confirmation.`
    error.value = false
  } catch (cause) {
    await refresh()
    if (pendingPlayback.value) {
      message.value = explain(cause, 'Playback action was uncertain; retry will reuse the same request.')
      error.value = true
    }
  } finally {
    busy.value = false
  }
}

async function finish(item: TabletQueueItem, to: 'completed' | 'failed') {
  if (!token.value || busy.value || partyExpired.value) return
  busy.value = true
  try {
    await transitionQueue(
      token.value,
      item.id,
      item.status,
      to,
      to === 'failed' ? failureReason.value : undefined,
    )
    await refresh()
    message.value =
      to === 'completed'
        ? 'Song marked complete.'
        : 'Song marked failed and removed from active queue.'
    error.value = false
    confirmFailure.value = null
  } catch (cause) {
    await refresh()
    message.value = explain(cause, 'The result was uncertain; state was refreshed.')
    error.value = true
  } finally {
    busy.value = false
  }
}

function signOut() {
  token.value = null
  status.value = null
  partyId.value = ''
  message.value = ''
  identity.value = ''
  clearSession()
}

onMounted(async () => {
  const saved = storedSession()
  if (saved) {
    token.value = saved.token
    partyId.value = saved.partyId || ''
    if (partyId.value) {
      loadPendingPlayback()
      status.value = {
        party: { id: partyId.value, code: saved.partyCode, expiresAt: '', status: 'active' },
        queue: [],
        controller: null,
      }
      await refresh()
    } else await restoreActiveParty()
  }
  refreshTimer = setInterval(refresh, 15000)
})
onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer)
})
</script>

<template>
  <main class="tablet-page" aria-labelledby="tablet-title">
    <header>
      <p class="eyebrow">Starsummit Karaoke</p>
      <h1 id="tablet-title">Tablet operator</h1>
    </header>
    <p v-if="message" class="message" :data-error="error" role="alert">{{ message }}</p>
    <form v-if="!token" class="card login" @submit.prevent="signIn">
      <h2>Sign in</h2>
      <label for="identity">Tablet account</label
      ><input id="identity" v-model="identity" autocomplete="username" required />
      <label for="password">Password</label
      ><input
        id="password"
        v-model="password"
        type="password"
        autocomplete="current-password"
        required
      />
      <button type="submit" :disabled="loading">{{ loading ? 'Signing in…' : 'Sign in' }}</button>
    </form>
    <section v-else class="operator">
      <div class="toolbar">
        <button type="button" @click="refresh" :disabled="loading || busy || !partyId">
          Refresh</button
        ><button type="button" class="quiet" @click="signOut">Sign out</button>
      </div>
      <section v-if="!status && !loading" class="card">
        <h2>No active party</h2>
        <p>Create a party when guests are ready to join.</p>
        <button type="button" @click="createActiveParty">Create party</button>
      </section>
      <section v-if="status?.party" class="card party-card" aria-labelledby="party-heading">
        <div>
          <h2 id="party-heading">
            Party <strong>{{ status.party.code || `••••${status.party.codeHint || ''}` }}</strong>
          </h2>
          <p v-if="partyExpired">This party has expired. Queue controls are unavailable.</p>
          <p v-else>
            Expires {{ new Date(status.party.expiresAt).toLocaleTimeString() }} ·
            {{ status.party.joinCount || 0 }} guests joined
          </p>
        </div>
        <QrcodeVue
          v-if="!partyExpired && joinUrl"
          :value="joinUrl"
          :size="132"
          level="M"
          aria-label="Party join QR code"
        />
        <p v-else-if="!partyExpired">
          QR unavailable after reload; create a new party to display it.
        </p>
        <button v-if="partyExpired" type="button" @click="createActiveParty" :disabled="loading">
          Create new party
        </button>
      </section>
      <section v-if="status" class="card controller" aria-labelledby="controller-heading">
        <h2 id="controller-heading">Controller</h2>
        <p :data-state="status.controller?.connectionState || 'unknown'">
          {{ status.controller?.connectionState || 'Not connected'
          }}<span v-if="status.controller?.state?.playerState">
            · {{ status.controller.state.playerState }}</span
          >
        </p>
        <p v-if="status.controller?.state?.videoId">Video {{ status.controller.state.videoId }}</p>
        <p v-if="!controllerReady">Connect the native controller before starting a song.</p>
        <p v-else-if="playing && !controllerMatchesPlaying" role="status">
          Waiting for controller playback confirmation…
        </p>
        <p v-if="pendingPlayback" role="status">
          {{ pendingPlayback.action === 'play' ? 'Play' : 'Pause' }} request pending.
        </p>
        <div class="playback-controls" aria-label="Playback controls">
          <button type="button" @click="controlPlayback('play')" :disabled="busy || !canPlay">
            Play
          </button>
          <button type="button" @click="controlPlayback('pause')" :disabled="busy || !canPause">
            Pause
          </button>
        </div>
        <button
          v-if="!status.controller?.device"
          type="button"
          :disabled="busy"
          @click="bindController"
        >
          {{ busy ? 'Working…' : 'Bind available controller' }}
        </button>
      </section>
      <section v-if="status && !partyExpired" class="card queue" aria-labelledby="queue-heading">
        <div class="queue-head">
          <h2 id="queue-heading">Queue</h2>
          <button
            type="button"
            @click="startNext"
            :disabled="busy || Boolean(playing) || !nextQueued || !controllerReady"
          >
            {{ busy ? 'Working…' : 'Play next' }}
          </button>
        </div>
        <p v-if="!activeQueue.length">Queue is empty.</p>
        <ol v-else>
          <li v-for="item in activeQueue" :key="item.id" :data-status="item.status">
            <div>
              <strong>{{ item.song?.title || 'Unknown song' }}</strong
              ><small>{{ item.song?.artist }}</small
              ><span class="status">{{
                item.status === 'playing' ? 'Playing now' : 'Queued'
              }}</span>
            </div>
            <div v-if="item.status === 'playing'" class="actions">
              <button type="button" @click="finish(item, 'completed')" :disabled="busy">
                Complete</button
              ><button type="button" @click="confirmFailure = item" :disabled="busy">
                Skip / fail
              </button>
            </div>
          </li>
        </ol>
      </section>
      <section class="card catalog" aria-labelledby="catalog-heading">
        <div class="queue-head">
          <h2 id="catalog-heading">Catalog review</h2>
          <button type="button" class="quiet" @click="refreshCatalog" :disabled="catalogLoading">
            {{ catalogShown ? 'Refresh' : 'Review songs' }}
          </button>
        </div>
        <div class="playlist-import">
          <label for="playlist-source">Trusted playlist source key</label>
          <input id="playlist-source" v-model="playlistSourceKey" @input="invalidatePlaylistContinuation" placeholder="channelId:playlistId" />
          <button type="button" @click="() => previewPlaylist()" :disabled="catalogLoading || !playlistSourceKey.trim()">Preview trusted playlist</button>
          <p v-if="playlistPreview" role="status">
            {{ playlistPreview.source.channelName || 'Configured channel' }} · {{ playlistPreview.expectedItems }} items ·
            {{ playlistPreview.modeledCost.playlistsList }} owner + {{ playlistPreview.modeledCost.playlistItemsList }} playlist + {{ playlistPreview.modeledCost.videosList }} video calls
          </p>
          <button v-if="playlistPreview" type="button" @click="importPlaylist" :disabled="catalogLoading">Import preview page</button>
          <button v-if="playlistContinuation" type="button" class="quiet" @click="previewNextPlaylistPage" :disabled="catalogLoading">Preview next page</button>
          <button v-if="playlistPreview" type="button" class="quiet" @click="revalidatePlaylist" :disabled="catalogLoading">Revalidate unavailable metadata</button>
        </div>
        <div v-if="catalogShown">
          <p v-if="catalogReport" class="catalog-summary">
            {{ catalogReport.total }} total · {{ catalogReport.unresolvedReviewBacklog }} awaiting
            review · {{ catalogReport.missingIdentity }} missing or uncertain identities ·
            {{ catalogReport.alternatives }} alternatives
          </p>
          <label for="catalog-review">Show</label
          ><select
            id="catalog-review"
            v-model="catalogReview"
            @change="changeCatalogReview"
          >
            <option value="unreviewed">Unreviewed</option>
            <option value="needs_review">Needs review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <div class="batch-review">
            <span>{{ selectedApprovalCount }} selected</span>
            <button
              type="button"
              @click="approveSelectedCatalogSongs"
              :disabled="catalogLoading || !selectedApprovalCount"
            >
              Approve selected ({{ selectedApprovalCount }})
            </button>
          </div>
          <p v-if="catalogLoading" role="status">Loading catalog…</p>
          <p v-else-if="!catalog.length">No songs match this review state.</p>
          <ul v-else>
            <li v-for="song in catalog" :key="song.id">
              <div class="catalog-details">
                <label
                v-if="song.reviewState !== 'approved' && song.classification === 'karaoke' && (song.classificationConfidence || 0) >= 0.8 && !song.alternativeCount && ['verified_source', 'operator_corrected'].includes(song.identityStatus || '')"
                  class="batch-select"
                >
                  <input v-model="selectedApprovals" type="checkbox" :value="song.id" :disabled="catalogLoading" />
                  Select for approval
                </label>
                <strong>{{ song.title }}</strong
                ><small
                  >Canonical artist: {{ song.artist || 'Missing' }} ·
                  {{ song.identityStatus || 'missing' }}</small
                ><small
                  >Source: {{ song.source || 'unknown' }}
                  {{ song.sourceList ? `· ${song.sourceList} #${song.sourceRank}` : '' }}
                  {{ song.sourceId ? `· ${song.sourceId}` : '' }}</small
                ><small
                  >YouTube title: {{ song.videoTitle || 'Unknown' }} · uploader
                  {{ song.videoChannelTitle || 'unknown' }}</small
                ><small
                  >YouTube ID: <code>{{ song.youtubeId }}</code>
                  <template v-if="youtubeWatchUrl(song.youtubeId)">
                    ·
                    <a
                      :href="youtubeWatchUrl(song.youtubeId)!"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open on YouTube
                    </a>
                  </template></small
                ><small
                  >Classification: {{ song.classification || 'unknown' }} ({{
                    Math.round((song.classificationConfidence || 0) * 100)
                  }}%) · {{ song.classificationReason || 'no reason' }}</small
                >
                <div class="identity-correction">
                  <input
                    v-model="correction[song.id]!.title"
                    aria-label="Canonical title"
                    placeholder="Canonical title"
                    maxlength="240"
                  /><input
                    v-model="correction[song.id]!.artist"
                    aria-label="Canonical artist"
                    placeholder="Canonical artist"
                    maxlength="160"
                  /><input
                    v-model="correction[song.id]!.reason"
                    aria-label="Correction reason"
                    placeholder="Correction reason"
                    maxlength="240"
                  /><button
                    type="button"
                    class="quiet"
                    @click="correctIdentity(song)"
                    :disabled="
                      catalogLoading ||
                      !correction[song.id]!.title ||
                      !correction[song.id]!.artist ||
                      !correction[song.id]!.reason
                    "
                  >
                    Save identity
                  </button>
                </div>
              </div>
              <div class="actions">
                <button
                  v-if="song.reviewState !== 'approved'"
                  type="button"
                  @click="setCatalogReview(song, 'approved')"
                  :disabled="catalogLoading"
                >
                  Approve</button
                ><button
                  v-if="song.reviewState !== 'rejected'"
                  type="button"
                  class="quiet"
                  @click="setCatalogReview(song, 'rejected')"
                  :disabled="catalogLoading"
                >
                  Reject</button
                ><label class="replacement"
                  ><span class="sr-only">Replacement YouTube ID</span
                  ><input
                    v-model="replacementId[song.id]"
                    placeholder="Replacement ID"
                    maxlength="11"
                  /><button
                    type="button"
                    @click="replaceSong(song)"
                    :disabled="catalogLoading || !replacementId[song.id]"
                  >
                    Replace
                  </button></label
                >
              </div>
            </li>
          </ul>
          <div v-if="catalogTotalPages > 1" class="pager">
            <button
              type="button"
              class="quiet"
              @click="previousCatalogPage"
              :disabled="catalogLoading || catalogPage <= 1"
            >
              Previous</button
            ><span>Page {{ catalogPage }} of {{ catalogTotalPages }}</span
            ><button
              type="button"
              class="quiet"
              @click="nextCatalogPage"
              :disabled="catalogLoading || catalogPage >= catalogTotalPages"
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </section>
    <div v-if="confirmFailure" class="dialog-backdrop">
      <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="failure-heading">
        <h2 id="failure-heading">Skip this song?</h2>
        <p>This marks the song as failed and lets the next singer play.</p>
        <label for="failure-reason">Reason</label
        ><input id="failure-reason" v-model="failureReason" maxlength="160" />
        <div>
          <button type="button" @click="confirmFailure = null">Cancel</button
          ><button type="button" @click="finish(confirmFailure!, 'failed')" :disabled="busy">
            Confirm skip
          </button>
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.tablet-page {
  max-width: 58rem;
  margin: 0 auto;
  padding: 1.25rem;
  font-family: system-ui, sans-serif;
  color: #17151d;
}
.eyebrow {
  color: #6750a4;
  font-weight: 700;
}
h1 {
  font-size: 2.25rem;
  margin: 0 0 1rem;
}
h2 {
  margin: 0 0 0.75rem;
}
.card {
  border: 1px solid #ddd8e8;
  border-radius: 1rem;
  padding: 1rem;
  margin: 1rem 0;
  background: #fff;
  box-shadow: 0 2px 8px #1610200d;
}
label {
  display: block;
  margin: 0.75rem 0 0.3rem;
  font-weight: 600;
}
input {
  width: 100%;
  box-sizing: border-box;
  padding: 0.8rem;
  border: 1px solid #aaa3b5;
  border-radius: 0.5rem;
  font-size: 1rem;
}
button {
  min-height: 2.9rem;
  padding: 0.65rem 1rem;
  border: 0;
  border-radius: 0.55rem;
  background: #6750a4;
  color: white;
  font-weight: 700;
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: wait;
}
button.quiet {
  background: #eeeaf2;
  color: #3e3748;
}
.message {
  padding: 0.8rem;
  border-radius: 0.5rem;
  background: #edf8ef;
}
.message[data-error='true'] {
  background: #fff0f0;
  color: #8a1717;
}
.toolbar,
.queue-head,
.party-card,
.actions,
.playback-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
.playback-controls {
  justify-content: flex-start;
}
.party-card {
  align-items: flex-start;
}
.party-card p,
small {
  color: #665f6c;
}
.queue ol {
  margin: 0;
  padding-left: 1.5rem;
}
.queue li {
  padding: 0.8rem 0;
  border-bottom: 1px solid #eee;
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}
.queue li:last-child {
  border-bottom: 0;
}
small,
.status {
  display: block;
}
.status {
  font-size: 0.82rem;
  color: #6750a4;
  margin-top: 0.25rem;
}
.dialog-backdrop {
  position: fixed;
  inset: 0;
  background: #16102088;
  display: grid;
  place-items: center;
  padding: 1rem;
}
.dialog {
  background: #fff;
  border-radius: 1rem;
  padding: 1.25rem;
  max-width: 28rem;
  width: 100%;
}
.dialog > div {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 1rem;
}
.catalog ul {
  list-style: none;
  padding: 0;
}
.catalog li {
  padding: 0.8rem 0;
  border-bottom: 1px solid #eee;
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}
.replacement {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0;
}
.replacement input {
  width: 9rem;
  padding: 0.55rem;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  margin-top: 1rem;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
}
.catalog-details {
  flex: 1;
  min-width: 0;
}
.catalog-summary {
  background: #f5f2f8;
  padding: 0.65rem;
  border-radius: 0.5rem;
}
.identity-correction {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.35rem;
  margin-top: 0.6rem;
}
.identity-correction input {
  padding: 0.55rem;
}
.identity-correction button {
  grid-column: 2;
}
</style>
