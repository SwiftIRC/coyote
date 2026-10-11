package net.swiftirc.coyote

import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

// Plays chimes and soundboard clips inside the call's audio. It never changes the
// audio mode, focus or route: those belong to the call (InCallManager / Telecom).
class CoyoteSoundsModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName() = "CoyoteSounds"

  private val players = HashMap<String, MediaPlayer>()

  // Explicit R.raw references, so release resource shrinking keeps the files.
  private val bundled = mapOf(
    "door_open" to R.raw.door_open,
    "sounds_drop" to R.raw.sounds_drop,
    "sounds_bloop" to R.raw.sounds_bloop,
  )

  @ReactMethod
  fun preload(id: String, uri: String) {
    players.remove(id)?.release()
    val p = MediaPlayer()
    try {
      p.setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build()
      )
      if (uri.startsWith("asset:")) {
        val res = bundled[uri.removePrefix("asset:")] ?: run { p.release(); return }
        ctx.resources.openRawResourceFd(res).use { p.setDataSource(it.fileDescriptor, it.startOffset, it.length) }
      } else {
        p.setDataSource(ctx, Uri.parse(uri))
      }
      p.setOnCompletionListener { emitEnded(id) }
      p.prepare()
      players[id] = p
    } catch (e: Exception) {
      Log.w("CoyoteSounds", "preload $id failed", e)
      p.release()
    }
  }

  @ReactMethod
  fun play(id: String) {
    val p = players[id] ?: return
    p.seekTo(0)
    if (!p.isPlaying) p.start()
  }

  @ReactMethod
  fun stop(id: String) {
    val p = players[id] ?: return
    if (p.isPlaying) p.pause()
    p.seekTo(0)
  }

  private fun emitEnded(id: String) {
    val body = Arguments.createMap().apply { putString("id", id) }
    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("CoyoteSoundEnded", body)
  }

  // Required by NativeEventEmitter on Android.
  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Int) {}

  override fun invalidate() {
    players.values.forEach { it.release() }
    players.clear()
    super.invalidate()
  }
}
