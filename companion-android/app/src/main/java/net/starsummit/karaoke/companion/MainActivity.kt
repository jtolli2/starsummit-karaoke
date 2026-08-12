package net.starsummit.karaoke.companion

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.content.ServiceConnection
import android.os.Bundle
import android.os.IBinder
import android.text.InputType
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import java.util.Locale

/** Touch-first operator surface. Controller enrollment is deliberately separate from Lounge. */
class MainActivity : Activity() {
  private val scope = CoroutineScope(Job() + Dispatchers.Main.immediate)
  private var service: CompanionService.CompanionBinder? = null
  private lateinit var diagnostics: TextView
  private lateinit var pairingStatus: TextView
  private lateinit var manualCode: EditText
  private lateinit var manualStaging: CheckBox
  private lateinit var pairingPrompt: TextView
  private lateinit var pairingConfirm: Button
  private lateinit var resetController: Button
  private var pendingEnrollment: ControllerPairingPolicy.EnrollmentRequest? = null
  private var latestDiagnostics = DiagnosticsSnapshot()

  // Optional Lounge controls remain available below the controller pairing section.
  private lateinit var tvCode: EditText
  private lateinit var videoId: EditText

  private val connection = object : ServiceConnection {
    override fun onServiceConnected(name: ComponentName, binder: IBinder) {
      service = binder as CompanionService.CompanionBinder
      scope.launch { service?.diagnostics()?.collect(::render) }
    }

    override fun onServiceDisconnected(name: ComponentName) {
      service = null
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(buildView())
    startServiceAndBind()
    handlePairingIntent(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handlePairingIntent(intent)
  }

  /** Accept only a validated custom-scheme link from the constrained admin screen. */
  private fun handlePairingIntent(intent: Intent?) {
    val data = intent?.data ?: return
    when (val result = ControllerPairingPolicy.parseEnrollmentLink(data.toString())) {
      is ControllerPairingPolicy.LinkResult.Accepted -> {
        pendingEnrollment = result.request
        pairingPrompt.text = "Pair this tablet with ${result.request.serverHost} as ${result.request.deviceName}?"
        pairingPrompt.visibility = View.VISIBLE
        pairingConfirm.visibility = View.VISIBLE
        pairingStatus.text = "Pairing link ready. Confirm to redeem this one-time grant."
        Toast.makeText(this, "Pairing request received.", Toast.LENGTH_SHORT).show()
      }
      is ControllerPairingPolicy.LinkResult.Rejected -> {
        pendingEnrollment = null
        pairingPrompt.visibility = View.GONE
        pairingConfirm.visibility = View.GONE
        val reason = result.error.name.lowercase(Locale.ROOT).replace('_', ' ')
        pairingStatus.text = "Pairing link rejected ($reason). Open a fresh link or enter the short code."
        Toast.makeText(this, "Pairing link is not trusted.", Toast.LENGTH_LONG).show()
      }
    }
    // Do not leave the grant in a retrievable intent after parsing it.
    intent?.data = null
  }

  private fun confirmPendingEnrollment() {
    val request = pendingEnrollment ?: return
    submitEnrollment(request)
    pendingEnrollment = null
    pairingPrompt.visibility = View.GONE
    pairingConfirm.visibility = View.GONE
  }

  private fun submitManualEnrollment() {
    val normalized = ControllerPairingPolicy.normalizeManualCode(manualCode.text.toString())
    if (normalized == null) {
      pairingStatus.text = "Enter the 16-character code from /admin. Spaces and hyphens are optional."
      manualCode.requestFocus()
      return
    }
    val origin = ControllerPairingPolicy.manualOrigin(null, manualStaging.isChecked)
    submitEnrollment(
      ControllerPairingPolicy.EnrollmentRequest(
        baseUrl = origin,
        grant = normalized,
        deviceName = "Starsummit tablet",
        serverHost = android.net.Uri.parse(origin).host.orEmpty(),
      ),
    )
    manualCode.text.clear()
  }

  private fun submitEnrollment(request: ControllerPairingPolicy.EnrollmentRequest) {
    val currentService = service
    if (currentService == null) {
      pairingStatus.text = "Controller service is still starting. Try again in a moment."
      return
    }
    pairingStatus.text = "Redeeming grant with ${request.serverHost}…"
    currentService.enrollController(
      request.baseUrl,
      request.grant,
      request.deviceName,
      request.serverHost,
      request.destination,
    )
  }

  override fun onDestroy() {
    runCatching { unbindService(connection) }
    scope.cancel()
    super.onDestroy()
  }

  private fun startServiceAndBind() {
    val serviceIntent = Intent(this, CompanionService::class.java)
    startForegroundService(serviceIntent)
    bindService(serviceIntent, connection, BIND_AUTO_CREATE)
  }

  private fun buildView(): ScrollView {
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(32, 28, 32, 28)
    }
    root.addView(TextView(this).apply {
      text = "Starsummit Karaoke companion"
      textSize = 24f
    }, match())
    root.addView(TextView(this).apply {
      text = "Pair the controller first. Credentials stay encrypted on this tablet; Lounge pairing below is separate."
      textSize = 15f
    }, match())

    root.addView(TextView(this).apply {
      text = "Controller pairing"
      textSize = 20f
      setPadding(0, 18, 0, 4)
    }, match())
    pairingStatus = TextView(this).apply {
      text = "Waiting for a pairing link or short code."
      textSize = 16f
    }
    root.addView(pairingStatus, match())
    pairingPrompt = TextView(this).apply {
      visibility = View.GONE
      textSize = 15f
      setPadding(0, 8, 0, 0)
    }
    root.addView(pairingPrompt, match())
    pairingConfirm = Button(this).apply {
      text = "Confirm controller pairing"
      visibility = View.GONE
      setOnClickListener { confirmPendingEnrollment() }
    }
    root.addView(pairingConfirm, match())

    manualCode = EditText(this).apply {
      hint = "Short pairing code (XXXX-XXXX-XXXX-XXXX)"
      inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
      maxLines = 1
      isSingleLine = true
    }
    root.addView(manualCode, match())
    manualStaging = CheckBox(this).apply {
      text = "Use staging server (karaoke-test.app.starsummit.net)"
      isChecked = false
    }
    root.addView(manualStaging, match())
    root.addView(Button(this).apply {
      text = "Pair with short code"
      setOnClickListener { submitManualEnrollment() }
    }, match())
    resetController = Button(this).apply {
      text = "Re-pair controller (keeps Lounge pairing)"
      visibility = View.GONE
      setOnClickListener {
        pairingStatus.text = "Clearing controller enrollment only…"
        service?.resetController()
      }
    }
    root.addView(resetController, match())

    // Keep these controls intact and visibly distinct: they operate SmartTube Lounge only.
    root.addView(TextView(this).apply {
      text = "Optional SmartTube Lounge controls"
      textSize = 20f
      setPadding(0, 24, 0, 4)
    }, match())
    root.addView(TextView(this).apply {
      text = "Use these only to pair the TV or send playback commands. They do not change controller enrollment."
      textSize = 15f
    }, match())
    tvCode = EditText(this).apply {
      hint = "SmartTube TV code"
      inputType = InputType.TYPE_CLASS_TEXT
      maxLines = 1
      isSingleLine = true
    }
    root.addView(tvCode, match())
    root.addView(Button(this).apply {
      text = "Pair TV"
      setOnClickListener { service?.pair(tvCode.text.toString()) }
    }, match())

    videoId = EditText(this).apply {
      hint = "YouTube video ID (11 characters)"
      inputType = InputType.TYPE_CLASS_TEXT
      maxLines = 1
      isSingleLine = true
    }
    root.addView(videoId, match())
    root.addView(Button(this).apply {
      text = "Open video"
      setOnClickListener { service?.openVideo(videoId.text.toString()) }
    }, match())
    val controls = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
    controls.addView(Button(this).apply {
      text = "Play"
      setOnClickListener { service?.play() }
    }, weight())
    controls.addView(Button(this).apply {
      text = "Pause"
      setOnClickListener { service?.pause() }
    }, weight())
    controls.addView(Button(this).apply {
      text = "Now playing"
      setOnClickListener { service?.getNowPlaying() }
    }, weight())
    root.addView(controls, match())

    val seek = EditText(this).apply {
      hint = "Seek seconds"
      inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
      maxLines = 1
      isSingleLine = true
    }
    root.addView(seek, match())
    root.addView(Button(this).apply {
      text = "Seek"
      setOnClickListener { seek.text.toString().toDoubleOrNull()?.let { service?.seekTo(it) } }
    }, match())

    diagnostics = TextView(this).apply {
      text = "Waiting for service…"
      textSize = 15f
      setPadding(0, 28, 0, 0)
    }
    root.addView(diagnostics, match())
    return ScrollView(this).apply { addView(root) }
  }

  private fun render(value: DiagnosticsSnapshot) {
    latestDiagnostics = value
    val enrollment = value.controllerEnrollmentState
    val connected = value.controllerEstablishCount > 0 && value.controllerStateReportCount > 0
    pairingStatus.text = when {
      pendingEnrollment != null && enrollment != "enrolling" ->
        "Pairing link ready. Confirm to redeem this one-time grant."
      value.controllerEnrollmentStorageBlocked || enrollment == "storage_blocked" ->
        "Controller storage is blocked after an incomplete save. Re-pair controller state only; Lounge pairing is preserved."
      connected -> "Controller connected and reporting fresh state. /admin should now show this tablet connected."
      enrollment == "enrolling" -> "Controller pairing in progress (phase: ${value.controllerPhase ?: "enrollment"})…"
      enrollment == "re_pair_required" -> "Controller credentials were rejected. Use Re-pair, then create a fresh grant."
      enrollment == "retryable_error" -> controllerEnrollmentRecoveryMessage(value.controllerEnrollmentErrorRedacted)
      enrollment == "reset" -> "Controller enrollment cleared. Lounge pairing was preserved."
      value.controllerPhase != null -> "Controller phase: ${value.controllerPhase}"
      else -> "Waiting for a pairing link or short code."
    }
    val rePairVisible = value.controllerRePairRequired ||
      value.controllerEnrollmentStorageBlocked || enrollment == "re_pair_required" || enrollment == "storage_blocked"
    resetController.visibility = if (rePairVisible) View.VISIBLE else View.GONE
    val now = value.nowPlaying
    diagnostics.text = buildString {
      append("Controller phase: ").append(value.controllerPhase ?: "—").append('\n')
      append("Controller endpoint: ").append(value.controllerEndpointHost ?: "—").append('\n')
      append("Controller connection proof: ").append(if (connected) "fresh state reported" else "waiting").append('\n')
      append("Controller error: ").append(value.controllerEnrollmentErrorRedacted ?: "—").append('\n')
      append("Lounge state: ").append(value.state.name).append('\n')
      append("Lounge last event: ").append(value.lastEventRedacted ?: "—").append('\n')
      append("Video: ").append(now.videoId ?: "—").append('\n')
      append("Player: ").append(now.state ?: "—").append('\n')
      append("Position: ").append(now.positionSeconds?.let { String.format(Locale.US, "%.1fs", it) } ?: "—")
      append(" / ").append(now.durationSeconds?.let { String.format(Locale.US, "%.1fs", it) } ?: "—")
    }
  }

  private fun match(): LinearLayout.LayoutParams = LinearLayout.LayoutParams(
    ViewGroup.LayoutParams.MATCH_PARENT,
    ViewGroup.LayoutParams.WRAP_CONTENT,
  ).apply { bottomMargin = 12 }

  private fun weight(): LinearLayout.LayoutParams = LinearLayout.LayoutParams(
    0,
    ViewGroup.LayoutParams.WRAP_CONTENT,
    1f,
  )
}
