package net.swiftirc.coyote

import android.app.Activity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

// Full screen during a call: the status and navigation bars hide, and a swipe in from
// an edge shows them briefly over the video. Re-applied when the window regains focus,
// since leaving and coming back (or PiP) can bring the bars back.
object Immersive {
  @Volatile private var on = false

  fun set(activity: Activity?, enabled: Boolean) {
    on = enabled
    activity?.runOnUiThread { apply(activity) }
  }

  fun onWindowFocusChanged(activity: Activity, hasFocus: Boolean) {
    if (hasFocus && on) apply(activity)
  }

  private fun apply(activity: Activity) {
    if (activity.isFinishing || activity.isDestroyed) return
    val window = activity.window ?: return
    val c = WindowCompat.getInsetsController(window, window.decorView)
    if (on) {
      c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      c.hide(WindowInsetsCompat.Type.systemBars())
    } else {
      c.show(WindowInsetsCompat.Type.systemBars())
    }
  }
}
