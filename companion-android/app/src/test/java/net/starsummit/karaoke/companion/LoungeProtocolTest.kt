package net.starsummit.karaoke.companion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import okhttp3.HttpUrl.Companion.toHttpUrl

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
    assertEquals("youtube-desktop", url.queryParameter("app"))
    assertEquals("8", url.queryParameter("VER"))
    assertEquals("2", url.queryParameter("v"))
    assertEquals("rpc", url.queryParameter("RID"))
    assertEquals("0", url.queryParameter("CI"))
    assertEquals("xmlhttp", url.queryParameter("TYPE"))
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
