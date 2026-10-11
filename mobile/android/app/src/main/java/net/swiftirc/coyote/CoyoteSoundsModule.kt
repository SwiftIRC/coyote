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
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

// Plays chimes and soundboard clips inside the call's audio. It never changes the
// audio mode, focus or route: those belong to the call (InCallManager / Telecom).
class CoyoteSoundsModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName() = "CoyoteSounds"

  private val players = ConcurrentHashMap<String, MediaPlayer>()
  private val io = Executors.newSingleThreadExecutor()

  // Explicit R.raw references, so release resource shrinking keeps the files.
  private val bundled = mapOf(
    "door_open" to R.raw.door_open,
    "sounds_drop" to R.raw.sounds_drop,
    "sounds_bloop" to R.raw.sounds_bloop,
  )

  @ReactMethod
  fun preload(id: String, uri: String) {
    if (uri.startsWith("http://") || uri.startsWith("https://")) {
      io.execute {
        val file = cachedFile(uri)
        val part = File(file.parentFile, file.name + ".part")
        val ok = try {
          if (!file.exists()) {
            val conn = (URL(uri).openConnection() as HttpURLConnection).apply { connectTimeout = 10_000; readTimeout = 15_000 }
            try {
              if (conn.responseCode !in 200..299) throw java.io.IOException("HTTP ${conn.responseCode}")
              conn.inputStream.use { input -> part.outputStream().use { input.copyTo(it) } }
            } finally {
              conn.disconnect()
            }
            if (!part.renameTo(file)) throw java.io.IOException("rename failed")
          }
          val ready = prepare(id, Uri.fromFile(file).toString())
          if (!ready) file.delete() // never keep a clip that will not play
          ready
        } catch (e: Exception) {
          Log.w("CoyoteSounds", "download $id failed", e)
          part.delete()
          players.remove(id)?.release()
          false
        }
        emitLoaded(id, ok)
      }
      return
    }
    emitLoaded(id, prepare(id, uri))
  }

  private fun cachedFile(uri: String): File {
    val name = Uri.parse(uri).path.orEmpty().trim('/').replace('/', '_').ifEmpty { "clip" }
    return File(File(ctx.cacheDir, "sounds").apply { mkdirs() }, name)
  }

  // Returns true when ready. On failure any previous player for `id` is dropped.
  private fun prepare(id: String, uri: String): Boolean {
    players.remove(id)?.release()
    val p = MediaPlayer()
    return try {
      p.setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build()
      )
      if (uri.startsWith("asset:")) {
        val res = bundled[uri.removePrefix("asset:")] ?: run { p.release(); return false }
        ctx.resources.openRawResourceFd(res).use { p.setDataSource(it.fileDescriptor, it.startOffset, it.length) }
      } else {
        p.setDataSource(ctx, Uri.parse(uri))
      }
      p.setOnCompletionListener { emitEnded(id) }
      p.prepare()
      players[id] = p
      true
    } catch (e: Exception) {
      Log.w("CoyoteSounds", "preload $id failed", e)
      p.release()
      false
    }
  }

  private fun emitLoaded(id: String, ok: Boolean) {
    val body = Arguments.createMap().apply { putString("id", id); putBoolean("ok", ok) }
    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("CoyoteSoundLoaded", body)
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
    io.shutdownNow()
    players.values.forEach { it.release() }
    players.clear()
    super.invalidate()
  }
}
