package net.starsummit.karaoke.companion

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.ResolverStyle
import java.util.Locale

enum class ControllerAction { OPEN_VIDEO, PLAY, PAUSE, SEEK, GET_NOW_PLAYING }

data class ControllerCommand(
  val id: String,
  val sequence: Long,
  val idempotencyKey: String,
  val action: ControllerAction,
  val videoId: String? = null,
  val seekSeconds: Double? = null,
  val expiresAtEpochMs: Long = Long.MAX_VALUE,
  val sessionId: String? = null,
  val generation: Long? = null,
)

data class ControllerCredentials(
  val baseUrl: String,
  val deviceKey: String,
  val deviceSecret: String,
  val deviceId: String? = null,
) {
  override fun toString() = "ControllerCredentials(redacted)"
}

data class ControllerAuth(val token: String, val expiresAtEpochMs: Long? = null, val baseUrl: String = "") {
  override fun toString() = "ControllerAuth(redacted)"
}

data class ControllerSession(
  val id: String,
  val generation: Long,
  val expiresAtEpochMs: Long,
  val resumed: Boolean = false,
)

data class ControllerProgress(
  val sessionId: String? = null,
  val generation: Long? = null,
  val lastCommandSequence: Long = 0,
  val inFlightId: String? = null,
  val inFlightIdempotencyKey: String? = null,
)

object ControllerCommandParser {
  fun parseList(text: String, nowEpochMs: Long = System.currentTimeMillis()): List<ControllerCommand> {
    val root = JSONObject(text)
    val array = root.optJSONArray("commands") ?: JSONArray()
    val commands = mutableListOf<ControllerCommand>()
    for (index in 0 until array.length()) {
      val item = array.getJSONObject(index)
      val status = item.optString("status").lowercase()
      if (status.isNotBlank() && status != "pending" && status != "queued") continue
      val expiry = item.opt("expiresAt") ?: item.opt("expires_at")
      if (expiry != null && runCatching { parseEpoch(expiry) <= nowEpochMs }.getOrDefault(false)) continue
      commands += parse(item, nowEpochMs)
    }
    return commands
  }

  fun parse(json: JSONObject, nowEpochMs: Long = System.currentTimeMillis()): ControllerCommand {
    val id = json.optString("id").trim().takeIf { it.isNotEmpty() }
      ?: throw ControllerProtocolException("missing command id")
    val sequence = json.optLong("sequence", 0L)
    if (sequence <= 0) throw ControllerProtocolException("invalid command sequence")
    val key = json.optString("idempotencyKey", json.optString("idempotency_key")).trim()
    if (key.isEmpty() || key.length > 128) throw ControllerProtocolException("invalid idempotency key")
    val action = when (json.optString("action").trim().lowercase()) {
      "open_video" -> ControllerAction.OPEN_VIDEO
      "play" -> ControllerAction.PLAY
      "pause" -> ControllerAction.PAUSE
      "seek" -> ControllerAction.SEEK
      "get_now_playing" -> ControllerAction.GET_NOW_PLAYING
      else -> throw ControllerProtocolException("unsupported command action")
    }
    val payload = json.optJSONObject("payload")
    val video = json.optString("videoId", payload?.optString("videoId", "") ?: "")
      .trim().takeIf { it.isNotEmpty() }
    val seek = if (json.has("seekSeconds")) json.optDouble("seekSeconds", Double.NaN)
      else payload?.optDouble("seekSeconds", Double.NaN) ?: Double.NaN
    val expiresValue = json.opt("expiresAt") ?: json.opt("expires_at")
      ?: throw ControllerProtocolException("missing command expiry")
    val expires = parseEpoch(expiresValue)
    if (expires <= nowEpochMs) throw ControllerProtocolException("expired command")
    when (action) {
      ControllerAction.OPEN_VIDEO -> if (LoungeValidation.videoId(video.orEmpty()) == null) {
        throw ControllerProtocolException("invalid video id")
      }
      ControllerAction.SEEK -> if (!seek.isFinite() || seek < 0.0 || seek > 86_400.0) {
        throw ControllerProtocolException("invalid seek position")
      }
      else -> Unit
    }
    return ControllerCommand(
      id = id,
      sequence = sequence,
      idempotencyKey = key,
      action = action,
      videoId = LoungeValidation.videoId(video.orEmpty()),
      seekSeconds = seek.takeUnless { it.isNaN() },
      expiresAtEpochMs = expires,
      sessionId = json.optString("sessionId", json.optString("session_id")).takeIf { it.isNotBlank() },
      generation = json.optLong("generation", Long.MIN_VALUE).takeUnless { it == Long.MIN_VALUE },
    )
  }

  private fun parseEpoch(value: Any?): Long = when (value) {
    is Number -> if (value.toLong() < 10_000_000_000L) value.toLong() * 1000 else value.toLong()
    is String -> value.toLongOrNull()?.let { if (it < 10_000_000_000L) it * 1000 else it }
      ?: runCatching { java.time.Instant.parse(value).toEpochMilli() }
        .recoverCatching {
          LocalDateTime.parse(value, POCKETBASE_UTC_DATETIME)
            .toInstant(ZoneOffset.UTC)
            .toEpochMilli()
        }
        .getOrElse { throw ControllerProtocolException("invalid command expiry") }
    else -> throw ControllerProtocolException("invalid command expiry")
  }

  private val POCKETBASE_UTC_DATETIME = DateTimeFormatter
    .ofPattern("uuuu-MM-dd HH:mm:ss.SSS'Z'", Locale.ROOT)
    .withResolverStyle(ResolverStyle.STRICT)
}

class ControllerProtocolException(message: String) : IOException(message)

data class PocketBaseRealtimeEvent(val name: String, val data: String)

/** Standards-compatible SSE framing parser; PB sends event/data pairs separated by a blank line. */
class PocketBaseSseParser {
  private val pending = StringBuilder()
  private var eventName = "message"
  private val data = StringBuilder()

  fun feed(chunk: String): List<PocketBaseRealtimeEvent> {
    pending.append(chunk)
    val result = mutableListOf<PocketBaseRealtimeEvent>()
    while (true) {
      val newline = pending.indexOf("\n")
      if (newline < 0) break
      val line = pending.substring(0, newline).trimEnd('\r')
      pending.delete(0, newline + 1)
      if (line.isEmpty()) {
        if (data.isNotEmpty()) result += PocketBaseRealtimeEvent(eventName, data.toString().removeSuffix("\n"))
        eventName = "message"
        data.clear()
      } else if (!line.startsWith(":")) {
        val colon = line.indexOf(':')
        val field = if (colon < 0) line else line.substring(0, colon)
        val value = if (colon < 0) "" else line.substring(colon + 1).removePrefix(" ")
        when (field) {
          "event" -> eventName = value
          "data" -> data.append(value).append('\n')
        }
      }
    }
    return result
  }

  fun finish(): List<PocketBaseRealtimeEvent> = feed("\n")
}

fun parsePocketBaseConnect(event: PocketBaseRealtimeEvent): String? {
  if (event.name != "PB_CONNECT") return null
  return runCatching { JSONObject(event.data).optString("clientId").takeIf { it.isNotBlank() } }.getOrNull()
}
