package net.swiftirc.coyote

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.oney.WebRTCModule.WebRTCModuleOptions
import com.oney.WebRTCModule.videoEffects.ProcessorProvider
import com.oney.WebRTCModule.videoEffects.VideoFrameProcessorFactoryInterface

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
          add(CallServicePackage())
          add(CoyoteSoundsPackage())
          add(CoyoteBackgroundPackage())
          add(CoyoteAudioRoutePackage())
          add(CoyotePipPackage())
          add(CoyoteImmersivePackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    // Screen sharing: react-native-webrtc starts its mediaProjection foreground service
    // only when asked. Android 14+ refuses to capture without one (SecurityException).
    WebRTCModuleOptions.getInstance().enableMediaProjectionService = true
    // The camera-frame hook for background effects (JS attaches it by this name).
    ProcessorProvider.addProcessor("coyote-background", VideoFrameProcessorFactoryInterface { BackgroundEngine })
    loadReactNative(this)
  }
}
