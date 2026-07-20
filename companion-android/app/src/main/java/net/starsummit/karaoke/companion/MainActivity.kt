package net.starsummit.karaoke.companion

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.content.ServiceConnection
import android.os.Bundle
import android.os.IBinder
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import java.util.Locale

class MainActivity : Activity() {
  private val scope = CoroutineScope(Job() + Dispatchers.Main.immediate)
  private var service: CompanionService.CompanionBinder? = null
  private lateinit var diagnostics: TextView
  private lateinit var tvCode: EditText
  private lateinit var videoId: EditText

  private val connection = object : ServiceConnection {
    override fun onServiceConnected(name: ComponentName, binder: IBinder) {
      service = binder as CompanionService.CompanionBinder
      scope.launch {
        service?.diagnostics()?.collect { render(it) }
      }
    }

    override fun onServiceDisconnected(name: ComponentName) {
      service = null
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(buildView())
    startServiceAndBind()
  }

  override fun onDestroy() {
    unbindService(connection)
    scope.cancel()
    super.onDestroy()
  }

  private fun startServiceAndBind() {
    val intent = Intent(this, CompanionService::class.java)
    startForegroundService(intent)
    bindService(intent, connection, BIND_AUTO_CREATE)
  }

  private fun buildView(): ScrollView {
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(32, 28, 32, 28)
    }
    root.addView(TextView(this).apply {
      text = "Starsummit Lounge diagnostic"
      textSize = 24f
    }, match())
    root.addView(TextView(this).apply {
      text = "Pair SmartTube with its TV code. Credentials stay encrypted on this tablet."
      textSize = 15f
    }, match())
    tvCode = EditText(this).apply {
      hint = "SmartTube TV code"
      inputType = android.text.InputType.TYPE_CLASS_TEXT
      maxLines = 1
    }
    root.addView(tvCode, match())
    root.addView(Button(this).apply {
      text = "Pair TV"
      setOnClickListener { service?.pair(tvCode.text.toString()) }
    }, match())

    videoId = EditText(this).apply {
      hint = "YouTube video ID (11 characters)"
      inputType = android.text.InputType.TYPE_CLASS_TEXT
      maxLines = 1
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
      inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL
      maxLines = 1
    }
    root.addView(seek, match())
    root.addView(Button(this).apply {
      text = "Seek"
      setOnClickListener { seek.text.toString().toDoubleOrNull()?.let { service?.seekTo(it) } }
    }, match())

    diagnostics = TextView(this).apply {
      text = "Waiting for service…"
      textSize = 16f
      setPadding(0, 28, 0, 0)
    }
    root.addView(diagnostics, match())
    return ScrollView(this).apply { addView(root) }
  }

  private fun render(value: DiagnosticsSnapshot) {
    val now = value.nowPlaying
    diagnostics.text = buildString {
      append("State: ").append(value.state.name).append('\n')
      append("Reconnect attempt: ").append(value.reconnectAttempt).append('\n')
      append("Last event: ").append(value.lastEventRedacted ?: "—").append('\n')
      append("Last error: ").append(value.lastErrorRedacted ?: "—").append('\n')
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

  private fun weight(): LinearLayout.LayoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
}
