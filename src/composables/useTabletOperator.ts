import { computed, nextTick, onMounted, onUnmounted, proxyRefs, ref } from 'vue'
import {
  authenticateTablet,
  createParty,
  issuePlaybackCommand,
  loadActiveParty,
  loadNext,
  loadTabletStatus,
  transitionQueue,
  type TabletQueueItem,
  type TabletStatus,
} from '@/services/tabletApi'

const storageKey = 'karaoke:tablet:session'
const playbackStorageKey = 'karaoke:tablet:pending-playback'

type StoredSession = { token: string; partyId?: string; partyCode?: string }
type PendingPlayback = { partyId: string; queueId: string; action: 'play' | 'pause'; key: string }
export type QueueConfirmation = { item: TabletQueueItem; action: 'completed' | 'failed' }

export function useTabletOperator() {
  const token = ref<string | null>(null)
  const identity = ref('')
  const password = ref('')
  const partyId = ref('')
  const status = ref<TabletStatus | null>(null)
  const loading = ref(false)
  const refreshing = ref(false)
  const busy = ref(false)
  const message = ref('')
  const error = ref(false)
  const pendingPlayback = ref<PendingPlayback | null>(null)
  const queueOpen = ref(false)
  const confirmation = ref<QueueConfirmation | null>(null)
  const failureReason = ref('Skipped by operator')
  let confirmationTrigger: HTMLButtonElement | null = null
  let refreshTimer: ReturnType<typeof setInterval> | undefined

  const queue = computed(() => status.value?.queue || [])
  const playing = computed(() => queue.value.find((item) => item.status === 'playing'))
  const queued = computed(() => queue.value.filter((item) => item.status === 'queued'))
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
  const playbackAction = computed<'play' | 'pause' | null>(() => {
    if (!playing.value || !controllerReady.value || !controllerMatchesPlaying.value) return null
    if (playerState.value === 'paused') return 'play'
    if (playerState.value === 'playing') return 'pause'
    return null
  })
  const playbackDisabledReason = computed(() => {
    if (partyExpired.value) return 'This party has expired.'
    if (!playing.value) return 'Start the next queued song first.'
    if (busy.value) return 'Waiting for the current operation to finish.'
    if (!controllerReady.value) return 'The controller is unavailable or stale.'
    if (!controllerMatchesPlaying.value) return 'Video mismatch: waiting for controller recovery.'
    if (!playbackAction.value) return 'Playback state is still unknown.'
    return ''
  })
  const nowPlayingTitle = computed(() => playing.value?.song?.title || 'No song playing')
  const nowPlayingArtist = computed(() => playing.value?.song?.artist || '')

  function explain(cause: unknown, fallback: string) {
    const code = (cause as { code?: string })?.code
    return (
      (
        {
          bad_password: 'The tablet account or password is incorrect.',
          forbidden: 'This account is not allowed to operate the tablet.',
          party_expired: 'This party has expired. Create a new party to continue.',
          stale_transition: 'The queue changed elsewhere. The latest state is shown.',
          not_next: 'Fair rotation selected another song. The latest state is shown.',
          party_already_playing: 'A song is already playing.',
          controller_ambiguous: 'More than one current controller is available.',
          controller_unavailable: 'The controller is unavailable.',
          controller_state_mismatch: 'Video mismatch: controller recovery is still needed.',
          nothing_playing: 'No active song is available to control.',
          idempotency_conflict: 'That playback action conflicts with an earlier request.',
        } as Record<string, string>
      )[code || ''] || fallback
    )
  }

  function savedSession(): StoredSession | null {
    try {
      const value = JSON.parse(sessionStorage.getItem(storageKey) || '') as StoredSession
      return typeof value.token === 'string' && value.token ? value : null
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

  function savePending(value: PendingPlayback | null) {
    pendingPlayback.value = value
    try {
      if (value) sessionStorage.setItem(playbackStorageKey, JSON.stringify(value))
      else sessionStorage.removeItem(playbackStorageKey)
    } catch {}
  }

  function restorePending() {
    try {
      const value = JSON.parse(sessionStorage.getItem(playbackStorageKey) || '') as PendingPlayback
      if (
        value.partyId === partyId.value &&
        ['play', 'pause'].includes(value.action) &&
        value.queueId &&
        value.key
      )
        pendingPlayback.value = value
    } catch {}
  }

  function reconcilePending() {
    const pending = pendingPlayback.value
    if (!pending) return
    if (pending.partyId !== partyId.value || pending.queueId !== playing.value?.id)
      return savePending(null)
    const confirmed =
      controllerMatchesPlaying.value &&
      ((pending.action === 'play' && playerState.value === 'playing') ||
        (pending.action === 'pause' && playerState.value === 'paused'))
    if (confirmed) {
      savePending(null)
      message.value = pending.action === 'play' ? 'Playback resumed.' : 'Playback paused.'
    } else
      message.value = `${pending.action === 'play' ? 'Play' : 'Pause'} requested; waiting for controller confirmation.`
  }

  async function refresh() {
    if (!token.value || !partyId.value || refreshing.value) return
    refreshing.value = true
    try {
      const knownCode = partyCode.value
      status.value = await loadTabletStatus(token.value, partyId.value)
      if (knownCode && !status.value.party.code) status.value.party.code = knownCode
      saveSession()
      reconcilePending()
      if (partyExpired.value) {
        message.value = 'This party has expired. Create a new party to continue.'
        error.value = true
      } else error.value = false
    } catch (cause) {
      const code = (cause as { status?: number }).status
      if (code === 401 || code === 403) {
        token.value = null
        partyId.value = ''
        status.value = null
        clearSession()
        message.value = 'Your tablet session expired. Sign in again.'
      } else message.value = explain(cause, 'Reconnecting to the latest party state…')
      error.value = true
    } finally {
      refreshing.value = false
    }
  }

  async function restoreActiveParty() {
    if (!token.value) return
    try {
      const result = await loadActiveParty(token.value)
      partyId.value = result.party?.id || ''
      status.value = null
      if (partyId.value) await refresh()
      saveSession()
    } catch (cause) {
      message.value = explain(cause, 'Could not restore the active party. Try again.')
      error.value = true
    }
  }

  async function signIn() {
    loading.value = true
    message.value = ''
    try {
      token.value = (await authenticateTablet(identity.value, password.value)).token
      password.value = ''
      await restoreActiveParty()
    } catch (cause) {
      message.value = explain(cause, 'Sign-in failed. Check your connection and try again.')
      error.value = true
    } finally {
      loading.value = false
    }
  }

  async function createActiveParty() {
    if (!token.value || loading.value) return
    loading.value = true
    try {
      const party = await createParty(token.value)
      partyId.value = party.id
      status.value = { party: { ...party, status: 'active' }, queue: [], controller: null }
      await refresh()
      if (status.value && !status.value.party.code) status.value.party.code = party.code
      saveSession()
      message.value = 'Party ready. Guests can scan the QR code.'
      error.value = false
    } catch (cause) {
      message.value = explain(cause, 'Could not create a party.')
      error.value = true
    } finally {
      loading.value = false
    }
  }

  async function startNext() {
    if (
      !token.value ||
      !partyId.value ||
      busy.value ||
      partyExpired.value ||
      !controllerReady.value ||
      playing.value
    )
      return
    busy.value = true
    try {
      const next = await loadNext(token.value, partyId.value)
      if (!next.queue) {
        message.value = 'No queued songs are waiting.'
        return
      }
      await transitionQueue(token.value, next.queue.id, 'queued', 'playing')
      await refresh()
      message.value = `${next.queue.song?.title || 'Song'} is now playing.`
      error.value = false
    } catch (cause) {
      await refresh()
      message.value = explain(cause, 'Start was uncertain; the latest state is shown.')
      error.value = true
    } finally {
      busy.value = false
    }
  }

  function openQueueConfirmation(
    item: TabletQueueItem,
    action: QueueConfirmation['action'],
    event: MouseEvent,
  ) {
    confirmationTrigger = event.currentTarget as HTMLButtonElement
    confirmation.value = { item, action }
  }

  function restoreConfirmationFocus() {
    void nextTick(() => {
      if (confirmationTrigger?.isConnected) confirmationTrigger.focus()
      else document.querySelector<HTMLButtonElement>('#queue-drawer button.quiet')?.focus()
      confirmationTrigger = null
    })
  }

  function dismissConfirmation() {
    confirmation.value = null
    restoreConfirmationFocus()
  }

  function playbackKey(action: 'play' | 'pause') {
    const unique =
      typeof crypto?.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`
    return `tablet:${partyId.value}:${playing.value?.id}:${action}:${unique}`.slice(0, 128)
  }

  async function controlPlayback() {
    const action = playbackAction.value
    if (!token.value || !partyId.value || !action || playbackDisabledReason.value) return
    const existing = pendingPlayback.value
    const operation =
      existing?.partyId === partyId.value &&
      existing.queueId === playing.value?.id &&
      existing.action === action
        ? existing
        : { partyId: partyId.value, queueId: playing.value!.id, action, key: playbackKey(action) }
    savePending(operation)
    busy.value = true
    try {
      await issuePlaybackCommand(token.value, partyId.value, action, operation.key)
      await refresh()
    } catch (cause) {
      await refresh()
      if (pendingPlayback.value) {
        message.value = explain(cause, 'Playback was uncertain; retry will reuse the same request.')
        error.value = true
      }
    } finally {
      busy.value = false
    }
  }

  async function confirmQueueAction() {
    const value = confirmation.value
    if (!token.value || !value || busy.value) return
    busy.value = true
    try {
      await transitionQueue(
        token.value,
        value.item.id,
        value.item.status,
        value.action,
        value.action === 'failed' ? failureReason.value : undefined,
      )
      confirmation.value = null
      await refresh()
      message.value = value.action === 'completed' ? 'Song marked complete.' : 'Song skipped.'
      error.value = false
    } catch (cause) {
      await refresh()
      message.value = explain(cause, 'That change was uncertain; the latest state is shown.')
      error.value = true
    } finally {
      busy.value = false
      restoreConfirmationFocus()
    }
  }

  function signOut() {
    token.value = null
    partyId.value = ''
    status.value = null
    message.value = ''
    clearSession()
  }
  function openAdmin() {
    if (window.confirm('Open Advanced Admin? Party controls stay available there.'))
      window.location.assign('/admin')
  }

  onMounted(async () => {
    const saved = savedSession()
    if (saved) {
      token.value = saved.token
      partyId.value = saved.partyId || ''
      if (partyId.value) {
        status.value = {
          party: { id: partyId.value, code: saved.partyCode, expiresAt: '', status: 'active' },
          queue: [],
          controller: null,
        }
        restorePending()
        await refresh()
      } else await restoreActiveParty()
    }
    refreshTimer = setInterval(refresh, 15000)
    window.addEventListener('focus', refresh)
  })
  onUnmounted(() => {
    if (refreshTimer) clearInterval(refreshTimer)
    window.removeEventListener('focus', refresh)
  })

  return proxyRefs({
    token,
    identity,
    password,
    status,
    loading,
    refreshing,
    busy,
    message,
    error,
    queue,
    queued,
    playing,
    partyCode,
    joinUrl,
    partyExpired,
    controllerReady,
    controllerMatchesPlaying,
    playerState,
    playbackAction,
    playbackDisabledReason,
    nowPlayingTitle,
    nowPlayingArtist,
    pendingPlayback,
    queueOpen,
    confirmation,
    failureReason,
    signIn,
    signOut,
    refresh,
    createActiveParty,
    startNext,
    controlPlayback,
    openQueueConfirmation,
    dismissConfirmation,
    confirmQueueAction,
    openAdmin,
  })
}
