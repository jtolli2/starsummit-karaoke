package net.starsummit.karaoke.companion

import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

private const val CONTROLLER_LIFECYCLE_LOG_TAG = "StarsummitController"

private val CONTROLLER_LIFECYCLE_LOG_EXECUTOR by lazy {
  Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "StarsummitControllerTelemetry").apply { isDaemon = true }
  }
}

/** Asynchronous, redacted controller lifecycle logging that cannot affect command delivery. */
internal class ControllerLifecycleLogger(
  private val sink: (String) -> Unit = { message ->
    android.util.Log.i(CONTROLLER_LIFECYCLE_LOG_TAG, message)
  },
) {
  private val attemptCount = AtomicInteger()
  private val establishedCount = AtomicInteger()

  fun listener(): ControllerDiagnosticsListener = object : ControllerDiagnosticsListener {
    override fun attemptStarted() {
      emit("attempt count=${attemptCount.incrementAndGet()}")
    }

    override fun established() {
      emit("established count=${establishedCount.incrementAndGet()}")
    }

    override fun initialRefetch(commandCount: Int) {
      emit("initial_refetch command_count=${commandCount.coerceAtLeast(0)}")
    }

    override fun realtimeEvent(name: String) {
      emit("realtime_event name=${sanitizeControllerRealtimeEventName(name)}")
    }

    override fun refetchSucceeded(commandCount: Int) {
      emit("refetch command_count=${commandCount.coerceAtLeast(0)}")
    }

    override fun refetchFailed(errorCode: String) {
      emit("refetch_error code=${sanitizeControllerDiagnosticError(errorCode)}")
    }

    override fun subscriptionAccepted() {
      emit("subscription accepted=true")
    }
  }

  private fun emit(message: String) {
    runCatching {
      CONTROLLER_LIFECYCLE_LOG_EXECUTOR.execute { runCatching { sink(message) } }
    }
  }
}

internal fun sanitizeControllerDiagnosticError(value: String): String {
  val candidate = value.trim()
  val knownCategories = setOf(
    "IOException",
    "InterruptedIOException",
    "SocketTimeoutException",
    "StreamResetException",
    "UnknownHostException",
    "ControllerAcknowledgementException",
    "ControllerProtocolException",
    "AmbiguousCommandException",
    "CommandDeadlineExceededException",
    "LoungeSessionClosedException",
    "IllegalArgumentException",
    "IllegalStateException",
  )
  return when {
    candidate.matches(Regex("ControllerHttp[0-9]{3}")) -> candidate
    candidate in knownCategories -> candidate
    else -> "ControllerFailure"
  }
}
