package net.swiftirc.coyote

import android.app.Activity
import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.Rational
import androidx.annotation.RequiresApi
import androidx.core.content.ContextCompat
import java.lang.ref.WeakReference

// Picture-in-picture for a live call. JS says when PiP is allowed (CoyotePip.setPip);
// MainActivity forwards its lifecycle here. Leaving the app enters PiP (auto-enter on
// 12+, onUserLeaveHint on 8–11); PiP mode, the activity's on-screen state and the PiP
// buttons go back to JS through the module. All state is confined to the main thread.
object Pip {
  private const val TAG = "CoyotePip"
  private const val ACTION = "net.swiftirc.coyote.PIP_ACTION"
  private const val EXTRA = "action"

  private val main = Handler(Looper.getMainLooper())
  private var activity = WeakReference<Activity>(null)
  private var module: CoyotePipModule? = null
  private var receiver: BroadcastReceiver? = null
  private var enabled = false
  private var micOn = false
  private var screen = false

  fun attach(m: CoyotePipModule, ctx: Context) {
    main.post {
      module = m
      if (receiver == null) {
        val r = object : BroadcastReceiver() {
          override fun onReceive(c: Context, i: Intent) {
            val a = i.getStringExtra(EXTRA)
            if (a == "mic" || a == "hangup") module?.emit("CoyotePipAction", "action", a)
          }
        }
        ContextCompat.registerReceiver(ctx.applicationContext, r, IntentFilter(ACTION), ContextCompat.RECEIVER_NOT_EXPORTED)
        receiver = r
      }
    }
  }

  fun detach(m: CoyotePipModule) {
    main.post { if (module === m) module = null }
  }

  fun set(enabled: Boolean, micOn: Boolean, screen: Boolean) {
    main.post {
      val wasEnabled = this.enabled
      this.enabled = enabled
      this.micOn = micOn
      this.screen = screen
      val a = activity.get() ?: return@post
      apply(a)
      // The call ended while shrunk: bring the app back so the window closes.
      if (wasEnabled && !enabled && Build.VERSION.SDK_INT >= 26 && a.isInPictureInPictureMode) {
        a.startActivity(Intent(a, a.javaClass).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP))
      }
    }
  }

  fun onStart(a: Activity) {
    activity = WeakReference(a)
    apply(a)
    module?.emit("CoyotePipVisibility", "visible", true)
  }

  fun onStop() {
    module?.emit("CoyotePipVisibility", "visible", false)
  }

  // Android 8–11 have no auto-enter: enter on Home / the gesture / switching apps.
  fun onUserLeaveHint(a: Activity) {
    // Plain comparisons (not `in 26..30`) so lint's NewApi check sees the guard.
    if (Build.VERSION.SDK_INT < 26 || Build.VERSION.SDK_INT >= 31) return
    if (!enabled || !supported(a) || a.isInPictureInPictureMode) return
    try {
      a.enterPictureInPictureMode(params(a))
    } catch (e: IllegalStateException) {
      Log.w(TAG, "enterPictureInPictureMode failed", e) // PiP turned off for the app
    }
  }

  fun onModeChanged(inPip: Boolean) {
    module?.emit("CoyotePipChanged", "inPip", inPip)
  }

  private fun supported(a: Activity) = a.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)

  private fun apply(a: Activity) {
    if (Build.VERSION.SDK_INT < 26 || !supported(a)) return
    try {
      a.setPictureInPictureParams(params(a))
    } catch (e: IllegalStateException) {
      Log.w(TAG, "setPictureInPictureParams failed", e)
    }
  }

  @RequiresApi(26)
  private fun params(c: Context): PictureInPictureParams {
    val b = PictureInPictureParams.Builder()
      .setAspectRatio(if (screen) Rational(16, 9) else Rational(3, 4))
      .setActions(if (enabled) actions(c) else emptyList())
    if (Build.VERSION.SDK_INT >= 31) b.setAutoEnterEnabled(enabled)
    return b.build()
  }

  @RequiresApi(26)
  private fun actions(c: Context) = listOf(
    if (micOn) action(c, "mic", R.drawable.ic_pip_mic, "Mute", 1)
    else action(c, "mic", R.drawable.ic_pip_mic_off, "Unmute", 1),
    action(c, "hangup", R.drawable.ic_pip_hangup, "Hang up", 2),
  )

  @RequiresApi(26)
  private fun action(c: Context, id: String, icon: Int, title: String, req: Int): RemoteAction {
    val intent = Intent(ACTION).setPackage(c.packageName).putExtra(EXTRA, id)
    val pi = PendingIntent.getBroadcast(c, req, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    return RemoteAction(Icon.createWithResource(c, icon), title, title, pi)
  }
}
