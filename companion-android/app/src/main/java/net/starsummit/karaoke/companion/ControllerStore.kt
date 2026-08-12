package net.starsummit.karaoke.companion

import android.content.Context
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** A persistence failure whose rollback outcome is explicit to the service lifecycle. */
class ControllerStatePersistenceException(val rollbackFailed: Boolean) : java.io.IOException(
  if (rollbackFailed) "controller state rollback failed" else "controller state persistence failed",
)

/** Minimal editor contract used to make failed-commit rollback deterministic in JVM tests. */
internal interface ControllerPreferenceEditor {
  fun putString(key: String, value: String?): ControllerPreferenceEditor
  fun remove(key: String): ControllerPreferenceEditor
  fun commit(): Boolean
}

internal data class ControllerPreferenceValue(val present: Boolean, val value: String?)

internal const val CONTROLLER_STORAGE_BLOCKED_KEY = "storage_blocked"
internal const val CONTROLLER_STORAGE_BLOCKED_VALUE = "1"

internal fun controllerStorageBlocked(values: Map<String, String?>): Boolean =
  values[CONTROLLER_STORAGE_BLOCKED_KEY] == CONTROLLER_STORAGE_BLOCKED_VALUE

internal fun controllerLoopMayStart(hasCredentials: Boolean, storageBlocked: Boolean): Boolean =
  hasCredentials && !storageBlocked

internal class ControllerPreferenceSnapshot private constructor(
  private val values: Map<String, ControllerPreferenceValue>,
) {
  fun restore(editor: ControllerPreferenceEditor): ControllerPreferenceEditor = values.entries.fold(editor) { target, (key, value) ->
    if (value.present) target.putString(key, value.value) else target.remove(key)
  }

  companion object {
    fun capture(keys: Iterable<String>, read: (String) -> ControllerPreferenceValue): ControllerPreferenceSnapshot =
      ControllerPreferenceSnapshot(keys.associateWith(read))
  }
}

/** Commits a change and restores the exact pre-change values if commit() reports failure. */
internal fun commitControllerPreferences(
  keys: Iterable<String>,
  read: (String) -> ControllerPreferenceValue,
  edit: () -> ControllerPreferenceEditor,
  mutate: (ControllerPreferenceEditor) -> Unit,
) {
  val snapshot = ControllerPreferenceSnapshot.capture(keys, read)
  val writer = edit()
  mutate(writer)
  val committed = runCatching { writer.commit() }.getOrDefault(false)
  if (committed) return

  val rollbackSucceeded = runCatching {
    snapshot.restore(edit()).commit()
  }.getOrDefault(false)
  if (!rollbackSucceeded) throw ControllerStatePersistenceException(rollbackFailed = true)
  throw ControllerStatePersistenceException(rollbackFailed = false)
}

/** Controller credentials and delivery progress are encrypted separately from Lounge pairing. */
class ControllerStore(context: Context) {
  private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

  /** A durable fail-closed marker for an interrupted or indeterminate controller transaction. */
  fun isStorageBlocked(): Boolean = controllerStorageBlocked(
    mapOf(CONTROLLER_STORAGE_BLOCKED_KEY to preferences.getString(CONTROLLER_STORAGE_BLOCKED_KEY, null)),
  )

  fun saveCredentials(credentials: ControllerCredentials) {
    saveEncrypted(KEY_CREDENTIALS, credentialsJson(credentials))
  }

  /**
   * Installs a replacement enrollment and starts its protocol at a clean generation.
   *
   * The credential write and removal of the old session/progress are one synchronous
   * SharedPreferences commit.  If encryption or the commit fails, the old encrypted
   * values remain available to the caller so it can resume the previous enrollment.
   */
  fun replaceCredentials(credentials: ControllerCredentials) {
    val encrypted = encrypt(credentialsJson(credentials))
    commitOrThrow(allowWhenBlocked = true) { editor ->
      editor
        .putString("$KEY_CREDENTIALS.ciphertext", encrypted.ciphertext)
        .putString("$KEY_CREDENTIALS.iv", encrypted.iv)
        .removeEncrypted(KEY_SESSION)
        .removeEncrypted(KEY_PROGRESS)
    }
  }

  /** Clears only this app's controller enrollment and protocol state. */
  fun clearControllerState() {
    commitOrThrow(allowWhenBlocked = true) { editor ->
      editor.removeEncrypted(KEY_CREDENTIALS).removeEncrypted(KEY_SESSION).removeEncrypted(KEY_PROGRESS)
    }
  }

  /** Clears resumable protocol state while retaining the current controller credential. */
  fun clearProtocolState() {
    commitOrThrow { editor -> editor.removeEncrypted(KEY_SESSION).removeEncrypted(KEY_PROGRESS) }
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
    val encrypted = encrypt(plaintext)
    commitOrThrow { editor ->
      editor.putString("$name.ciphertext", encrypted.ciphertext).putString("$name.iv", encrypted.iv)
    }
  }

  private fun encrypt(plaintext: String): EncryptedValue {
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, key())
    return EncryptedValue(
      ciphertext = Base64.encodeToString(cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP),
      iv = Base64.encodeToString(cipher.iv, Base64.NO_WRAP),
    )
  }

  private fun commitOrThrow(
    allowWhenBlocked: Boolean = false,
    mutate: (ControllerPreferenceEditor) -> Unit,
  ) {
    if (!allowWhenBlocked && isStorageBlocked()) {
      throw ControllerStatePersistenceException(rollbackFailed = true)
    }
    markStorageBlocked()
    val mutationFailure = runCatching {
      commitControllerPreferences(
        keys = PERSISTED_KEYS,
        read = { key -> ControllerPreferenceValue(preferences.contains(key), preferences.getString(key, null)) },
        edit = { AndroidControllerPreferenceEditor(preferences.edit()) },
        mutate = mutate,
      )
      null
    }.getOrElse { failure -> failure }
    if (mutationFailure != null) {
      if (mutationFailure is ControllerStatePersistenceException && !mutationFailure.rollbackFailed) {
        clearStorageBlocked()
      }
      if (mutationFailure is ControllerStatePersistenceException) throw mutationFailure
      throw ControllerStatePersistenceException(rollbackFailed = true)
    }
    clearStorageBlocked()
  }

  private fun markStorageBlocked() {
    val committed = runCatching {
      preferences.edit().putString(CONTROLLER_STORAGE_BLOCKED_KEY, CONTROLLER_STORAGE_BLOCKED_VALUE).commit()
    }.getOrDefault(false)
    if (committed) return
    // A failed commit may still have changed SharedPreferences' in-memory map. Retry the
    // marker, and fail closed if durability remains unavailable.
    val retry = runCatching {
      preferences.edit().putString(CONTROLLER_STORAGE_BLOCKED_KEY, CONTROLLER_STORAGE_BLOCKED_VALUE).commit()
    }.getOrDefault(false)
    if (!retry) throw ControllerStatePersistenceException(rollbackFailed = true)
    throw ControllerStatePersistenceException(rollbackFailed = true)
  }

  private fun clearStorageBlocked() {
    val committed = runCatching { preferences.edit().remove(CONTROLLER_STORAGE_BLOCKED_KEY).commit() }.getOrDefault(false)
    if (committed) return
    // Restore the marker after a failed remove so a process restart remains fail-closed.
    val restored = runCatching {
      preferences.edit().putString(CONTROLLER_STORAGE_BLOCKED_KEY, CONTROLLER_STORAGE_BLOCKED_VALUE).commit()
    }.getOrDefault(false)
    if (!restored) throw ControllerStatePersistenceException(rollbackFailed = true)
    throw ControllerStatePersistenceException(rollbackFailed = true)
  }

  private fun ControllerPreferenceEditor.removeEncrypted(name: String): ControllerPreferenceEditor =
    remove("$name.ciphertext").remove("$name.iv")

  private fun credentialsJson(credentials: ControllerCredentials): String = JSONObject()
    .put("baseUrl", credentials.baseUrl)
    .put("deviceKey", credentials.deviceKey)
    .put("deviceSecret", credentials.deviceSecret)
    .put("deviceId", credentials.deviceId)
    .toString()

  private fun loadEncrypted(name: String): String? {
    val ciphertext = preferences.getString("$name.ciphertext", null) ?: return null
    val encodedIv = preferences.getString("$name.iv", null) ?: return null
    return runCatching {
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_LENGTH_BITS, Base64.decode(encodedIv, Base64.NO_WRAP)))
      String(cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP)), Charsets.UTF_8)
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
    val PERSISTED_KEYS = listOf(
      "$KEY_CREDENTIALS.ciphertext", "$KEY_CREDENTIALS.iv",
      "$KEY_SESSION.ciphertext", "$KEY_SESSION.iv",
      "$KEY_PROGRESS.ciphertext", "$KEY_PROGRESS.iv",
    )
  }

  private data class EncryptedValue(val ciphertext: String, val iv: String)

  private class AndroidControllerPreferenceEditor(
    private val delegate: android.content.SharedPreferences.Editor,
  ) : ControllerPreferenceEditor {
    override fun putString(key: String, value: String?): ControllerPreferenceEditor {
      delegate.putString(key, value)
      return this
    }

    override fun remove(key: String): ControllerPreferenceEditor {
      delegate.remove(key)
      return this
    }

    override fun commit(): Boolean = delegate.commit()
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
