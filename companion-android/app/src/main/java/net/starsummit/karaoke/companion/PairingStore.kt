package net.starsummit.karaoke.companion

import android.content.Context
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Stores only AES/GCM ciphertext and IV in private preferences. */
class PairingStore(context: Context) {
  private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

  fun save(material: PairingMaterial) {
    val plaintext = JSONObject()
      .put("screenId", material.screenId)
      .put("loungeToken", material.loungeToken)
      .put("screenName", material.screenName)
      .toString()
      .toByteArray(Charsets.UTF_8)
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, key())
    val encrypted = cipher.doFinal(plaintext)
    preferences.edit()
      .putString(KEY_CIPHERTEXT, Base64.encodeToString(encrypted, Base64.NO_WRAP))
      .putString(KEY_IV, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
      .apply()
  }

  fun load(): PairingMaterial? {
    val ciphertext = preferences.getString(KEY_CIPHERTEXT, null) ?: return null
    val encodedIv = preferences.getString(KEY_IV, null) ?: return null
    return runCatching {
      val cipher = Cipher.getInstance(TRANSFORMATION)
      val iv = Base64.decode(encodedIv, Base64.NO_WRAP)
      cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_LENGTH_BITS, iv))
      val json = JSONObject(String(cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP)), Charsets.UTF_8))
      PairingMaterial(
        screenId = json.getString("screenId"),
        loungeToken = json.getString("loungeToken"),
        screenName = json.getString("screenName"),
      )
    }.getOrNull()
  }

  private fun key(): SecretKey {
    val store = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
    val existing = store.getKey(KEY_ALIAS, null) as? SecretKey
    if (existing != null) return existing
    val generator = KeyGenerator.getInstance("AES", ANDROID_KEYSTORE)
    generator.init(android.security.keystore.KeyGenParameterSpec.Builder(
      KEY_ALIAS,
      android.security.keystore.KeyProperties.PURPOSE_ENCRYPT or
        android.security.keystore.KeyProperties.PURPOSE_DECRYPT,
    ).setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE)
      .setRandomizedEncryptionRequired(true)
      .build())
    return generator.generateKey()
  }

  private companion object {
    const val PREFERENCES = "lounge_pairing"
    const val KEY_CIPHERTEXT = "ciphertext"
    const val KEY_IV = "iv"
    const val KEY_ALIAS = "starsummit_lounge_pairing_v1"
    const val ANDROID_KEYSTORE = "AndroidKeyStore"
    const val TRANSFORMATION = "AES/GCM/NoPadding"
    const val TAG_LENGTH_BITS = 128
  }
}
