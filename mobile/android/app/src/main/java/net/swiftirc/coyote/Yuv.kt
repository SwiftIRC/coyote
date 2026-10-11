package net.swiftirc.coyote

import org.webrtc.JavaI420Buffer
import org.webrtc.VideoFrame

// BT.601 limited-range conversions between I420 and packed ARGB ints, sized for
// the 640×360 frames the background effect works on.
object Yuv {
  fun i420ToArgb(src: VideoFrame.I420Buffer, out: IntArray) {
    val w = src.width
    val h = src.height
    val y = src.dataY
    val u = src.dataU
    val v = src.dataV
    val sy = src.strideY
    val su = src.strideU
    val sv = src.strideV
    for (row in 0 until h) {
      val yRow = row * sy
      val uRow = (row / 2) * su
      val vRow = (row / 2) * sv
      for (col in 0 until w) {
        val c = (y.get(yRow + col).toInt() and 0xff) - 16
        val d = (u.get(uRow + col / 2).toInt() and 0xff) - 128
        val e = (v.get(vRow + col / 2).toInt() and 0xff) - 128
        val r = clamp((298 * c + 409 * e + 128) shr 8)
        val g = clamp((298 * c - 100 * d - 208 * e + 128) shr 8)
        val b = clamp((298 * c + 516 * d + 128) shr 8)
        out[row * w + col] = (0xff shl 24) or (r shl 16) or (g shl 8) or b
      }
    }
  }

  fun argbToI420(src: IntArray, w: Int, h: Int, dst: JavaI420Buffer) {
    val y = dst.dataY
    val u = dst.dataU
    val v = dst.dataV
    for (row in 0 until h) {
      for (col in 0 until w) {
        val p = src[row * w + col]
        val r = (p shr 16) and 0xff
        val g = (p shr 8) and 0xff
        val b = p and 0xff
        y.put(row * dst.strideY + col, (((66 * r + 129 * g + 25 * b + 128) shr 8) + 16).toByte())
        if (row % 2 == 0 && col % 2 == 0) {
          u.put((row / 2) * dst.strideU + col / 2, (((-38 * r - 74 * g + 112 * b + 128) shr 8) + 128).toByte())
          v.put((row / 2) * dst.strideV + col / 2, (((112 * r - 94 * g - 18 * b + 128) shr 8) + 128).toByte())
        }
      }
    }
  }

  private fun clamp(x: Int) = if (x < 0) 0 else if (x > 255) 255 else x
}
