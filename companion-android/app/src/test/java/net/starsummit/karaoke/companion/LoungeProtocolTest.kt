package net.starsummit.karaoke.companion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlinx.coroutines.async
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import okhttp3.FormBody
import okhttp3.Interceptor
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import java.io.IOException
import java.io.InterruptedIOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class LoungeProtocolTest {
  @Test
  fun parserReadsEventsAcrossChunkBoundaries() {
    val parser = LoungeChunkParser()
    val payload = "[[105,[\"onStateChange\",{\"videoId\":\"dQw4w9WgXcQ\",\"state\":\"PLAYING\"}]]]"
    assertEquals(emptyList<LoungeEvent>(), parser.feed(payload.substring(0, 20)))
    val events = parser.feed(payload.substring(20) + "\n")
    assertEquals(1, events.size)
    val nowPlaying = events.single() as LoungeEvent.NowPlaying
    assertEquals("dQw4w9WgXcQ", nowPlaying.videoId)
    assertEquals("PLAYING", nowPlaying.state)
  }

  @Test
  fun parserReadsLengthPrefixedPayload() {
    val payload = "[[0,[\"S\",\"session\"]]]"
    val parser = LoungeChunkParser()
    val events = parser.feed("${payload.length}\n$payload\n")
    assertEquals(1, events.size)
    val event = events.single() as LoungeEvent.Raw
    assertEquals("S", event.name)
    assertEquals("session", event.payload.optString("gsessionid"))
  }

  @Test
  fun parserReadsNestedLoungeEventsAndRetainsAid() {
    val payload = """[[0,["c","sid"]],[1,["S","gsession"]],[105,["onStateChange",{"currentTime":"50","duration":"318","state":"1"}]]]"""
    val events = LoungeChunkParser().feed("${payload.length}\n$payload\n")
    assertEquals(3, events.size)
    assertEquals("sid", (events[0] as LoungeEvent.Raw).payload.optString("SID"))
    assertEquals(0L, (events[0] as LoungeEvent.Raw).eventId)
    assertEquals("gsession", (events[1] as LoungeEvent.Raw).payload.optString("gsessionid"))
    val nowPlaying = events[2] as LoungeEvent.NowPlaying
    assertEquals(105L, nowPlaying.eventId)
    assertEquals(50.0, nowPlaying.positionSeconds!!, 0.001)
    assertEquals(318.0, nowPlaying.durationSeconds!!, 0.001)
    assertEquals("1", nowPlaying.state)
  }

  @Test
  fun bindResponseExtractsSessionAndLastAid() {
    val payload = "[[42,[\"c\",\"sid\"]],[43,[\"S\",\"gsession\"]],[105,[\"onStateChange\",{\"currentTime\":\"50\",\"duration\":\"318\",\"state\":\"1\"}]]]"
    val bound = parseBindResponse("${payload.length}\n$payload\n")
    assertEquals("sid", bound.sid)
    assertEquals("gsession", bound.gsessionId)
    assertEquals(105L, bound.lastEventId)
  }

  @Test
  fun malformedProtocolIsRedactedAsErrorEvent() {
    val event = LoungeChunkParser().feed("not-json\n").single()
    assertTrue(event is LoungeEvent.ProtocolError)
    assertEquals("protocol_error", DiagnosticsStore().also { it.event(event) }.snapshot.value.lastEventRedacted)
  }

  @Test
  fun validJsonWithInvalidStructureEmitsProtocolErrors() {
    val invalidOuterItem = LoungeChunkParser().feed("[123]\n").single()
    val invalidEnvelope = LoungeChunkParser().feed("[[7]]\n").single()
    val emptyTuple = LoungeChunkParser().feed("[[8,[]]]\n").single()
    val unknownTuple = LoungeChunkParser().feed("[[9,[\"unknown\",{}]]]\n").single()
    val noopTuple = LoungeChunkParser().feed("[[10,[\"noop\"]]]\n").single()
    assertTrue(invalidOuterItem is LoungeEvent.ProtocolError)
    assertTrue(invalidEnvelope is LoungeEvent.ProtocolError)
    assertTrue(emptyTuple is LoungeEvent.ProtocolError)
    assertTrue(unknownTuple is LoungeEvent.Raw)
    assertTrue(noopTuple is LoungeEvent.Raw)
  }

  @Test
  fun refreshResponseUsesNestedScreensToken() {
    val existing = PairingMaterial("old-screen", "old-token", "Old")
    val refreshed = parsePairingResponse(
      "{\"screens\":[{\"screenId\":\"old-screen\",\"loungeToken\":\"new-token\",\"screenName\":\"TV\"}]}",
      existing,
      "Default",
    )
    assertEquals("old-screen", refreshed.screenId)
    assertEquals("new-token", refreshed.loungeToken)
    assertThrows(java.io.IOException::class.java) {
      parsePairingResponse(
        "{\"screens\":[{\"screenId\":\"different\",\"loungeToken\":\"other\"}]}",
        existing,
        "Default",
      )
    }
  }

  @Test
  fun requestShapeIncludesCommonSessionParameters() {
    val pairing = PairingMaterial("sid", "token", "TV")
    val url = LoungeRequestShape.sessionUrl(pairing, "Companion", "SID", "gsession", 105, "rpc", true).toHttpUrl()
    assertEquals("REMOTE_CONTROL", url.queryParameter("device"))
    assertEquals("sid", url.queryParameter("id"))
    assertEquals("youtube-desktop", url.queryParameter("app"))
    assertEquals("8", url.queryParameter("VER"))
    assertEquals("2", url.queryParameter("v"))
    assertEquals("rpc", url.queryParameter("RID"))
    assertEquals("0", url.queryParameter("CI"))
    assertEquals("xmlhttp", url.queryParameter("TYPE"))
    val commandUrl = LoungeRequestShape.sessionUrl(pairing, "Companion", "SID", "gsession", 105, "2", false).toHttpUrl()
    assertEquals("0", commandUrl.queryParameter("CI"))
    assertEquals("bind", commandUrl.queryParameter("TYPE"))
    assertEquals("1", commandUrl.queryParameter("t"))
    assertEquals("token", url.queryParameter("loungeIdToken"))
  }

  @Test
  fun requestShapeIncludesBindAndCommandFields() {
    val pairing = PairingMaterial("screen", "token", "TV")
    val bind = LoungeRequestShape.bindForm(pairing, "Companion")
    assertEquals("web", bind["app"])
    assertEquals("REMOTE_CONTROL", bind["device"])
    assertEquals("token", bind["loungeIdToken"])
    assertEquals("user_agent=dunno&window_width_points=&window_height_points=&os_name=android&ms=", bind["deviceContext"])
    val command = LoungeRequestShape.commandForm("seekTo", 7, mapOf("req0_newTime" to "50"))
    assertEquals("1", command["count"])
    assertEquals("7", command["ofs"])
    assertEquals("seekTo", command["req0__sc"])
    assertEquals("50", command["req0_newTime"])
  }

  @Test
  fun setPlaylistSendsReceiverDefaultsAndCanonicalSessionUrl() = runBlocking {
    val requests = mutableListOf<CapturedRequest>()
    val client = fakeClient { chain ->
      val request = chain.request()
      synchronized(requests) { requests += CapturedRequest(request.url.toString(), request.formValues()) }
      response(request, if (request.url.queryParameter("RID") == "1") {
        "[[0,[\"c\",\"sid\"]],[1,[\"S\",\"gsession\"]]]"
      } else "")
    }
    val session = LoungeHttpController(client, commandTimeoutMillis = 500)
      .connect(PairingMaterial("screen", "token", "TV"))
    session.setPlaylist("dQw4w9WgXcQ")
    val command = synchronized(requests) { requests.last() }
    val url = command.url.toHttpUrl()
    assertEquals("screen", url.queryParameter("id"))
    assertEquals("REMOTE_CONTROL", url.queryParameter("device"))
    assertEquals("youtube-desktop", url.queryParameter("app"))
    assertEquals("dQw4w9WgXcQ", command.form["req0_videoId"])
    assertEquals("", command.form["req0_listId"])
    assertEquals("-1", command.form["req0_currentIndex"])
    assertEquals("0", command.form["req0_currentTime"])
    assertEquals("false", command.form["req0_audioOnly"])
    assertEquals("", command.form["req0_params"])
    assertEquals("", command.form["req0_playerParams"])
    assertEquals("true", command.form["req0_prioritizeMobileSenderPlaybackStateOnConnection"])
    session.close()
  }

  @Test
  fun commandTimeoutCancelsTheInFlightCall() = runBlocking {
    val client = fakeClient { chain ->
      val request = chain.request()
      val isBind = request.url.queryParameter("RID") == "1"
      if (!isBind) {
        try {
          Thread.sleep(250)
        } catch (interrupted: InterruptedException) {
          Thread.currentThread().interrupt()
          throw IOException("cancelled", interrupted)
        }
      }
      response(request, if (isBind) "[[0,[\"c\",\"sid\"]],[1,[\"S\",\"gsession\"]]]" else "")
    }
    val session = LoungeHttpController(client, commandTimeoutMillis = 50)
      .connect(PairingMaterial("screen", "token", "TV"))
    val startedAt = System.nanoTime()
    val failure = runCatching { session.play() }.exceptionOrNull()
    val elapsedMillis = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedAt)
    assertTrue(failure is InterruptedIOException)
    assertTrue("command timeout was not bounded", elapsedMillis < 1_000)
    session.close()
  }

  @Test
  fun eventAidCanAdvanceWhileCommandNetworkIsPending() = runBlocking {
    val commandStarted = CountDownLatch(1)
    val releaseCommand = CountDownLatch(1)
    val requests = mutableListOf<CapturedRequest>()
    val client = fakeClient { chain ->
      val request = chain.request()
      synchronized(requests) { requests += CapturedRequest(request.url.toString(), request.formValues()) }
      if (request.method == "GET") {
        response(
          request,
          "[[105,[\"onStateChange\",{\"videoId\":\"dQw4w9WgXcQ\",\"state\":\"PLAYING\"}]]]\n",
        )
      } else {
        val isBind = request.url.queryParameter("RID") == "1"
        if (!isBind) {
          commandStarted.countDown()
          releaseCommand.await(1, TimeUnit.SECONDS)
        }
        response(request, if (isBind) "[[0,[\"c\",\"sid\"]],[1,[\"S\",\"gsession\"]]]" else "")
      }
    }
    val session = LoungeHttpController(client, commandTimeoutMillis = 500)
      .connect(PairingMaterial("screen", "token", "TV"))
    val command = async(Dispatchers.Default) { session.play() }
    assertTrue("command never reached transport", commandStarted.await(1, TimeUnit.SECONDS))
    val event = async(Dispatchers.Default) { session.events.first { it is LoungeEvent.NowPlaying } }
    assertEquals(105L, (event.await() as LoungeEvent.NowPlaying).eventId)
    releaseCommand.countDown()
    command.await()
    session.pause()
    val pause = synchronized(requests) { requests.last() }
    assertEquals("105", pause.url.toHttpUrl().queryParameter("AID"))
    session.close()
  }

  @Test
  fun concurrentCommandsTransmitInRidAndOffsetOrder() = runBlocking {
    val started = CountDownLatch(1)
    val release = CountDownLatch(1)
    val requests = mutableListOf<CapturedRequest>()
    val client = fakeClient { chain ->
      val request = chain.request()
      val captured = CapturedRequest(request.url.toString(), request.formValues())
      synchronized(requests) { requests += captured }
      if (request.url.queryParameter("RID") == "2") {
        started.countDown()
        release.await(1, TimeUnit.SECONDS)
      }
      response(request, if (request.url.queryParameter("RID") == "1") {
        "[[0,[\"c\",\"sid\"]],[1,[\"S\",\"gsession\"]]]"
      } else "")
    }
    val session = LoungeHttpController(client, commandTimeoutMillis = 500)
      .connect(PairingMaterial("screen", "token", "TV"))
    val first = async(Dispatchers.Default) { session.play() }
    assertTrue(started.await(1, TimeUnit.SECONDS))
    val second = async(Dispatchers.Default) { session.pause() }
    Thread.sleep(25)
    synchronized(requests) { assertEquals(2, requests.size) }
    release.countDown()
    first.await()
    second.await()
    val sent = synchronized(requests) { requests.drop(1) }
    assertEquals(listOf("2", "3"), sent.map { it.url.toHttpUrl().queryParameter("RID") })
    assertEquals(listOf("0", "1"), sent.map { it.form["ofs"] })
    session.close()
  }

  private data class CapturedRequest(val url: String, val form: Map<String, String>)

  private fun fakeClient(handler: (Interceptor.Chain) -> Response): OkHttpClient = OkHttpClient.Builder()
    .addInterceptor(Interceptor { chain -> handler(chain) })
    .build()

  private fun okhttp3.Request.formValues(): Map<String, String> {
    val form = body as? FormBody ?: return emptyMap()
    return (0 until form.size).associate { index -> form.name(index) to form.value(index) }
  }

  private fun response(request: okhttp3.Request, body: String): Response = Response.Builder()
    .request(request)
    .protocol(Protocol.HTTP_1_1)
    .code(200)
    .message("OK")
    .body(body.toResponseBody())
    .build()

  @Test
  fun reducerKeepsFieldsWhenPartialEventArrives() {
    val reducer = LoungeEventReducer()
    reducer.reduce(LoungeEvent.NowPlaying("video", "PLAYING", 3.0, 100.0))
    val snapshot = reducer.reduce(LoungeEvent.NowPlaying(null, "PAUSED", 8.0, null))
    assertEquals("video", snapshot.videoId)
    assertEquals("PAUSED", snapshot.state)
    assertEquals(8.0, snapshot.positionSeconds!!, 0.001)
    assertEquals(100.0, snapshot.durationSeconds!!, 0.001)
  }

  @Test
  fun backoffIsExponentialAndBounded() {
    assertEquals(1_000L, ReconnectBackoff.delayMillis(0))
    assertEquals(2_000L, ReconnectBackoff.delayMillis(1))
    assertEquals(60_000L, ReconnectBackoff.delayMillis(30))
    assertEquals(500L, ReconnectBackoff.delayMillis(10, baseMillis = 250, maxMillis = 500))
  }

  @Test
  fun validationRejectsMalformedIdentifiers() {
    assertNull(LoungeValidation.tvCode("1234"))
    assertEquals("123456789012", LoungeValidation.tvCode("1234-5678 9012"))
    assertNull(LoungeValidation.videoId("too-short"))
    assertEquals("dQw4w9WgXcQ", LoungeValidation.videoId("dQw4w9WgXcQ"))
  }

  @Test
  fun pairingMaterialToStringDoesNotRevealIdentifiers() {
    val text = PairingMaterial("screen-secret", "token-secret", "TV secret").toString()
    assertTrue("redacted" in text)
    assertTrue("screen-secret" !in text)
    assertTrue("token-secret" !in text)
  }

  @Test
  fun staleSessionGenerationCannotTriggerReconnect() {
    assertTrue(SessionGenerationGuard.isCurrent(4, 4))
    assertTrue(!SessionGenerationGuard.isCurrent(5, 4))
  }

  @Test
  fun closedSessionGateRejectsQueuedWork() {
    val gate = SessionClosedGate()
    gate.requireOpen()
    gate.close()
    assertThrows(LoungeSessionClosedException::class.java) { gate.requireOpen() }
  }
}
