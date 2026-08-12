package net.starsummit.karaoke.companion

import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.Locale

/**
 * The browser and the companion intentionally share one enrollment request.  Keep all
 * validation here so an intent, a copied code, and a future QR reader have the same
 * origin and credential rules.
 */
object ControllerPairingPolicy {
  const val PRODUCTION_ORIGIN = "https://karaoke.app.starsummit.net"
  const val STAGING_ORIGIN = "https://karaoke-test.app.starsummit.net"
  private const val MAX_LINK_LENGTH = 4096
  private const val MAX_GRANT_LENGTH = 256
  private const val MAX_DEVICE_LENGTH = 64
  private val SHORT_CODE = Regex("^[A-Z2-9]{16}$")
  private val ALLOWED_HOSTS = setOf("karaoke.app.starsummit.net", "karaoke-test.app.starsummit.net")

  data class EnrollmentRequest(
    val baseUrl: String,
    val grant: String,
    val deviceName: String,
    val serverHost: String,
    val destination: String = "controller",
  ) {
    override fun toString(): String = "EnrollmentRequest(baseUrl=$baseUrl, grant=redacted, deviceName=$deviceName)"
  }

  enum class LinkError {
    TOO_LONG,
    UNSUPPORTED_SCHEME,
    MALFORMED,
    UNTRUSTED_ORIGIN,
    MISSING_GRANT,
    INVALID_GRANT,
    MISSING_DEVICE,
    INVALID_DEVICE,
  }

  sealed interface LinkResult {
    data class Accepted(val request: EnrollmentRequest) : LinkResult
    data class Rejected(val error: LinkError) : LinkResult
  }

  /** Parse only the package-targeted custom-scheme link emitted by the admin UI. */
  fun parseEnrollmentLink(raw: String): LinkResult {
    if (raw.length > MAX_LINK_LENGTH) return LinkResult.Rejected(LinkError.TOO_LONG)
    val uri = runCatching { URI(raw.trim()) }.getOrNull()
      ?: return LinkResult.Rejected(LinkError.MALFORMED)
    if (!uri.scheme.equals("starsummit-controller", ignoreCase = true) ||
      !uri.host.equals("enroll", ignoreCase = true) ||
      uri.userInfo != null || uri.port != -1 || uri.rawPath.isNotEmpty() && uri.rawPath != "/"
    ) return LinkResult.Rejected(LinkError.UNSUPPORTED_SCHEME)

    val query = parseQuery(uri.rawQuery ?: "")
    val server = query["server"] ?: return LinkResult.Rejected(LinkError.UNTRUSTED_ORIGIN)
    val origin = normalizeOrigin(server) ?: return LinkResult.Rejected(LinkError.UNTRUSTED_ORIGIN)
    val grant = query["grant"] ?: return LinkResult.Rejected(LinkError.MISSING_GRANT)
    if (!isBoundedCredential(grant)) return LinkResult.Rejected(LinkError.INVALID_GRANT)
    val device = query["device"] ?: return LinkResult.Rejected(LinkError.MISSING_DEVICE)
    val normalizedDevice = device.trim()
    if (!isBoundedDevice(normalizedDevice)) return LinkResult.Rejected(LinkError.INVALID_DEVICE)
    return LinkResult.Accepted(EnrollmentRequest(origin, grant, normalizedDevice, URI(origin).host.orEmpty()))
  }

  /** Grouping and casing are display concerns; the wire contract is exactly 16 characters. */
  fun normalizeManualCode(raw: String): String? {
    val normalized = raw.trim().uppercase(Locale.ROOT).replace(Regex("[\\s-]+"), "")
    return normalized.takeIf { SHORT_CODE.matches(it) }
  }

  fun formatManualCode(raw: String): String? = normalizeManualCode(raw)?.chunked(4)?.joinToString("-")

  fun isManualCode(raw: String): Boolean = normalizeManualCode(raw) != null

  fun normalizeOrigin(raw: String): String? {
    val uri = runCatching { URI(raw.trim()) }.getOrNull() ?: return null
    val host = uri.host?.lowercase(Locale.ROOT) ?: return null
    if (!uri.scheme.equals("https", ignoreCase = true) || host !in ALLOWED_HOSTS ||
      uri.userInfo != null || (uri.port != -1 && uri.port != 443) ||
      uri.rawQuery != null || uri.rawFragment != null || (uri.rawPath.isNotEmpty() && uri.rawPath != "/")
    ) return null
    return "https://$host"
  }

  fun manualOrigin(currentOrigin: String?, staging: Boolean): String {
    val safeCurrent = currentOrigin?.let(::normalizeOrigin)
    if (safeCurrent != null && (!staging || safeCurrent == STAGING_ORIGIN)) return safeCurrent
    return if (staging) STAGING_ORIGIN else PRODUCTION_ORIGIN
  }

  private fun parseQuery(raw: String): Map<String, String> {
    if (raw.length > MAX_LINK_LENGTH) return emptyMap()
    val values = linkedMapOf<String, String>()
    if (raw.isEmpty()) return values
    raw.split('&').forEach { part ->
      val pieces = part.split('=', limit = 2)
      if (pieces.size != 2) return emptyMap()
      val key = decode(pieces[0]) ?: return emptyMap()
      val value = decode(pieces[1]) ?: return emptyMap()
      if (key.isBlank() || values.put(key, value) != null) return emptyMap()
    }
    return values
  }

  private fun decode(value: String): String? = runCatching {
    URLDecoder.decode(value, StandardCharsets.UTF_8.name())
  }.getOrNull()

  private fun isBoundedCredential(value: String): Boolean = value.length in 8..MAX_GRANT_LENGTH &&
    value.none { it.isISOControl() || it.isWhitespace() }

  private fun isBoundedDevice(value: String): Boolean = value.trim().length in 1..MAX_DEVICE_LENGTH &&
    value.none { it.isISOControl() }
}
