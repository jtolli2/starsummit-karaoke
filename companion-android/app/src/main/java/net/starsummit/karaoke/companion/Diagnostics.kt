package net.starsummit.karaoke.companion

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class ConnectionState { IDLE, PAIRING, CONNECTING, CONNECTED, RECONNECTING, ERROR }

internal object SessionGenerationGuard {
  fun isCurrent(installedGeneration: Long, expectedGeneration: Long): Boolean = installedGeneration == expectedGeneration
}

data class DiagnosticsSnapshot(
  val state: ConnectionState = ConnectionState.IDLE,
  val lastEventRedacted: String? = null,
  val lastErrorRedacted: String? = null,
  val reconnectAttempt: Int = 0,
  val nowPlaying: PlaybackSnapshot = PlaybackSnapshot(),
  val playbackRevision: Long = 0,
  val controllerAttemptCount: Int = 0,
  val controllerEndpointHost: String? = null,
  val controllerPhase: String? = null,
  val controllerEstablishCount: Int = 0,
  val controllerInitialRefetchCount: Int? = null,
  val controllerRealtimeEventRedacted: String? = null,
  val controllerRefetchCount: Int? = null,
  val controllerRefetchErrorRedacted: String? = null,
  val controllerSubscriptionAccepted: Boolean = false,
  val controllerRealtimeFallbackErrorRedacted: String? = null,
)

/** Receives only redacted controller lifecycle facts; it never receives auth or event payloads. */
interface ControllerDiagnosticsListener {
  fun attemptStarted() = Unit
  fun phase(name: String) = Unit
  fun established() = Unit
  fun initialRefetch(commandCount: Int) = Unit
  fun realtimeEvent(name: String) = Unit
  fun refetchSucceeded(commandCount: Int) = Unit
  fun refetchFailed(errorCode: String) = Unit
  fun subscriptionAccepted() = Unit
  fun realtimeFallback(errorCode: String) = Unit
}

class DiagnosticsStore {
  private val mutable = MutableStateFlow(DiagnosticsSnapshot())
  val snapshot: StateFlow<DiagnosticsSnapshot> = mutable.asStateFlow()

  fun state(value: ConnectionState) { mutable.value = mutable.value.copy(state = value) }
  fun event(value: LoungeEvent) {
    mutable.value = mutable.value.copy(
      lastEventRedacted = when (value) {
        is LoungeEvent.Raw -> "event:${value.name.take(48)}"
        is LoungeEvent.NowPlaying -> "now_playing"
        is LoungeEvent.ProtocolError -> "protocol_error"
      },
    )
  }

  fun controllerAttemptStarted() {
    mutable.value = mutable.value.copy(
      controllerAttemptCount = mutable.value.controllerAttemptCount + 1,
      controllerPhase = "authenticate",
      controllerInitialRefetchCount = null,
      controllerRealtimeEventRedacted = null,
      controllerRefetchCount = null,
      controllerRefetchErrorRedacted = null,
      controllerSubscriptionAccepted = false,
      controllerRealtimeFallbackErrorRedacted = null,
    )
  }

  fun controllerPhase(name: String) {
    mutable.value = mutable.value.copy(controllerPhase = sanitizeControllerPhase(name))
  }

  fun controllerEndpoint(baseUrl: String) {
    mutable.value = mutable.value.copy(controllerEndpointHost = sanitizeControllerEndpointHost(baseUrl))
  }

  fun controllerEstablished() {
    mutable.value = mutable.value.copy(controllerEstablishCount = mutable.value.controllerEstablishCount + 1)
  }

  fun controllerInitialRefetch(commandCount: Int) {
    mutable.value = mutable.value.copy(controllerInitialRefetchCount = commandCount)
  }

  fun controllerRealtimeEvent(name: String) {
    mutable.value = mutable.value.copy(controllerRealtimeEventRedacted = sanitizeControllerRealtimeEventName(name))
  }

  fun controllerRefetchSucceeded(commandCount: Int) {
    mutable.value = mutable.value.copy(
      controllerRefetchCount = commandCount,
      controllerRefetchErrorRedacted = null,
    )
  }

  fun controllerRefetchFailed(failure: Throwable) {
    controllerRefetchFailed(redactDiagnosticError(failure))
  }

  fun controllerRefetchFailed(errorCode: String) {
    mutable.value = mutable.value.copy(controllerRefetchErrorRedacted = errorCode.take(80))
  }

  fun controllerSubscriptionAccepted() {
    mutable.value = mutable.value.copy(controllerSubscriptionAccepted = true)
  }
  fun controllerRealtimeFallback(errorCode: String) {
    mutable.value = mutable.value.copy(controllerRealtimeFallbackErrorRedacted = errorCode.take(80))
  }
  fun error(value: Throwable, setErrorState: Boolean = true) {
    mutable.value = mutable.value.copy(
      lastErrorRedacted = redactDiagnosticError(value),
      state = if (setErrorState) ConnectionState.ERROR else mutable.value.state,
    )
  }
  fun reconnectAttempt(value: Int) {
    mutable.value = mutable.value.copy(
      reconnectAttempt = value,
      state = if (value == 0) mutable.value.state else ConnectionState.RECONNECTING,
    )
  }
  fun nowPlaying(value: PlaybackSnapshot, authoritative: Boolean = false) {
    mutable.value = mutable.value.copy(
      nowPlaying = value,
      playbackRevision = mutable.value.playbackRevision + if (authoritative) 1 else 0,
    )
  }
}

internal fun sanitizeControllerRealtimeEventName(value: String): String {
  val candidate = value.trim().removePrefix("event:").take(48)
  val safe = when (candidate) {
    "PB_CONNECT", "create", "update", "delete", "message", "__PB_STREAM_CLOSED__" -> candidate
    else -> "unknown"
  }
  return "event:$safe"
}

internal fun sanitizeControllerPhase(value: String): String = when (value) {
  "authenticate", "session", "realtime", "subscribe", "initial_refetch", "report_state", "listen" -> value
  else -> "unknown"
}

internal fun sanitizeControllerEndpointHost(value: String): String = runCatching {
  java.net.URI(value).host?.lowercase()?.takeIf { it.isNotBlank() }
}.getOrNull() ?: "unknown"

internal fun redactDiagnosticError(value: Throwable): String = when (value) {
  is ControllerHttpException -> "ControllerHttp${value.statusCode}"
  else -> value::class.simpleName ?: "DiagnosticError"
}.take(80)
