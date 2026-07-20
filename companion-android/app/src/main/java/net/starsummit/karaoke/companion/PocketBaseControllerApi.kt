package net.starsummit.karaoke.companion

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

interface ControllerApi {
  suspend fun enroll(baseUrl: String, grant: String, deviceName: String): ControllerCredentials
  suspend fun authenticate(credentials: ControllerCredentials): ControllerAuth
  suspend fun startOrResumeSession(auth: ControllerAuth, resumeSessionId: String?): ControllerSession
  suspend fun fetchCommands(auth: ControllerAuth, session: ControllerSession, afterSequence: Long): List<ControllerCommand>
  suspend fun acknowledge(auth: ControllerAuth, session: ControllerSession, command: ControllerCommand, success: Boolean, errorCode: String? = null)
  suspend fun reportState(auth: ControllerAuth, session: ControllerSession, state: SanitizedControllerState)
}

data class SanitizedControllerState(
  val connectionState: String,
  val playback: PlaybackSnapshot = PlaybackSnapshot(),
  val lastCommandSequence: Long = 0,
)

class ControllerHttpException(val statusCode: Int) : IOException("PocketBase controller request failed ($statusCode)")

object PocketBaseControllerPaths {
  const val ENROLL = "/api/karaoke/controllers/enroll"
  const val AUTH = "/api/collections/controller_devices/auth-with-password"
  const val SESSIONS = "/api/karaoke/controllers/sessions"
  const val COMMANDS = "/api/karaoke/controllers/commands"
  const val STATE = "/api/karaoke/controllers/state"
  const val REALTIME = "/api/realtime"
}

class PocketBaseControllerApi(
  private val client: OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(10, TimeUnit.SECONDS)
    .readTimeout(30, TimeUnit.SECONDS)
    .build(),
  private val now: () -> Long = { System.currentTimeMillis() },
) : ControllerApi {
  override suspend fun enroll(baseUrl: String, grant: String, deviceName: String): ControllerCredentials = withContext(Dispatchers.IO) {
    val response = request(baseUrl, PocketBaseControllerPaths.ENROLL, null, JSONObject().put("token", grant).put("deviceName", deviceName), "POST")
    val json = JSONObject(response)
    ControllerCredentials(baseUrl.trimEnd('/'), json.getString("deviceKey"), json.getString("deviceSecret"), json.optString("deviceId").takeIf { it.isNotBlank() })
  }

  override suspend fun authenticate(credentials: ControllerCredentials): ControllerAuth = withContext(Dispatchers.IO) {
    val body = JSONObject().put("identity", credentials.deviceKey).put("password", credentials.deviceSecret)
    val response = request(credentials.baseUrl, PocketBaseControllerPaths.AUTH, null, body, "POST")
    val json = JSONObject(response)
    ControllerAuth(json.getString("token"), parseEpoch(json.opt("expiresAt")), credentials.baseUrl.trimEnd('/'))
  }

  override suspend fun startOrResumeSession(auth: ControllerAuth, resumeSessionId: String?): ControllerSession = withContext(Dispatchers.IO) {
    val body = JSONObject().apply { if (!resumeSessionId.isNullOrBlank()) put("resumeSessionId", resumeSessionId) }
    val response = request(authBase(auth), PocketBaseControllerPaths.SESSIONS, auth.token, body, "POST")
    parseSession(response)
  }

  override suspend fun fetchCommands(auth: ControllerAuth, session: ControllerSession, afterSequence: Long): List<ControllerCommand> = withContext(Dispatchers.IO) {
    val url = "${authBase(auth)}${PocketBaseControllerPaths.COMMANDS}?sessionId=${encode(session.id)}&generation=${session.generation}&after=$afterSequence"
    val text = request(url, null, auth.token, null, "GET")
    val root = JSONObject(text)
    if (root.optString("sessionId").isNotBlank() && root.optString("sessionId") != session.id) {
      throw IOException("stale controller session response")
    }
    if (root.has("generation") && root.optLong("generation") != session.generation) {
      throw IOException("stale controller generation response")
    }
    ControllerCommandParser.parseList(text, now())
  }

  override suspend fun acknowledge(auth: ControllerAuth, session: ControllerSession, command: ControllerCommand, success: Boolean, errorCode: String?) = withContext(Dispatchers.IO) {
    val body = JSONObject().put("sessionId", session.id).put("generation", session.generation)
      .put("sequence", command.sequence).put("idempotencyKey", command.idempotencyKey)
      .put("status", if (success) "succeeded" else "failed").apply { errorCode?.let { put("errorCode", it) } }
    request("${authBase(auth)}${PocketBaseControllerPaths.COMMANDS}/${encode(command.id)}/ack", null, auth.token, body, "POST")
    Unit
  }

  override suspend fun reportState(auth: ControllerAuth, session: ControllerSession, state: SanitizedControllerState) = withContext(Dispatchers.IO) {
    val body = JSONObject().put("sessionId", session.id).put("generation", session.generation)
      .put("connectionState", state.connectionState).put("lastCommandSequence", state.lastCommandSequence)
    state.playback.videoId?.let { body.put("videoId", it) }
    state.playback.state?.let { body.put("playerState", it) }
    state.playback.positionSeconds?.let { body.put("positionSeconds", it) }
    state.playback.durationSeconds?.let { body.put("durationSeconds", it) }
    request(authBase(auth), PocketBaseControllerPaths.STATE, auth.token, body, "PUT")
    Unit
  }

  private fun parseSession(text: String): ControllerSession {
    val json = JSONObject(text)
    val id = json.optString("id").takeIf { it.isNotBlank() } ?: throw IOException("controller session missing id")
    val generation = json.optLong("generation", Long.MIN_VALUE).takeUnless { it == Long.MIN_VALUE }
      ?: throw IOException("controller session missing generation")
    val expiresValue = json.opt("expiresAt") ?: json.opt("expires_at")
      ?: throw IOException("controller session missing expiry")
    val expires = parseEpoch(expiresValue)
    if (expires <= now()) throw IOException("controller session expired")
    return ControllerSession(id, generation, expires, json.optBoolean("resumed"))
  }

  private fun authBase(auth: ControllerAuth): String = auth.baseUrl.takeIf { it.startsWith("https://") }
    ?: throw IOException("controller API base URL unavailable")

  private fun request(baseOrUrl: String, path: String?, token: String?, body: JSONObject?, method: String): String {
    val url = if (path == null) baseOrUrl else baseOrUrl.trimEnd('/') + path
    if (!url.startsWith("https://")) throw IOException("PocketBase controller requires HTTPS")
    val builder = Request.Builder().url(url).header("Accept", "application/json")
    token?.let { builder.header("Authorization", "Bearer $it") }
    body?.let { builder.method(method, it.toString().toRequestBody(JSON)) } ?: builder.method(method, null)
    client.newCall(builder.build()).execute().use { response ->
      if (!response.isSuccessful) throw ControllerHttpException(response.code)
      return response.body?.string().orEmpty()
    }
  }

  private fun encode(value: String) = java.net.URLEncoder.encode(value, Charsets.UTF_8.name())
  private fun parseEpoch(value: Any?): Long = when (value) {
    is Number -> if (value.toLong() < 10_000_000_000L) value.toLong() * 1000 else value.toLong()
    is String -> value.toLongOrNull()?.let { if (it < 10_000_000_000L) it * 1000 else it }
      ?: runCatching { java.time.Instant.parse(value).toEpochMilli() }.getOrDefault(Long.MAX_VALUE)
    else -> Long.MAX_VALUE
  }

  private companion object { val JSON = "application/json".toMediaType() }
}
