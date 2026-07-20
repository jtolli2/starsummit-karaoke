package net.starsummit.karaoke.companion

import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.CancellationException
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.io.Reader
import java.io.StringReader

class ControllerProtocolTest {
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
    assertEquals(1, snapshot.controllerEstablishCount)
    assertEquals(null, snapshot.controllerInitialRefetchCount)
    assertEquals(null, snapshot.controllerRealtimeEventRedacted)
    assertEquals(null, snapshot.controllerRefetchCount)
    assertEquals(null, snapshot.controllerRefetchErrorRedacted)
    assertEquals(false, snapshot.controllerSubscriptionAccepted)
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
  fun ambiguousSendIsNotAckedThenConvergedRedeliverySucceeds() = runTest {
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
    try {
      bridge.processCommand(processor, command, PlaybackSnapshot())
      throw AssertionError("expected ambiguous failure")
    } catch (_: AmbiguousCommandException) {
      // Controller loop reconnects/refetches; no terminal acknowledgement was sent.
    }
    assertEquals(0, acknowledgements)
    assertEquals("cmd", progress.load().inFlightId)
    assertEquals(CommandResult.Duplicate, bridge.processCommand(processor, command, PlaybackSnapshot()))
    assertEquals(1, acknowledgements)
    assertEquals(1, playCalls)
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
