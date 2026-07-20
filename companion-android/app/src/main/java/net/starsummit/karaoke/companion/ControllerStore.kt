package net.starsummit.karaoke.companion

import android.content.Context
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Controller credentials and delivery progress are encrypted separately from Lounge pairing. */
class ControllerStore(context: Context) {
  private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

  fun saveCredentials(credentials: ControllerCredentials) {
    val json = JSONObject()
      .put("baseUrl", credentials.baseUrl)
      .put("deviceKey", credentials.deviceKey)
      .put("deviceSecret", credentials.deviceSecret)
      .put("deviceId", credentials.deviceId)
    saveEncrypted(KEY_CREDENTIALS, json.toString())
  }

  fun loadCredentials(): ControllerCredentials? = loadEncrypted(KEY_CREDENTIALS)?.let {
    runCatching {
      val json = JSONObject(it)
      ControllerCredentials(json.getString("baseUrl"), json.getString("deviceKey"), json.getString("deviceSecret"), json.optString("deviceId").takeIf { id -> id.isNotBlank() })
    }.getOrNull()
  }

  fun saveSession(session: ControllerSession) {
    saveEncrypted(KEY_SESSION, JSONObject()
      .put("id", session.id)
      .put("generation", session.generation)
      .put("expiresAt", session.expiresAtEpochMs)
      .put("resumed", session.resumed)
      .toString())
  }

  fun loadSession(): ControllerSession? = loadEncrypted(KEY_SESSION)?.let {
    runCatching {
      val json = JSONObject(it)
      ControllerSession(json.getString("id"), json.getLong("generation"), json.getLong("expiresAt"), json.optBoolean("resumed"))
    }.getOrNull()
  }

  fun saveProgress(progress: ControllerProgress) {
    saveEncrypted(KEY_PROGRESS, JSONObject()
      .put("sessionId", progress.sessionId)
      .put("generation", progress.generation)
      .put("lastCommandSequence", progress.lastCommandSequence)
      .put("inFlightId", progress.inFlightId)
      .put("inFlightIdempotencyKey", progress.inFlightIdempotencyKey)
      .toString())
  }

  fun loadProgress(): ControllerProgress = loadEncrypted(KEY_PROGRESS)?.let {
    runCatching {
      val json = JSONObject(it)
      ControllerProgress(
        json.optString("sessionId").takeIf(String::isNotBlank),
        if (json.has("generation") && !json.isNull("generation")) json.optLong("generation") else null,
        json.optLong("lastCommandSequence", 0L),
        json.optString("inFlightId").takeIf(String::isNotBlank),
        json.optString("inFlightIdempotencyKey").takeIf(String::isNotBlank),
      )
    }.getOrNull()
  } ?: ControllerProgress()

  private fun saveEncrypted(name: String, plaintext: String) {
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, key())
    val committed = preferences.edit()
      .putString("$name.ciphertext", Base64.encodeToString(cipher.doFinal(plaintext.toByteArray()), Base64.NO_WRAP))
      .putString("$name.iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
      .commit()
    if (!committed) throw java.io.IOException("controller state persistence failed")
  }

  private fun loadEncrypted(name: String): String? {
    val ciphertext = preferences.getString("$name.ciphertext", null) ?: return null
    val encodedIv = preferences.getString("$name.iv", null) ?: return null
    return runCatching {
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_LENGTH_BITS, Base64.decode(encodedIv, Base64.NO_WRAP)))
      String(cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP)))
    }.getOrNull()
  }

  private fun key(): SecretKey {
    val store = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
    (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
    return KeyGenerator.getInstance("AES", ANDROID_KEYSTORE).apply {
      init(android.security.keystore.KeyGenParameterSpec.Builder(
        KEY_ALIAS,
        android.security.keystore.KeyProperties.PURPOSE_ENCRYPT or android.security.keystore.KeyProperties.PURPOSE_DECRYPT,
      ).setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE)
        .setRandomizedEncryptionRequired(true)
        .build())
    }.generateKey()
  }

  private companion object {
    const val PREFERENCES = "controller_protocol"
    const val KEY_ALIAS = "starsummit_controller_protocol_v1"
    const val KEY_CREDENTIALS = "credentials"
    const val KEY_SESSION = "session"
    const val KEY_PROGRESS = "progress"
    const val ANDROID_KEYSTORE = "AndroidKeyStore"
    const val TRANSFORMATION = "AES/GCM/NoPadding"
    const val TAG_LENGTH_BITS = 128
  }
}

class ControllerStoreProgressAdapter(private val store: ControllerStore) : ProgressStore {
  override fun load(): ControllerProgress = store.loadProgress()
  override fun save(progress: ControllerProgress) { store.saveProgress(progress) }
}

class ControllerStoreSessionAdapter(private val store: ControllerStore) : SessionStore {
  override fun load(): ControllerSession? = store.loadSession()
  override fun save(session: ControllerSession) { store.saveSession(session) }
}
