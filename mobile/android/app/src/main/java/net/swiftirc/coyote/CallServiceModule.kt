package net.swiftirc.coyote

import android.content.Intent
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
    androidx.core.content.ContextCompat.startForegroundService(ctx, intent)
  }

  @ReactMethod
  fun stop() {
    ctx.stopService(Intent(ctx, CallService::class.java))
  }

  // Required by NativeEventEmitter on Android.
  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Int) {}
}
