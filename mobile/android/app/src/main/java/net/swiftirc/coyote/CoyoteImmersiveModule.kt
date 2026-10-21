package net.swiftirc.coyote

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

// The JS side of Immersive.
class CoyoteImmersiveModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName() = "CoyoteImmersive"

  @ReactMethod
  fun setImmersive(enabled: Boolean) {
    Immersive.set(ctx.currentActivity, enabled)
  }
}
