package net.starsummit.karaoke.companion

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.mapNotNull
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.cancel
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.io.Reader
import java.util.concurrent.TimeUnit
import kotlin.math.abs

private const val REALTIME_CLOSED_EVENT = "__PB_STREAM_CLOSED__"

interface CommandExecutor {
  suspend fun openVideo(videoId: String)
  suspend fun play()
  suspend fun pause()
  suspend fun seek(seconds: Double)
  suspend fun getNowPlaying()
  suspend fun refreshNowPlaying(): PlaybackSnapshot {
    getNowPlaying()
    throw IOException("fresh playback state unavailable")
  }
}

interface ProgressStore {
  fun load(): ControllerProgress
  fun save(progress: ControllerProgress)
}

class InMemoryProgressStore(initial: ControllerProgress = ControllerProgress()) : ProgressStore {
  private var value = initial
  override fun load() = value
  override fun save(progress: ControllerProgress) { value = progress }
}

interface SessionStore {
  fun load(): ControllerSession?
  fun save(session: ControllerSession)
}

enum class BridgeState { IDLE, AUTHENTICATING, CONNECTING, CONNECTED, RECONNECTING, STALE, ERROR }

internal fun sanitizeControllerConnectionState(value: ConnectionState): String = when (value) {
  ConnectionState.IDLE -> "disconnected"
  ConnectionState.PAIRING, ConnectionState.CONNECTING, ConnectionState.RECONNECTING -> "connecting"
  ConnectionState.CONNECTED -> "connected"
  ConnectionState.ERROR -> "error"
}

internal fun sanitizeLoungePlayerState(value: String): String = when (value.uppercase()) {
  "1", "PLAYING" -> "playing"
  "2", "PAUSED" -> "paused"
  "3", "BUFFERING" -> "buffering"
  "0", "ENDED" -> "ended"
  else -> "unknown"
}

object ControllerReconnectPolicy {
  const val MAX_ATTEMPTS = 8
  fun delayMillis(attempt: Int): Long = ReconnectBackoff.delayMillis(attempt.coerceIn(0, MAX_ATTEMPTS))
}

class ControllerBridgeStateMachine {
  var state: BridgeState = BridgeState.IDLE
    private set
  fun authenticating() { state = BridgeState.AUTHENTICATING }
  fun connecting(reconnect: Boolean = false) { state = if (reconnect) BridgeState.RECONNECTING else BridgeState.CONNECTING }
  fun connected() { state = BridgeState.CONNECTED }
  fun stale() { state = BridgeState.STALE }
  fun failed() { state = BridgeState.ERROR }
}

/** Applies only convergent, absolute playback intents and durably advances sequence progress. */
class ControllerCommandProcessor(
  private val executor: CommandExecutor,
  private val progressStore: ProgressStore,
  private val now: () -> Long = { System.currentTimeMillis() },
) {
  suspend fun process(command: ControllerCommand, session: ControllerSession, @Suppress("UNUSED_PARAMETER") snapshot: PlaybackSnapshot): CommandResult {
    val progress = progressStore.load()
    if (command.sessionId != null && command.sessionId != session.id) return CommandResult.Stale
    if (command.generation != null && command.generation != session.generation) return CommandResult.Stale
    if (command.expiresAtEpochMs <= now()) return CommandResult.Expired
    if (progress.sessionId == session.id && progress.generation == session.generation && command.sequence <= progress.lastCommandSequence) {
      return reconcileAndMaybeReplay(command, session, progress)
    }
    if (progress.inFlightId == command.id || progress.inFlightIdempotencyKey == command.idempotencyKey) {
      return reconcileAndMaybeReplay(command, session, progress)
    }
    progressStore.save(progress.copy(sessionId = session.id, generation = session.generation, inFlightId = command.id, inFlightIdempotencyKey = command.idempotencyKey))
    return try {
      execute(command)
      markComplete(session, command, progress)
      CommandResult.Applied
    } catch (cancelled: kotlinx.coroutines.CancellationException) {
      throw cancelled
    } catch (failure: Throwable) {
      classifyFailure(failure)
    }
  }

  private suspend fun reconcileAndMaybeReplay(
    command: ControllerCommand,
    session: ControllerSession,
    progress: ControllerProgress,
  ): CommandResult {
    val fresh = try {
      executor.refreshNowPlaying()
    } catch (cancelled: kotlinx.coroutines.CancellationException) {
      throw cancelled
    } catch (failure: Throwable) {
      return classifyFailure(failure)
    }
    return if (isConverged(command, fresh)) {
      markComplete(session, command, progress)
      CommandResult.Duplicate
    } else replay(command, session, progress)
  }

  private suspend fun replay(command: ControllerCommand, session: ControllerSession, progress: ControllerProgress): CommandResult {
    return try {
      execute(command)
      markComplete(session, command, progress)
      CommandResult.Replayed
    } catch (cancelled: kotlinx.coroutines.CancellationException) {
      throw cancelled
    } catch (failure: Throwable) {
      classifyFailure(failure)
    }
  }

  private fun classifyFailure(failure: Throwable): CommandResult = when (failure) {
    is IllegalArgumentException -> CommandResult.Failed("invalid_playback_command")
    else -> CommandResult.TransientFailure(failure::class.simpleName ?: "playback_unavailable")
  }

  private suspend fun execute(command: ControllerCommand) = when (command.action) {
    ControllerAction.OPEN_VIDEO -> executor.openVideo(command.videoId!!)
    ControllerAction.PLAY -> executor.play()
    ControllerAction.PAUSE -> executor.pause()
    ControllerAction.SEEK -> executor.seek(command.seekSeconds!!)
    ControllerAction.GET_NOW_PLAYING -> executor.getNowPlaying()
  }

  private fun markComplete(session: ControllerSession, command: ControllerCommand, old: ControllerProgress) {
    progressStore.save(ControllerProgress(session.id, session.generation, maxOf(old.lastCommandSequence, command.sequence), null, null))
  }

  private fun isConverged(command: ControllerCommand, snapshot: PlaybackSnapshot): Boolean = when (command.action) {
    ControllerAction.OPEN_VIDEO -> snapshot.videoId == command.videoId
    ControllerAction.PLAY -> snapshot.state.equals("PLAYING", true) || snapshot.state == "1"
    ControllerAction.PAUSE -> snapshot.state.equals("PAUSED", true) || snapshot.state == "2"
    ControllerAction.SEEK -> snapshot.positionSeconds != null && abs(snapshot.positionSeconds - command.seekSeconds!!) <= 2.0
    ControllerAction.GET_NOW_PLAYING -> true
  }
}

sealed interface CommandResult {
  data object Applied : CommandResult
  data object Replayed : CommandResult
  data object Duplicate : CommandResult
  data object Stale : CommandResult
  data object Expired : CommandResult
  data class Failed(val errorCode: String) : CommandResult
  data class TransientFailure(val errorCode: String) : CommandResult
}

class AmbiguousCommandException(message: String) : IOException(message)

interface ControllerRealtimeTransport {
  suspend fun connect(auth: ControllerAuth): ControllerRealtimeConnection
}

interface ControllerRealtimeConnection {
  val events: Flow<PocketBaseRealtimeEvent>
  suspend fun subscribe(clientId: String, collection: String = "controller_commands/*")
  fun close()
}

/** PocketBase bridge lifecycle: session state is durable, realtime is only a wake hint. */
class PocketBaseControllerBridge(
  private val api: ControllerApi,
  private val realtime: ControllerRealtimeTransport,
  private val store: ProgressStore,
  private val credentials: ControllerCredentials,
  private val sessionStore: SessionStore? = null,
  private val now: () -> Long = { System.currentTimeMillis() },
) {
  private var auth: ControllerAuth? = null
  private var session: ControllerSession? = null
  private var realtimeConnection: ControllerRealtimeConnection? = null
  private var realtimeClientId: String? = null
  val stateMachine = ControllerBridgeStateMachine()

  suspend fun establish(): List<ControllerCommand> {
    stateMachine.authenticating()
    val authenticated = api.authenticate(credentials)
    auth = authenticated
    stateMachine.connecting()
    val previous = store.load()
    val resumeSessionId = previous.sessionId ?: sessionStore?.load()?.id
    var replacedExpiredSession = false
    val opened = try {
      api.startOrResumeSession(authenticated, resumeSessionId)
    } catch (failure: ControllerHttpException) {
      if (failure.statusCode != 409 || resumeSessionId == null) throw failure
      replacedExpiredSession = true
      api.startOrResumeSession(authenticated, null)
    }
    val old = session
    val previousGeneration = previous.generation
    if ((old != null && opened.generation < old.generation) ||
      (previousGeneration != null && opened.generation < previousGeneration)) {
      stateMachine.stale()
      throw IOException("stale controller session generation")
    }
    session = opened
    sessionStore?.save(opened)
    store.save(previous.copy(
      sessionId = opened.id,
      generation = opened.generation,
      inFlightId = previous.inFlightId.takeUnless { replacedExpiredSession },
      inFlightIdempotencyKey = previous.inFlightIdempotencyKey.takeUnless { replacedExpiredSession },
    ))
    val connected = realtime.connect(authenticated)
    realtimeConnection?.close()
    realtimeConnection = connected
    realtimeClientId = withTimeout(15_000L) { connected.awaitConnectAndSubscribe() }
    stateMachine.connected()
    return refetch()
  }

  /** Every reconnect and every realtime hint must call this authoritative HTTPS query. */
  suspend fun refetch(): List<ControllerCommand> {
    val authenticated = auth ?: throw IOException("controller not authenticated")
    val active = session ?: throw IOException("controller session unavailable")
    if (active.expiresAtEpochMs <= now()) {
      stateMachine.stale()
      throw IOException("controller session expired")
    }
    val progress = store.load()
    return api.fetchCommands(authenticated, active, progress.lastCommandSequence)
  }

  /** Consume SSE notifications; notifications are deliberately reduced to an HTTPS refetch hint. */
  suspend fun listenRealtime(onCommands: suspend (List<ControllerCommand>) -> Unit) {
    val connected = realtimeConnection ?: throw IOException("controller realtime unavailable")
    connected.events.collect { event ->
      if (event.name == REALTIME_CLOSED_EVENT) throw IOException("PocketBase realtime stream ended")
      val clientId = parsePocketBaseConnect(event)
      if (clientId != null) {
        if (clientId != realtimeClientId) {
          connected.subscribe(clientId)
          realtimeClientId = clientId
        }
      } else {
        // Never trust event payloads as commands. A reconnect/event loss is expected; refetch is authoritative.
        onCommands(refetch())
      }
    }
  }

  suspend fun processCommand(processor: ControllerCommandProcessor, command: ControllerCommand, snapshot: PlaybackSnapshot): CommandResult {
    val authenticated = auth ?: throw IOException("controller not authenticated")
    val active = session ?: throw IOException("controller session unavailable")
    val result = processor.process(command, active, snapshot)
    when (result) {
      CommandResult.Applied, CommandResult.Replayed, CommandResult.Duplicate -> api.acknowledge(authenticated, active, command, true)
      is CommandResult.Failed -> api.acknowledge(authenticated, active, command, false, result.errorCode)
      is CommandResult.TransientFailure -> throw AmbiguousCommandException(result.errorCode)
      CommandResult.Stale, CommandResult.Expired -> Unit
    }
    return result
  }

  suspend fun reportState(state: SanitizedControllerState) {
    val authenticated = auth ?: throw IOException("controller not authenticated")
    val active = session ?: throw IOException("controller session unavailable")
    api.reportState(authenticated, active, state)
  }

  fun close() { realtimeConnection?.close(); realtimeConnection = null; realtimeClientId = null }
}

suspend fun ControllerRealtimeConnection.awaitConnectAndSubscribe(collection: String = "controller_commands/*"): String {
  val id = events.mapNotNull(::parsePocketBaseConnect).first()
  subscribe(id, collection)
  return id
}

/** OkHttp SSE transport. PB_CONNECT is parsed before authorization of the subscription. */
class OkHttpControllerRealtimeTransport(
  private val client: OkHttpClient = OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(0, TimeUnit.MILLISECONDS).build(),
) : ControllerRealtimeTransport {
  override suspend fun connect(auth: ControllerAuth): ControllerRealtimeConnection = OkHttpRealtimeConnection(client, auth)
}

private class OkHttpRealtimeConnection(private val client: OkHttpClient, private val auth: ControllerAuth) : ControllerRealtimeConnection {
  private var closed = false
  private var call: okhttp3.Call? = null
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val eventChannel = MutableSharedFlow<PocketBaseRealtimeEvent>(replay = 1, extraBufferCapacity = 32)
  override val events: Flow<PocketBaseRealtimeEvent> = eventChannel.asSharedFlow()

  init {
    scope.launch { stream() }
  }

  private suspend fun stream() {
    runReconnectableRealtimeStream(
      isOpen = { !closed },
      readStream = {
        val request = Request.Builder().url(auth.baseUrl.trimEnd('/') + PocketBaseControllerPaths.REALTIME)
          .header("Accept", "text/event-stream").header("Authorization", "Bearer ${auth.token}").build()
        val currentCall = client.newCall(request)
        call = currentCall
        currentCall.execute().use { response ->
          if (!response.isSuccessful) throw IOException("PocketBase realtime failed (${response.code})")
          response.body?.charStream()?.buffered()?.use { reader ->
            consumePocketBaseSse(reader, { !closed }) { eventChannel.emit(it) }
          }
        }
      },
      onStreamClosed = { eventChannel.emit(PocketBaseRealtimeEvent(REALTIME_CLOSED_EVENT, "")) },
    )
  }

  override suspend fun subscribe(clientId: String, collection: String) = withContext(Dispatchers.IO) {
    val body = JSONObject().put("clientId", clientId).put("subscriptions", org.json.JSONArray().put(collection)).toString()
    val request = Request.Builder().url(auth.baseUrl.trimEnd('/') + PocketBaseControllerPaths.REALTIME)
      .header("Authorization", "Bearer ${auth.token}").post(body.toRequestBody("application/json".toMediaType())).build()
    client.newCall(request).execute().use { response -> if (!response.isSuccessful) throw IOException("PocketBase realtime subscription failed (${response.code})") }
  }

  override fun close() { closed = true; call?.cancel(); scope.cancel() }

}

/** Runs an SSE stream, converting expected I/O disconnects into the reconnect wake hint. */
internal suspend fun runReconnectableRealtimeStream(
  isOpen: () -> Boolean,
  readStream: suspend () -> Unit,
  onStreamClosed: suspend () -> Unit,
) {
  var reconnectableEnd = false
  try {
    readStream()
    reconnectableEnd = true
  } catch (_: IOException) {
    // HTTP/2 stream resets are ordinary realtime disconnects; the service reconnects below.
    reconnectableEnd = true
  } finally {
    if (reconnectableEnd && isOpen()) onStreamClosed()
  }
}

/** Reads PocketBase SSE frames. I/O failures are handled by [runReconnectableRealtimeStream]. */
internal suspend fun consumePocketBaseSse(
  reader: Reader,
  shouldContinue: () -> Boolean = { true },
  onEvent: suspend (PocketBaseRealtimeEvent) -> Unit,
) {
  val parser = PocketBaseSseParser()
  val buffer = CharArray(2048)
  while (shouldContinue()) {
    val read = reader.read(buffer)
    if (read < 0) break
    parser.feed(String(buffer, 0, read)).forEach { onEvent(it) }
  }
  parser.finish().forEach { onEvent(it) }
}
