package net.starsummit.karaoke.companion

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Binder
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.TimeoutCancellationException
import java.io.IOException

class CompanionService : Service() {
  private val binder = CompanionBinder()
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  private lateinit var pairingStore: PairingStore
  private lateinit var controllerStore: ControllerStore
  private lateinit var controllerApi: PocketBaseControllerApi
  private lateinit var controller: LoungeController
  private lateinit var diagnosticsStore: DiagnosticsStore
  private var reconnectJob: Job? = null
  private var controllerJob: Job? = null
  private var controllerBridge: PocketBaseControllerBridge? = null
  private var session: LoungeSession? = null
  private var sessionGeneration = 0L
  private var reducer = LoungeEventReducer()
  private var commandStartRevision: Long? = null

  override fun onCreate() {
    super.onCreate()
    pairingStore = PairingStore(this)
    controllerStore = ControllerStore(this)
    controllerApi = PocketBaseControllerApi()
    controller = LoungeHttpController()
    diagnosticsStore = DiagnosticsStore()
    createNotificationChannel()
    startForeground(NOTIFICATION_ID, notification())
    if (pairingStore.load() != null) startConnectionLoop()
    if (controllerStore.loadCredentials() != null) startControllerLoop()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

  override fun onBind(intent: Intent?): IBinder = binder

  override fun onDestroy() {
    session?.close()
    reconnectJob?.cancel()
    controllerBridge?.close()
    controllerJob?.cancel()
    scope.cancel()
    super.onDestroy()
  }

  inner class CompanionBinder : Binder() {
    fun diagnostics(): StateFlow<DiagnosticsSnapshot> = diagnosticsStore.snapshot
    fun pair(tvCode: String) { scope.launch { pairInternal(tvCode) } }
    fun openVideo(videoId: String) { command { setPlaylist(videoId) } }
    fun play() { command { play() } }
    fun pause() { command { pause() } }
    fun seekTo(seconds: Double) { command { seekTo(seconds) } }
    fun getNowPlaying() { command { getNowPlaying() } }
    /** Native enrollment entry point; grant and returned secret never enter UI state or logs. */
    fun enrollController(baseUrl: String, grant: String, deviceName: String = "Starsummit tablet") {
      scope.launch {
        runCatching { controllerApi.enroll(baseUrl, grant, deviceName) }
          .onSuccess { controllerStore.saveCredentials(it); startControllerLoop() }
          .onFailure { diagnosticsStore.error(it, setErrorState = false) }
      }
    }
  }

  private fun startControllerLoop() {
    if (controllerJob?.isActive == true) return
    controllerJob = scope.launch {
      var attempt = 0
      while (isActive) {
        val credentials = controllerStore.loadCredentials() ?: return@launch
        val bridge = PocketBaseControllerBridge(
          api = controllerApi,
          realtime = OkHttpControllerRealtimeTransport(),
          store = ControllerStoreProgressAdapter(controllerStore),
          credentials = credentials,
          sessionStore = ControllerStoreSessionAdapter(controllerStore),
          diagnostics = object : ControllerDiagnosticsListener {
            override fun attemptStarted() = diagnosticsStore.controllerAttemptStarted()
            override fun established() = diagnosticsStore.controllerEstablished()
            override fun initialRefetch(commandCount: Int) = diagnosticsStore.controllerInitialRefetch(commandCount)
            override fun realtimeEvent(name: String) = diagnosticsStore.controllerRealtimeEvent(name)
            override fun refetchSucceeded(commandCount: Int) = diagnosticsStore.controllerRefetchSucceeded(commandCount)
            override fun refetchFailed(errorCode: String) = diagnosticsStore.controllerRefetchFailed(errorCode)
            override fun subscriptionAccepted() = diagnosticsStore.controllerSubscriptionAccepted()
          },
        )
        controllerBridge = bridge
        try {
          val processor = ControllerCommandProcessor(LoungeCommandExecutor(), ControllerStoreProgressAdapter(controllerStore))
          val initialCommands = bridge.establish()
          runCatching { bridge.reportState(sanitizedControllerState()) }
            .onFailure { diagnosticsStore.error(it, setErrorState = false) }
          processControllerCommands(bridge, processor, initialCommands)
          attempt = 0
          bridge.listenRealtime { commands -> processControllerCommands(bridge, processor, commands) }
          throw IOException("PocketBase realtime stream ended")
        } catch (cancelled: CancellationException) {
          throw cancelled
        } catch (failure: Throwable) {
          if (failure is AmbiguousCommandException) {
            session?.let { forceReconnect(it, sessionGeneration) }
          }
          bridge.close()
          controllerBridge = null
          diagnosticsStore.error(failure, setErrorState = false)
          delay(ControllerReconnectPolicy.delayMillis(attempt))
          attempt = (attempt + 1).coerceAtMost(ControllerReconnectPolicy.MAX_ATTEMPTS)
        }
      }
    }
  }

  private suspend fun processControllerCommands(
    bridge: PocketBaseControllerBridge,
    processor: ControllerCommandProcessor,
    commands: List<ControllerCommand>,
  ) {
    commands.sortedBy { it.sequence }.forEach { command ->
      val result = bridge.processCommand(processor, command, diagnosticsStore.snapshot.value.nowPlaying)
      if (result is CommandResult.Failed) diagnosticsStore.error(IllegalStateException(result.errorCode), setErrorState = false)
      runCatching {
        bridge.reportState(sanitizedControllerState())
      }.onFailure { diagnosticsStore.error(it, setErrorState = false) }
    }
  }

  private fun sanitizedControllerState(): SanitizedControllerState {
    val diagnostics = diagnosticsStore.snapshot.value
    val now = diagnostics.nowPlaying
    val progress = controllerStore.loadProgress()
    return SanitizedControllerState(
      connectionState = sanitizeControllerConnectionState(diagnostics.state),
      playback = now.copy(state = now.state?.let(::sanitizeLoungePlayerState)),
      lastCommandSequence = progress.lastCommandSequence,
    )
  }

  private inner class LoungeCommandExecutor : CommandExecutor {
    private fun markCommandStart() {
      commandStartRevision = diagnosticsStore.snapshot.value.playbackRevision
    }

    private suspend fun active(): LoungeSession = session ?: throw IOException("Lounge unavailable")
    override suspend fun openVideo(videoId: String) { markCommandStart(); active().setPlaylist(videoId) }
    override suspend fun play() { markCommandStart(); active().play() }
    override suspend fun pause() { markCommandStart(); active().pause() }
    override suspend fun seek(seconds: Double) { markCommandStart(); active().seekTo(seconds) }
    override suspend fun getNowPlaying() { markCommandStart(); requestNowPlaying() }
    private suspend fun requestNowPlaying() { active().getNowPlaying() }
    override suspend fun refreshNowPlaying(): PlaybackSnapshot {
      val revision = diagnosticsStore.snapshot.value.playbackRevision
      requestNowPlaying()
      return try {
        withTimeout(CONTROLLER_STATE_REFRESH_TIMEOUT_MILLIS) {
          diagnosticsStore.snapshot.first { it.playbackRevision > revision }.nowPlaying
        }
      } catch (_: TimeoutCancellationException) {
        val latest = diagnosticsStore.snapshot.value
        timedOutRefreshSnapshot(latest, commandStartRevision)
          ?: throw IOException("Lounge now-playing refresh timed out")
      }
    }
  }

  private suspend fun pairInternal(tvCode: String) {
    val previousState = diagnosticsStore.snapshot.value.state
    diagnosticsStore.state(ConnectionState.PAIRING)
    val material = runCatching { controller.pair(tvCode) }.getOrElse {
      diagnosticsStore.error(it, setErrorState = false)
      diagnosticsStore.state(previousState)
      return
    }
    val oldJob = reconnectJob
    val oldSession = session
    session = null
    reconnectJob = null
    sessionGeneration += 1
    oldSession?.close()
    oldJob?.cancel()
    oldJob?.join()
    pairingStore.save(material)
    startConnectionLoop()
  }

  private fun startConnectionLoop() {
    if (reconnectJob?.isActive == true) return
    reconnectJob = scope.launch {
      var attempt = 0
      while (true) {
        val loopGeneration = sessionGeneration
        var connectionGeneration = loopGeneration
        val current = pairingStore.load() ?: run {
          diagnosticsStore.state(ConnectionState.IDLE)
          return@launch
        }
        try {
          diagnosticsStore.state(ConnectionState.CONNECTING)
          val refreshed = controller.refreshPairing(current)
          pairingStore.save(refreshed)
          val connected = controller.connect(refreshed)
          if (!SessionGenerationGuard.isCurrent(sessionGeneration, loopGeneration)) {
            connected.close()
            return@launch
          }
          connectionGeneration = loopGeneration + 1
          sessionGeneration = connectionGeneration
          session = connected
          reducer = LoungeEventReducer()
          attempt = 0
          diagnosticsStore.state(ConnectionState.CONNECTED)
          diagnosticsStore.reconnectAttempt(0)
          coroutineScope {
            val eventJob = launch {
              connected.events.collect { event ->
                diagnosticsStore.event(event)
                diagnosticsStore.nowPlaying(reducer.reduce(event), event is LoungeEvent.NowPlaying)
              }
            }
            try {
              // Request authoritative state while the event subscription is active.
              connected.getNowPlaying()
              eventJob.join()
            } finally {
              eventJob.cancel()
            }
          }
          throw IOException("Lounge event stream ended")
        } catch (cancelled: CancellationException) {
          throw cancelled
        } catch (failure: Throwable) {
          if (!SessionGenerationGuard.isCurrent(sessionGeneration, connectionGeneration)) return@launch
          session?.close()
          session = null
          diagnosticsStore.error(failure)
          diagnosticsStore.reconnectAttempt(attempt)
          delay(ReconnectBackoff.delayMillis(attempt))
          attempt = (attempt + 1).coerceAtMost(30)
        }
      }
    }
  }

  private fun command(action: suspend LoungeSession.() -> Unit) {
    scope.launch {
      val active = session
      if (active == null) {
        diagnosticsStore.error(IllegalStateException("Not connected"))
        return@launch
      }
      val expectedGeneration = sessionGeneration
      runCatching { active.action() }.onFailure { failure ->
        if (failure is java.io.IOException) {
          if (session !== active || !SessionGenerationGuard.isCurrent(sessionGeneration, expectedGeneration)) return@onFailure
          diagnosticsStore.error(failure)
          forceReconnect(active, expectedGeneration)
        } else {
          diagnosticsStore.error(failure)
        }
      }
    }
  }

  private fun forceReconnect(expectedSession: LoungeSession, expectedGeneration: Long) {
    if (session !== expectedSession || !SessionGenerationGuard.isCurrent(sessionGeneration, expectedGeneration)) return
    val oldSession = session
    val oldJob = reconnectJob
    session = null
    reconnectJob = null
    sessionGeneration += 1
    oldSession?.close()
    oldJob?.cancel()
    startConnectionLoop()
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(CHANNEL_ID, getString(R.string.diagnostic_channel_name), NotificationManager.IMPORTANCE_LOW)
      getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
  }

  private fun notification(): Notification {
    val intent = Intent(this, MainActivity::class.java)
    val pending = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT)
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(getString(R.string.app_name))
      .setContentText("Lounge controller diagnostic service")
      .setSmallIcon(android.R.drawable.stat_sys_download_done)
      .setContentIntent(pending)
      .setOngoing(true)
      .build()
  }

  private companion object {
    const val CHANNEL_ID = "lounge_connection"
    const val NOTIFICATION_ID = 1001
    const val CONTROLLER_STATE_REFRESH_TIMEOUT_MILLIS = 3_000L
  }
}

internal fun timedOutRefreshSnapshot(snapshot: DiagnosticsSnapshot, commandRevision: Long?): PlaybackSnapshot? =
  snapshot.nowPlaying.takeIf { commandRevision != null && snapshot.playbackRevision > commandRevision }
