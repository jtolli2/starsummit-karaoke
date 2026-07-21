package net.starsummit.karaoke.companion

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.Callback
import okhttp3.FormBody
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.io.InterruptedIOException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

interface LoungeController {
  suspend fun pair(tvCode: String): PairingMaterial
  suspend fun refreshPairing(pairing: PairingMaterial): PairingMaterial
  suspend fun connect(pairing: PairingMaterial): LoungeSession
}

interface LoungeSession {
  val events: Flow<LoungeEvent>
  suspend fun setPlaylist(videoId: String)
  suspend fun play()
  suspend fun pause()
  suspend fun seekTo(newTimeSeconds: Double)
  suspend fun getNowPlaying()
  fun close()
}

data class LoungeCommandTelemetry(
  val action: String,
  val requestId: Long,
  val offset: Long,
  val elapsedMillis: Long,
  val outcome: String,
)

fun interface LoungeCommandObserver {
  fun onCommand(event: LoungeCommandTelemetry)
}

private const val LOUNGE_TELEMETRY_TAG = "StarsummitLounge"

private val LOUNGE_TELEMETRY_EXECUTOR by lazy {
  Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "StarsummitLoungeTelemetry").apply { isDaemon = true }
  }
}

private val DEFAULT_LOUNGE_COMMAND_OBSERVER = LoungeCommandObserver { event ->
  runCatching {
    android.util.Log.i(
      LOUNGE_TELEMETRY_TAG,
      "command action=${event.action} rid=${event.requestId} ofs=${event.offset} " +
        "elapsedMs=${event.elapsedMillis} outcome=${event.outcome}",
    )
  }
}

/** Minimal transport for the private YouTube Lounge protocol. Keep this seam replaceable. */
class LoungeHttpController(
  private val client: OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(10, TimeUnit.SECONDS)
    .readTimeout(0, TimeUnit.MILLISECONDS)
    .build(),
  private val clientName: String = "Starsummit Karaoke Companion",
  private val commandTimeoutMillis: Long = COMMAND_TIMEOUT_MILLIS,
  private val commandObserver: LoungeCommandObserver = DEFAULT_LOUNGE_COMMAND_OBSERVER,
) : LoungeController {
  init {
    require(commandTimeoutMillis in 1..COMMAND_TIMEOUT_MAX_MILLIS) {
      "Command timeout must be below PocketBase command expiry"
    }
  }

  override suspend fun pair(tvCode: String): PairingMaterial = withContext(Dispatchers.IO) {
    val code = LoungeValidation.tvCode(tvCode) ?: throw IllegalArgumentException("Invalid TV code")
    val response = postFormRaw(
      LoungeRequestShape.PAIRING_URL,
      mapOf("pairing_code" to code, "screen_name" to clientName),
    )
    parsePairingResponse(response, null, clientName)
  }

  override suspend fun refreshPairing(pairing: PairingMaterial): PairingMaterial = withContext(Dispatchers.IO) {
    val response = postFormRaw(
      LoungeRequestShape.REFRESH_URL,
      mapOf("screen_ids" to pairing.screenId),
    )
    parsePairingResponse(response, pairing, clientName)
  }

  override suspend fun connect(pairing: PairingMaterial): LoungeSession = withContext(Dispatchers.IO) {
    require(pairing.screenId.isNotBlank() && pairing.loungeToken.isNotBlank())
    val response = postFormRaw(
      "${LoungeRequestShape.BIND_URL}?RID=1&VER=8&v=2&CVER=1&auth_failure_option=send_error",
      LoungeRequestShape.bindForm(pairing, clientName),
    )
    val bound = parseBindResponse(response)
    HttpLoungeSession(
      client,
      pairing,
      clientName,
      bound.sid,
      bound.gsessionId,
      bound.lastEventId,
      commandTimeoutMillis,
      commandObserver,
    )
  }

  private fun postFormRaw(url: String, values: Map<String, String>): String {
    val body = FormBody.Builder().apply { values.forEach { (key, value) -> add(key, value) } }.build()
    client.newCall(Request.Builder().url(url).post(body).build()).execute().use { response ->
      if (!response.isSuccessful) throw IOException("Lounge request failed (${response.code})")
      return response.body?.string().orEmpty()
    }
  }
}

internal fun parsePairingResponse(text: String, existing: PairingMaterial?, defaultName: String): PairingMaterial {
  val json: Any = runCatching { JSONObject(text) }.getOrElse {
    runCatching { JSONArray(text) }.getOrElse { throw IOException("Lounge pairing response was not JSON") }
  }
  if (existing != null && json is JSONObject && json.optJSONArray("screens") != null && findPairingObject(json, existing.screenId) == null) {
    throw IOException("Lounge refresh did not return the paired screen")
  }
  val selected = findPairingObject(json, existing?.screenId)
  val screenId = selected?.let { findString(it, "screenId", "screen_id") }
    ?: if (selected == null) findString(json, "screenId", "screen_id") else null
    ?: existing?.screenId
  val token = selected?.let { findString(it, "loungeToken", "lounge_token", "token") }
    ?: if (selected == null && existing == null) findString(json, "loungeToken", "lounge_token", "token") else null
  val screenName = selected?.let { findString(it, "screenName", "screen_name", "name") }
    ?: findString(json, "screenName", "screen_name", "name")
    ?: existing?.screenName
    ?: defaultName
  if (screenId.isNullOrBlank() || token.isNullOrBlank()) throw IOException("Lounge pairing response incomplete")
  return PairingMaterial(screenId, token, screenName)
}

private fun findPairingObject(value: Any?, requiredScreenId: String?): JSONObject? {
  if (value is JSONObject) {
    val screens = value.optJSONArray("screens")
    if (screens != null) {
      for (index in 0 until screens.length()) {
        val item = screens.optJSONObject(index) ?: continue
        val id = findString(item, "screenId", "screen_id")
        if (requiredScreenId == null || id == requiredScreenId) return item
      }
      if (requiredScreenId != null) return null
    }
    val id = findString(value, "screenId", "screen_id")
    if (requiredScreenId == null || id == requiredScreenId) return value
    val keys = value.keys()
    while (keys.hasNext()) findPairingObject(value.opt(keys.next()), requiredScreenId)?.let { return it }
  } else if (value is JSONArray) {
    for (index in 0 until value.length()) findPairingObject(value.opt(index), requiredScreenId)?.let { return it }
  }
  return null
}

private fun findString(value: Any?, vararg names: String): String? {
  when (value) {
    is JSONObject -> {
      names.firstNotNullOfOrNull { name -> value.optString(name).takeIf { it.isNotBlank() } }?.let { return it }
      val keys = value.keys()
      while (keys.hasNext()) findString(value.opt(keys.next()), *names)?.let { return it }
    }
    is JSONArray -> for (index in 0 until value.length()) findString(value.opt(index), *names)?.let { return it }
  }
  return null
}

internal data class LoungeBindResponse(val sid: String, val gsessionId: String, val lastEventId: Long?)

internal class LoungeSessionClosedException : IOException("Lounge session closed")

internal class SessionClosedGate {
  private val closed = AtomicBoolean(false)
  fun close() { closed.set(true) }
  fun isClosed(): Boolean = closed.get()
  fun requireOpen() {
    if (closed.get()) throw LoungeSessionClosedException()
  }
}

private val LoungeEvent.eventId: Long?
  get() = when (this) {
    is LoungeEvent.Raw -> eventId
    is LoungeEvent.NowPlaying -> eventId
    is LoungeEvent.ProtocolError -> eventId
  }

internal object LoungeRequestShape {
  const val PAIRING_URL = "https://www.youtube.com/api/lounge/pairing/get_screen"
  const val REFRESH_URL = "https://www.youtube.com/api/lounge/pairing/get_lounge_token_batch"
  const val BIND_URL = "https://www.youtube.com/api/lounge/bc/bind"

  fun bindForm(pairing: PairingMaterial, name: String): Map<String, String> = mapOf(
    "app" to "web",
    "mdx-version" to "3",
    "name" to name,
    "id" to pairing.screenId,
    "device" to "REMOTE_CONTROL",
    "capabilities" to "que,dsdtr,atp,vsp",
    "magnaKey" to "cloudPairedDevice",
    "ui" to "false",
    "theme" to "cl",
    "loungeIdToken" to pairing.loungeToken,
    "deviceContext" to "user_agent=dunno&window_width_points=&window_height_points=&os_name=android&ms=",
  )

  fun commandForm(action: String, offset: Long, values: Map<String, String>): Map<String, String> = buildMap {
    put("count", "1")
    put("ofs", offset.toString())
    put("req0__sc", action)
    putAll(values)
  }

  fun sessionUrl(
    pairing: PairingMaterial,
    name: String,
    sid: String,
    gsessionId: String,
    aid: Long,
    requestId: String,
    subscribe: Boolean,
  ): String {
    val url = BIND_URL.toHttpUrl().newBuilder()
      .addQueryParameter("name", name)
      .addQueryParameter("id", pairing.screenId)
      .addQueryParameter("loungeIdToken", pairing.loungeToken)
      .addQueryParameter("SID", sid)
      .addQueryParameter("AID", aid.toString())
      .addQueryParameter("gsessionid", gsessionId)
      .addQueryParameter("device", "REMOTE_CONTROL")
      .addQueryParameter("app", "youtube-desktop")
      .addQueryParameter("VER", "8")
      .addQueryParameter("v", "2")
      .addQueryParameter("RID", requestId)
    if (subscribe) {
      url.addQueryParameter("CI", "0").addQueryParameter("TYPE", "xmlhttp")
    } else {
      url.addQueryParameter("CI", "0").addQueryParameter("TYPE", "bind").addQueryParameter("t", "1")
    }
    return url.build().toString()
  }
}

internal fun parseBindResponse(text: String): LoungeBindResponse {
  val parser = LoungeChunkParser()
  val events = parser.feed(text) + parser.finish()
  var sid: String? = null
  var gsession: String? = null
  var aid: Long? = null
  events.forEach { event ->
    if (event is LoungeEvent.Raw) {
      sid = sid ?: event.payload.optString("SID").takeIf { it.isNotBlank() }
      gsession = gsession ?: event.payload.optString("gsessionid").takeIf { it.isNotBlank() }
    }
    event.eventId?.let { aid = maxOf(aid ?: it, it) }
  }
  if (sid.isNullOrBlank() || gsession.isNullOrBlank()) throw IOException("Lounge bind response incomplete")
  return LoungeBindResponse(sid!!, gsession!!, aid)
}

private class HttpLoungeSession(
  private val client: OkHttpClient,
  private val pairing: PairingMaterial,
  private val clientName: String,
  private val sid: String,
  private val gsessionId: String,
  initialEventId: Long?,
  commandTimeoutMillis: Long,
  private val commandObserver: LoungeCommandObserver,
) : LoungeSession {
  private val commandMutex = Mutex()
  private val commandSendMutex = Mutex()
  private val commandClient = client.newBuilder()
    .callTimeout(commandTimeoutMillis, TimeUnit.MILLISECONDS)
    .build()
  private val activeCalls = java.util.concurrent.ConcurrentHashMap.newKeySet<Call>()
  private val closed = SessionClosedGate()
  private var requestId = 2L
  private var offset = 1L
  private var lastEventId = initialEventId ?: 0L

  override val events: Flow<LoungeEvent> = channelFlow {
    closed.requireOpen()
    val parser = LoungeChunkParser()
    val request = Request.Builder().url(commandMutex.withLock {
      LoungeRequestShape.sessionUrl(pairing, clientName, sid, gsessionId, lastEventId, "rpc", subscribe = true)
    }).build()
    val call = client.newCall(request)
    closed.requireOpen()
    activeCalls += call
    if (closed.isClosed()) {
      activeCalls -= call
      call.cancel()
      throw LoungeSessionClosedException()
    }
    withContext(Dispatchers.IO) {
      try {
        call.execute().use { response ->
        if (!response.isSuccessful) throw IOException("Lounge event stream failed (${response.code})")
        response.body?.charStream()?.buffered()?.use { reader ->
          for (event in reader.readLoungeEvents(parser)) {
            if (!isActive || closed.isClosed()) break
            send(event)
            if (event is LoungeEvent.ProtocolError) throw IOException(event.reason)
            commandMutex.withLock {
              event.eventId?.let { lastEventId = maxOf(lastEventId, it) }
            }
          }
        }
        }
      } finally {
        activeCalls -= call
      }
    }
  }

  override suspend fun setPlaylist(videoId: String) {
    LoungeValidation.videoId(videoId) ?: throw IllegalArgumentException("Invalid YouTube video ID")
    command(
      "setPlaylist",
      mapOf(
        "req0_videoId" to videoId,
        "req0_listId" to "",
        "req0_currentIndex" to "-1",
        "req0_currentTime" to "0",
        "req0_audioOnly" to "false",
        "req0_params" to "",
        "req0_playerParams" to "",
        "req0_prioritizeMobileSenderPlaybackStateOnConnection" to "true",
      ),
    )
  }

  override suspend fun play() = command("play")
  override suspend fun pause() = command("pause")

  override suspend fun seekTo(newTimeSeconds: Double) {
    require(newTimeSeconds.isFinite() && newTimeSeconds >= 0) { "Invalid seek position" }
    command("seekTo", mapOf("req0_newTime" to newTimeSeconds.toString()))
  }

  override suspend fun getNowPlaying() = command("getNowPlaying")

  override fun close() {
    closed.close()
    activeCalls.forEach { it.cancel() }
  }

  private suspend fun command(action: String, values: Map<String, String> = emptyMap()) {
    var call: Call? = null
    var requestIdForTelemetry = 0L
    var offsetForTelemetry = 0L
    val startedAt = System.nanoTime()
    var outcome: String? = null
    try {
      commandSendMutex.withLock {
        call = commandMutex.withLock {
          closed.requireOpen()
          val commandRequestId = requestId++
          val commandOffset = offset++
          requestIdForTelemetry = commandRequestId
          offsetForTelemetry = commandOffset
          val url = LoungeRequestShape.sessionUrl(
            pairing,
            clientName,
            sid,
            gsessionId,
            lastEventId,
            commandRequestId.toString(),
            subscribe = false,
          )
          val body = FormBody.Builder()
            .apply {
              LoungeRequestShape.commandForm(action, commandOffset, values)
                .forEach { (key, value) -> add(key, value) }
            }
            .build()
          commandClient.newCall(Request.Builder().url(url).post(body).build()).also { requestCall ->
            activeCalls += requestCall
          }
        }
        withContext(Dispatchers.IO) {
          closed.requireOpen()
          if (closed.isClosed()) {
            call?.cancel()
            throw LoungeSessionClosedException()
          }
          executeCommandCall(call!!).use { response ->
            outcome = if (response.isSuccessful) "http_2xx" else "http_${response.code}"
            if (!response.isSuccessful) throw IOException("Lounge command failed (${response.code})")
          }
        }
      }
    } catch (failure: Throwable) {
      outcome = outcome ?: loungeCommandFailureOutcome(failure)
      throw failure
    } finally {
      call?.let { activeCalls -= it }
      emitCommandTelemetry(
        LoungeCommandTelemetry(
          action = loungeCommandAction(action),
          requestId = requestIdForTelemetry,
          offset = offsetForTelemetry,
          elapsedMillis = (System.nanoTime() - startedAt).coerceAtLeast(0L) / 1_000_000L,
          outcome = outcome ?: "closed",
        ),
      )
    }
  }

  private fun emitCommandTelemetry(event: LoungeCommandTelemetry) {
    runCatching {
      LOUNGE_TELEMETRY_EXECUTOR.execute {
        runCatching { commandObserver.onCommand(event) }
      }
    }
  }

  private fun loungeCommandAction(action: String): String = when (action) {
    "setPlaylist", "play", "pause", "seekTo", "getNowPlaying" -> action
    else -> "unknown"
  }

  private fun loungeCommandFailureOutcome(failure: Throwable): String = when {
    failure is LoungeSessionClosedException || closed.isClosed() -> "closed"
    failure is TimeoutCancellationException -> "timeout"
    failure is CancellationException -> "cancelled"
    failure is InterruptedIOException -> "timeout"
    failure is IOException -> failure::class.simpleName ?: "IOException"
    else -> "failure"
  }

  private suspend fun executeCommandCall(call: Call) = suspendCancellableCoroutine<okhttp3.Response> { continuation ->
    continuation.invokeOnCancellation { call.cancel() }
    call.enqueue(object : Callback {
      override fun onFailure(call: Call, error: IOException) {
        runCatching { continuation.resumeWithException(error) }
      }

      override fun onResponse(call: Call, response: okhttp3.Response) {
        runCatching {
          continuation.resume(response) { _, _, _ -> response.close() }
        }.onFailure { response.close() }
      }
    })
  }
}

private const val COMMAND_TIMEOUT_MILLIS = 15_000L
private const val COMMAND_TIMEOUT_MAX_MILLIS = 29_000L
