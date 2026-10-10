# Coyote mobile (iOS & Android)

React Native (bare) client for Coyote. Design:
`docs/superpowers/specs/2026-10-08-mobile-foundation-design.md`.

- `src/core/` — protocol and call logic, pure TypeScript, tested with Jest. Must not
  import React Native or native modules (ESLint enforces it).
- `src/shared/web.ts` — DOM-free modules imported straight from `internal/web/assets/lib`.
- `src/native/` — adapters for react-native-webrtc, CallKeep, InCallManager, storage,
  lifecycle and links. `src/ui/` — screens.

    nvm use
    cd mobile && npm ci
    npm test && npm run typecheck && npm run lint
    npx react-native run-android      # needs the Android SDK
    npx react-native run-ios          # Mac only

On Linux, `source mobile/android/env.sh` before running Gradle or
`react-native run-android`. It sets `JAVA_HOME` and `ANDROID_HOME` for the local JDK 17
and Android SDK; the file is git-ignored, so adjust the paths for your machine.

Releases: RELEASE.md. Device checklist: MANUAL-TEST.md.
