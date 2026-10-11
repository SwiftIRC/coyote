import UIKit
import React

// Owns the app's window. The iOS 27 SDK no longer launches apps without the
// UIScene lifecycle, so React Native starts here rather than in AppDelegate.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let app = UIApplication.shared.delegate as? AppDelegate,
          let factory = app.reactNativeFactory else { return }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    app.window = window

    factory.startReactNative(
      withModuleName: "Coyote",
      in: window,
      launchOptions: launchOptions(from: connectionOptions)
    )
  }

  // Links that arrive while the app is running.
  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let url = URLContexts.first?.url else { return }
    RCTLinkingManager.application(UIApplication.shared, open: url, options: [:])
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    RCTLinkingManager.application(UIApplication.shared, continue: userActivity,
                                  restorationHandler: { _ in })
  }

  // A link that cold-starts the app comes in connectionOptions, not launchOptions;
  // Linking.getInitialURL reads launchOptions, so translate it into those keys.
  private func launchOptions(from options: UIScene.ConnectionOptions) -> [UIApplication.LaunchOptionsKey: Any]? {
    if let url = options.urlContexts.first?.url {
      return [.url: url]
    }
    if let activity = options.userActivities.first(where: { $0.activityType == NSUserActivityTypeBrowsingWeb }) {
      return [.userActivityDictionary: [
        "UIApplicationLaunchOptionsUserActivityTypeKey": activity.activityType,
        "UIApplicationLaunchOptionsUserActivityKey": activity,
      ]]
    }
    return nil
  }
}
