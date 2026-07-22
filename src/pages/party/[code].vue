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
const query = ref('')
const loading = ref(true)
const searching = ref(false)
const message = ref('')
const errorKind = ref('')
const pendingSongs = ref(new Set<string>())
let stopWake: () => void = () => undefined
let searchTimer: ReturnType<typeof setTimeout> | undefined
let rejoining = false
let fuse: Fuse<LibrarySong> | null = null
async function rejoinOnce() { if (rejoining) return false; rejoining = true; try { clearPartyCredential(code.value); credential.value = (await joinParty(code.value)).credential; stopWake(); stopWake = await startQueueWakeHint(credential.value, reconcile); return true } catch { return false } finally { rejoining = false } }

const explain = (error: unknown, fallback: string) => {
  const e = error as { code?: string; status?: number }
  errorKind.value = e.code || ''
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
    message.value = ''
    errorKind.value = ''
  } catch (error) {
    if ((error as { code?: string }).code === 'guest_credential_expired' && await rejoinOnce()) return reconcile()
    message.value = explain(error, 'Queue could not be loaded.')
  }
}

async function search() {
  if (!credential.value) return
  const normalized = normalizeSearchText(query.value)
  if (!normalized) { songs.value = indexSongs.value.slice(0, 20); return }
  searching.value = true
  try {
    const local = fuse?.search(normalized, { limit: 12 }).map((result) => result.item) || []
    songs.value = local
    // Fuse scores above 0.42 are intentionally treated as weak and may spend fallback quota.
    const weak = local.length === 0 || (fuse?.search(normalized, { limit: 1 })[0]?.score || 1) > 0.42
    if (weak) {
      const response = await fallbackSearchSongs(credential.value, query.value)
      songs.value = [...local, ...(response.songs || []).map((song) => ({ ...normalizeCatalogSong(song), source: 'youtube' as const }))].filter((song, i, all) => all.findIndex((candidate) => candidate.youtubeId === song.youtubeId) === i).slice(0, 12)
      if (response.cached || response.replay) message.value = 'Showing a cached YouTube search.'
    }
  } catch (error) {
    if ((error as { code?: string }).code === 'guest_credential_expired' && await rejoinOnce()) return search()
    message.value = explain(error, 'Songs could not be loaded.')
  } finally {
    searching.value = false
  }
}

function scheduleSearch() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(search, 300)
}

async function add(song: LibrarySong, idempotencyKey = `guest-${song.youtubeId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`) {
  if (!credential.value) return
  if (pendingSongs.value.has(song.youtubeId)) return
  pendingSongs.value = new Set(pendingSongs.value).add(song.youtubeId)
  try {
    if (song.source === 'youtube') await requestFallbackSong(credential.value, song.youtubeId, idempotencyKey)
    else await requestSong(credential.value, song.youtubeId)
    await reconcile()
    message.value = `${song.title} was added to the queue.`
    errorKind.value = ''
  } catch (error) {
    if ((error as { code?: string }).code === 'guest_credential_expired') {
      const next = new Set(pendingSongs.value); next.delete(song.youtubeId); pendingSongs.value = next
      if (await rejoinOnce()) return add(song, idempotencyKey)
    }
    message.value = explain(error, 'That song could not be requested.')
  } finally {
    const next = new Set(pendingSongs.value)
    next.delete(song.youtubeId)
    pendingSongs.value = next
  }
}

onMounted(async () => {
  try {
    credential.value = partyCredential(code.value) || (await joinParty(code.value)).credential
    try {
      const catalog = await loadCatalogIndex(credential.value)
      indexSongs.value = catalog.songs
    } catch {
      // Compatibility with older servers: use the bounded browse endpoint as an index seed.
      indexSongs.value = (await searchSongs(credential.value, '')).songs
    }
    fuse = new Fuse(indexSongs.value, { keys: [{ name: 'title', getFn: (song) => normalizeSearchText(song.title) }, { name: 'artist', getFn: (song) => normalizeSearchText(song.artist) }, { name: 'combined', getFn: (song) => `${normalizeSearchText(song.artist)} ${normalizeSearchText(song.title)}` }], includeScore: true, threshold: 0.5, ignoreLocation: true })
    await Promise.all([reconcile(), search()])
    stopWake = await startQueueWakeHint(credential.value, reconcile)
  } catch (error) {
    message.value = explain(error, 'We could not join this party. Check the QR code and try again.')
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
      <p v-if="message" class="message" :data-error="Boolean(errorKind)" role="alert">{{ message }}</p>
      <section aria-labelledby="search-title"><h2 id="search-title">Browse songs</h2><label for="song-search">Search title or artist</label><input id="song-search" v-model="query" role="combobox" aria-controls="song-suggestions" aria-autocomplete="list" type="search" autocomplete="off" placeholder="Try a song or artist" @input="scheduleSearch" /><p v-if="searching" role="status">Searching…</p><ul v-else-if="songs.length" id="song-suggestions" role="listbox"><li v-for="song in songs" :key="song.id" role="option"><span><strong>{{ song.title }}</strong><small>{{ song.artist }}<template v-if="song.source === 'youtube'"> · YouTube fallback</template></small></span><button type="button" :disabled="song.requestable === false || pendingSongs.has(song.youtubeId)" @click="add(song)">{{ song.requestable === false ? 'Unavailable' : pendingSongs.has(song.youtubeId) ? 'Adding…' : 'Queue' }}</button></li></ul><p v-else>No eligible songs found. Try a different spelling.</p></section>
      <section aria-labelledby="queue-title"><h2 id="queue-title">Queue</h2><ul v-if="queue.length"><li v-for="item in queue" :key="item.id"><span><strong>{{ item.song.title }}</strong><small>{{ item.song.artist }}</small></span><em>{{ item.status === 'playing' ? 'Playing now' : 'Queued' }}</em></li></ul><p v-else>The queue is empty. Be the first to request a song!</p></section>
    </section>
  </main>
</template>

<style scoped>
.party-page { max-width: 42rem; margin: 0 auto; padding: 1.25rem; font-family: system-ui, sans-serif; }
header { margin-bottom: 1.5rem; } .eyebrow { color: #6750a4; font-weight: 700; }
h1 { margin: 0; font-size: 2rem; } h2 { margin-top: 1.75rem; }
label { display: block; margin-bottom: .35rem; } input { width: 100%; box-sizing: border-box; padding: .75rem; font-size: 1rem; }
ul { list-style: none; padding: 0; } li { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .8rem 0; border-bottom: 1px solid #ddd; }
small { display: block; color: #666; } button { padding: .55rem .8rem; } .message[data-error='true'] { color: #a00; }
</style>
