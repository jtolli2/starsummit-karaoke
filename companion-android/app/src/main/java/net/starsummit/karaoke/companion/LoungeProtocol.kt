package net.starsummit.karaoke.companion

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import kotlin.math.min

/** Values returned by the private Lounge pairing flow. Never render token in diagnostics. */
data class PairingMaterial(
  val screenId: String,
  val loungeToken: String,
  val screenName: String,
) {
  override fun toString(): String = "PairingMaterial(redacted)"
}

object LoungeValidation {
  private val tvCodePattern = Regex("^\\d{12}$")
  private val videoIdPattern = Regex("^[A-Za-z0-9_-]{11}$")

  fun tvCode(value: String): String? = value.filterNot { it == ' ' || it == '-' }.takeIf { tvCodePattern.matches(it) }
  fun videoId(value: String): String? = value.trim().takeIf { videoIdPattern.matches(it) }
}

sealed interface LoungeEvent {
  data class Raw(val name: String, val payload: JSONObject, val eventId: Long? = null) : LoungeEvent
  data class ProtocolError(val reason: String, val eventId: Long? = null) : LoungeEvent
  data class NowPlaying(
    val videoId: String?,
    val state: String?,
    val positionSeconds: Double?,
    val durationSeconds: Double?,
    val eventId: Long? = null,
  ) : LoungeEvent
}

/** Parses newline-delimited and length-prefixed chunks used by Lounge's event stream. */
class LoungeChunkParser {
  private val pending = StringBuilder()

  fun feed(chunk: String): List<LoungeEvent> {
    pending.append(chunk)
    val events = mutableListOf<LoungeEvent>()
    while (true) {
      val boundary = pending.indexOf("\n")
      if (boundary < 0) break
      val line = pending.substring(0, boundary).trimEnd('\r')
      pending.delete(0, boundary + 1)
      if (line.isBlank()) continue

      // Some responses prefix a JSON payload with its byte length. The payload itself
      // can contain newlines, so hold it until all advertised bytes are present.
      if (line.all(Char::isDigit)) {
        val length = line.toIntOrNull() ?: continue
        if (pending.length < length) {
          pending.insert(0, "$line\n")
          break
        }
        val payload = pending.substring(0, length)
        pending.delete(0, length)
      events += parsePayload(payload)
      } else {
        events += parsePayload(line)
      }
    }
    return events
  }

  fun finish(): List<LoungeEvent> {
    val remainder = pending.toString().trim()
    pending.clear()
    return if (remainder.isEmpty()) emptyList() else parsePayload(remainder)
  }

  private fun parsePayload(text: String): List<LoungeEvent> = try {
    if (text.trimStart().startsWith("[")) {
      val array = JSONArray(text)
      if (array.length() == 0) listOf(LoungeEvent.ProtocolError("empty Lounge event array")) else (0 until array.length()).flatMap { index ->
        when (val item = array.get(index)) {
          is JSONArray -> parseEnvelope(item)
          else -> listOf(LoungeEvent.ProtocolError("invalid Lounge event item"))
        }
      }
    } else {
      listOf(LoungeEvent.ProtocolError("invalid Lounge event payload"))
    }
  } catch (_: Exception) {
    listOf(LoungeEvent.ProtocolError("invalid Lounge event payload"))
  }

  private fun parseEnvelope(envelope: JSONArray): List<LoungeEvent> {
    if (envelope.length() != 2 || envelope.opt(0) !is Number) {
      return listOf(LoungeEvent.ProtocolError("invalid Lounge event envelope"))
    }
    val eventId = envelope.optLong(0)
    val protocol = envelope.optJSONArray(1) ?: return listOf(LoungeEvent.ProtocolError("invalid Lounge event envelope", eventId))
    return parseTuple(protocol, eventId)
  }

  private fun parseObject(json: JSONObject, eventId: Long?): List<LoungeEvent> {
    val name = json.optString("event").ifBlank { json.optString("name") }.ifBlank { json.optString("c") }
    if (name.isBlank()) return listOf(LoungeEvent.ProtocolError("missing Lounge event name", eventId))
    val payload = json.optJSONObject("payload") ?: json
    val protocolName = json.optString("c").ifBlank { name }
    val videoId = payload.optString("videoId", payload.optString("video_id", "")).ifBlank { null }
    val state = payload.optString("state", payload.optString("playerState", "")).ifBlank { null }
    return if (videoId != null || state != null || payload.has("positionSeconds") || payload.has("currentTime")) {
      listOf(LoungeEvent.NowPlaying(
        videoId = videoId,
        state = state,
        positionSeconds = payload.optDoubleOrNull("positionSeconds") ?: payload.optDoubleOrNull("currentTime"),
        durationSeconds = payload.optDoubleOrNull("durationSeconds") ?: payload.optDoubleOrNull("duration"),
        eventId = eventId,
      ))
    } else {
      listOf(LoungeEvent.Raw(protocolName, payload, eventId))
    }
  }

  private fun parseTuple(tuple: JSONArray, eventId: Long? = null): List<LoungeEvent> {
    if (tuple.length() < 1) return listOf(LoungeEvent.ProtocolError("invalid Lounge event tuple", eventId))
    val json = JSONObject()
    val name = tuple.optString(0)
    val argument = tuple.opt(1)
    if (name.isBlank()) return listOf(LoungeEvent.ProtocolError("missing Lounge event command", eventId))
    when (name) {
      "c" -> if (tuple.optString(1).isBlank()) return listOf(LoungeEvent.ProtocolError("missing Lounge SID", eventId)) else json.put("SID", tuple.optString(1))
      "S" -> if (tuple.optString(1).isBlank()) return listOf(LoungeEvent.ProtocolError("missing Lounge gsession", eventId)) else json.put("gsessionid", tuple.optString(1))
      "onStateChange", "onVideoId", "onNowPlaying", "nowPlaying" -> if (argument is JSONObject) {
        return parseObject(JSONObject().put("event", name).put("payload", argument), eventId)
      } else return listOf(LoungeEvent.ProtocolError("invalid Lounge state payload", eventId))
      else -> {
        if (argument is JSONObject) json.put("payload", argument)
        return listOf(LoungeEvent.Raw(name, json, eventId))
      }
    }
    return listOf(LoungeEvent.Raw(name, json, eventId))
  }
}

private fun JSONObject.optDoubleOrNull(name: String): Double? {
  if (!has(name) || isNull(name)) return null
  return when (val value = opt(name)) {
    is Number -> value.toDouble()
    is String -> value.toDoubleOrNull()
    else -> null
  }
}

data class PlaybackSnapshot(
  val videoId: String? = null,
  val state: String? = null,
  val positionSeconds: Double? = null,
  val durationSeconds: Double? = null,
)

class LoungeEventReducer {
  var snapshot: PlaybackSnapshot = PlaybackSnapshot()
    private set

  fun reduce(event: LoungeEvent): PlaybackSnapshot {
    if (event is LoungeEvent.NowPlaying) {
      snapshot = snapshot.copy(
        videoId = event.videoId ?: snapshot.videoId,
        state = event.state ?: snapshot.state,
        positionSeconds = event.positionSeconds ?: snapshot.positionSeconds,
        durationSeconds = event.durationSeconds ?: snapshot.durationSeconds,
      )
    }
    return snapshot
  }
}

object ReconnectBackoff {
  const val DEFAULT_BASE_MILLIS = 1_000L
  const val DEFAULT_MAX_MILLIS = 60_000L

  fun delayMillis(attempt: Int, baseMillis: Long = DEFAULT_BASE_MILLIS, maxMillis: Long = DEFAULT_MAX_MILLIS): Long {
    require(attempt >= 0)
    require(baseMillis > 0 && maxMillis >= baseMillis)
    val exponent = min(attempt, 30)
    val candidate = baseMillis shl exponent
    return min(candidate, maxMillis)
  }
}

fun BufferedReader.readLoungeEvents(parser: LoungeChunkParser): Sequence<LoungeEvent> = sequence {
  while (true) {
    val line = readLine() ?: break
    yieldAll(parser.feed("$line\n"))
  }
  yieldAll(parser.finish())
}
