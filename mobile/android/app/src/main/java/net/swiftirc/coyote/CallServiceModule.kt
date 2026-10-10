package net.swiftirc.coyote

import android.content.Intent
import android.util.Log
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

class CallServiceModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName() = "CallService"

  init {
    CallService.onLeave = {
      ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("CallServiceLeave", null)
    }
  }

  @ReactMethod
  fun start(room: String) {
    val intent = Intent(ctx, CallService::class.java).putExtra(CallService.EXTRA_ROOM, room)
    try {
      androidx.core.content.ContextCompat.startForegroundService(ctx, intent)
    } catch (e: Exception) {
      // Android 12+ throws ForegroundServiceStartNotAllowedException if the app went to
      // the background before this ran; uncaught, it would crash the app. The call
      // continues, just without the keep-alive notification.
      Log.w("CallService", "could not start the call service", e)
    }
  }

  @ReactMethod
  fun stop() {
    ctx.stopService(Intent(ctx, CallService::class.java))
  }

  // Required by NativeEventEmitter on Android.
  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Int) {}
}
