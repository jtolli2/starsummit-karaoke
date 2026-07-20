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
)

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
  fun error(value: Throwable, setErrorState: Boolean = true) {
    val safe = when (value) {
      is ControllerHttpException -> "ControllerHttp${value.statusCode}"
      else -> value::class.simpleName ?: "LoungeError"
    }
    mutable.value = mutable.value.copy(
      lastErrorRedacted = safe.take(80),
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
