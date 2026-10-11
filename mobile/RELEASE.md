# Building and releasing the Coyote apps

Claude maintains the code on Linux; builds are signed and shipped from a Mac.

## One-time setup (Mac)

- Xcode (current), CocoaPods (`sudo gem install cocoapods` or `brew install cocoapods`),
  Node 22 (`nvm use` in the repo root), JDK 17 and Android Studio (for its SDK).
- Apple Developer team with the App ID `net.swiftirc.coyote` and these capabilities:
  Associated Domains, Background Modes (Audio; Voice over IP).
- Play Console app `net.swiftirc.coyote` with Play App Signing enabled; keep your upload
  keystore outside the repo and reference it from `~/.gradle/gradle.properties`:

  ```
  COYOTE_UPLOAD_STORE_FILE=/Users/you/keys/coyote-upload.keystore
  COYOTE_UPLOAD_KEY_ALIAS=upload
  COYOTE_UPLOAD_STORE_PASSWORD=…
  COYOTE_UPLOAD_KEY_PASSWORD=…
  ```

  Without these properties `bundleRelease` produces an unsigned bundle that Play will
  reject; debug builds are unaffected.

- Server: set `WVC_APPLE_APP_ID=<TEAMID>.net.swiftirc.coyote`,
  `WVC_ANDROID_PACKAGE=net.swiftirc.coyote` and
  `WVC_ANDROID_CERT_SHA256=<Play Console → App integrity → App signing SHA-256>` so
  room links open the apps. The details are in the "Mobile app links" section of
  [docs/DEPLOY.md](../docs/DEPLOY.md#mobile-app-links).

## Version

Bump both in one commit before each release:
- iOS: `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` in `ios/Coyote.xcodeproj/project.pbxproj`.
- Android: `versionName` and `versionCode` in `android/app/build.gradle`.

## iOS → TestFlight

```bash
cd mobile && npm ci && bundle install && (cd ios && bundle exec pod install)
open ios/Coyote.xcworkspace
```

Select your team on the Coyote target (Signing & Capabilities), choose
"Any iOS Device", Product → Archive, then Distribute App → TestFlight & App Store.

## Android → Play internal testing

```bash
cd mobile && npm ci && cd android && ./gradlew bundleRelease
```

Upload `app/build/outputs/bundle/release/app-release.aab` to Play Console → Testing →
Internal testing.

## Before every release

Run `mobile/MANUAL-TEST.md` on both platforms.
