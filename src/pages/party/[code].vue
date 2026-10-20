<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import Fuse from 'fuse.js'
import { useRoute } from 'vue-router'
import { clearPartyCredential, fallbackSearchSongs, joinParty, loadCatalogIndex, loadQueue, normalizeCatalogSong, normalizeSearchText, partyCredential, requestFallbackSong, requestSong, searchSongs, startQueueWakeHint, type LibrarySong, type QueueSong } from '@/services/partyApi'

const route = useRoute()
const code = computed(() => String(route.params.code || '').trim().toUpperCase())
const credential = ref<string | null>(null)
const queue = ref<QueueSong[]>([])
const songs = ref<LibrarySong[]>([])
const indexSongs = ref<LibrarySong[]>([])
const catalogResultCount = computed(
  () => songs.value.filter((song) => song.source !== 'youtube').length,
)
const query = ref('')
const loading = ref(true)
const searching = ref(false)
const fallbackSearching = ref(false)
const fallbackSuggested = ref(false)
const fallbackSearched = ref(false)
const fallbackResultCount = ref(0)
const message = ref('')
const errorKind = ref('')
const pendingSongs = ref(new Set<string>())
const requestMessage = ref('')
const requestErrorKind = ref('')
const refreshMessage = ref('')
const refreshErrorKind = ref('')
type PendingAttempt = {
  credential: string
  key: string
  source: 'catalog' | 'youtube'
  youtubeId: string
  title: string
  uncertain: boolean
  rejoined: boolean
}
const pendingAttempts = ref(new Map<string, PendingAttempt>())
const unresolvedAttempts = computed(() => Array.from(pendingAttempts.value.values()))
let stopWake: () => void = () => undefined
let searchTimer: ReturnType<typeof setTimeout> | undefined
let rejoining: Promise<string> | null = null
let backgroundRejoinAttempted = false
let fuse: Fuse<LibrarySong> | null = null
async function rejoinOnce() {
  if (!rejoining) {
    clearPartyCredential(code.value)
    rejoining = (async () => {
      const nextCredential = (await joinParty(code.value)).credential
      credential.value = nextCredential
      stopWake()
      stopWake = await startQueueWakeHint(nextCredential, reconcile)
      return nextCredential
    })()
  }
  try { return await rejoining } finally { rejoining = null }
}

function setCatalogIndex(nextSongs: LibrarySong[]) {
  indexSongs.value = nextSongs
  fuse = new Fuse(indexSongs.value, {
    keys: [
      { name: 'title', getFn: (song) => normalizeSearchText(song.title) },
      { name: 'artist', getFn: (song) => normalizeSearchText(song.artist) },
      {
        name: 'combined',
        getFn: (song) => `${normalizeSearchText(song.artist)} ${normalizeSearchText(song.title)}`,
      },
    ],
    includeScore: true,
    threshold: 0.5,
    ignoreLocation: true,
  })
}

function localMatches(normalized: string) {
  const matches = fuse?.search(normalized, { limit: 12 }) || []
  return {
    songs: matches.map((result) => result.item),
    weak: matches.length === 0 || (matches[0]?.score ?? 1) > 0.55,
  }
}

const explain = (error: unknown, fallback: string) => {
  const e = error as { code?: string; status?: number }
  return ({
    duplicate_song: 'That song is already queued or playing.',
    rate_limited: 'Please wait a moment before trying again.',
    party_expired: 'This party has ended. Ask the host for a new QR code.',
    guest_credential_expired: 'Your party session expired. Reload this page to rejoin.',
    song_unavailable: 'That song is no longer available.',
    youtube_quota_exhausted: 'Live search quota is exhausted. Try a catalog title instead.',
    fallback_quota_exhausted: 'Live search quota is exhausted. Try a catalog title instead.',
    youtube_key_unconfigured: 'Live search is temporarily unavailable. Try a catalog title instead.',
    fallback_unavailable: 'Live search is temporarily unavailable. Try a catalog title instead.',
    fallback_candidate_unavailable: 'That fallback candidate is no longer requestable. Search again.',
  } as Record<string, string>)[e.code || ''] || fallback
}

async function reconcile() {
  if (!credential.value) return
  try {
    queue.value = (await loadQueue(credential.value)).queue
    refreshMessage.value = ''
    refreshErrorKind.value = ''
  } catch (error) {
    if ((error as { code?: string }).code === 'guest_credential_expired' && !backgroundRejoinAttempted) {
      backgroundRejoinAttempted = true
      try {
        const nextCredential = await rejoinOnce()
        queue.value = (await loadQueue(nextCredential)).queue
        refreshMessage.value = ''
        refreshErrorKind.value = ''
        return
      } catch (rejoinError) {
        refreshMessage.value = explain(rejoinError, 'Queue could not be loaded.')
        refreshErrorKind.value = (rejoinError as { code?: string }).code || ''
        return
      }
    }
    refreshMessage.value = explain(error, 'Queue could not be loaded.')
    refreshErrorKind.value = (error as { code?: string }).code || ''
  }
}

async function search() {
  if (!credential.value) return
  const normalized = normalizeSearchText(query.value)
  if (!normalized) {
    songs.value = indexSongs.value.slice(0, 20)
    fallbackSuggested.value = false
    fallbackSearched.value = false
    fallbackResultCount.value = 0
    return
  }
  searching.value = true
  try {
    const local = localMatches(normalized)
    songs.value = local.songs
    // Scores above 0.55 are weak enough to offer the explicit fallback. This still
    // catches genuinely poor matches while retaining ordinary multi-character typos.
    fallbackSuggested.value = local.weak
  } catch (error) {
    message.value = explain(error, 'Songs could not be loaded.')
    errorKind.value = (error as { code?: string }).code || ''
  } finally {
    searching.value = false
  }
}

async function searchFallback() {
  if (
    !credential.value ||
    !fallbackSuggested.value ||
    !normalizeSearchText(query.value) ||
    fallbackSearching.value
  ) return
  if (searchTimer) clearTimeout(searchTimer)
  const requestedValue = query.value
  const requestedQuery = normalizeSearchText(query.value)
  searching.value = true
  fallbackSearching.value = true
  try {
    try {
      const refreshedCatalog = await loadCatalogIndex(credential.value, true)
      if (requestedQuery !== normalizeSearchText(query.value)) return
      setCatalogIndex(refreshedCatalog.songs)
      const refreshedLocal = localMatches(requestedQuery)
      songs.value = refreshedLocal.songs
      fallbackSuggested.value = refreshedLocal.weak
      if (!refreshedLocal.weak) {
        fallbackSearched.value = false
        fallbackResultCount.value = 0
        message.value = 'Catalog refreshed: a newly approved song is now available.'
        errorKind.value = ''
        return
      }
    } catch {
      // Continue with the already-loaded sanitized catalog when a refresh is unavailable.
    }
    if (requestedQuery !== normalizeSearchText(query.value)) return
    let response
    try {
      response = await fallbackSearchSongs(credential.value, requestedValue)
    } catch (error) {
      if ((error as { code?: string }).code !== 'guest_credential_expired') throw error
      const rejoined = await rejoinOnce()
      if (!rejoined || !credential.value) throw error
      if (requestedQuery !== normalizeSearchText(query.value)) return
      response = await fallbackSearchSongs(credential.value, requestedValue)
    }
    if (requestedQuery !== normalizeSearchText(query.value)) return
    const youtubeSongs = (response.songs || []).map((song) => ({
      ...normalizeCatalogSong(song),
      source: 'youtube' as const,
    }))
    const displayedSongs = [...songs.value, ...youtubeSongs]
      .filter(
        (song, i, all) =>
          all.findIndex((candidate) => candidate.youtubeId === song.youtubeId) === i,
      )
      .slice(0, 12)
    songs.value = displayedSongs
    fallbackResultCount.value = displayedSongs.filter((song) => song.source === 'youtube').length
    fallbackSearched.value = true
    fallbackSuggested.value = false
    message.value = ''
    errorKind.value = ''
    if (response.cached || response.replay) message.value = 'Showing a cached YouTube search.'
  } catch (error) {
    message.value = explain(error, 'Songs could not be loaded.')
    errorKind.value = (error as { code?: string }).code || ''
  } finally {
    searching.value = false
    fallbackSearching.value = false
  }
}

function scheduleSearch() {
  if (searchTimer) clearTimeout(searchTimer)
  fallbackSuggested.value = false
  fallbackSearched.value = false
  fallbackResultCount.value = 0
  searchTimer = setTimeout(search, 300)
}

function setPendingAttempt(youtubeId: string, attempt: PendingAttempt | null) {
  const next = new Map(pendingAttempts.value)
  if (attempt) next.set(youtubeId, attempt)
  else next.delete(youtubeId)
  pendingAttempts.value = next
}

function attemptError(error: unknown, fallback: string) {
  const code = (error as { code?: string }).code || ''
  return { code, message: explain(error, fallback) }
}

function showUncertainRequest(attempt: PendingAttempt, error: unknown) {
  const detail = attemptError(error, 'The request could not be confirmed.')
  requestMessage.value = detail.code === 'guest_credential_expired'
    ? `${attempt.title} may already be in the queue. The original party session expired and cannot verify the outcome. Ask the host to check the queue before trying again.`
    : `${attempt.title} may already be in the queue. Retry this same request to check safely. ${detail.message}`
  requestErrorKind.value = detail.code || 'request_outcome_uncertain'
}

async function submitAttempt(attempt: PendingAttempt) {
  if (attempt.source === 'youtube') return requestFallbackSong(attempt.credential, attempt.youtubeId, attempt.key)
  return requestSong(attempt.credential, attempt.youtubeId, attempt.key)
}

async function add(song: LibrarySong) {
  if (!credential.value) return
  if (pendingSongs.value.has(song.youtubeId)) return
  let attempt = pendingAttempts.value.get(song.youtubeId)
  if (!attempt) {
    attempt = {
      credential: credential.value,
      key: `guest-${song.youtubeId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      source: song.source === 'youtube' ? 'youtube' : 'catalog',
      youtubeId: song.youtubeId,
      title: song.title,
      uncertain: false,
      rejoined: false,
    }
    setPendingAttempt(song.youtubeId, attempt)
  }
  pendingSongs.value = new Set(pendingSongs.value).add(song.youtubeId)
  try {
    let firstError: unknown
    try { await submitAttempt(attempt) } catch (error) { firstError = error }
    if (firstError && (firstError as { ambiguous?: boolean }).ambiguous) {
      attempt.uncertain = true
      try { await submitAttempt(attempt) } catch (retryError) {
        showUncertainRequest(attempt, retryError)
        return
      }
    } else if (
      firstError &&
      (firstError as { code?: string }).code === 'guest_credential_expired' &&
      !attempt.uncertain &&
      !attempt.rejoined
    ) {
      attempt.rejoined = true
      try {
        attempt.credential = await rejoinOnce()
        try { await submitAttempt(attempt) } catch (retryError) {
          if (!(retryError as { ambiguous?: boolean }).ambiguous) throw retryError
          attempt.uncertain = true
          try { await submitAttempt(attempt) } catch (ambiguousError) {
            showUncertainRequest(attempt, ambiguousError)
            return
          }
        }
      } catch (retryError) {
        if (attempt.uncertain) throw retryError
        const detail = attemptError(retryError, 'We could not rejoin this party.')
        requestMessage.value = detail.message
        requestErrorKind.value = detail.code
        setPendingAttempt(song.youtubeId, null)
        return
      }
    } else if (firstError) {
      throw firstError
    }
    setPendingAttempt(song.youtubeId, null)
    requestMessage.value = `${attempt.title} was added to the queue.`
    requestErrorKind.value = ''
    void reconcile()
  } catch (error) {
    if (attempt.uncertain) {
      showUncertainRequest(attempt, error)
    } else {
      setPendingAttempt(song.youtubeId, null)
      const detail = attemptError(error, 'That song could not be requested.')
      requestMessage.value = detail.message
      requestErrorKind.value = detail.code
    }
  } finally {
    const next = new Set(pendingSongs.value)
    next.delete(song.youtubeId)
    pendingSongs.value = next
  }
}

function retryPending(attempt: PendingAttempt) {
  return add({
    id: attempt.youtubeId,
    youtubeId: attempt.youtubeId,
    title: attempt.title,
    artist: '',
    source: attempt.source === 'youtube' ? 'youtube' : 'local',
  })
}

onMounted(async () => {
  try {
    credential.value = partyCredential(code.value) || (await joinParty(code.value)).credential
    try {
      const catalog = await loadCatalogIndex(credential.value)
      setCatalogIndex(catalog.songs)
    } catch {
      // Compatibility with older servers: use the bounded browse endpoint as an index seed.
      setCatalogIndex((await searchSongs(credential.value, '')).songs)
    }
    await Promise.all([reconcile(), search()])
    stopWake = await startQueueWakeHint(credential.value, reconcile)
  } catch (error) {
    message.value = explain(error, 'We could not join this party. Check the QR code and try again.')
    errorKind.value = (error as { code?: string }).code || ''
  } finally {
    loading.value = false
  }
})

onUnmounted(() => {
  stopWake()
  if (searchTimer) clearTimeout(searchTimer)
})
</script>

<template>
  <main class="party-page" aria-labelledby="party-title">
    <header><p class="eyebrow">Starsummit Karaoke</p><h1 id="party-title">Request a song</h1><p>Party <strong>{{ code }}</strong></p></header>
    <p v-if="loading" role="status">Joining party…</p>
    <section v-else>
      <p v-if="requestMessage" class="message" :data-error="Boolean(requestErrorKind)" role="status">{{ requestMessage }}</p>
      <p v-if="refreshMessage" class="message" :data-error="Boolean(refreshErrorKind)" role="alert">{{ refreshMessage }}</p>
      <p v-if="message" class="message" :data-error="Boolean(errorKind)" role="alert">{{ message }}</p>
      <section v-if="unresolvedAttempts.length" aria-labelledby="pending-requests-title">
        <h2 id="pending-requests-title">Requests needing confirmation</h2>
        <ul>
          <li v-for="attempt in unresolvedAttempts" :key="attempt.youtubeId">
            <span>{{ attempt.title }}</span>
            <button type="button" :disabled="pendingSongs.has(attempt.youtubeId)" @click="retryPending(attempt)">
              {{ pendingSongs.has(attempt.youtubeId) ? 'Checking…' : 'Retry same request' }}
            </button>
          </li>
        </ul>
      </section>
      <section aria-labelledby="search-title"><h2 id="search-title">Browse songs</h2><label for="song-search">Search title or artist</label><input id="song-search" v-model="query" role="combobox" aria-controls="song-suggestions" aria-autocomplete="list" type="search" autocomplete="off" placeholder="Try a song or artist" @input="scheduleSearch" @keyup.enter="searchFallback" /><button v-if="fallbackSuggested && !searching" type="button" @click="searchFallback">Search YouTube for this song</button><p v-if="searching" role="status">{{ fallbackSearching ? 'Searching YouTube…' : 'Searching catalog…' }}</p><p v-else-if="fallbackSearched" class="search-status" role="status">{{ fallbackResultCount ? `YouTube search completed: ${fallbackResultCount} eligible result${fallbackResultCount === 1 ? '' : 's'} ${catalogResultCount ? 'added below. Catalog matches remain first.' : 'shown below.'}` : `YouTube search completed, but no eligible YouTube results were found.${catalogResultCount ? ' The catalog matches below are still shown.' : ''}` }}</p><ul v-if="!searching && songs.length" id="song-suggestions" role="listbox"><li v-for="song in songs" :key="song.id" role="option"><span><strong>{{ song.title }}</strong><small>{{ song.source === 'youtube' ? (song.channelTitle ? `${song.channelTitle} · YouTube fallback` : 'YouTube fallback') : `${song.artist} · Catalog` }}</small></span><button type="button" :disabled="song.requestable === false || pendingSongs.has(song.youtubeId)" @click="add(song)">{{ song.requestable === false ? 'Unavailable' : pendingSongs.has(song.youtubeId) ? 'Adding…' : pendingAttempts.has(song.youtubeId) ? 'Retry same request' : 'Queue' }}</button></li></ul><p v-else-if="!searching">No eligible songs found. Try a different spelling.</p></section>
      <section aria-labelledby="queue-title"><h2 id="queue-title">Queue</h2><ul v-if="queue.length"><li v-for="item in queue" :key="item.id"><span><strong>{{ item.song.title }}</strong><small>{{ item.song.artist }}</small></span><em>{{ item.status === 'playing' ? 'Playing now' : 'Queued' }}</em></li></ul><p v-else>The queue is empty. Be the first to request a song!</p></section>
    </section>
  </main>
</template>

<style scoped>
.party-page { min-height: 100dvh; max-width: 42rem; margin: 0 auto; padding: 1.25rem; box-sizing: border-box; font-family: system-ui, sans-serif; background: #171320; color: #fff; }
header { margin-bottom: 1.5rem; } .eyebrow { color: #6750a4; font-weight: 700; }
h1 { margin: 0; font-size: 2rem; } h2 { margin-top: 1.75rem; }
label { display: block; margin-bottom: .35rem; } input { width: 100%; box-sizing: border-box; padding: .75rem; font-size: 1rem; }
ul { list-style: none; padding: 0; } li { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .8rem 0; border-bottom: 1px solid #ddd; }
small { display: block; color: #cfc5dc; } button { padding: .55rem .8rem; border: 0; border-radius: .45rem; background: #b176ff; color: #170d21; font-weight: 700; } button:disabled { opacity: .5; }
.message { padding: .8rem; border-radius: .5rem; background: #30263e; } .message[data-error='true'] { color: #ffd7df; background: #652b3c; }
.search-status { padding: .65rem; background: #30263e; border-radius: .4rem; }
</style>
