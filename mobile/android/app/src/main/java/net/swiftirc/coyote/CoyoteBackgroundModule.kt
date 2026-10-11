package net.swiftirc.coyote

import android.graphics.BitmapFactory
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

// Configures BackgroundEngine from JS and reports trips. Scene images are downloaded
// once into the cache; the latest setEffect wins even if an earlier download
// finishes after it.
class CoyoteBackgroundModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName() = "CoyoteBackground"

  private val io = Executors.newSingleThreadExecutor()
  private val token = AtomicInteger(0)

  init {
    BackgroundEngine.onTrip = { reason -> emitTripped(reason) }
  }

  @ReactMethod
  fun setEffect(effect: ReadableMap, promise: Promise) {
    val mine = token.incrementAndGet()
    when (if (effect.hasKey("kind")) effect.getString("kind") else null) {
      "blur" -> {
        val radius = if (effect.hasKey("radius")) effect.getDouble("radius") else 0.012
        BackgroundEngine.configure(BackgroundEngine.Effect.Blur(radius))
        promise.resolve(null)
      }
      "scene" -> {
        val url = if (effect.hasKey("url")) effect.getString("url") else null
        if (url.isNullOrEmpty()) {
          promise.reject("bad_effect", "scene without a url")
          return
        }
        io.execute {
          try {
            val image = loadScene(url)
            if (token.get() == mine) BackgroundEngine.configure(BackgroundEngine.Effect.Scene(image))
            promise.resolve(null)
          } catch (e: Exception) {
            Log.w("CoyoteBackground", "scene $url failed", e)
            promise.reject("scene_failed", e.message ?: "scene failed", e)
          }
        }
      }
      else -> promise.reject("bad_effect", "unknown effect kind")
    }
  }

  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Int) {}

  private fun loadScene(url: String): android.graphics.Bitmap {
    val dir = File(ctx.cacheDir, "backgrounds").apply { mkdirs() }
    val hash = MessageDigest.getInstance("SHA-1").digest(url.toByteArray()).joinToString("") { "%02x".format(it) }
    val file = File(dir, "$hash.webp")
    if (!file.exists()) {
      val part = File(dir, "$hash.part")
      val conn = (URL(url).openConnection() as HttpURLConnection).apply { connectTimeout = 10_000; readTimeout = 15_000 }
      try {
        if (conn.responseCode !in 200..299) throw java.io.IOException("HTTP ${conn.responseCode}")
        conn.inputStream.use { input -> part.outputStream().use { input.copyTo(it) } }
      } catch (e: Exception) {
        part.delete()
        throw e
      } finally {
        conn.disconnect()
      }
      if (!part.renameTo(file)) {
        part.delete()
        throw java.io.IOException("rename failed")
      }
    }
    return BitmapFactory.decodeFile(file.path) ?: run {
      file.delete()
      throw java.io.IOException("decode failed")
    }
  }

  private fun emitTripped(reason: String) {
    if (!ctx.hasActiveReactInstance()) return
    val body = Arguments.createMap().apply { putString("reason", reason) }
    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("CoyoteBackgroundTripped", body)
  }
}
