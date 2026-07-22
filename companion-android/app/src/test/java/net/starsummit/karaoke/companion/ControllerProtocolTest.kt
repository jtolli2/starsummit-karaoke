package net.starsummit.karaoke.companion

import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.ResponseBody
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.io.Reader
import java.io.StringReader
import java.time.Instant
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import okio.Buffer
import okio.BufferedSource
import okio.Source
import okio.Timeout
import okio.buffer

class ControllerProtocolTest {
  @Test
  fun pocketBaseAuthorizationUsesTheRawTokenForMatchingRealtimeRequests() {
    assertEquals("controller-token", pocketBaseAuthorization("controller-token"))
  }

  @Test
  fun `controller HTTP diagnostics expose status only`() {
    val diagnostics = DiagnosticsStore()

    diagnostics.error(ControllerHttpException(410), setErrorState = false)

    assertEquals("ControllerHttp410", diagnostics.snapshot.value.lastErrorRedacted)
  }

  @Test
  fun controllerDiagnosticsRedactRealtimeNamesAndFailureDetails() {
    val diagnostics = DiagnosticsStore()

    diagnostics.controllerRealtimeEvent("create token=secret payload={\"videoId\":\"dQw4w9WgXcQ\"}")
    diagnostics.controllerRefetchFailed(IOException("token=secret payload=private"))

    val snapshot = diagnostics.snapshot.value
    assertEquals("event:unknown", snapshot.controllerRealtimeEventRedacted)
    assertEquals("IOException", snapshot.controllerRefetchErrorRedacted)
    assertFalse(snapshot.controllerRealtimeEventRedacted!!.contains("token=secret"))
    assertFalse(snapshot.controllerRefetchErrorRedacted!!.contains("private"))
  }

  @Test
  fun controllerLifecycleLoggerEmitsOnlySafeFacts() {
    val logs = mutableListOf<String>()
    val logged = CountDownLatch(8)
    val listener = ControllerLifecycleLogger { message ->
      logs += message
      logged.countDown()
    }.listener()

    listener.attemptStarted()
    listener.phase("authenticate")
    listener.established()
    listener.initialRefetch(3)
    listener.subscriptionAccepted()
    listener.realtimeEvent("create token=secret payload=private")
    listener.refetchSucceeded(2)
    listener.refetchFailed("ControllerHttp503")

    assertTrue(logged.await(1, TimeUnit.SECONDS))
    assertEquals(
      listOf(
        "attempt count=1",
        "phase name=authenticate",
        "established count=1",
        "initial_refetch command_count=3",
        "subscription accepted=true",
        "realtime_event name=event:unknown",
        "refetch command_count=2",
        "refetch_error code=ControllerHttp503",
      ),
      logs,
    )
    val text = logs.joinToString(" ")
    assertFalse(text.contains("secret"))
    assertFalse(text.contains("private"))
    assertEquals("ControllerFailure", sanitizeControllerDiagnosticError("token=secret payload=private"))
    assertEquals("ControllerFailure", sanitizeControllerDiagnosticError("secretToken123"))
    assertEquals("unknown", sanitizeControllerPhase("token=secret payload=private"))
  }

  @Test
  fun controllerLifecycleLoggerSwallowsSinkFailures() {
    val invoked = CountDownLatch(1)
    val listener = ControllerLifecycleLogger {
      invoked.countDown()
      error("sink failure")
    }.listener()

    listener.attemptStarted()

    assertTrue(invoked.await(1, TimeUnit.SECONDS))
  }

  @Test
  fun controllerAttemptStartClearsPriorAttemptEvidence() {
    val diagnostics = DiagnosticsStore()
    diagnostics.controllerAttemptStarted()
    diagnostics.controllerEstablished()
    diagnostics.controllerSubscriptionAccepted()
    diagnostics.controllerInitialRefetch(2)
    diagnostics.controllerRealtimeEvent("create")
    diagnostics.controllerRefetchSucceeded(2)
    diagnostics.controllerAttemptStarted()

    val snapshot = diagnostics.snapshot.value
    assertEquals(2, snapshot.controllerAttemptCount)
    assertEquals("authenticate", snapshot.controllerPhase)
    assertEquals(1, snapshot.controllerEstablishCount)
    assertEquals(null, snapshot.controllerInitialRefetchCount)
    assertEquals(null, snapshot.controllerRealtimeEventRedacted)
    assertEquals(null, snapshot.controllerRefetchCount)
    assertEquals(null, snapshot.controllerRefetchErrorRedacted)
    assertEquals(false, snapshot.controllerSubscriptionAccepted)
  }

  @Test
  fun controllerEndpointDiagnosticsExposeOnlyTheHost() {
    val diagnostics = DiagnosticsStore()

    diagnostics.controllerEndpoint("https://device:secret@controller-test.app.starsummit.net/api")

    assertEquals("controller-test.app.starsummit.net", diagnostics.snapshot.value.controllerEndpointHost)
  }

  @Test
  fun pollingFallbackReportsIdleControllerStateBeforeFreshnessExpires() {
    val initialReportAt = 5_000L

    assertFalse(ControllerHeartbeatPolicy.shouldReport(initialReportAt, initialReportAt + 29_999L))
    assertTrue(ControllerHeartbeatPolicy.shouldReport(initialReportAt, initialReportAt + 30_000L))
    assertTrue(ControllerHeartbeatPolicy.shouldReport(0L, 90_001L))
  }

  private val future = System.currentTimeMillis() + 60_000
  private val session = ControllerSession("session", 4, future)

  @Test
  fun parsesAndValidatesApprovedCommands() {
    val command = ControllerCommandParser.parse(JSONObject()
      .put("id", "cmd-1").put("sequence", 1).put("idempotencyKey", "key-1")
      .put("action", "open_video").put("videoId", "dQw4w9WgXcQ").put("expiresAt", future), future - 1)
    assertEquals(ControllerAction.OPEN_VIDEO, command.action)
    assertEquals("dQw4w9WgXcQ", command.videoId)
  }

  @Test
  fun parsesPocketBaseCommandViewDateTimeAndEmptyNowPlayingPayload() {
    val expiry = "2026-07-20 08:10:15.123Z"
    val now = Instant.parse("2026-07-20T08:00:00Z").toEpochMilli()
    val command = ControllerCommandParser.parseList(
      JSONObject().put(
        "commands",
        JSONArray().put(
          JSONObject()
            .put("id", "cmd-now-playing")
            .put("sequence", 1)
            .put("idempotencyKey", "now-playing-key")
            .put("action", "get_now_playing")
            .put("expiresAt", expiry),
        ),
      ).toString(),
      now,
    ).single()

    assertEquals(ControllerAction.GET_NOW_PLAYING, command.action)
    assertEquals(Instant.parse("2026-07-20T08:10:15.123Z").toEpochMilli(), command.expiresAtEpochMs)
  }

  @Test
  fun skipsExpiredPocketBaseDateTime() {
    val expiry = "2026-07-20 08:10:15.123Z"
    val now = Instant.parse("2026-07-20T08:10:15.124Z").toEpochMilli()
    val commands = ControllerCommandParser.parseList(
      JSONObject().put(
        "commands",
        JSONArray().put(
          JSONObject()
            .put("id", "expired")
            .put("sequence", 1)
            .put("idempotencyKey", "expired-key")
            .put("action", "get_now_playing")
            .put("expiresAt", expiry),
        ),
      ).toString(),
      now,
    )

    assertTrue(commands.isEmpty())
  }

  @Test
  fun skipsPocketBaseDateTimeAtTheCurrentTime() {
    val expiry = "2026-07-20 08:10:15.123Z"
    val now = Instant.parse("2026-07-20T08:10:15.123Z").toEpochMilli()
    val commands = ControllerCommandParser.parseList(
      JSONObject().put(
        "commands",
        JSONArray().put(
          JSONObject()
            .put("id", "boundary")
            .put("sequence", 1)
            .put("idempotencyKey", "boundary-key")
            .put("action", "get_now_playing")
            .put("expiresAt", expiry),
        ),
      ).toString(),
      now,
    )

    assertTrue(commands.isEmpty())
  }

  @Test
  fun preservesNumericEpochSeconds() {
    val expected = Instant.parse("2026-07-20T08:10:15Z").toEpochMilli()
    val command = ControllerCommandParser.parse(
      JSONObject()
        .put("id", "numeric")
        .put("sequence", 1)
        .put("idempotencyKey", "numeric-key")
        .put("action", "get_now_playing")
        .put("expiresAt", expected / 1000),
      expected - 1,
    )

    assertEquals(expected, command.expiresAtEpochMs)
  }

  @Test
  fun preservesIsoInstantExpiry() {
    val expiry = "2026-07-20T08:10:15.123Z"
    val command = ControllerCommandParser.parse(
      JSONObject()
        .put("id", "iso")
        .put("sequence", 1)
        .put("idempotencyKey", "iso-key")
        .put("action", "get_now_playing")
        .put("expiresAt", expiry),
      Instant.parse("2026-07-20T08:00:00Z").toEpochMilli(),
    )

    assertEquals(Instant.parse(expiry).toEpochMilli(), command.expiresAtEpochMs)
  }

  @Test(expected = ControllerProtocolException::class)
  fun rejectsMalformedPocketBaseDateTime() {
    ControllerCommandParser.parse(
      JSONObject()
        .put("id", "cmd")
        .put("sequence", 1)
        .put("idempotencyKey", "key")
        .put("action", "get_now_playing")
        .put("payload", JSONObject())
        .put("expiresAt", "2026-02-30 08:10:15.123Z"),
      Instant.parse("2026-02-01T00:00:00Z").toEpochMilli(),
    )
  }

  @Test(expected = ControllerProtocolException::class)
  fun rejectsAmbiguousPocketBaseDateTimeOffset() {
    ControllerCommandParser.parse(
      JSONObject()
        .put("id", "cmd")
        .put("sequence", 1)
        .put("idempotencyKey", "key")
        .put("action", "get_now_playing")
        .put("payload", JSONObject())
        .put("expiresAt", "2026-07-20 08:10:15.123+00:00"),
      Instant.parse("2026-07-20T08:00:00Z").toEpochMilli(),
    )
  }

  @Test(expected = ControllerProtocolException::class)
  fun rejectsUnsupportedAction() {
    ControllerCommandParser.parse(JSONObject().put("id", "x").put("sequence", 1)
      .put("idempotencyKey", "x").put("action", "volume").put("expiresAt", future), future - 1)
  }

  @Test(expected = ControllerProtocolException::class)
  fun rejectsOutOfRangeSeek() {
    ControllerCommandParser.parse(JSONObject().put("id", "x").put("sequence", 1)
      .put("idempotencyKey", "x").put("action", "seek").put("seekSeconds", 86_401).put("expiresAt", future), future - 1)
  }

  @Test
  fun parsesPocketBaseConnectSseAcrossFrames() {
    val parser = PocketBaseSseParser()
    assertTrue(parser.feed("event: PB_CONNECT\ndata: {\"client").isEmpty())
    val event = parser.feed("Id\":\"abc\"}\n\n").single()
    assertEquals("PB_CONNECT", event.name)
    assertEquals("abc", parsePocketBaseConnect(event))
  }

  @Test
  fun throwingSseBodyReaderEmitsConnectionClosedSentinel() = runTest {
    val events = mutableListOf<PocketBaseRealtimeEvent>()
    val reader = object : Reader() {
      private val delegate = StringReader("event: PB_CONNECT\ndata: {\"clientId\":\"abc\"}\n\n")
      private var failed = false

      override fun read(cbuf: CharArray, off: Int, len: Int): Int {
        if (failed) throw IOException("stream reset: CANCEL")
        val read = delegate.read(cbuf, off, len)
        failed = true
        return read
      }

      override fun close() = delegate.close()
    }

    runReconnectableRealtimeStream(
      isOpen = { true },
      readStream = { consumePocketBaseSse(reader) { events += it } },
      onStreamClosed = { events += PocketBaseRealtimeEvent("__PB_STREAM_CLOSED__", "") },
    )

    assertEquals(
      listOf(
        PocketBaseRealtimeEvent("PB_CONNECT", "{\"clientId\":\"abc\"}"),
        PocketBaseRealtimeEvent("__PB_STREAM_CLOSED__", ""),
      ),
      events,
    )
  }

  @Test
  fun cancellationIsNotConvertedToRealtimeReconnect() = runTest {
    var cancellationEscaped = false
    var closedSentinelEmitted = false

    try {
      runReconnectableRealtimeStream(
        isOpen = { true },
        readStream = { throw CancellationException("service stopped") },
        onStreamClosed = { closedSentinelEmitted = true },
      )
    } catch (_: CancellationException) {
      cancellationEscaped = true
    }

    assertTrue(cancellationEscaped)
    assertTrue(!closedSentinelEmitted)
  }

  @Test
  fun unexpectedRealtimeFailureIsNotConvertedToReconnect() = runTest {
    var failureEscaped = false
    var closedSentinelEmitted = false

    try {
      runReconnectableRealtimeStream(
        isOpen = { true },
        readStream = { throw IllegalStateException("unexpected parser failure") },
        onStreamClosed = { closedSentinelEmitted = true },
      )
    } catch (_: IllegalStateException) {
      failureEscaped = true
    }

    assertTrue(failureEscaped)
    assertTrue(!closedSentinelEmitted)
  }

  @Test
  fun duplicateIsReconciledWithoutReplayWhenSnapshotConverged() = runTest {
    val calls = mutableListOf<String>()
    val executor = object : CommandExecutor {
      override suspend fun openVideo(videoId: String) { calls += "open:$videoId" }
      override suspend fun play() { calls += "play" }
      override suspend fun pause() { calls += "pause" }
      override suspend fun seek(seconds: Double) { calls += "seek:$seconds" }
      override suspend fun getNowPlaying() { calls += "now" }
      override suspend fun refreshNowPlaying(): PlaybackSnapshot {
        calls += "now"
        return PlaybackSnapshot("dQw4w9WgXcQ")
      }
    }
    val store = InMemoryProgressStore(ControllerProgress("session", 4, 2, "cmd-1", "key-1"))
    val processor = ControllerCommandProcessor(executor, store, { future - 1 })
    val command = ControllerCommand("cmd-1", 1, "key-1", ControllerAction.OPEN_VIDEO, "dQw4w9WgXcQ", expiresAtEpochMs = future)
    assertEquals(CommandResult.Duplicate, processor.process(command, session, PlaybackSnapshot("dQw4w9WgXcQ")))
    assertEquals(listOf("now"), calls)
  }

  @Test
  fun staleGenerationDoesNotTouchLounge() = runTest {
    var invoked = false
    val executor = object : CommandExecutor {
      override suspend fun openVideo(videoId: String) { invoked = true }
      override suspend fun play() = Unit
      override suspend fun pause() = Unit
      override suspend fun seek(seconds: Double) = Unit
      override suspend fun getNowPlaying() = Unit
    }
    val processor = ControllerCommandProcessor(executor, InMemoryProgressStore(), { future - 1 })
    val command = ControllerCommand("cmd", 1, "key", ControllerAction.PLAY, generation = 3, expiresAtEpochMs = future)
    assertEquals(CommandResult.Stale, processor.process(command, session, PlaybackSnapshot()))
    assertTrue(!invoked)
  }

  @Test
  fun queuedCommandExpiresWhileWaitingForLoungeSend() = runTest {
    val sendLock = Mutex()
    val firstEntered = CompletableDeferred<Unit>()
    val releaseFirst = CompletableDeferred<Unit>()
    var calls = 0
    val executor = object : CommandExecutor {
      override suspend fun openVideo(videoId: String) = Unit
      override suspend fun play() {
        sendLock.withLock {
          calls++
          if (calls == 1) {
            firstEntered.complete(Unit)
            releaseFirst.await()
          }
        }
      }
      override suspend fun pause() = Unit
      override suspend fun seek(seconds: Double) = Unit
      override suspend fun getNowPlaying() = Unit
    }
    val clock = System.currentTimeMillis()
    val processor = ControllerCommandProcessor(executor, InMemoryProgressStore(), { System.currentTimeMillis() })
    val first = ControllerCommand("first", 1, "first-key", ControllerAction.PLAY, expiresAtEpochMs = clock + 5_000)
    val second = ControllerCommand("second", 2, "second-key", ControllerAction.PLAY, expiresAtEpochMs = clock + 40)
    val firstResult = launch { assertEquals(CommandResult.Applied, processor.process(first, session, PlaybackSnapshot())) }
    firstEntered.await()
    assertEquals(
      CommandResult.TransientFailure("command_deadline_exceeded"),
      processor.process(second, session, PlaybackSnapshot()),
    )
    releaseFirst.complete(Unit)
    firstResult.join()
  }

  @Test
  fun commandExpiredBeforeExecutionIsNotMarkedAmbiguous() = runTest {
    var invoked = false
    val executor = object : CommandExecutor {
      override suspend fun openVideo(videoId: String) = Unit
      override suspend fun play() { invoked = true }
      override suspend fun pause() = Unit
      override suspend fun seek(seconds: Double) = Unit
      override suspend fun getNowPlaying() = Unit
    }
    val now = System.currentTimeMillis()
    val processor = ControllerCommandProcessor(executor, InMemoryProgressStore(), { now })
    val command = ControllerCommand("expired", 1, "expired-key", ControllerAction.PLAY, expiresAtEpochMs = now)
    assertEquals(CommandResult.Expired, processor.process(command, session, PlaybackSnapshot()))
    assertTrue(!invoked)
  }

  @Test
  fun bridgeSubscribesOnceAndRefetchesAfterRealtimeWake() = runTest {
    var fetches = 0
    var subscriptions = 0
    val auth = ControllerAuth("auth", baseUrl = "https://karaoke.example")
    val fakeApi = object : ControllerApi {
      override suspend fun enroll(baseUrl: String, grant: String, deviceName: String) = ControllerCredentials(baseUrl, "key", "secret")
      override suspend fun authenticate(credentials: ControllerCredentials) = auth
      override suspend fun startOrResumeSession(auth: ControllerAuth, resumeSessionId: String?) = session
      override suspend fun fetchCommands(auth: ControllerAuth, session: ControllerSession, afterSequence: Long): List<ControllerCommand> { fetches++; return emptyList() }
      override suspend fun acknowledge(auth: ControllerAuth, session: ControllerSession, command: ControllerCommand, success: Boolean, errorCode: String?) = Unit
      override suspend fun reportState(auth: ControllerAuth, session: ControllerSession, state: SanitizedControllerState) = Unit
    }
    val realtime = object : ControllerRealtimeTransport {
      override suspend fun connect(auth: ControllerAuth) = object : ControllerRealtimeConnection {
        override val events: Flow<PocketBaseRealtimeEvent> = flowOf(
          PocketBaseRealtimeEvent("PB_CONNECT", "{\"clientId\":\"client\"}"),
          PocketBaseRealtimeEvent("create", "{\"record\":{}}"),
        )
        override suspend fun subscribe(clientId: String, collection: String) { subscriptions++ }
        override fun close() = Unit
      }
    }
    val bridge = PocketBaseControllerBridge(fakeApi, realtime, InMemoryProgressStore(), ControllerCredentials("https://karaoke.example", "key", "secret"), now = { future - 1 })
    bridge.establish()
    bridge.listenRealtime { }
    assertEquals(2, fetches)
    assertEquals(1, subscriptions)
  }

  @Test
  fun bridgeFallsBackToAuthoritativePollingForRealtimeAuthorizationMismatch() = runTest {
    val callbacks = mutableListOf<String>()
    val auth = ControllerAuth("auth", baseUrl = "https://karaoke.example")
    val api = object : ControllerApi {
      override suspend fun enroll(baseUrl: String, grant: String, deviceName: String) = ControllerCredentials(baseUrl, "key", "secret")
      override suspend fun authenticate(credentials: ControllerCredentials) = auth
      override suspend fun startOrResumeSession(auth: ControllerAuth, resumeSessionId: String?) = session
      override suspend fun fetchCommands(auth: ControllerAuth, session: ControllerSession, afterSequence: Long) = emptyList<ControllerCommand>()
      override suspend fun acknowledge(auth: ControllerAuth, session: ControllerSession, command: ControllerCommand, success: Boolean, errorCode: String?) = Unit
      override suspend fun reportState(auth: ControllerAuth, session: ControllerSession, state: SanitizedControllerState) = Unit
    }
    val realtime = object : ControllerRealtimeTransport {
      override suspend fun connect(auth: ControllerAuth) = object : ControllerRealtimeConnection {
        override val events: Flow<PocketBaseRealtimeEvent> = flowOf(PocketBaseRealtimeEvent("PB_CONNECT", "{\"clientId\":\"client\"}"))
        override suspend fun subscribe(clientId: String, collection: String) { throw ControllerHttpException(403) }
        override fun close() = Unit
      }
    }
    val bridge = PocketBaseControllerBridge(
      api, realtime, InMemoryProgressStore(), ControllerCredentials("https://karaoke.example", "key", "secret"),
      now = { future - 1 },
      diagnostics = object : ControllerDiagnosticsListener {
        override fun realtimeFallback(errorCode: String) { callbacks += errorCode }
      },
    )

    assertEquals(emptyList<ControllerCommand>(), bridge.establish())
    assertFalse(bridge.isRealtimeAvailable)
    assertEquals(listOf("ControllerHttp403"), callbacks)
  }

  @Test
  fun bridgeReportsEstablishInitialRefetchSubscriptionAndRealtimeHintTelemetry() = runTest {
    val callbacks = mutableListOf<String>()
    var fetches = 0
    val auth = ControllerAuth("auth", baseUrl = "https://karaoke.example")
    val fakeApi = object : ControllerApi {
      override suspend fun enroll(baseUrl: String, grant: String, deviceName: String) = ControllerCredentials(baseUrl, "key", "secret")
      override suspend fun authenticate(credentials: ControllerCredentials) = auth
      override suspend fun startOrResumeSession(auth: ControllerAuth, resumeSessionId: String?) = session
      override suspend fun fetchCommands(auth: ControllerAuth, session: ControllerSession, afterSequence: Long): List<ControllerCommand> {
        fetches++
        return emptyList()
      }
      override suspend fun acknowledge(auth: ControllerAuth, session: ControllerSession, command: ControllerCommand, success: Boolean, errorCode: String?) = Unit
      override suspend fun reportState(auth: ControllerAuth, session: ControllerSession, state: SanitizedControllerState) = Unit
    }
    val realtime = object : ControllerRealtimeTransport {
      override suspend fun connect(auth: ControllerAuth) = object : ControllerRealtimeConnection {
        override val events: Flow<PocketBaseRealtimeEvent> = flowOf(
          PocketBaseRealtimeEvent("PB_CONNECT", "{\"clientId\":\"client\"}"),
          PocketBaseRealtimeEvent("create", "{\"record\":{\"token\":\"secret\"}}"),
        )
        override suspend fun subscribe(clientId: String, collection: String) { callbacks += "subscribed:$collection" }
        override fun close() = Unit
      }
    }
    val bridge = PocketBaseControllerBridge(
      fakeApi,
      realtime,
      InMemoryProgressStore(),
      ControllerCredentials("https://karaoke.example", "key", "secret"),
      now = { future - 1 },
      diagnostics = object : ControllerDiagnosticsListener {
        override fun established() { callbacks += "established" }
        override fun initialRefetch(commandCount: Int) { callbacks += "initial:$commandCount" }
        override fun realtimeEvent(name: String) { callbacks += name }
        override fun refetchSucceeded(commandCount: Int) { callbacks += "refetch:$commandCount" }
        override fun subscriptionAccepted() { callbacks += "accepted" }
      },
    )

    bridge.establish()
    bridge.listenRealtime { }

    assertEquals(2, fetches)
    assertEquals(
      listOf(
        "subscribed:controller_commands/*",
        "accepted",
        "established",
        "refetch:0",
        "initial:0",
        "event:PB_CONNECT",
        "event:create",
        "refetch:0",
      ),
      callbacks,
    )
  }

  @Test
  fun throwingDiagnosticsCallbacksCannotInterruptControllerLifecycle() = runTest {
    var fetches = 0
    val delegate = basicApi()
    val api = object : ControllerApi by delegate {
      override suspend fun fetchCommands(auth: ControllerAuth, session: ControllerSession, afterSequence: Long): List<ControllerCommand> {
        fetches++
        return emptyList()
      }
    }
    val realtime = object : ControllerRealtimeTransport {
      override suspend fun connect(auth: ControllerAuth) = object : ControllerRealtimeConnection {
        override val events: Flow<PocketBaseRealtimeEvent> = flowOf(
          PocketBaseRealtimeEvent("PB_CONNECT", "{\"clientId\":\"client\"}"),
          PocketBaseRealtimeEvent("create", "{\"record\":{}}"),
        )
        override suspend fun subscribe(clientId: String, collection: String) = Unit
        override fun close() = Unit
      }
    }
    val throwing = object : ControllerDiagnosticsListener {
      override fun attemptStarted() = error("telemetry attempt callback")
      override fun established() = error("telemetry establish callback")
      override fun initialRefetch(commandCount: Int) = error("telemetry initial callback")
      override fun realtimeEvent(name: String) = error("telemetry event callback")
      override fun refetchSucceeded(commandCount: Int) = error("telemetry refetch callback")
      override fun subscriptionAccepted() = error("telemetry subscription callback")
    }
    val bridge = PocketBaseControllerBridge(
      api,
      realtime,
      InMemoryProgressStore(),
      ControllerCredentials("https://karaoke.example", "key", "secret"),
      now = { future - 1 },
      diagnostics = throwing,
    )

    bridge.establish()
    bridge.listenRealtime { }

    assertEquals(2, fetches)
  }

  @Test
  fun bridgeReportsAuthoritativeRefetchFailureWithoutResponseDetails() = runTest {
    val failures = mutableListOf<String>()
    val delegate = basicApi()
    val api = object : ControllerApi by delegate {
      override suspend fun fetchCommands(auth: ControllerAuth, session: ControllerSession, afterSequence: Long): List<ControllerCommand> {
        throw ControllerHttpException(503)
      }
    }
    val bridge = PocketBaseControllerBridge(
      api,
      connectingRealtime(),
      InMemoryProgressStore(),
      ControllerCredentials("https://karaoke.example", "key", "secret"),
      now = { future - 1 },
      diagnostics = object : ControllerDiagnosticsListener {
        override fun refetchFailed(errorCode: String) {
          failures += errorCode
          error("telemetry failure callback")
        }
      },
    )

    try {
      bridge.establish()
      throw AssertionError("expected refetch failure")
    } catch (_: ControllerHttpException) {
      // Failure is surfaced to the reconnect loop after redacted telemetry is recorded.
    }

    assertEquals(listOf("ControllerHttp503"), failures)
  }

  @Test
  fun sanitizedStateUsesBackendEnumsOnly() {
    assertEquals("disconnected", sanitizeControllerConnectionState(ConnectionState.IDLE))
    assertEquals("connecting", sanitizeControllerConnectionState(ConnectionState.RECONNECTING))
    assertEquals("connected", sanitizeControllerConnectionState(ConnectionState.CONNECTED))
    assertEquals("ended", sanitizeLoungePlayerState("0"))
    assertEquals("unknown", sanitizeLoungePlayerState("idle"))
  }

  @Test(expected = IOException::class)
  fun bridgeSurfacesEndedRealtimeForBoundedReconnect() = runTest {
    val auth = ControllerAuth("auth", baseUrl = "https://karaoke.example")
    val fakeApi = object : ControllerApi {
      override suspend fun enroll(baseUrl: String, grant: String, deviceName: String) = ControllerCredentials(baseUrl, "key", "secret")
      override suspend fun authenticate(credentials: ControllerCredentials) = auth
      override suspend fun startOrResumeSession(auth: ControllerAuth, resumeSessionId: String?) = session
      override suspend fun fetchCommands(auth: ControllerAuth, session: ControllerSession, afterSequence: Long) = emptyList<ControllerCommand>()
      override suspend fun acknowledge(auth: ControllerAuth, session: ControllerSession, command: ControllerCommand, success: Boolean, errorCode: String?) = Unit
      override suspend fun reportState(auth: ControllerAuth, session: ControllerSession, state: SanitizedControllerState) = Unit
    }
    val realtime = object : ControllerRealtimeTransport {
      override suspend fun connect(auth: ControllerAuth) = object : ControllerRealtimeConnection {
        override val events: Flow<PocketBaseRealtimeEvent> = flowOf(PocketBaseRealtimeEvent("PB_CONNECT", "{\"clientId\":\"client\"}"), PocketBaseRealtimeEvent("__PB_STREAM_CLOSED__", ""))
        override suspend fun subscribe(clientId: String, collection: String) = Unit
        override fun close() = Unit
      }
    }
    val bridge = PocketBaseControllerBridge(fakeApi, realtime, InMemoryProgressStore(), ControllerCredentials("https://karaoke.example", "key", "secret"), now = { future - 1 })
    bridge.establish()
    bridge.listenRealtime { }
  }

  @Test
  fun expiredPersistedSessionRetriesOnceWithoutResume() = runTest {
    val resumes = mutableListOf<String?>()
    val savedSessions = mutableListOf<ControllerSession>()
    val progress = InMemoryProgressStore(ControllerProgress("expired", 4, 7, "old-command", "old-key"))
    val freshSession = ControllerSession("fresh", 5, future)
    val fakeApi = object : ControllerApi {
      override suspend fun enroll(baseUrl: String, grant: String, deviceName: String) = ControllerCredentials(baseUrl, "key", "secret")
      override suspend fun authenticate(credentials: ControllerCredentials) = ControllerAuth("auth", baseUrl = credentials.baseUrl)
      override suspend fun startOrResumeSession(auth: ControllerAuth, resumeSessionId: String?): ControllerSession {
        resumes += resumeSessionId
        if (resumeSessionId != null) throw ControllerHttpException(409)
        return freshSession
      }
      override suspend fun fetchCommands(auth: ControllerAuth, session: ControllerSession, afterSequence: Long) = emptyList<ControllerCommand>()
      override suspend fun acknowledge(auth: ControllerAuth, session: ControllerSession, command: ControllerCommand, success: Boolean, errorCode: String?) = Unit
      override suspend fun reportState(auth: ControllerAuth, session: ControllerSession, state: SanitizedControllerState) = Unit
    }
    val bridge = PocketBaseControllerBridge(
      fakeApi,
      connectingRealtime(),
      progress,
      ControllerCredentials("https://karaoke.example", "key", "secret"),
      sessionStore = object : SessionStore {
        override fun load() = ControllerSession("expired", 4, future - 2)
        override fun save(session: ControllerSession) { savedSessions += session }
      },
      now = { future - 1 },
    )
    bridge.establish()
    assertEquals(listOf("expired", null), resumes)
    assertEquals(listOf(freshSession), savedSessions)
    assertEquals(7, progress.load().lastCommandSequence)
    assertEquals("fresh", progress.load().sessionId)
    assertEquals(null, progress.load().inFlightId)
  }

  @Test
  fun ambiguousSendReconcilesImmediatelyAndAcksOnce() = runTest {
    var acknowledgements = 0
    var playCalls = 0
    var nowPlaying = PlaybackSnapshot()
    val command = ControllerCommand("cmd", 1, "key", ControllerAction.PLAY, expiresAtEpochMs = future)
    val fakeApi = basicApi(onAck = { acknowledgements++ })
    val progress = InMemoryProgressStore()
    val bridge = PocketBaseControllerBridge(
      fakeApi,
      connectingRealtime(),
      progress,
      ControllerCredentials("https://karaoke.example", "key", "secret"),
      now = { future - 1 },
    )
    bridge.establish()
    val executor = object : CommandExecutor {
      override suspend fun openVideo(videoId: String) = Unit
      override suspend fun play() {
        playCalls++
        nowPlaying = PlaybackSnapshot(state = "PLAYING")
        throw IOException("ambiguous send")
      }
      override suspend fun pause() = Unit
      override suspend fun seek(seconds: Double) = Unit
      override suspend fun getNowPlaying() = Unit
      override suspend fun refreshNowPlaying() = nowPlaying
    }
    val processor = ControllerCommandProcessor(executor, progress, { future - 1 })
    assertEquals(CommandResult.Duplicate, bridge.processCommand(processor, command, PlaybackSnapshot()))
    assertEquals(1, acknowledgements)
    assertEquals(null, progress.load().inFlightId)
    assertEquals(1, playCalls)
  }

  @Test
  fun ambiguousSendWithUnconvergedRefreshRemainsUnacked() = runTest {
    var acknowledgements = 0
    val progress = InMemoryProgressStore()
    val bridge = PocketBaseControllerBridge(
      basicApi(onAck = { acknowledgements++ }),
      connectingRealtime(),
      progress,
      ControllerCredentials("https://karaoke.example", "key", "secret"),
      now = { future - 1 },
    )
    bridge.establish()
    val executor = object : CommandExecutor {
      override suspend fun openVideo(videoId: String) = throw IOException("send timeout")
      override suspend fun play() = throw IOException("send timeout")
      override suspend fun pause() = Unit
      override suspend fun seek(seconds: Double) = Unit
      override suspend fun getNowPlaying() = Unit
      override suspend fun refreshNowPlaying() = throw IOException("refresh unavailable")
    }
    val processor = ControllerCommandProcessor(executor, progress, { future - 1 })
    val command = ControllerCommand("cmd", 1, "key", ControllerAction.OPEN_VIDEO, "WEuuVs4SrSA", expiresAtEpochMs = future)
    try {
      bridge.processCommand(processor, command, PlaybackSnapshot())
      throw AssertionError("expected ambiguous failure")
    } catch (_: AmbiguousCommandException) {
      // No ACK while the applied state is unconfirmed.
    }
    assertEquals(0, acknowledgements)
  }

  @Test
  fun ambiguousRefreshExpiryCannotAckLateState() = runTest {
    var acknowledgements = 0
    val clock = System.currentTimeMillis()
    val progress = InMemoryProgressStore()
    val bridge = PocketBaseControllerBridge(
      basicApi(onAck = { acknowledgements++ }),
      connectingRealtime(),
      progress,
      ControllerCredentials("https://karaoke.example", "key", "secret"),
      now = { clock },
    )
    bridge.establish()
    val executor = object : CommandExecutor {
      override suspend fun openVideo(videoId: String) = throw IOException("send timeout")
      override suspend fun play() = Unit
      override suspend fun pause() = Unit
      override suspend fun seek(seconds: Double) = Unit
      override suspend fun getNowPlaying() = Unit
      override suspend fun refreshNowPlaying(): PlaybackSnapshot {
        delay(100)
        return PlaybackSnapshot(videoId = "WEuuVs4SrSA")
      }
    }
    val processor = ControllerCommandProcessor(executor, progress, { clock })
    val command = ControllerCommand("cmd", 1, "key", ControllerAction.OPEN_VIDEO, "WEuuVs4SrSA", expiresAtEpochMs = clock + 25)
    try {
      bridge.processCommand(processor, command, PlaybackSnapshot())
      throw AssertionError("expected ambiguous expiry")
    } catch (_: AmbiguousCommandException) {
      // Expiry prevents a late ACK even if a refresh eventually returns the target.
    }
    assertEquals(0, acknowledgements)
  }

  @Test
  fun acknowledgementTimeoutRestoresInFlightProgress() = runTest {
    val clock = System.currentTimeMillis()
    var acknowledgements = 0
    val progress = InMemoryProgressStore(ControllerProgress("prior", 2, 4))
    val delegate = basicApi()
    val api = object : ControllerApi by delegate {
      override suspend fun acknowledge(
        auth: ControllerAuth,
        session: ControllerSession,
        command: ControllerCommand,
        success: Boolean,
        errorCode: String?,
      ) {
        delay(100)
        acknowledgements++
      }
    }
    val bridge = PocketBaseControllerBridge(
      api,
      connectingRealtime(),
      progress,
      ControllerCredentials("https://karaoke.example", "key", "secret"),
      now = { clock },
    )
    bridge.establish()
    val command = ControllerCommand("cmd", 5, "key", ControllerAction.PLAY, expiresAtEpochMs = clock + 25)
    val executor = object : CommandExecutor {
      override suspend fun openVideo(videoId: String) = Unit
      override suspend fun play() = Unit
      override suspend fun pause() = Unit
      override suspend fun seek(seconds: Double) = Unit
      override suspend fun getNowPlaying() = Unit
    }
    try {
      bridge.processCommand(ControllerCommandProcessor(executor, progress, { clock }), command, PlaybackSnapshot())
      throw AssertionError("expected acknowledgement timeout")
    } catch (_: ControllerAcknowledgementException) {
      // Reconnect/refetch must recover the command using restored in-flight identity.
    }
    assertEquals(0, acknowledgements)
    assertEquals(4, progress.load().lastCommandSequence)
    assertEquals("cmd", progress.load().inFlightId)
  }

  @Test
  fun acknowledgementHttpCancellationCancelsCallAndRestoresInFlightProgress() = runBlocking {
    val bodyRead = CountDownLatch(1)
    val cancelled = CountDownLatch(1)
    val client = OkHttpClient.Builder()
      .addInterceptor(Interceptor { chain ->
        val call = chain.call()
        val body = object : ResponseBody() {
          override fun contentType() = "application/json".toMediaType()
          override fun contentLength() = -1L
          override fun source(): BufferedSource = object : Source {
            override fun read(sink: Buffer, byteCount: Long): Long {
              bodyRead.countDown()
              while (!call.isCanceled()) {
                try {
                  Thread.sleep(1)
                } catch (_: InterruptedException) {
                  // Re-check cancellation below.
                }
              }
              cancelled.countDown()
              throw IOException("response body cancelled")
            }

            override fun timeout() = Timeout.NONE
            override fun close() = Unit
          }.buffer()
        }
        okhttp3.Response.Builder()
          .request(chain.request())
          .protocol(Protocol.HTTP_1_1)
          .code(200)
          .message("OK")
          .body(body)
          .build()
      })
      .build()
    val delegate = basicApi()
    val api = object : ControllerApi by delegate {
      val http = PocketBaseControllerApi(client)

      override suspend fun acknowledge(
        auth: ControllerAuth,
        session: ControllerSession,
        command: ControllerCommand,
        success: Boolean,
        errorCode: String?,
      ) = http.acknowledge(auth, session, command, success, errorCode)
    }
    val clock = System.currentTimeMillis()
    val progress = InMemoryProgressStore(ControllerProgress("prior", 2, 4))
    val bridge = PocketBaseControllerBridge(
      api,
      connectingRealtime(),
      progress,
      ControllerCredentials("https://karaoke.example", "key", "secret"),
      now = { clock },
    )
    bridge.establish()
    val command = ControllerCommand("cmd", 5, "key", ControllerAction.PLAY, expiresAtEpochMs = clock + 250)
    val executor = object : CommandExecutor {
      override suspend fun openVideo(videoId: String) = Unit
      override suspend fun play() = Unit
      override suspend fun pause() = Unit
      override suspend fun seek(seconds: Double) = Unit
      override suspend fun getNowPlaying() = Unit
    }
    try {
      bridge.processCommand(ControllerCommandProcessor(executor, progress, { clock }), command, PlaybackSnapshot())
      throw AssertionError("expected acknowledgement timeout")
    } catch (_: ControllerAcknowledgementException) {
      // Cancellation must reach the underlying OkHttp call before the in-flight marker is restored.
    }
    assertTrue(bodyRead.await(1, TimeUnit.SECONDS))
    assertTrue(cancelled.await(1, TimeUnit.SECONDS))
    assertEquals(4, progress.load().lastCommandSequence)
    assertEquals("cmd", progress.load().inFlightId)
  }

  @Test
  fun outerTimeoutDuringAcknowledgementPropagatesAndRestoresInFlightProgress() = runTest {
    val clock = System.currentTimeMillis()
    val progress = InMemoryProgressStore(ControllerProgress("prior", 2, 4))
    val delegate = basicApi()
    val api = object : ControllerApi by delegate {
      override suspend fun acknowledge(
        auth: ControllerAuth,
        session: ControllerSession,
        command: ControllerCommand,
        success: Boolean,
        errorCode: String?,
      ) {
        delay(100)
      }
    }
    val bridge = PocketBaseControllerBridge(
      api,
      connectingRealtime(),
      progress,
      ControllerCredentials("https://karaoke.example", "key", "secret"),
      now = { clock },
    )
    bridge.establish()
    val command = ControllerCommand("cmd", 5, "key", ControllerAction.PLAY, expiresAtEpochMs = clock + 10_000)
    val executor = object : CommandExecutor {
      override suspend fun openVideo(videoId: String) = Unit
      override suspend fun play() = Unit
      override suspend fun pause() = Unit
      override suspend fun seek(seconds: Double) = Unit
      override suspend fun getNowPlaying() = Unit
    }
    try {
      withTimeout(25) {
        bridge.processCommand(ControllerCommandProcessor(executor, progress, { clock }), command, PlaybackSnapshot())
      }
      throw AssertionError("expected outer timeout")
    } catch (_: kotlinx.coroutines.TimeoutCancellationException) {
      // Parent cancellation must remain distinguishable from the bridge's own expiry timeout.
    }
    assertEquals(4, progress.load().lastCommandSequence)
    assertEquals("cmd", progress.load().inFlightId)
  }

  @Test
  fun ambiguousOpenAndSeekRedeliveryReconcilesFromLatestState() = runTest {
    val targets = listOf(
      ControllerCommand(
        "open", 1, "open-key", ControllerAction.OPEN_VIDEO, "WEuuVs4SrSA", expiresAtEpochMs = future,
      ),
      ControllerCommand(
        "seek", 2, "seek-key", ControllerAction.SEEK, seekSeconds = 30.0, expiresAtEpochMs = future,
      ),
    )
    var nowPlaying = PlaybackSnapshot()
    val executor = object : CommandExecutor {
      override suspend fun openVideo(videoId: String) {
        nowPlaying = PlaybackSnapshot(videoId = videoId)
        throw IOException("response timeout after open")
      }
      override suspend fun play() = Unit
      override suspend fun pause() = Unit
      override suspend fun seek(seconds: Double) {
        nowPlaying = nowPlaying.copy(positionSeconds = seconds)
        throw IOException("response timeout after seek")
      }
      override suspend fun getNowPlaying() = Unit
      override suspend fun refreshNowPlaying() = nowPlaying
    }
    for (command in targets) {
      val progress = InMemoryProgressStore()
      val processor = ControllerCommandProcessor(executor, progress, { future - 1 })
      assertEquals(CommandResult.Duplicate, processor.process(command, session, PlaybackSnapshot()))
    }
  }

  @Test
  fun timedOutRefreshAcceptsOnlyObservationAfterDispatchMarker() {
    val target = PlaybackSnapshot(videoId = "WEuuVs4SrSA", positionSeconds = 30.0)
    val observed = DiagnosticsSnapshot(nowPlaying = target, playbackRevision = 8)
    val correlation = CommandCorrelation()
    assertEquals(null, correlation.accept(observed))
    correlation.begin("cmd", "key", revision = 7)
    assertEquals(target, correlation.accept(observed))
    correlation.begin("cmd", "key", revision = 99)
    assertEquals(target, correlation.accept(observed))
    correlation.begin("next", "next-key", revision = 8)
    assertEquals(null, correlation.accept(observed))
  }

  @Test
  fun bridgeAcksCorrelatedOpenAndSeekAfterAmbiguousSends() = runTest {
    var acknowledgements = 0
    var nowPlaying = PlaybackSnapshot()
    val bridge = PocketBaseControllerBridge(
      basicApi(onAck = { acknowledgements++ }),
      connectingRealtime(),
      InMemoryProgressStore(),
      ControllerCredentials("https://karaoke.example", "key", "secret"),
      now = { future - 1 },
    )
    bridge.establish()
    val executor = object : CommandExecutor {
      override suspend fun openVideo(videoId: String) {
        nowPlaying = PlaybackSnapshot(videoId = videoId)
        throw IOException("open response timeout")
      }
      override suspend fun play() = Unit
      override suspend fun pause() = Unit
      override suspend fun seek(seconds: Double) {
        nowPlaying = nowPlaying.copy(positionSeconds = seconds)
        throw IOException("seek response timeout")
      }
      override suspend fun getNowPlaying() = Unit
      override suspend fun refreshNowPlaying() = nowPlaying
    }
    val processor = ControllerCommandProcessor(executor, InMemoryProgressStore(), { future - 1 })
    val commands = listOf(
      ControllerCommand("open", 1, "open-key", ControllerAction.OPEN_VIDEO, "WEuuVs4SrSA", expiresAtEpochMs = future),
      ControllerCommand("seek", 2, "seek-key", ControllerAction.SEEK, seekSeconds = 30.0, expiresAtEpochMs = future),
    )
    for (command in commands) {
      assertEquals(CommandResult.Duplicate, bridge.processCommand(processor, command, PlaybackSnapshot()))
    }
    assertEquals(2, acknowledgements)
  }

  @Test
  fun recreatedExecutorPreservesSameCommandCorrelationButResetsNewCommand() = runTest {
    var acknowledgements = 0
    var observed = DiagnosticsSnapshot()
    val correlation = CommandCorrelation()
    val progress = InMemoryProgressStore()
    val bridge = PocketBaseControllerBridge(
      basicApi(onAck = { acknowledgements++ }),
      connectingRealtime(),
      progress,
      ControllerCredentials("https://karaoke.example", "key", "secret"),
      now = { future - 1 },
    )
    bridge.establish()
    fun executor() = object : CommandExecutor {
      override fun beginCommand(commandId: String, idempotencyKey: String) {
        correlation.begin(commandId, idempotencyKey, observed.playbackRevision)
      }
      override suspend fun openVideo(videoId: String) {
        observed = observed.copy(
          nowPlaying = PlaybackSnapshot(videoId = videoId),
          playbackRevision = observed.playbackRevision + 1,
        )
        throw IOException("response timeout")
      }
      override suspend fun play() = Unit
      override suspend fun pause() = Unit
      override suspend fun seek(seconds: Double) = Unit
      override suspend fun getNowPlaying() = Unit
      override suspend fun refreshNowPlaying() = correlation.accept(observed)
        ?: throw IOException("uncorrelated state")
    }
    val command = ControllerCommand("open", 1, "open-key", ControllerAction.OPEN_VIDEO, "WEuuVs4SrSA", expiresAtEpochMs = future)
    assertEquals(
      CommandResult.Duplicate,
      bridge.processCommand(ControllerCommandProcessor(executor(), progress, { future - 1 }), command, PlaybackSnapshot()),
    )
    assertEquals(1, acknowledgements)

    correlation.begin("new", "new-key", observed.playbackRevision)
    assertEquals(null, correlation.accept(observed))
    assertEquals(null, CommandCorrelation().accept(observed))
  }

  @Test
  fun cachedConvergedStateWithoutFreshEventIsNotAcknowledged() = runTest {
    var acknowledgements = 0
    val progress = InMemoryProgressStore(ControllerProgress("session", 4, 0, "cmd", "key"))
    val bridge = PocketBaseControllerBridge(
      basicApi(onAck = { acknowledgements++ }),
      connectingRealtime(),
      progress,
      ControllerCredentials("https://karaoke.example", "key", "secret"),
      now = { future - 1 },
    )
    bridge.establish()
    val executor = object : CommandExecutor {
      override suspend fun openVideo(videoId: String) = Unit
      override suspend fun play() = Unit
      override suspend fun pause() = Unit
      override suspend fun seek(seconds: Double) = Unit
      override suspend fun getNowPlaying() = throw IOException("no correlated state event")
    }
    val command = ControllerCommand("cmd", 1, "key", ControllerAction.PLAY, expiresAtEpochMs = future)
    try {
      bridge.processCommand(
        ControllerCommandProcessor(executor, progress, { future - 1 }),
        command,
        PlaybackSnapshot(state = "PLAYING"),
      )
      throw AssertionError("expected transient refresh failure")
    } catch (_: AmbiguousCommandException) {
      // Cached convergence cannot substitute for a correlated authoritative refresh.
    }
    assertEquals(0, acknowledgements)
    assertEquals("cmd", progress.load().inFlightId)
  }

  @Test
  fun offlineResumeFailureCanRetryWithoutLosingInFlightIdentity() = runTest {
    var starts = 0
    val progress = InMemoryProgressStore(ControllerProgress("session", 4, 0, "cmd", "key"))
    val delegate = basicApi()
    val fakeApi = object : ControllerApi by delegate {
      override suspend fun startOrResumeSession(auth: ControllerAuth, resumeSessionId: String?): ControllerSession {
        starts++
        if (starts == 1) throw IOException("offline")
        return session
      }
    }
    val bridge = PocketBaseControllerBridge(
      fakeApi,
      connectingRealtime(),
      progress,
      ControllerCredentials("https://karaoke.example", "key", "secret"),
      now = { future - 1 },
    )
    try {
      bridge.establish()
      throw AssertionError("expected offline failure")
    } catch (_: IOException) {
      // Service backoff retries establish.
    }
    bridge.establish()
    assertEquals(2, starts)
    assertEquals("cmd", progress.load().inFlightId)
  }

  @Test
  fun loungeStartupRaceKeepsCommandPendingWithoutFailureAck() = runTest {
    var acknowledgements = 0
    val progress = InMemoryProgressStore()
    val bridge = PocketBaseControllerBridge(
      basicApi(onAck = { acknowledgements++ }),
      connectingRealtime(),
      progress,
      ControllerCredentials("https://karaoke.example", "key", "secret"),
      now = { future - 1 },
    )
    bridge.establish()
    val executor = object : CommandExecutor {
      override suspend fun openVideo(videoId: String) = throw IOException("Lounge unavailable")
      override suspend fun play() = throw IOException("Lounge unavailable")
      override suspend fun pause() = throw IOException("Lounge unavailable")
      override suspend fun seek(seconds: Double) = throw IOException("Lounge unavailable")
      override suspend fun getNowPlaying() = throw IOException("Lounge unavailable")
    }
    val command = ControllerCommand("startup", 1, "startup-key", ControllerAction.PLAY, expiresAtEpochMs = future)
    try {
      bridge.processCommand(ControllerCommandProcessor(executor, progress, { future - 1 }), command, PlaybackSnapshot())
      throw AssertionError("expected startup race to reconnect")
    } catch (_: AmbiguousCommandException) {
      // Expected: no terminal ack until Lounge is available and redelivery is reconciled.
    }
    assertEquals(0, acknowledgements)
    assertEquals("startup", progress.load().inFlightId)
  }

  @Test(expected = IOException::class)
  fun lowerGenerationFreshSessionAfterConflictIsRejected() = runTest {
    val progress = InMemoryProgressStore(ControllerProgress("expired", 4, 0))
    val delegate = basicApi()
    val api = object : ControllerApi by delegate {
      override suspend fun startOrResumeSession(auth: ControllerAuth, resumeSessionId: String?): ControllerSession {
        if (resumeSessionId != null) throw ControllerHttpException(409)
        return ControllerSession("fresh", 3, future)
      }
    }
    PocketBaseControllerBridge(
      api,
      connectingRealtime(),
      progress,
      ControllerCredentials("https://karaoke.example", "key", "secret"),
      now = { future - 1 },
    ).establish()
  }

  @Test
  fun playbackRevisionAdvancesOnlyForAuthoritativeNowPlayingEvents() {
    val diagnostics = DiagnosticsStore()
    diagnostics.nowPlaying(PlaybackSnapshot(state = "PLAYING"))
    assertEquals(0, diagnostics.snapshot.value.playbackRevision)
    diagnostics.nowPlaying(PlaybackSnapshot(state = "PAUSED"), authoritative = true)
    assertEquals(1, diagnostics.snapshot.value.playbackRevision)
  }

  private fun connectingRealtime(): ControllerRealtimeTransport = object : ControllerRealtimeTransport {
    override suspend fun connect(auth: ControllerAuth) = object : ControllerRealtimeConnection {
      override val events: Flow<PocketBaseRealtimeEvent> = flowOf(PocketBaseRealtimeEvent("PB_CONNECT", "{\"clientId\":\"client\"}"))
      override suspend fun subscribe(clientId: String, collection: String) = Unit
      override fun close() = Unit
    }
  }

  private fun basicApi(onAck: () -> Unit = {}): ControllerApi = object : ControllerApi {
    override suspend fun enroll(baseUrl: String, grant: String, deviceName: String) = ControllerCredentials(baseUrl, "key", "secret")
    override suspend fun authenticate(credentials: ControllerCredentials) = ControllerAuth("auth", baseUrl = credentials.baseUrl)
    override suspend fun startOrResumeSession(auth: ControllerAuth, resumeSessionId: String?) = session
    override suspend fun fetchCommands(auth: ControllerAuth, session: ControllerSession, afterSequence: Long) = emptyList<ControllerCommand>()
    override suspend fun acknowledge(auth: ControllerAuth, session: ControllerSession, command: ControllerCommand, success: Boolean, errorCode: String?) { onAck() }
    override suspend fun reportState(auth: ControllerAuth, session: ControllerSession, state: SanitizedControllerState) = Unit
  }
}
