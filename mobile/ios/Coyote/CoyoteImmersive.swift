import UIKit
import React

// The app's root view controller. During a call it lets the home indicator fade
// when the screen isn't being touched. The status bar is hidden from JS (StatusBar).
class CoyoteRootViewController: UIViewController {
  static var homeIndicatorHidden = false

  override var prefersHomeIndicatorAutoHidden: Bool { Self.homeIndicatorHidden }
}

// Full screen during a call: the JS side of CoyoteRootViewController.
@objc(CoyoteImmersive)
class CoyoteImmersive: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { false }

  @objc(setImmersive:)
  func setImmersive(_ on: Bool) {
    DispatchQueue.main.async {
      CoyoteRootViewController.homeIndicatorHidden = on
      for scene in UIApplication.shared.connectedScenes {
        for window in (scene as? UIWindowScene)?.windows ?? [] {
          window.rootViewController?.setNeedsUpdateOfHomeIndicatorAutoHidden()
        }
      }
    }
  }
}
