package net.swiftirc.coyote

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.os.SystemClock
import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.segmentation.Segmentation
import com.google.mlkit.vision.segmentation.Segmenter
import com.google.mlkit.vision.segmentation.selfie.SelfieSegmenterOptions
import com.oney.WebRTCModule.videoEffects.VideoFrameProcessor
import org.webrtc.JavaI420Buffer
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoFrame
import java.util.concurrent.TimeUnit
import kotlin.math.max
import kotlin.math.roundToInt

// The "coyote-background" processor. Segments the person with ML Kit and composites
// them over a blurred copy of the frame or a scene, on the CPU at 640×360, output
// upright with rotation 0. Returning null passes the frame through untouched
// (react-native-webrtc then forwards the original); a returned frame is new and
// owned by the caller.
object BackgroundEngine : VideoFrameProcessor {
  sealed class Effect {
    data class Blur(val radius: Double) : Effect() // fraction of the short side
    class Scene(val image: Bitmap) : Effect()
  }

  private const val TAG = "CoyoteBackground"
  private const val LONG_SIDE = 640
  private const val SHORT_SIDE = 360
  private const val BUDGET_MS = 45.0
  private const val WARMUP_MS = 2_000L
  private const val SLOW_FOR_MS = 3_000L
  private const val SEGMENT_EVERY_MS = 66L

  @Volatile var onTrip: ((String) -> Unit)? = null

  private var effect: Effect? = null
  private var tripped = false
  private var armedAt = 0L
  private var avgMs = 0.0
  private var slowSince = 0L

  private var segmenter: Segmenter? = null
  private var mask: FloatArray? = null
  private var maskAt = 0L
  private var raw: Bitmap? = null
  private var upright: Bitmap? = null
  private var argb = IntArray(0)
  private var bg = IntArray(0)
  private var sceneFor: Effect.Scene? = null
  private var scenePixels = IntArray(0)
  private val paint = Paint(Paint.FILTER_BITMAP_FLAG)

  // null turns the effect off. Re-arms the breaker.
  @Synchronized fun configure(next: Effect?) {
    effect = next
    tripped = false
    armedAt = SystemClock.elapsedRealtime()
    avgMs = 0.0
    slowSince = 0L
    mask = null
    sceneFor = null
  }

  @Synchronized override fun process(frame: VideoFrame, textureHelper: SurfaceTextureHelper?): VideoFrame? {
    val e = effect ?: return null
    if (tripped) return null
    val t0 = SystemClock.elapsedRealtime()
    return try {
      val out = render(frame, e, t0)
      watch(t0)
      out
    } catch (t: Throwable) {
      Log.w(TAG, "background frame failed", t)
      trip("failed")
      null
    }
  }

  private fun render(frame: VideoFrame, e: Effect, now: Long): VideoFrame {
    val buffer = frame.buffer
    val landscape = buffer.width >= buffer.height
    val sw = if (landscape) LONG_SIDE else SHORT_SIDE
    val sh = if (landscape) SHORT_SIDE else LONG_SIDE
    val scaled = buffer.cropAndScale(0, 0, buffer.width, buffer.height, sw, sh)
    val i420 = try { scaled.toI420() } finally { scaled.release() } ?: throw IllegalStateException("toI420 failed")
    val rot = ((frame.rotation % 360) + 360) % 360
    val sideways = rot == 90 || rot == 270
    val uw = if (sideways) sh else sw
    val uh = if (sideways) sw else sh
    ensureScratch(sw, sh, uw, uh)
    try { Yuv.i420ToArgb(i420, argb) } finally { i420.release() }
    val rawBmp = raw!!
    val up = upright!!
    rawBmp.setPixels(argb, 0, sw, 0, 0, sw, sh)
    val m = Matrix().apply {
      postRotate(rot.toFloat())
      when (rot) {
        90 -> postTranslate(sh.toFloat(), 0f)
        180 -> postTranslate(sw.toFloat(), sh.toFloat())
        270 -> postTranslate(0f, sw.toFloat())
      }
    }
    Canvas(up).drawBitmap(rawBmp, m, paint)
    up.getPixels(argb, 0, uw, 0, 0, uw, uh)
    if (mask == null || now - maskAt >= SEGMENT_EVERY_MS) segment(up, uw, uh, now)
    val personMask = mask ?: throw IllegalStateException("no mask")
    background(e, up, uw, uh)
    for (i in 0 until uw * uh) {
      val a = personMask[i].coerceIn(0f, 1f)
      val f = argb[i]
      val b = bg[i]
      val r = (((f shr 16) and 0xff) * a + ((b shr 16) and 0xff) * (1 - a)).toInt()
      val g = (((f shr 8) and 0xff) * a + ((b shr 8) and 0xff) * (1 - a)).toInt()
      val bl = ((f and 0xff) * a + (b and 0xff) * (1 - a)).toInt()
      argb[i] = (0xff shl 24) or (r shl 16) or (g shl 8) or bl
    }
    val out = JavaI420Buffer.allocate(uw, uh)
    Yuv.argbToI420(argb, uw, uh, out)
    return VideoFrame(out, 0, frame.timestampNs)
  }

  private fun ensureScratch(sw: Int, sh: Int, uw: Int, uh: Int) {
    val r = raw
    val u = upright
    if (r != null && u != null && r.width == sw && r.height == sh && u.width == uw && u.height == uh) return
    r?.recycle()
    u?.recycle()
    raw = Bitmap.createBitmap(sw, sh, Bitmap.Config.ARGB_8888)
    upright = Bitmap.createBitmap(uw, uh, Bitmap.Config.ARGB_8888)
    argb = IntArray(sw * sh)
    bg = IntArray(sw * sh)
    mask = null
    sceneFor = null
  }

  private fun segment(image: Bitmap, w: Int, h: Int, now: Long) {
    val client = segmenter ?: Segmentation.getClient(
      SelfieSegmenterOptions.Builder().setDetectorMode(SelfieSegmenterOptions.STREAM_MODE).build()
    ).also { segmenter = it }
    val result = Tasks.await(client.process(InputImage.fromBitmap(image, 0)), 500, TimeUnit.MILLISECONDS)
    if (result.width != w || result.height != h) throw IllegalStateException("mask ${result.width}x${result.height} for ${w}x$h")
    val floats = result.buffer.apply { rewind() }.asFloatBuffer()
    val arr = mask?.takeIf { it.size == w * h } ?: FloatArray(w * h)
    floats.get(arr)
    mask = arr
    maskAt = now
  }

  private fun background(e: Effect, image: Bitmap, w: Int, h: Int) {
    when (e) {
      is Effect.Blur -> {
        val f = max(2, (e.radius * minOf(w, h)).roundToInt())
        val small = Bitmap.createScaledBitmap(image, max(1, w / f), max(1, h / f), true)
        val big = Bitmap.createScaledBitmap(small, w, h, true)
        big.getPixels(bg, 0, w, 0, 0, w, h)
        small.recycle()
        big.recycle()
      }
      is Effect.Scene -> {
        if (sceneFor !== e || scenePixels.size != w * h) {
          val img = e.image
          val s = max(w.toFloat() / img.width, h.toFloat() / img.height)
          val m = Matrix().apply {
            postScale(s, s)
            postTranslate((w - img.width * s) / 2f, (h - img.height * s) / 2f)
          }
          val canvasBmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
          Canvas(canvasBmp).drawBitmap(img, m, paint)
          scenePixels = IntArray(w * h)
          canvasBmp.getPixels(scenePixels, 0, w, 0, 0, w, h)
          canvasBmp.recycle()
          sceneFor = e
        }
        System.arraycopy(scenePixels, 0, bg, 0, w * h)
      }
    }
  }

  // Rolling average of the per-frame cost; trips after SLOW_FOR_MS over budget.
  private fun watch(t0: Long) {
    val now = SystemClock.elapsedRealtime()
    val ms = (now - t0).toDouble()
    avgMs = if (avgMs == 0.0) ms else avgMs * 0.8 + ms * 0.2
    if (now - armedAt < WARMUP_MS) return
    if (avgMs > BUDGET_MS) {
      if (slowSince == 0L) slowSince = now else if (now - slowSince >= SLOW_FOR_MS) trip("slow")
    } else {
      slowSince = 0L
    }
  }

  private fun trip(reason: String) {
    tripped = true
    onTrip?.invoke(reason)
  }
}
