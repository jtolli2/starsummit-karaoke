import { computed, nextTick, onMounted, onUnmounted, proxyRefs, ref } from 'vue'
import {
  authenticateTablet,
  createParty,
  issuePlaybackCommand,
  loadActiveParty,
  loadNext,
  loadTabletStatus,
  transitionQueue,
  reorderTabletQueue,
  type TabletQueueItem,
  type TabletStatus,
} from '@/services/tabletApi'

const storageKey = 'karaoke:tablet:session'
const playbackStorageKey = 'karaoke:tablet:pending-playback'

type StoredSession = { token: string; partyId?: string; partyCode?: string }
type PendingPlayback = {
  partyId: string
  queueId: string
  action: 'play' | 'pause' | 'open_video'
  key: string
  expiresAt?: string
}
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
  let refreshPromise: Promise<boolean> | null = null
  let refreshAfterFlight: Promise<boolean> | null = null
  let discoveryPromise: Promise<void> | null = null
  let discoveryGeneration = 0
  let actionGeneration = 0
  let confirmationRun = 0
  let confirmationTimer: ReturnType<typeof setTimeout> | undefined
  let mounted = true
  let creatingParty = false

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
  const canRecoverPlayback = computed(() =>
    Boolean(
      playing.value &&
      controllerReady.value &&
      !busy.value &&
      !partyExpired.value &&
      (!controllerMatchesPlaying.value || !['playing', 'paused'].includes(playerState.value)),
    ),
  )
  const nowPlayingTitle = computed(() => playing.value?.song?.title || 'No song playing')
  const nowPlayingArtist = computed(() => playing.value?.song?.artist || '')
  const nowPlayingThumbnailUrl = computed(() => {
    const youtubeId = playing.value?.song?.youtubeId
    return youtubeId && /^[A-Za-z0-9_-]{11}$/.test(youtubeId)
      ? `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`
      : ''
  })

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
          stale_reorder: 'The queue changed elsewhere. The latest order is shown.',
          queue_not_reorderable: 'Only queued songs can be moved.',
        } as Record<string, string>
      )[code || ''] || fallback
    )
  }

  function actionMayHaveApplied(cause: unknown) {
    const status = (cause as { status?: number })?.status
    return status === undefined || status >= 500
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
        ['play', 'pause', 'open_video'].includes(value.action) &&
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
      controllerReady.value &&
      controllerMatchesPlaying.value &&
      ((pending.action === 'play' && playerState.value === 'playing') ||
        (pending.action === 'pause' && playerState.value === 'paused') ||
        (pending.action === 'open_video' && playerState.value === 'playing'))
    if (confirmed) {
      savePending(null)
      message.value =
        pending.action === 'play'
          ? 'Playback resumed.'
          : pending.action === 'pause'
            ? 'Playback paused.'
            : 'Selected video confirmed playing.'
    } else
      message.value = `${pending.action === 'play' ? 'Play' : pending.action === 'pause' ? 'Pause' : 'Video recovery'} requested; waiting for controller confirmation.`
  }

  function refresh(): Promise<void> {
    return refreshStatus().then(() => undefined)
  }

  function refreshStatus(): Promise<boolean> {
    if (!mounted || !token.value || !partyId.value) return Promise.resolve(false)
    if (refreshAfterFlight) return refreshAfterFlight
    if (refreshPromise) {
      if (!refreshAfterFlight) {
        const inFlight = refreshPromise
        refreshAfterFlight = inFlight.then(() => {
          refreshAfterFlight = null
          return loadCurrentStatus()
        })
      }
      return refreshAfterFlight
    }
    return loadCurrentStatus()
  }

  function loadCurrentStatus() {
    if (!token.value || !partyId.value) {
      refreshing.value = false
      return Promise.resolve(false)
    }
    const requestToken = token.value
    const requestPartyId = partyId.value
    refreshing.value = true
    const run: Promise<boolean> = Promise.resolve().then(async () => {
      try {
        const knownCode = partyCode.value
        const nextStatus = await loadTabletStatus(requestToken, requestPartyId)
        if (!mounted || token.value !== requestToken || partyId.value !== requestPartyId)
          return false
        status.value = nextStatus
        if (knownCode && !status.value.party.code) status.value.party.code = knownCode
        saveSession()
        reconcilePending()
        if (partyExpired.value) {
          message.value = 'This party has expired. Create a new party to continue.'
          error.value = true
          return false
        } else {
          error.value = false
          return true
        }
      } catch (cause) {
        if (!mounted || token.value !== requestToken || partyId.value !== requestPartyId)
          return false
        const code = (cause as { status?: number }).status
        if (code === 401 || code === 403) {
          token.value = null
          partyId.value = ''
          status.value = null
          clearSession()
          message.value = 'Your tablet session expired. Sign in again.'
        } else message.value = explain(cause, 'Reconnecting to the latest party state…')
        error.value = true
        return false
      } finally {
        if (refreshPromise === run) {
          refreshPromise = null
          refreshing.value = Boolean(refreshAfterFlight)
        }
      }
    })
    refreshPromise = run
    return run
  }

  async function restoreActiveParty() {
    if (!mounted || !token.value || discoveryPromise || creatingParty) return discoveryPromise
    const requestToken = token.value
    const generation = ++discoveryGeneration
    const run = (async () => {
      try {
        const result = await loadActiveParty(requestToken)
        if (!mounted || token.value !== requestToken || generation !== discoveryGeneration) return
        const nextPartyId = result.party?.id || ''
        if (partyId.value !== nextPartyId) {
          invalidateAction()
          confirmation.value = null
          partyId.value = nextPartyId
          status.value = result.party ? { party: result.party, queue: [], controller: null } : null
          savePending(null)
        }
        if (nextPartyId) await refresh()
        else saveSession()
      } catch (cause) {
        if (mounted && token.value === requestToken && generation === discoveryGeneration) {
          message.value = explain(cause, 'Could not restore the active party. Try again.')
          error.value = true
          if (partyId.value) await refresh()
        }
      }
    })()
    discoveryPromise = run
    try {
      await run
    } finally {
      if (discoveryPromise === run) discoveryPromise = null
    }
  }

  function cancelConfirmationBurst() {
    confirmationRun++
    if (confirmationTimer) clearTimeout(confirmationTimer)
    confirmationTimer = undefined
  }

  function invalidateAction() {
    actionGeneration++
    busy.value = false
    cancelConfirmationBurst()
  }

  function isActionCurrent(run: number, requestToken: string, requestPartyId: string) {
    return Boolean(
      mounted &&
      actionGeneration === run &&
      token.value === requestToken &&
      partyId.value === requestPartyId,
    )
  }

  function playbackConfirmed(queueId: string, expectedPlayerState: 'playing' | 'paused') {
    const item = queue.value.find((entry) => entry.id === queueId && entry.status === 'playing')
    return Boolean(
      item?.song?.youtubeId &&
      controllerReady.value &&
      status.value?.controller?.state?.videoId === item.song.youtubeId &&
      playerState.value === expectedPlayerState,
    )
  }

  function scheduleConfirmationBurst(
    queueId: string,
    expectedPlayerState: 'playing' | 'paused',
    onConfirmed?: () => void,
  ) {
    cancelConfirmationBurst()
    const run = confirmationRun
    const requestToken = token.value
    const requestPartyId = partyId.value
    const deadline = Date.now() + 30000
    const poll = async () => {
      if (
        run !== confirmationRun ||
        !mounted ||
        token.value !== requestToken ||
        partyId.value !== requestPartyId ||
        Date.now() >= deadline
      )
        return
      const refreshed = await refreshStatus()
      if (
        run !== confirmationRun ||
        !mounted ||
        token.value !== requestToken ||
        partyId.value !== requestPartyId
      )
        return
      if (refreshed && playbackConfirmed(queueId, expectedPlayerState)) {
        onConfirmed?.()
        return
      }
      if (partyExpired.value || !token.value || Date.now() >= deadline) return
      confirmationTimer = setTimeout(() => void poll(), Math.min(1000, deadline - Date.now()))
    }
    confirmationTimer = setTimeout(() => void poll(), 1000)
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
    const requestToken = token.value
    loading.value = true
    creatingParty = true
    try {
      invalidateAction()
      confirmation.value = null
      discoveryGeneration++
      const party = await createParty(requestToken)
      if (!mounted || token.value !== requestToken) return
      discoveryGeneration++
      partyId.value = party.id
      status.value = { party: { ...party, status: 'active' }, queue: [], controller: null }
      await refresh()
      if (!mounted || token.value !== requestToken || partyId.value !== party.id) return
      if (status.value && !status.value.party.code) status.value.party.code = party.code
      saveSession()
      message.value = 'Party ready. Guests can scan the QR code.'
      error.value = false
    } catch (cause) {
      if (mounted && token.value === requestToken) {
        message.value = explain(cause, 'Could not create a party.')
        error.value = true
      }
    } finally {
      creatingParty = false
      if (mounted) loading.value = false
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
    invalidateAction()
    const requestToken = token.value
    const requestPartyId = partyId.value
    const run = ++actionGeneration
    busy.value = true
    let startedQueueId = ''
    let startedSongTitle = 'Song'
    try {
      const next = await loadNext(requestToken, requestPartyId)
      if (!isActionCurrent(run, requestToken, requestPartyId)) return
      if (!next.queue) {
        message.value = 'No queued songs are waiting.'
        return
      }
      startedQueueId = next.queue.id
      startedSongTitle = next.queue.song?.title || 'Song'
      await transitionQueue(requestToken, next.queue.id, 'queued', 'playing')
      if (!isActionCurrent(run, requestToken, requestPartyId)) return
      const refreshed = await refreshStatus()
      if (!isActionCurrent(run, requestToken, requestPartyId)) return
      const confirmed = refreshed && playbackConfirmed(next.queue.id, 'playing')
      message.value = confirmed
        ? `${next.queue.song?.title || 'Song'} is now playing.`
        : `${next.queue.song?.title || 'Song'} started in the queue; waiting for TV confirmation.`
      error.value = false
      if (!confirmed)
        scheduleConfirmationBurst(next.queue.id, 'playing', () => {
          message.value = `${startedSongTitle} is now playing.`
          error.value = false
        })
    } catch (cause) {
      if (!isActionCurrent(run, requestToken, requestPartyId)) return
      const refreshed = await refreshStatus()
      if (!isActionCurrent(run, requestToken, requestPartyId)) return
      if (startedQueueId && actionMayHaveApplied(cause)) {
        if (refreshed && playbackConfirmed(startedQueueId, 'playing')) {
          message.value = `${startedSongTitle} is now playing.`
          error.value = false
          return
        }
        message.value = explain(cause, 'Start was uncertain; the latest state is shown.')
        error.value = true
        scheduleConfirmationBurst(startedQueueId, 'playing', () => {
          message.value = `${startedSongTitle} is now playing.`
          error.value = false
        })
        return
      }
      message.value = explain(cause, 'Start was uncertain; the latest state is shown.')
      error.value = true
    } finally {
      if (actionGeneration === run) busy.value = false
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

  function playbackKey(action: 'play' | 'pause' | 'open_video') {
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
    const isExpired = existing?.expiresAt && Date.parse(existing.expiresAt) <= Date.now()
    const operation =
      existing?.partyId === partyId.value &&
      existing.queueId === playing.value?.id &&
      existing.action === action &&
      !isExpired
        ? existing
        : { partyId: partyId.value, queueId: playing.value!.id, action, key: playbackKey(action) }
    await submitPlayback(operation)
  }

  async function retrySelectedPlayback() {
    if (!token.value || !partyId.value || !playing.value || !canRecoverPlayback.value) return
    const existing = pendingPlayback.value
    const isExpired = existing?.expiresAt && Date.parse(existing.expiresAt) <= Date.now()
    const operation =
      existing?.partyId === partyId.value &&
      existing.queueId === playing.value.id &&
      existing.action === 'open_video' &&
      !isExpired
        ? existing
        : {
            partyId: partyId.value,
            queueId: playing.value.id,
            action: 'open_video' as const,
            key: playbackKey('open_video'),
          }
    await submitPlayback(operation)
  }

  async function submitPlayback(operation: PendingPlayback) {
    cancelConfirmationBurst()
    if (!token.value || !partyId.value || operation.partyId !== partyId.value) return
    const requestToken = token.value
    const requestPartyId = partyId.value
    const run = ++actionGeneration
    savePending(operation)
    busy.value = true
    try {
      const result = await issuePlaybackCommand(
        requestToken,
        requestPartyId,
        operation.action,
        operation.key,
      )
      if (!isActionCurrent(run, requestToken, requestPartyId)) return
      if (result.status !== 'pending') {
        savePending(null)
        message.value =
          'The prior playback request is complete. Retry the selected video if needed.'
        await refresh()
        if (!isActionCurrent(run, requestToken, requestPartyId)) return
        return
      }
      savePending({ ...operation, expiresAt: result.expiresAt })
      const refreshed = await refreshStatus()
      if (!isActionCurrent(run, requestToken, requestPartyId)) return
      const target = operation.action === 'pause' ? 'paused' : 'playing'
      if (refreshed && playbackConfirmed(operation.queueId, target)) return
      scheduleConfirmationBurst(operation.queueId, target)
    } catch (cause) {
      if (!isActionCurrent(run, requestToken, requestPartyId)) return
      await refreshStatus()
      if (!isActionCurrent(run, requestToken, requestPartyId)) return
      if (pendingPlayback.value) {
        message.value = explain(cause, 'Playback was uncertain; retry will reuse the same request.')
        error.value = true
        if (actionMayHaveApplied(cause))
          scheduleConfirmationBurst(
            operation.queueId,
            operation.action === 'pause' ? 'paused' : 'playing',
          )
      }
    } finally {
      if (actionGeneration === run) busy.value = false
    }
  }

  async function confirmQueueAction() {
    const value = confirmation.value
    const requestToken = token.value
    const requestPartyId = partyId.value
    if (
      !requestToken ||
      !requestPartyId ||
      !value ||
      busy.value ||
      status.value?.party?.id !== requestPartyId
    )
      return
    invalidateAction()
    const run = ++actionGeneration
    busy.value = true
    try {
      await transitionQueue(
        requestToken,
        value.item.id,
        value.item.status,
        value.action,
        value.action === 'failed' ? failureReason.value : undefined,
      )
      if (!isActionCurrent(run, requestToken, requestPartyId)) return
      confirmation.value = null
      await refresh()
      if (!isActionCurrent(run, requestToken, requestPartyId)) return
      message.value = value.action === 'completed' ? 'Song marked complete.' : 'Song skipped.'
      error.value = false
    } catch (cause) {
      if (!isActionCurrent(run, requestToken, requestPartyId)) return
      await refresh()
      if (!isActionCurrent(run, requestToken, requestPartyId)) return
      message.value = explain(cause, 'That change was uncertain; the latest state is shown.')
      error.value = true
    } finally {
      if (actionGeneration === run) {
        busy.value = false
        restoreConfirmationFocus()
      }
    }
  }

  async function moveQueueItem(
    item: TabletQueueItem,
    target: 'up' | 'down' | { targetQueueId: string },
  ) {
    const requestToken = token.value
    const requestPartyId = partyId.value
    if (
      !requestToken ||
      !requestPartyId ||
      busy.value ||
      item.status !== 'queued' ||
      status.value?.party?.id !== requestPartyId
    )
      return
    const revision = status.value?.queueOrderRevision
    const digest = status.value?.queueOrderDigest
    if (revision === undefined || !digest) return
    invalidateAction()
    const run = ++actionGeneration
    busy.value = true
    error.value = false
    try {
      await reorderTabletQueue(requestToken, requestPartyId, item.id, target, revision, digest)
      if (!isActionCurrent(run, requestToken, requestPartyId)) return
      const refreshed = await refreshStatus()
      if (!isActionCurrent(run, requestToken, requestPartyId)) return
      if (!refreshed) {
        message.value =
          'Queue change saved, but the latest order could not be confirmed. Refresh to check.'
        error.value = true
        return
      }
      message.value = 'Queue order updated.'
      error.value = false
    } catch (cause) {
      if (!isActionCurrent(run, requestToken, requestPartyId)) return
      const refreshed = await refreshStatus()
      if (!isActionCurrent(run, requestToken, requestPartyId)) return
      message.value = refreshed
        ? explain(cause, 'Queue order changed elsewhere; the latest state is shown.')
        : 'Queue order is uncertain because the latest state could not be loaded. Refresh to check.'
      error.value = true
    } finally {
      if (actionGeneration === run) busy.value = false
    }
  }

  function signOut() {
    invalidateAction()
    discoveryGeneration++
    confirmation.value = null
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
        await restoreActiveParty()
      } else await restoreActiveParty()
    }
    if (!mounted) return
    refreshTimer = setInterval(() => {
      void restoreActiveParty()
    }, 5000)
    window.addEventListener('focus', restoreActiveParty)
  })
  onUnmounted(() => {
    mounted = false
    if (refreshTimer) clearInterval(refreshTimer)
    window.removeEventListener('focus', restoreActiveParty)
    invalidateAction()
    confirmation.value = null
    discoveryGeneration++
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
    canRecoverPlayback,
    nowPlayingTitle,
    nowPlayingArtist,
    nowPlayingThumbnailUrl,
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
    retrySelectedPlayback,
    openQueueConfirmation,
    dismissConfirmation,
    confirmQueueAction,
    moveQueueItem,
    openAdmin,
  })
}
