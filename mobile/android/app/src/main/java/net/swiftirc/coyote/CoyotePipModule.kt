package net.swiftirc.coyote

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

// The JS side of Pip: whether PiP is allowed, and its events.
class CoyotePipModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName() = "CoyotePip"

  init {
    Pip.attach(this, ctx)
  }

  @ReactMethod
  fun setPip(enabled: Boolean, micOn: Boolean, aspect: String) {
    Pip.set(enabled, micOn, aspect == "screen")
  }

  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Int) {}

  fun emit(event: String, key: String, value: Any) {
    if (!ctx.hasActiveReactInstance()) return
    val body = Arguments.createMap().apply {
      when (value) {
        is Boolean -> putBoolean(key, value)
        else -> putString(key, value.toString())
      }
    }
    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(event, body)
  }

  override fun invalidate() {
    Pip.detach(this)
    super.invalidate()
  }
}
