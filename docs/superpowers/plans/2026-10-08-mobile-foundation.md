# Mobile Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Native iOS and Android Coyote apps (React Native) that join a room from a
`vc.swiftirc.net` link, carry a two-way audio/video call, and keep it alive with the
screen locked or the app in the background.

**Architecture:** A bare React Native app in `mobile/`. All protocol behaviour lives
in `mobile/src/core/` as pure TypeScript with its WebSocket, RTCPeerConnection,
media, timers and system-call integration injected, so it is tested with Jest on
Linux. `mobile/src/native/` adapts react-native-webrtc, CallKeep, InCallManager,
AsyncStorage, AppState/NetInfo and Linking to those injected ports; `mobile/src/ui/`
renders. DOM-free web-client modules are imported from `internal/web/assets/lib/`
through Metro `watchFolders`. The Go server gains only two `.well-known` routes.

**Tech Stack:** Go 1.26 (server); React Native 0.87.1 (bare, New Architecture,
Hermes), TypeScript, Jest; react-native-webrtc 124.0.8, react-native-callkeep 4.3.16,
react-native-incall-manager 4.3.0, @react-navigation/native 7 + native-stack 7,
@react-native-async-storage/async-storage 3, @react-native-community/netinfo 12,
js-sha256; Kotlin (one Android foreground service); Node 22 (`.nvmrc`).

**Spec:** `docs/superpowers/specs/2026-10-08-mobile-foundation-design.md`

## Global Constraints

- Default host is exactly `vc.swiftirc.net`; it is the only Universal Link / App Link domain.
- Bundle ID / applicationId is exactly `net.swiftirc.coyote`; app display name is exactly `Coyote`.
- Room slug rule (server's): `^[a-z0-9-]{1,32}$` after lowercasing.
- No wire-protocol change. Frames are `{type, ...fields}` JSON, encoded with the shared `protocol.js`.
- `RTCPeerConnection` is created with **no ICE servers**.
- The SFU accepts only **VP8** video and **Opus** audio; VP8 must be first in the video codec preferences.
- The client is the **polite** peer; collisions use implicit rollback (bare `setRemoteDescription(offer)`), never `{type:"rollback"}`.
- Camera turns **off** in the background on both platforms and back on when foregrounded if it was on.
- `core/` must not import `react-native`, any `react-native-*` package, or any `@react-native*` package. Enforced by an ESLint rule (Task 2).
- `internal/web` stays no-build, no-npm: nothing in `internal/web` gains a dependency, and the web client is not modified.
- `mobile/node_modules`, `mobile/ios/Pods`, `mobile/android/.gradle`, build outputs and any keystore are git-ignored; `mobile/` is excluded from the Docker build context.
- Commit messages carry **no** `Co-Authored-By` trailer (maintainer preference). Never `git push`.
- Every task that touches iOS-only native code or config ends by listing the `mobile/MANUAL-TEST.md` items the maintainer must run on a Mac/device; Claude cannot compile iOS.

## Review Focus

1. **A reconnect after frames were queued while the socket was down.** A stale `offer`/`candidate` from the dead session must never reach the new server session ahead of `join` (the server rejects any first frame that is not `join` with `protocol`). Expected: the queue is dropped on an unexpected close and `join` is always the first frame on every open — pinned in Task 5.
2. **CallKit mute echo.** Muting in-app calls `setMuted` on CallKit, which reports back a mute action. Expected: no loop and no duplicate `media-state`; the echo is a no-op — pinned in Task 10.
3. **Background → foreground while the socket silently died.** Expected: foregrounding reconnects immediately (backoff reset) and the camera comes back on only if it was on before backgrounding, not if the user turned it off — pinned in Task 10.
4. **A link opened with mixed case, trailing slash, query string, or a path that is not a room** (`/api/rooms/x`, `/ws/x`, `/a/b`). Expected: case and trailing slash are normalised; anything not a single valid slug segment yields "not a room" and the app shows Home — pinned in Task 4.
5. **Mic or camera permission denied.** Expected: the join still goes through with that device off, `join.mic`/`join.camera` say false, and toggling the device on later retries acquisition and shows a notice on failure instead of throwing — pinned in Task 10.

---

## File structure

```
internal/config/config.go               + AppleAppID, AndroidPackage, AndroidCertSHA256
internal/config/config_test.go          + tests for the three new settings
internal/server/wellknown.go            NEW: AASA + assetlinks handlers
internal/server/wellknown_test.go       NEW
internal/server/server.go               + two routes
README.md, docs/DEPLOY.md, deploy/k8s/deployment.yaml   docs/env for the new settings
.dockerignore, .gitignore               + mobile/ entries

mobile/
  package.json, .nvmrc -> ../.nvmrc (not a symlink; npm reads the root one)
  babel.config.js, metro.config.js, jest.config.js, tsconfig.json, .eslintrc.js
  index.js, app.json
  src/shared/web.ts          re-exports from internal/web/assets/lib
  src/core/types.ts          structural types for WebRTC objects + protocol frames
  src/core/link.ts           URL / room-name parsing
  src/core/token.ts          unverified nick from a #t= token
  src/core/gravatar.ts       SHA-256 email hash
  src/core/api.ts            /api/rooms, /api/invite, /api/version peeks
  src/core/errors.ts         join-error wording
  src/core/grid.ts           column count for the tile grid
  src/core/signaling.ts      WebSocket client
  src/core/codecs.ts         VP8-first codec ordering
  src/core/peer.ts           RTCPeerConnection controller
  src/core/roster.ts         participant store
  src/core/call.ts           call controller
  src/core/recent.ts         recent-rooms list logic
  src/core/uuid.ts           v4 UUIDs from an injected random source
  src/core/audioRoutes.ts    audio-route cycling and labels
  src/core/systemCallRouter.ts  routes CallKit/ConnectionService events to the active call
  src/native/webrtc.ts       react-native-webrtc factories + getUserMedia
  src/native/systemCall.ts   CallKeep + Android foreground service
  src/native/audioRoute.ts   InCallManager
  src/native/lifecycle.ts    AppState + NetInfo subscriptions
  src/native/storage.ts      AsyncStorage prefs + recent rooms
  src/native/linking.ts      initial URL + url events
  src/native/permissions.ts  Android runtime permissions
  src/native/callFactory.ts  builds a Call with all native ports
  src/ui/App.tsx, src/ui/CallContext.tsx, src/ui/navigation.ts, src/ui/theme.ts
  src/ui/screens/Home.tsx, PreJoin.tsx, Call.tsx
  src/ui/components/Tile.tsx, SelfView.tsx, Controls.tsx, Banner.tsx, Avatar.tsx
  test/*.test.ts             Jest, core only
  test/fakes.ts              FakeSocket, FakePC, FakeTrack, fake timers helpers
  android/app/src/main/java/net/swiftirc/coyote/CallService.kt        NEW foreground service
  android/app/src/main/java/net/swiftirc/coyote/CallServiceModule.kt  NEW RN module
  android/app/src/main/java/net/swiftirc/coyote/CallServicePackage.kt NEW
  MANUAL-TEST.md, RELEASE.md, README.md
```

---

### Task 1: Server — `.well-known` routes for Universal Links and App Links

**Files:**
- Modify: `internal/config/config.go:12-30` (struct), `:63-72` (flags)
- Modify: `internal/config/config_test.go` (append)
- Create: `internal/server/wellknown.go`
- Create: `internal/server/wellknown_test.go`
- Modify: `internal/server/server.go:98` (routes)
- Modify: `README.md` (flags table), `docs/DEPLOY.md`, `deploy/k8s/deployment.yaml`

**Interfaces:**
- Produces: `config.Config.AppleAppID string`, `AndroidPackage string`, `AndroidCertSHA256 []string`; routes `GET /.well-known/apple-app-site-association`, `GET /.well-known/assetlinks.json`.

- [ ] **Step 1: Write the failing config test** — append to `internal/config/config_test.go`:

```go
func TestAppLinkSettings(t *testing.T) {
	env := map[string]string{
		"WVC_APPLE_APP_ID":        "ABCDE12345.net.swiftirc.coyote",
		"WVC_ANDROID_PACKAGE":     "net.swiftirc.coyote",
		"WVC_ANDROID_CERT_SHA256": "AA:BB, CC:DD ,",
	}
	cfg, err := Load(nil, func(k string) string { return env[k] })
	if err != nil {
		t.Fatal(err)
	}
	if cfg.AppleAppID != "ABCDE12345.net.swiftirc.coyote" {
		t.Errorf("AppleAppID = %q", cfg.AppleAppID)
	}
	if cfg.AndroidPackage != "net.swiftirc.coyote" {
		t.Errorf("AndroidPackage = %q", cfg.AndroidPackage)
	}
	if len(cfg.AndroidCertSHA256) != 2 || cfg.AndroidCertSHA256[0] != "AA:BB" || cfg.AndroidCertSHA256[1] != "CC:DD" {
		t.Errorf("AndroidCertSHA256 = %q, want [AA:BB CC:DD]", cfg.AndroidCertSHA256)
	}
}

func TestAppLinkSettingsDefaultEmpty(t *testing.T) {
	cfg, err := Load(nil, func(string) string { return "" })
	if err != nil {
		t.Fatal(err)
	}
	if cfg.AppleAppID != "" || cfg.AndroidPackage != "" || len(cfg.AndroidCertSHA256) != 0 {
		t.Errorf("app-link settings should default empty: %+v", cfg)
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `go test ./internal/config/ -run AppLink`
Expected: FAIL — `cfg.AppleAppID undefined`.

- [ ] **Step 3: Implement** — in `internal/config/config.go` add to the struct after `TrustProxy`:

```go
	// Mobile app links (Universal Links / Android App Links). Each .well-known
	// document is served only when its settings are present.
	AppleAppID        string   // "<TEAMID>.<bundle id>"
	AndroidPackage    string   // applicationId
	AndroidCertSHA256 []string // signing-cert SHA-256 fingerprints, "AA:BB:..." form
```

Add `"strings"` to the imports, and after the `trust-proxy` flag line:

```go
	fs.StringVar(&cfg.AppleAppID, "apple-app-id", str("WVC_APPLE_APP_ID", ""), "iOS app id <TEAMID>.<bundle> for Universal Links (empty = no AASA)")
	fs.StringVar(&cfg.AndroidPackage, "android-package", str("WVC_ANDROID_PACKAGE", ""), "Android applicationId for App Links (empty = no assetlinks)")
	androidCerts := fs.String("android-cert-sha256", str("WVC_ANDROID_CERT_SHA256", ""), "comma-separated Android signing-cert SHA-256 fingerprints")
```

and after `fs.Parse` succeeds (before the log-level parse):

```go
	for _, c := range strings.Split(*androidCerts, ",") {
		if c = strings.TrimSpace(c); c != "" {
			cfg.AndroidCertSHA256 = append(cfg.AndroidCertSHA256, c)
		}
	}
```

- [ ] **Step 4: Run config tests**

Run: `go test ./internal/config/`
Expected: PASS.

- [ ] **Step 5: Write the failing server test** — `internal/server/wellknown_test.go`:

```go
package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/SwiftIRC/coyote/internal/config"
)

func wellKnownServer(t *testing.T, cfg config.Config) *httptest.Server {
	t.Helper()
	h := &Hub{cfg: cfg}
	mux := http.NewServeMux()
	h.registerWellKnown(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func TestAASAServed(t *testing.T) {
	srv := wellKnownServer(t, config.Config{AppleAppID: "T1.net.swiftirc.coyote"})
	resp, err := http.Get(srv.URL + "/.well-known/apple-app-site-association")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 || resp.Header.Get("Content-Type") != "application/json" {
		t.Fatalf("status %d type %q", resp.StatusCode, resp.Header.Get("Content-Type"))
	}
	var doc struct {
		Applinks struct {
			Details []struct {
				AppIDs     []string         `json:"appIDs"`
				Components []map[string]any `json:"components"`
			} `json:"details"`
		} `json:"applinks"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&doc); err != nil {
		t.Fatal(err)
	}
	d := doc.Applinks.Details
	if len(d) != 1 || len(d[0].AppIDs) != 1 || d[0].AppIDs[0] != "T1.net.swiftirc.coyote" {
		t.Fatalf("appIDs wrong: %+v", d)
	}
	want := []string{"/api/*", "/ws/*", "/.well-known/*", "/*"}
	if len(d[0].Components) != len(want) {
		t.Fatalf("components = %+v", d[0].Components)
	}
	for i, w := range want {
		c := d[0].Components[i]
		if c["/"] != w {
			t.Errorf("component %d path = %v, want %s", i, c["/"], w)
		}
		excluded, _ := c["exclude"].(bool)
		if excluded != (i < 3) {
			t.Errorf("component %d exclude = %v", i, c["exclude"])
		}
	}
}

func TestAssetLinksServed(t *testing.T) {
	srv := wellKnownServer(t, config.Config{AndroidPackage: "net.swiftirc.coyote", AndroidCertSHA256: []string{"AA:BB", "CC:DD"}})
	resp, err := http.Get(srv.URL + "/.well-known/assetlinks.json")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 || resp.Header.Get("Content-Type") != "application/json" {
		t.Fatalf("status %d type %q", resp.StatusCode, resp.Header.Get("Content-Type"))
	}
	var doc []struct {
		Relation []string `json:"relation"`
		Target   struct {
			Namespace   string   `json:"namespace"`
			PackageName string   `json:"package_name"`
			Certs       []string `json:"sha256_cert_fingerprints"`
		} `json:"target"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&doc); err != nil {
		t.Fatal(err)
	}
	if len(doc) != 1 || doc[0].Relation[0] != "delegate_permission/common.handle_all_urls" ||
		doc[0].Target.Namespace != "android_app" || doc[0].Target.PackageName != "net.swiftirc.coyote" ||
		len(doc[0].Target.Certs) != 2 {
		t.Fatalf("assetlinks wrong: %+v", doc)
	}
}

func TestWellKnownNotFoundWhenUnconfigured(t *testing.T) {
	srv := wellKnownServer(t, config.Config{AndroidPackage: "net.swiftirc.coyote"}) // no certs
	for _, p := range []string{"/.well-known/apple-app-site-association", "/.well-known/assetlinks.json"} {
		resp, err := http.Get(srv.URL + p)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != 404 {
			t.Errorf("%s: status %d, want 404", p, resp.StatusCode)
		}
	}
}

func TestWellKnownRoutedByHub(t *testing.T) {
	// The real router must send these paths to the handlers, not the static catch-all.
	_, srv := newTestHub(t, "", true)
	resp, err := http.Get(srv.URL + "/.well-known/assetlinks.json")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 404 || resp.Header.Get("Content-Type") == "text/html; charset=utf-8" {
		t.Fatalf("unconfigured hub: status %d type %q, want a bare 404", resp.StatusCode, resp.Header.Get("Content-Type"))
	}
}
```

- [ ] **Step 6: Run it to verify it fails**

Run: `go test ./internal/server/ -run WellKnown\|AASA\|AssetLinks`
Expected: FAIL — `h.registerWellKnown undefined`.

- [ ] **Step 7: Implement** — `internal/server/wellknown.go`:

```go
package server

import (
	"encoding/json"
	"net/http"
)

// registerWellKnown adds the two documents that let the mobile apps claim this
// host's room links: Apple's apple-app-site-association (Universal Links) and
// Android's assetlinks.json (App Links). Each is 404 until configured, so a
// deployment without apps is unchanged.
func (h *Hub) registerWellKnown(mux *http.ServeMux) {
	mux.HandleFunc("GET /.well-known/apple-app-site-association", h.handleAASA)
	mux.HandleFunc("GET /.well-known/assetlinks.json", h.handleAssetLinks)
}

func (h *Hub) handleAASA(w http.ResponseWriter, r *http.Request) {
	if h.cfg.AppleAppID == "" {
		http.NotFound(w, r)
		return
	}
	type component struct {
		Path    string `json:"/"`
		Exclude bool   `json:"exclude,omitempty"`
	}
	doc := map[string]any{
		"applinks": map[string]any{
			"details": []map[string]any{{
				"appIDs": []string{h.cfg.AppleAppID},
				// Order matters: Apple applies the first matching component.
				"components": []component{
					{Path: "/api/*", Exclude: true},
					{Path: "/ws/*", Exclude: true},
					{Path: "/.well-known/*", Exclude: true},
					{Path: "/*"},
				},
			}},
		},
	}
	writeJSON(w, doc)
}

func (h *Hub) handleAssetLinks(w http.ResponseWriter, r *http.Request) {
	if h.cfg.AndroidPackage == "" || len(h.cfg.AndroidCertSHA256) == 0 {
		http.NotFound(w, r)
		return
	}
	doc := []map[string]any{{
		"relation": []string{"delegate_permission/common.handle_all_urls"},
		"target": map[string]any{
			"namespace":                "android_app",
			"package_name":             h.cfg.AndroidPackage,
			"sha256_cert_fingerprints": h.cfg.AndroidCertSHA256,
		},
	}}
	writeJSON(w, doc)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
```

In `internal/server/server.go` `Routes()`, after the `/api/invite/{id}` line add:

```go
	h.registerWellKnown(mux)
```

- [ ] **Step 8: Run the server tests**

Run: `go test -race ./internal/server/ ./internal/config/ && go vet ./...`
Expected: PASS.

- [ ] **Step 9: Document** —
  - `README.md` "Key flags" table, three rows after `-trust-proxy`:

```
| `-apple-app-id` | `WVC_APPLE_APP_ID` | _(empty)_ | iOS `<TEAMID>.<bundle id>`; serves `/.well-known/apple-app-site-association` so room links open the app |
| `-android-package` | `WVC_ANDROID_PACKAGE` | _(empty)_ | Android applicationId for `/.well-known/assetlinks.json` |
| `-android-cert-sha256` | `WVC_ANDROID_CERT_SHA256` | _(empty)_ | Comma-separated signing-cert SHA-256 fingerprints for assetlinks (both settings needed) |
```

  - `docs/DEPLOY.md`: append a section `## Mobile app links` saying: set the three variables to have room links open the Coyote apps; values for the official apps are `WVC_APPLE_APP_ID=<TEAMID>.net.swiftirc.coyote`, `WVC_ANDROID_PACKAGE=net.swiftirc.coyote`, `WVC_ANDROID_CERT_SHA256=<Play app-signing cert SHA-256, from Play Console → App integrity>`; the reverse proxy must pass `/.well-known/*` through to coyote unmodified and without redirects (Apple fetches it via its CDN and refuses redirects); verify with `curl -sI https://vc.swiftirc.net/.well-known/apple-app-site-association`.
  - `deploy/k8s/deployment.yaml`: after the `WVC_SECRET` block add the three variables commented out:

```yaml
            # Mobile app links — uncomment once the apps are published.
            # - name: WVC_APPLE_APP_ID
            #   value: "<TEAMID>.net.swiftirc.coyote"
            # - name: WVC_ANDROID_PACKAGE
            #   value: "net.swiftirc.coyote"
            # - name: WVC_ANDROID_CERT_SHA256
            #   value: "<Play app-signing SHA-256>"
```

- [ ] **Step 10: Commit**

```bash
git add internal/config internal/server/wellknown.go internal/server/wellknown_test.go internal/server/server.go README.md docs/DEPLOY.md deploy/k8s/deployment.yaml
git commit -m "feat(server): serve .well-known app-link documents for the mobile apps"
```

---

### Task 2: Scaffold `mobile/` with TypeScript, Jest, ESLint and the shared web lib

**Files:**
- Create: `mobile/` via the React Native CLI, then edit `mobile/package.json`, `mobile/metro.config.js`, `mobile/babel.config.js`, `mobile/jest.config.js`, `mobile/tsconfig.json`, `mobile/.eslintrc.js`, `mobile/app.json`
- Create: `mobile/src/shared/web.ts`, `mobile/test/shared.test.ts`
- Modify: `.gitignore`, `.dockerignore`

**Interfaces:**
- Produces: `mobile/src/shared/web.ts` exporting `encode, decode, parseInvite, parseToken, backoffDelay, handleRemoteOffer, serverErrorDisposition, qualityTier, encodingCaps, QUALITY_TIERS, stacksNarrow, avatarFor, gravatarUrl, IRC_AVATAR_COLORS`; npm scripts `test`, `typecheck`, `lint`.

- [ ] **Step 1: Generate the project** (from the repo root, Node 22):

```bash
source ~/.nvm/nvm.sh && nvm use
npx --yes @react-native-community/cli@20.2.0 init Coyote --version 0.87.1 --directory mobile --package-name net.swiftirc.coyote --skip-git-init --install-pods false
```

Expected: `mobile/` containing `App.tsx`, `index.js`, `ios/`, `android/`, `package.json`. If the CLI rejects `--package-name`, run without it and in Step 2 rename the Android package by editing `android/app/build.gradle` (`namespace` and `applicationId` → `net.swiftirc.coyote`) and moving `android/app/src/main/java/com/coyote/` to `android/app/src/main/java/net/swiftirc/coyote/` with its `package` lines updated; iOS bundle id is set in Task 12.

- [ ] **Step 2: Remove the template app and set scripts** — delete `mobile/App.tsx` and `mobile/__tests__/`. Edit `mobile/index.js` to:

```js
import { AppRegistry } from "react-native";
import App from "./src/ui/App";
import { name as appName } from "./app.json";

AppRegistry.registerComponent(appName, () => App);
```

Create a placeholder `mobile/src/ui/App.tsx` (replaced in Task 14):

```tsx
import React from "react";
import { Text } from "react-native";

export default function App() {
  return <Text>Coyote</Text>;
}
```

In `mobile/package.json` set `"name": "coyote-mobile"`, `"private": true`, and `scripts`:

```json
"scripts": {
  "android": "react-native run-android",
  "ios": "react-native run-ios",
  "start": "react-native start",
  "test": "jest",
  "typecheck": "tsc --noEmit",
  "lint": "eslint src test"
}
```

- [ ] **Step 3: Let Metro, Babel, Jest and TS see the web lib** —

`mobile/metro.config.js`:

```js
const path = require("path");
const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");

// The DOM-free modules of the web client are imported directly (see src/shared/web.ts)
// so the two clients share one copy of protocol, negotiation and backoff logic.
const webLib = path.resolve(__dirname, "../internal/web/assets/lib");

module.exports = mergeConfig(getDefaultConfig(__dirname), {
  watchFolders: [webLib],
  resolver: {
    // Files under watchFolders resolve packages from the app's node_modules.
    nodeModulesPaths: [path.resolve(__dirname, "node_modules")],
  },
});
```

`mobile/jest.config.js`:

```js
module.exports = {
  preset: "react-native",
  roots: ["<rootDir>/test"],
  testMatch: ["**/*.test.ts"],
  // Transform the web lib (outside rootDir) with this project's babel config.
  transform: { "^.+\\.[jt]sx?$": ["babel-jest", { configFile: require.resolve("./babel.config.js") }] },
  transformIgnorePatterns: ["node_modules/(?!(react-native|@react-native|js-sha256)/)"],
};
```

`mobile/tsconfig.json`:

```json
{
  "extends": "@react-native/typescript-config",
  "compilerOptions": {
    "allowJs": true,
    "checkJs": false,
    "strict": true,
    "noEmit": true
  },
  "include": ["src", "test", "index.js"]
}
```

`mobile/.eslintrc.js` — keep the generated config and add the core-purity rule:

```js
module.exports = {
  root: true,
  extends: "@react-native",
  overrides: [
    {
      files: ["src/core/**/*.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              { group: ["react-native", "react-native-*", "@react-native*", "react", "../native/*", "../ui/*"],
                message: "core/ is pure: inject platform objects instead." },
            ],
          },
        ],
      },
    },
  ],
};
```

(If the generated project uses flat config `eslint.config.js` instead of `.eslintrc.js`, put the same `files`/`rules` object into its exported array.)

- [ ] **Step 4: Write the failing shared-lib test** — `mobile/test/shared.test.ts`:

```ts
import {
  encode, decode, parseInvite, parseToken, backoffDelay, handleRemoteOffer,
  serverErrorDisposition, qualityTier, encodingCaps, stacksNarrow, avatarFor, gravatarUrl,
} from "../src/shared/web";

test("the web client's pure modules load under Jest", () => {
  expect(decode(encode("join", { name: "a" }))).toEqual({ type: "join", name: "a" });
  expect(parseInvite("#i=abc")).toBe("abc");
  expect(parseToken("#t=x.y")).toBe("x.y");
  expect(backoffDelay(0)).toBe(500);
  expect(backoffDelay(10)).toBe(10000);
  expect(handleRemoteOffer({ makingOffer: true, signalingState: "stable" }).action).toBe("rollback-then-answer");
  expect(serverErrorDisposition({ code: "x", message: "m", inCall: false }).fatal).toBe(true);
  expect(encodingCaps(qualityTier("low"), 720).scaleResolutionDownBy).toBe(2);
  expect(stacksNarrow(400, 800, 3)).toBe(true);
  expect(avatarFor("bob").initial).toBe("B");
  expect(gravatarUrl("nope", 10)).toBe("");
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `cd mobile && npx jest test/shared.test.ts`
Expected: FAIL — cannot find module `../src/shared/web`.

- [ ] **Step 6: Implement** `mobile/src/shared/web.ts`:

```ts
// The browser client's DOM-free modules, shared rather than copied so the two
// clients cannot drift on wire encoding, negotiation, backoff or error handling.
// Only import modules listed as pure in the Foundation spec; anything touching the
// DOM, storage or browser media APIs must not be added here.
export { encode, decode, parseInvite, parseToken } from "../../../internal/web/assets/lib/protocol.js";
export { backoffDelay } from "../../../internal/web/assets/lib/backoff.js";
export { handleRemoteOffer } from "../../../internal/web/assets/lib/negotiation.js";
export { serverErrorDisposition } from "../../../internal/web/assets/lib/serverError.js";
export { QUALITY_TIERS, qualityTier, encodingCaps } from "../../../internal/web/assets/lib/quality.js";
export { stacksNarrow } from "../../../internal/web/assets/lib/gridLayout.js";
// avatar.js also has DOM helpers, but only inside functions we never call.
export { avatarFor, gravatarUrl, IRC_AVATAR_COLORS } from "../../../internal/web/assets/lib/avatar.js";
```

- [ ] **Step 7: Run tests, typecheck, lint**

Run: `cd mobile && npm test && npm run typecheck && npm run lint`
Expected: all PASS. If Jest reports "SyntaxError: Cannot use import statement outside a module" for a file under `internal/web`, the transform did not reach it: confirm `jest.config.js` passes `configFile` to babel-jest as above.

- [ ] **Step 8: Ignore files** — append to `.gitignore`:

```
# Mobile (React Native) build products and secrets
mobile/node_modules/
mobile/ios/Pods/
mobile/ios/build/
mobile/android/.gradle/
mobile/android/app/build/
mobile/android/build/
mobile/android/local.properties
mobile/**/*.keystore
!mobile/android/app/debug.keystore
mobile/.bundle/
mobile/vendor/
```

Append to `.dockerignore` (under the "Not part of the server image" block):

```
mobile/
```

Verify `git status --short mobile | head` shows no `node_modules`/`Pods` entries.

- [ ] **Step 9: Commit**

```bash
git add .gitignore .dockerignore mobile
git commit -m "feat(mobile): scaffold the React Native app with the shared web lib"
```

---
### Task 3: Native dependencies, platform configuration, first device builds

This task comes before any app code on purpose: all three native libraries are
legacy (non-codegen) modules running through React Native's New Architecture
interop layer, and that is the plan's largest technical risk. It is retired here,
with an empty app, before anything depends on it.

**Files:**
- Modify: `mobile/package.json` (dependencies)
- Modify: `mobile/android/app/src/main/AndroidManifest.xml`
- Create: `mobile/android/app/src/main/java/net/swiftirc/coyote/CallService.kt`, `CallServiceModule.kt`, `CallServicePackage.kt`
- Modify: `mobile/android/app/src/main/java/net/swiftirc/coyote/MainApplication.kt` (register package)
- Modify: `mobile/ios/Coyote/Info.plist`, `mobile/ios/Coyote/AppDelegate.swift`, `mobile/ios/Coyote.xcodeproj/project.pbxproj`
- Create: `mobile/ios/Coyote/Coyote.entitlements`

**Interfaces:**
- Produces: native module `CallService` with `start(room: string): void`, `stop(): void`, and device event `"CallServiceLeave"` (no payload), consumed by Task 12.

- [ ] **Step 1: Install a JDK and the Android SDK in the home directory (no sudo)**

```bash
mkdir -p ~/.local/jdk17 && curl -fsSL "https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse" | tar -xz -C ~/.local/jdk17 --strip-components=1
export JAVA_HOME=~/.local/jdk17 PATH=~/.local/jdk17/bin:$PATH
mkdir -p ~/Android/Sdk/cmdline-tools && cd ~/Android/Sdk/cmdline-tools
curl -fsSLo tools.zip "https://dl.google.com/android/repo/commandlinetools-linux-13114758_latest.zip" && unzip -q tools.zip && mv cmdline-tools latest && rm tools.zip
export ANDROID_HOME=~/Android/Sdk PATH=~/Android/Sdk/cmdline-tools/latest/bin:~/Android/Sdk/platform-tools:$PATH
yes | sdkmanager --licenses >/dev/null
grep -E "compileSdkVersion|buildToolsVersion|ndkVersion" ~/Workspace/webrtc-chat/mobile/android/build.gradle
```

Then install exactly the versions that grep printed, e.g.
`sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;27.1.12297006"`.
If the commandlinetools URL 404s, take the current "Command line tools only" Linux link
from https://developer.android.com/studio#command-line-tools-only. Put the two `export`
lines (JAVA_HOME/ANDROID_HOME and PATH) in `mobile/android/env.sh` — **not** committed;
add `mobile/android/env.sh` to `.gitignore` — and `source` it before Gradle commands.

- [ ] **Step 2: Add dependencies**

```bash
cd mobile
npm install react-native-webrtc@124.0.8 react-native-callkeep@4.3.16 react-native-incall-manager@4.3.0 \
  @react-navigation/native@7 @react-navigation/native-stack@7 react-native-screens react-native-safe-area-context \
  @react-native-async-storage/async-storage@3 @react-native-community/netinfo@12 js-sha256@0.11.1
```

- [ ] **Step 3: Android manifest** — in `mobile/android/app/src/main/AndroidManifest.xml`, inside `<manifest>` before `<application>`:

```xml
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.MANAGE_OWN_CALLS" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_PHONE_CALL" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />
    <uses-feature android:name="android.hardware.camera" android:required="false" />
```

Inside `<application>`:

```xml
      <service
        android:name=".CallService"
        android:exported="false"
        android:stopWithTask="true"
        android:foregroundServiceType="phoneCall|microphone" />
      <service
        android:name="io.wazo.callkeep.VoiceConnectionService"
        android:label="Coyote"
        android:permission="android.permission.BIND_TELECOM_CONNECTION_SERVICE"
        android:foregroundServiceType="phoneCall|microphone"
        android:exported="true">
        <intent-filter>
          <action android:name="android.telecom.ConnectionService" />
        </intent-filter>
      </service>
```

Inside the existing `MainActivity` `<activity>` (keep its `launchMode="singleTask"`), add:

```xml
        <intent-filter android:autoVerify="true">
          <action android:name="android.intent.action.VIEW" />
          <category android:name="android.intent.category.DEFAULT" />
          <category android:name="android.intent.category.BROWSABLE" />
          <data android:scheme="https" android:host="vc.swiftirc.net" />
        </intent-filter>
```

The service type is `phoneCall|microphone`, not the spec's `microphone|camera`: the
camera is always off in the background (a spec decision), so the camera type buys
nothing, and starting a camera-typed service throws if the camera permission was
denied. `phoneCall` is allowed for a self-managed calling app holding
`MANAGE_OWN_CALLS`, and keeps a listen-only (mic-denied) call alive too.

- [ ] **Step 4: Android foreground service** — `CallService.kt`:

```kotlin
package net.swiftirc.coyote

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

// Keeps the process (and so the WebRTC call) alive while the app is in the
// background, with an ongoing "In call" notification. Started on join, stopped on
// leave/kick/ban/fatal error by CallServiceModule.
class CallService : Service() {
  companion object {
    const val CHANNEL_ID = "call"
    const val NOTIFICATION_ID = 4201
    const val ACTION_LEAVE = "net.swiftirc.coyote.LEAVE"
    const val EXTRA_ROOM = "room"
    // Set by CallServiceModule; invoked when the notification's Leave is tapped.
    @Volatile var onLeave: (() -> Unit)? = null
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_LEAVE) {
      onLeave?.invoke()
      return START_NOT_STICKY
    }
    val room = intent?.getStringExtra(EXTRA_ROOM) ?: ""
    ensureChannel()
    val launch = packageManager.getLaunchIntentForPackage(packageName)!!
      .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
    val open = PendingIntent.getActivity(this, 0, launch,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val leave = PendingIntent.getService(this, 1,
      Intent(this, CallService::class.java).setAction(ACTION_LEAVE), PendingIntent.FLAG_IMMUTABLE)
    val notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle("In call: #$room")
      .setContentText("Tap to return to the call")
      .setOngoing(true)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setContentIntent(open)
      .addAction(0, "Leave", leave)
      .build()
    var types = 0
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      types = ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL
      if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
        types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
      }
    }
    ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, types)
    return START_NOT_STICKY
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = getSystemService(NotificationManager::class.java)
    if (nm.getNotificationChannel(CHANNEL_ID) == null) {
      nm.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Ongoing call", NotificationManager.IMPORTANCE_LOW))
    }
  }
}
```

`CallServiceModule.kt`:

```kotlin
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
```

`CallServicePackage.kt`:

```kotlin
package net.swiftirc.coyote

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class CallServicePackage : ReactPackage {
  override fun createNativeModules(ctx: ReactApplicationContext): List<NativeModule> = listOf(CallServiceModule(ctx))
  override fun createViewManagers(ctx: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
```

In `MainApplication.kt`, in `getPackages()`, add to the list returned by
`PackageList(this).packages` (the template has a comment showing where):
`add(CallServicePackage())`.

- [ ] **Step 5: Android debug build**

```bash
cd mobile/android && source env.sh && ./gradlew assembleDebug
```

Expected: `BUILD SUCCESSFUL`, `app/build/outputs/apk/debug/app-debug.apk` exists. A
failure naming react-native-webrtc / callkeep / incall-manager and "new architecture"
or "TurboModule" is the interop risk materialising: stop and report it with the
error rather than working around it.

- [ ] **Step 6: iOS configuration** —

`mobile/ios/Coyote/Info.plist`, add inside the top-level `<dict>`:

```xml
	<key>NSCameraUsageDescription</key>
	<string>Coyote uses the camera so others in the call can see you.</string>
	<key>NSMicrophoneUsageDescription</key>
	<string>Coyote uses the microphone so others in the call can hear you.</string>
	<key>NSBluetoothAlwaysUsageDescription</key>
	<string>Coyote uses Bluetooth to route call audio to your headset.</string>
	<key>UIBackgroundModes</key>
	<array>
		<string>audio</string>
		<string>voip</string>
	</array>
```

`mobile/ios/Coyote/Coyote.entitlements`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.developer.associated-domains</key>
	<array>
		<string>applinks:vc.swiftirc.net</string>
	</array>
</dict>
</plist>
```

In `mobile/ios/Coyote.xcodeproj/project.pbxproj`, in both the Debug and Release
`XCBuildConfiguration` blocks of the **Coyote** target (the ones containing
`INFOPLIST_FILE = Coyote/Info.plist;`):
- set `PRODUCT_BUNDLE_IDENTIFIER = net.swiftirc.coyote;`
- add `CODE_SIGN_ENTITLEMENTS = Coyote/Coyote.entitlements;`

Verify: `grep -c "net.swiftirc.coyote;" mobile/ios/Coyote.xcodeproj/project.pbxproj` → 2,
`grep -c "Coyote.entitlements" mobile/ios/Coyote.xcodeproj/project.pbxproj` → at least 2.

`mobile/ios/Coyote/AppDelegate.swift`: add `import React` if absent, and inside the
`AppDelegate` class add the two link handlers so Universal Links reach `Linking`:

```swift
  func application(_ app: UIApplication, open url: URL,
                   options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
    return RCTLinkingManager.application(app, open: url, options: options)
  }

  func application(_ application: UIApplication, continue userActivity: NSUserActivity,
                   restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
    return RCTLinkingManager.application(application, continue: userActivity,
                                         restorationHandler: restorationHandler)
  }
```

- [ ] **Step 7: Verify JS still passes**

Run: `cd mobile && npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add .gitignore mobile/package.json mobile/package-lock.json mobile/android mobile/ios
git commit -m "feat(mobile): native call dependencies, foreground service and platform config"
```

- [ ] **Step 9: Maintainer checkpoint (iOS) — stop and ask.** Claude cannot build iOS.
Ask the maintainer to run on their Mac and report back:

```bash
cd mobile && npm ci && cd ios && pod install && cd ..
npx react-native run-ios          # simulator: app shows "Coyote"
```

and in Xcode (`ios/Coyote.xcworkspace`) select their team on the Coyote target's
Signing tab and run once on a device. Do not continue past this task until both
platforms build; a pod or link failure here is fixed in this task.

---

### Task 4: Room links and token nick (`core/link.ts`, `core/token.ts`)

**Files:**
- Create: `mobile/src/core/link.ts`, `mobile/src/core/token.ts`
- Test: `mobile/test/link.test.ts`, `mobile/test/token.test.ts`

**Interfaces:**
- Consumes: `parseInvite`, `parseToken` from `src/shared/web`.
- Produces:
  ```ts
  export const DEFAULT_HOST = "vc.swiftirc.net";
  export const SLUG_RE: RegExp;
  export interface RoomLink { origin: string; host: string; slug: string; invite: string; token: string }
  export function parseRoomInput(input: string, defaultHost?: string): RoomLink | null;
  export function wsUrl(link: RoomLink): string;          // "wss://host/ws/slug"
  export function isDefaultHost(link: RoomLink): boolean;
  export function nickFromToken(token: string): string;  // token.ts
  ```

React Native's `URL` implementation lacks `pathname`/`hash` getters, so parsing is a
regex, not `new URL()`.

- [ ] **Step 1: Write the failing tests** — `mobile/test/link.test.ts`:

```ts
import { parseRoomInput, wsUrl, isDefaultHost, DEFAULT_HOST } from "../src/core/link";

test("bare room name joins on the default host", () => {
  expect(parseRoomInput("  Lounge ")).toEqual({
    origin: "https://vc.swiftirc.net", host: DEFAULT_HOST, slug: "lounge", invite: "", token: "",
  });
});

test("full link with invite", () => {
  const l = parseRoomInput("https://vc.swiftirc.net/Chat/#i=abc123");
  expect(l).toEqual({ origin: "https://vc.swiftirc.net", host: "vc.swiftirc.net", slug: "chat", invite: "abc123", token: "" });
});

test("token link; invite wins when both present", () => {
  expect(parseRoomInput("https://vc.swiftirc.net/x#t=aa.bb")!.token).toBe("aa.bb");
  const both = parseRoomInput("https://vc.swiftirc.net/x#t=aa.bb&i=zz")!;
  expect(both.invite).toBe("zz");
  expect(both.token).toBe("");
});

test("query string is ignored; other hosts and http are allowed", () => {
  expect(parseRoomInput("https://vc.swiftirc.net/x?utm=1#i=q")!.invite).toBe("q");
  const other = parseRoomInput("http://localhost:8080/dev")!;
  expect(other.origin).toBe("http://localhost:8080");
  expect(wsUrl(other)).toBe("ws://localhost:8080/ws/dev");
  expect(isDefaultHost(other)).toBe(false);
  expect(wsUrl(parseRoomInput("abc")!)).toBe("wss://vc.swiftirc.net/ws/abc");
});

test.each([
  "", "   ", "https://vc.swiftirc.net/", "https://vc.swiftirc.net/api/rooms/x",
  "https://vc.swiftirc.net/ws/x", "https://vc.swiftirc.net/a/b", "bad_room!",
  "x".repeat(33), "ftp://vc.swiftirc.net/x", "https:///x",
])("not a room: %p", (input) => {
  expect(parseRoomInput(input)).toBeNull();
});
```

`mobile/test/token.test.ts`:

```ts
import { nickFromToken } from "../src/core/token";

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

test("reads the n claim without verifying", () => {
  expect(nickFromToken(`${b64url(JSON.stringify({ n: "Ryan", r: "x" }))}.sig`)).toBe("Ryan");
});

test("handles non-ASCII nicks", () => {
  expect(nickFromToken(`${b64url(JSON.stringify({ n: "Zoë🚀" }))}.sig`)).toBe("Zoë🚀");
});

test.each(["", "garbage", "!!!.x", `${b64url("not json")}.x`, `${b64url(JSON.stringify({ n: 5 }))}.x`])(
  "returns empty for %p", (t) => expect(nickFromToken(t)).toBe(""),
);
```

- [ ] **Step 2: Run to verify failure**

Run: `cd mobile && npx jest test/link.test.ts test/token.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement** — `mobile/src/core/link.ts`:

```ts
import { parseInvite, parseToken } from "../shared/web";

export const DEFAULT_HOST = "vc.swiftirc.net";
// The server's slug rule (internal/server/server.go).
export const SLUG_RE = /^[a-z0-9-]{1,32}$/;

export interface RoomLink {
  origin: string; // "https://host[:port]"
  host: string; // "host[:port]"
  slug: string;
  invite: string; // #i= id, "" if none
  token: string; // #t= token, "" if none or an invite is present
}

// scheme, host, path, fragment. React Native's URL has no pathname/hash getters.
const URL_RE = /^(https?):\/\/([^/?#\s]+)\/?([^?#]*)(?:\?[^#]*)?(?:#(.*))?$/i;

// parseRoomInput accepts a full room link (any host) or a bare room name (default
// host). Returns null for anything that is not exactly one valid slug segment, so a
// tapped link to /api/... or /ws/... opens Home rather than a room.
export function parseRoomInput(input: string, defaultHost: string = DEFAULT_HOST): RoomLink | null {
  const text = (input || "").trim();
  if (!text) return null;
  const m = URL_RE.exec(text);
  if (!m) {
    const slug = text.toLowerCase();
    if (!SLUG_RE.test(slug)) return null;
    return { origin: `https://${defaultHost}`, host: defaultHost, slug, invite: "", token: "" };
  }
  const [, scheme, host, rawPath, fragment = ""] = m;
  const path = rawPath.replace(/\/+$/, "").toLowerCase();
  if (!path || path.includes("/") || !SLUG_RE.test(path)) return null;
  const invite = parseInvite(fragment);
  return {
    origin: `${scheme.toLowerCase()}://${host.toLowerCase()}`,
    host: host.toLowerCase(),
    slug: path,
    invite,
    token: invite ? "" : parseToken(fragment),
  };
}

export function wsUrl(link: RoomLink): string {
  return `${link.origin.replace(/^http/, "ws")}/ws/${link.slug}`;
}

export function isDefaultHost(link: RoomLink): boolean {
  return link.host === DEFAULT_HOST;
}
```

`mobile/src/core/token.ts`:

```ts
// nickFromToken reads the display name from a #t= token WITHOUT verifying it
// (prefill/lock convenience only; the server verifies on join). Port of
// nickFromToken in internal/web/assets/ui/prejoin.js, without atob/TextDecoder.
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function base64urlToBytes(s: string): number[] | null {
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of s) {
    const v = B64.indexOf(ch);
    if (v < 0) return null;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return out;
}

function utf8Decode(bytes: number[]): string {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i++];
    let cp: number;
    if (b < 0x80) cp = b;
    else if (b >= 0xf0) cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    else if (b >= 0xe0) cp = ((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    else cp = ((b & 0x1f) << 6) | (bytes[i++] & 0x3f);
    out += String.fromCodePoint(cp);
  }
  return out;
}

export function nickFromToken(token: string): string {
  const seg = (token || "").split(".")[0];
  if (!seg) return "";
  const bytes = base64urlToBytes(seg);
  if (!bytes) return "";
  try {
    const claims = JSON.parse(utf8Decode(bytes));
    return typeof claims?.n === "string" ? claims.n : "";
  } catch {
    return "";
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd mobile && npx jest test/link.test.ts test/token.test.ts && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/core/link.ts mobile/src/core/token.ts mobile/test/link.test.ts mobile/test/token.test.ts
git commit -m "feat(mobile): parse room links and token nicks"
```

---

### Task 5: Signaling client (`core/types.ts`, `core/signaling.ts`, test fakes)

**Files:**
- Create: `mobile/src/core/types.ts`, `mobile/src/core/signaling.ts`, `mobile/test/fakes.ts`
- Test: `mobile/test/signaling.test.ts`

**Interfaces:**
- Consumes: `encode`, `decode`, `backoffDelay` from `src/shared/web`.
- Produces (`types.ts`):
  ```ts
  export type Frame = { type: string; [k: string]: any };
  export interface Logger { info(...a: unknown[]): void; warn(...a: unknown[]): void; error(...a: unknown[]): void }
  export interface Timers { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: unknown): void }
  export const SOCKET_OPEN = 1;
  export interface SocketLike {
    readonly readyState: number; send(data: string): void; close(): void;
    onopen: (() => void) | null; onmessage: ((ev: { data: unknown }) => void) | null;
    onclose: ((ev?: { code?: number; reason?: string }) => void) | null; onerror: ((ev?: unknown) => void) | null;
  }
  ```
- Produces (`signaling.ts`):
  ```ts
  export interface SignalingDeps extends Timers { createSocket(url: string): SocketLike; random(): number; log: Logger }
  export type Handler = (msg: Frame) => void;
  export class Signaling {
    constructor(url: string, deps: SignalingDeps);
    onOpen(fn: () => void): void;       // runs on every open, before queued frames flush
    onClose(fn: () => void): void;      // runs on every UNEXPECTED close (not after stop/reconnectNow)
    on(type: string, fn: Handler): this; off(type: string, fn: Handler): this;
    connect(): void; send(type: string, fields?: Record<string, unknown>): void;
    stop(): void; reconnectNow(): void; readonly isOpen: boolean; readonly stopped: boolean;
  }
  ```
- Produces (`test/fakes.ts`): `FakeSocket`, `FakeTimers`, `silentLog` (used by Tasks 6-10).

Deliberate differences from `signaling.js`: `join` is sent by an `onOpen` hook that
runs **before** the queue flushes, and the queue is **dropped** on an unexpected
close — frames from a dead session (an old peer's offer/candidates) must never
reach a new server session; current state is re-sent via `join` and the rebuilt peer.

- [ ] **Step 1: Write fakes** — `mobile/test/fakes.ts`:

```ts
import { SOCKET_OPEN, type Logger, type SocketLike, type Timers } from "../src/core/types";

export const silentLog: Logger = { info() {}, warn() {}, error() {} };

export class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: any[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev?: { code?: number; reason?: string }) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  static last(): FakeSocket {
    return FakeSocket.all[FakeSocket.all.length - 1];
  }
  send(data: string) {
    if (this.readyState !== SOCKET_OPEN) throw new Error("send on non-open socket");
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  // test drivers
  open() {
    this.readyState = SOCKET_OPEN;
    this.onopen?.();
  }
  receive(frame: object) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  types(): string[] {
    return this.sent.map((f) => f.type);
  }
}

// Manual timers: advance(ms) runs everything due, in order.
export class FakeTimers implements Timers {
  now = 0;
  private seq = 0;
  private due = new Map<number, { at: number; fn: () => void }>();
  setTimeout = (fn: () => void, ms: number) => {
    const id = ++this.seq;
    this.due.set(id, { at: this.now + ms, fn });
    return id;
  };
  clearTimeout = (h: unknown) => {
    this.due.delete(h as number);
  };
  pending(): number {
    return this.due.size;
  }
  advance(ms: number) {
    const until = this.now + ms;
    for (;;) {
      const next = [...this.due.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > until) break;
      this.due.delete(next[0]);
      this.now = next[1].at;
      next[1].fn();
    }
    this.now = until;
  }
}
```

- [ ] **Step 2: Write the failing tests** — `mobile/test/signaling.test.ts`:

```ts
import { Signaling } from "../src/core/signaling";
import { FakeSocket, FakeTimers, silentLog } from "./fakes";

function make() {
  FakeSocket.all = [];
  const timers = new FakeTimers();
  const sig = new Signaling("wss://h/ws/r", {
    createSocket: (url) => new FakeSocket(url),
    random: () => 0,
    log: silentLog,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  return { sig, timers };
}

test("onOpen runs before queued frames flush, on every open", () => {
  const { sig, timers } = make();
  sig.onOpen(() => sig.send("join", { name: "a" }));
  sig.connect();
  sig.send("media-state", { mic: true, camera: false }); // queued pre-open
  FakeSocket.last().open();
  expect(FakeSocket.last().types()).toEqual(["join", "media-state"]);
  FakeSocket.last().drop();
  timers.advance(500);
  FakeSocket.last().open();
  expect(FakeSocket.all).toHaveLength(2);
  expect(FakeSocket.last().types()).toEqual(["join"]);
});

test("onClose fires for unexpected closes only", () => {
  const { sig } = make();
  let closes = 0;
  sig.onClose(() => closes++);
  sig.connect();
  FakeSocket.last().open();
  FakeSocket.last().drop();
  expect(closes).toBe(1);
  sig.reconnectNow();
  const s = FakeSocket.last();
  s.open();
  sig.stop();
  s.drop(1000);
  expect(closes).toBe(1);
});

test("frames queued while disconnected are dropped on an unexpected close", () => {
  const { sig, timers } = make();
  sig.onOpen(() => sig.send("join", {}));
  sig.connect();
  FakeSocket.last().open();
  FakeSocket.last().drop();
  sig.send("offer", { sdp: "stale" }); // from the dead session
  timers.advance(500);
  FakeSocket.last().open();
  expect(FakeSocket.last().types()).toEqual(["join"]);
});

test("dispatches by type and to '*', ignores malformed frames, off() removes", () => {
  const { sig } = make();
  const got: string[] = [];
  const h = (m: any) => got.push(`joined:${m.selfId}`);
  sig.on("joined", h).on("*", (m) => got.push(`*:${m.type}`));
  sig.connect();
  FakeSocket.last().open();
  FakeSocket.last().onmessage?.({ data: "{not json" });
  FakeSocket.last().receive({ type: "joined", selfId: "p1" });
  sig.off("joined", h);
  FakeSocket.last().receive({ type: "joined", selfId: "p2" });
  expect(got).toEqual(["joined:p1", "*:joined", "*:joined"]);
});

test("reconnect backoff grows, caps, and resets after open", () => {
  const { sig, timers } = make();
  sig.connect();
  FakeSocket.last().drop(); // attempt 0 -> 500ms
  timers.advance(499);
  expect(FakeSocket.all).toHaveLength(1);
  timers.advance(1);
  expect(FakeSocket.all).toHaveLength(2);
  FakeSocket.last().drop(); // attempt 1 -> 1000ms
  timers.advance(999);
  expect(FakeSocket.all).toHaveLength(2);
  timers.advance(1);
  expect(FakeSocket.all).toHaveLength(3);
  FakeSocket.last().open(); // resets
  FakeSocket.last().drop();
  timers.advance(500);
  expect(FakeSocket.all).toHaveLength(4);
});

test("stop() is permanent: closes, cancels pending reconnect, never reconnects", () => {
  const { sig, timers } = make();
  sig.connect();
  FakeSocket.last().open();
  FakeSocket.last().drop();
  expect(timers.pending()).toBe(1);
  sig.stop();
  expect(timers.pending()).toBe(0);
  timers.advance(60_000);
  sig.reconnectNow();
  sig.connect();
  expect(FakeSocket.all).toHaveLength(1);
  expect(sig.stopped).toBe(true);
});

test("stop() on an open socket closes it without reconnecting", () => {
  const { sig, timers } = make();
  sig.connect();
  const s = FakeSocket.last();
  s.open();
  sig.stop();
  expect(s.closed).toBe(true);
  s.drop(1000); // the close event arrives afterwards
  timers.advance(60_000);
  expect(FakeSocket.all).toHaveLength(1);
});

test("reconnectNow skips the backoff wait and resets the attempt counter", () => {
  const { sig, timers } = make();
  sig.connect();
  FakeSocket.last().drop();
  FakeSocket.last(); // still the first socket; a 500ms timer is pending
  sig.reconnectNow();
  expect(FakeSocket.all).toHaveLength(2);
  expect(timers.pending()).toBe(0);
});

test("reconnectNow on an open socket replaces it (media-failed recovery)", () => {
  const { sig } = make();
  sig.onOpen(() => sig.send("join", {}));
  sig.connect();
  const first = FakeSocket.last();
  first.open();
  sig.reconnectNow();
  expect(first.closed).toBe(true);
  first.drop(1000); // the old socket's late close must not schedule another reconnect
  expect(FakeSocket.all).toHaveLength(2);
  FakeSocket.last().open();
  expect(FakeSocket.last().types()).toEqual(["join"]);
  expect(sig.isOpen).toBe(true);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd mobile && npx jest test/signaling.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement** — `mobile/src/core/types.ts`:

```ts
// Structural types for everything core/ is given by injection. They describe the
// subset of the WebSocket / react-native-webrtc API that core/ uses, so tests can
// supply fakes and core/ never imports a native module.

export type Frame = { type: string; [k: string]: any };

export interface Logger {
  info(...a: unknown[]): void;
  warn(...a: unknown[]): void;
  error(...a: unknown[]): void;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

export const SOCKET_OPEN = 1;

export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev?: { code?: number; reason?: string }) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
}
```

`mobile/src/core/signaling.ts`:

```ts
// WebSocket signaling: port of internal/web/assets/net/signaling.js.
//
// Security-critical, as on the web: reconnect happens on ANY close except after
// stop(). kicked/banned/leave call stop(); server-restarting does not.
//
// Differences from the web client, both about reconnects:
//  - onOpen hooks (the join frame) run BEFORE queued frames flush, so join is always
//    the first frame the server sees on a socket.
//  - The outbound queue is dropped on an unexpected close: anything queued belongs to
//    a dead server session (an old peer's offer or candidates). State that matters is
//    re-sent by the join frame and the rebuilt peer.
import { encode, decode, backoffDelay } from "../shared/web";
import { SOCKET_OPEN, type Frame, type Logger, type SocketLike, type Timers } from "./types";

const JITTER_MS = 250;

export interface SignalingDeps extends Timers {
  createSocket(url: string): SocketLike;
  random(): number;
  log: Logger;
}

export type Handler = (msg: Frame) => void;

export class Signaling {
  private handlers = new Map<string, Handler[]>();
  private openHooks: Array<() => void> = [];
  private closeHooks: Array<() => void> = [];
  private queue: string[] = [];
  private attempt = 0;
  private ws: SocketLike | null = null;
  private reconnectTimer: unknown = null;
  private _stopped = false;

  constructor(readonly url: string, private deps: SignalingDeps) {}

  get stopped(): boolean {
    return this._stopped;
  }

  get isOpen(): boolean {
    return !!this.ws && this.ws.readyState === SOCKET_OPEN;
  }

  onOpen(fn: () => void): void {
    this.openHooks.push(fn);
  }

  onClose(fn: () => void): void {
    this.closeHooks.push(fn);
  }

  on(type: string, fn: Handler): this {
    const list = this.handlers.get(type) || [];
    list.push(fn);
    this.handlers.set(type, list);
    return this;
  }

  off(type: string, fn: Handler): this {
    const list = this.handlers.get(type);
    if (list) {
      const i = list.indexOf(fn);
      if (i !== -1) list.splice(i, 1);
    }
    return this;
  }

  connect(): void {
    if (this._stopped) return;
    const ws = this.deps.createSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.deps.log.info(`[signaling] open${this.attempt ? ` after ${this.attempt} failed attempt(s)` : ""}`);
      this.attempt = 0;
      for (const hook of this.openHooks) hook(); // join first
      const pending = this.queue;
      this.queue = [];
      for (const frame of pending) ws.send(frame);
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      let msg: Frame;
      try {
        msg = decode(String(ev.data));
      } catch {
        return;
      }
      this.dispatch(msg);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return; // a socket we already replaced or stopped
      this.ws = null;
      if (this._stopped) return;
      this.deps.log.warn(`[signaling] closed unexpectedly code=${ev?.code ?? "?"} — will reconnect`);
      this.queue = [];
      for (const hook of this.closeHooks) hook();
      this.scheduleReconnect();
    };
    ws.onerror = () => this.deps.log.warn("[signaling] socket error (a close, and a reconnect, follow)");
  }

  send(type: string, fields: Record<string, unknown> = {}): void {
    const frame = encode(type, fields);
    if (this.ws && this.ws.readyState === SOCKET_OPEN) this.ws.send(frame);
    else this.queue.push(frame);
  }

  stop(): void {
    this._stopped = true;
    this.cancelTimer();
    this.queue = [];
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  // Reconnect immediately: app foregrounded, network changed, or the media plane
  // failed. Replaces an open socket too (the server then builds a fresh session).
  reconnectNow(): void {
    if (this._stopped) return;
    this.cancelTimer();
    this.attempt = 0;
    const old = this.ws;
    this.ws = null; // detach first so its late close is ignored
    old?.close();
    this.queue = [];
    this.connect();
  }

  private dispatch(msg: Frame) {
    for (const fn of [...(this.handlers.get(msg.type) || [])]) fn(msg);
    for (const fn of [...(this.handlers.get("*") || [])]) fn(msg);
  }

  private cancelTimer() {
    if (this.reconnectTimer !== null) {
      this.deps.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer !== null) return;
    const delay = backoffDelay(this.attempt) + Math.floor(this.deps.random() * JITTER_MS);
    this.attempt += 1;
    this.reconnectTimer = this.deps.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
```

- [ ] **Step 5: Run tests**

Run: `cd mobile && npx jest test/signaling.test.ts && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/core/types.ts mobile/src/core/signaling.ts mobile/test/fakes.ts mobile/test/signaling.test.ts
git commit -m "feat(mobile): signaling client with join-first reconnects"
```

---
### Task 6: Peer — publishing and perfect negotiation (`core/codecs.ts`, `core/peer.ts`)

**Files:**
- Modify: `mobile/src/core/types.ts` (append WebRTC structural types)
- Create: `mobile/src/core/codecs.ts`, `mobile/src/core/peer.ts`
- Modify: `mobile/test/fakes.ts` (append `FakeSig`, `FakeTrack`, `FakeStream`, `FakePC`)
- Test: `mobile/test/codecs.test.ts`, `mobile/test/peer.test.ts`

**Interfaces:**
- Consumes: `handleRemoteOffer`, `qualityTier`, `encodingCaps` (shared); `Signaling` handler types (Task 5).
- Produces:
  ```ts
  // types.ts additions
  export type Kind = "mic" | "camera" | "screen" | "screen-audio";
  export interface TrackLike { readonly id: string; readonly kind: string; enabled: boolean; stop(): void;
    getSettings?(): { height?: number }; addEventListener?(type: "ended", fn: () => void): void }
  export interface StreamLike { readonly id: string; getTracks(): TrackLike[]; toURL?(): string }
  export interface CodecLike { mimeType: string; clockRate: number; channels?: number; sdpFmtpLine?: string }
  export interface SenderLike { readonly track: TrackLike | null; replaceTrack(t: TrackLike | null): Promise<void>;
    getParameters(): { encodings?: Array<Record<string, unknown>> }; setParameters(p: unknown): Promise<void> }
  export interface TransceiverLike { readonly mid: string | null; readonly sender: SenderLike; setCodecPreferences?(c: CodecLike[]): void }
  export interface SessionDescription { type: string; sdp: string }
  export interface TrackEventLike { track: TrackLike; transceiver: { mid: string | null }; streams: StreamLike[] }
  export interface PeerConnectionLike { /* see Step 3 */ }
  // codecs.ts
  export function preferVp8(codecs: CodecLike[]): CodecLike[];
  // peer.ts
  export type SignalingPort = { on(t: string, fn: (m: Frame) => void): unknown; off(t: string, fn: (m: Frame) => void): unknown; send(t: string, f?: Record<string, unknown>): void };
  export interface PeerDeps extends Timers { createPeerConnection(): PeerConnectionLike; createStream(tracks: TrackLike[]): StreamLike;
    createCandidate(init: unknown): unknown; videoCodecs(): CodecLike[] | null; log: Logger }
  export interface PeerEvents { remoteTrack(e: { participantId: string; kind: string; stream: StreamLike }): void;
    peerGone(e: { participantId?: string; kind?: string }): void; error(e: { error: unknown; phase: string }): void; mediaFailed(): void }
  export class Peer {
    constructor(sig: SignalingPort, deps: PeerDeps, events: PeerEvents);
    start(local: Array<{ track: TrackLike; kind: Kind }>): Promise<void>;
    publish(track: TrackLike, kind: Kind): Promise<void>;
    replaceTrack(kind: Kind, track: TrackLike | null): Promise<boolean>;
    unpublish(kind: Kind): void;
    setQuality(camera: string, screen: string): void;
    close(): void;
  }
  ```

- [ ] **Step 1: Append the WebRTC types** to `mobile/src/core/types.ts`:

```ts
export type Kind = "mic" | "camera" | "screen" | "screen-audio";

export interface TrackLike {
  readonly id: string;
  readonly kind: string; // "audio" | "video"
  enabled: boolean;
  stop(): void;
  getSettings?(): { height?: number };
  addEventListener?(type: "ended", fn: () => void): void;
}

export interface StreamLike {
  readonly id: string;
  getTracks(): TrackLike[];
  toURL?(): string; // react-native-webrtc: the RTCView streamURL
}

export interface CodecLike {
  mimeType: string;
  clockRate: number;
  channels?: number;
  sdpFmtpLine?: string;
}

export interface SenderLike {
  readonly track: TrackLike | null;
  replaceTrack(t: TrackLike | null): Promise<void>;
  getParameters(): { encodings?: Array<Record<string, unknown>> };
  setParameters(p: unknown): Promise<void>;
}

export interface TransceiverLike {
  readonly mid: string | null;
  readonly sender: SenderLike;
  setCodecPreferences?(codecs: CodecLike[]): void;
}

export interface SessionDescription {
  type: string;
  sdp: string;
}

export interface TrackEventLike {
  track: TrackLike;
  transceiver: { mid: string | null };
  streams: StreamLike[];
}

export interface PeerConnectionLike {
  readonly signalingState: string;
  readonly connectionState: string;
  readonly iceConnectionState: string;
  readonly localDescription: SessionDescription | null;
  readonly remoteDescription: SessionDescription | null;
  addEventListener(type: "icecandidate", fn: (ev: { candidate: unknown | null }) => void): void;
  addEventListener(type: "track", fn: (ev: TrackEventLike) => void): void;
  addEventListener(type: "negotiationneeded" | "connectionstatechange" | "iceconnectionstatechange", fn: () => void): void;
  addTransceiver(track: TrackLike, init: { direction: "sendonly"; streams: StreamLike[] }): TransceiverLike;
  removeTrack(sender: SenderLike): void;
  createOffer(): Promise<SessionDescription>;
  createAnswer(): Promise<SessionDescription>;
  setLocalDescription(d: SessionDescription): Promise<void>;
  setRemoteDescription(d: SessionDescription): Promise<void>;
  addIceCandidate(c: unknown): Promise<void>;
  restartIce?(): void;
  close(): void;
}
```

- [ ] **Step 2: Append fakes** to `mobile/test/fakes.ts`:

```ts
import type {
  CodecLike, Frame, PeerConnectionLike, SenderLike, SessionDescription, StreamLike, TrackLike, TransceiverLike,
} from "../src/core/types";

export class FakeSig {
  sent: Frame[] = [];
  handlers = new Map<string, Array<(m: Frame) => void>>();
  on(t: string, fn: (m: Frame) => void) {
    this.handlers.set(t, [...(this.handlers.get(t) || []), fn]);
    return this;
  }
  off(t: string, fn: (m: Frame) => void) {
    this.handlers.set(t, (this.handlers.get(t) || []).filter((f) => f !== fn));
    return this;
  }
  send(type: string, fields: Record<string, unknown> = {}) {
    this.sent.push({ type, ...fields });
  }
  receive(frame: Frame) {
    for (const fn of [...(this.handlers.get(frame.type) || [])]) fn(frame);
  }
  ofType(t: string) {
    return this.sent.filter((f) => f.type === t);
  }
  handlerCount() {
    return [...this.handlers.values()].reduce((n, l) => n + l.length, 0);
  }
}

let trackSeq = 0;
export class FakeTrack implements TrackLike {
  readonly id = `t${++trackSeq}`;
  enabled = true;
  stopped = false;
  private ended: Array<() => void> = [];
  constructor(readonly kind: string, private height = 720) {}
  stop() {
    this.stopped = true;
  }
  getSettings() {
    return { height: this.height };
  }
  addEventListener(_t: "ended", fn: () => void) {
    this.ended.push(fn);
  }
  end() {
    for (const fn of this.ended) fn();
  }
}

let streamSeq = 0;
export class FakeStream implements StreamLike {
  readonly id = `s${++streamSeq}`;
  constructor(private tracks: TrackLike[]) {}
  getTracks() {
    return this.tracks;
  }
  toURL() {
    return `url-${this.id}`;
  }
}

export class FakeSender implements SenderLike {
  params: { encodings: Array<Record<string, unknown>> } = { encodings: [] };
  setParams: any[] = [];
  constructor(public track: TrackLike | null) {}
  async replaceTrack(t: TrackLike | null) {
    this.track = t;
  }
  getParameters() {
    return JSON.parse(JSON.stringify(this.params));
  }
  async setParameters(p: any) {
    this.setParams.push(p);
  }
}

export class FakeTransceiver implements TransceiverLike {
  readonly sender: FakeSender;
  codecPrefs: CodecLike[] | null = null;
  constructor(public mid: string | null, track: TrackLike, public streams: StreamLike[]) {
    this.sender = new FakeSender(track);
  }
  setCodecPreferences(c: CodecLike[]) {
    this.codecPrefs = c;
  }
}

// A small RTCPeerConnection model: just enough signaling-state machine for perfect
// negotiation, with implicit rollback on setRemoteDescription(offer).
export class FakePC implements PeerConnectionLike {
  signalingState = "stable";
  connectionState = "new";
  iceConnectionState = "new";
  localDescription: SessionDescription | null = null;
  remoteDescription: SessionDescription | null = null;
  transceivers: FakeTransceiver[] = [];
  removed: SenderLike[] = [];
  candidates: unknown[] = [];
  srdCalls: SessionDescription[] = [];
  restarts = 0;
  closed = false;
  private offers = 0;
  private listeners = new Map<string, Array<(ev?: any) => void>>();
  addEventListener(type: string, fn: (ev?: any) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), fn]);
  }
  emit(type: string, ev?: any) {
    for (const fn of this.listeners.get(type) || []) fn(ev);
  }
  addTransceiver(track: TrackLike, init: { direction: "sendonly"; streams: StreamLike[] }) {
    const t = new FakeTransceiver(String(this.transceivers.length), track, init.streams);
    this.transceivers.push(t);
    return t;
  }
  removeTrack(sender: SenderLike) {
    this.removed.push(sender);
  }
  async createOffer() {
    return { type: "offer", sdp: `offer-${++this.offers}` };
  }
  async createAnswer() {
    return { type: "answer", sdp: `answer-to-${this.remoteDescription?.sdp}` };
  }
  async setLocalDescription(d: SessionDescription) {
    this.localDescription = d;
    this.signalingState = d.type === "offer" ? "have-local-offer" : "stable";
    if (d.type === "answer") this.negotiated();
  }
  async setRemoteDescription(d: SessionDescription) {
    if ((d as any).type === "rollback") throw new Error("explicit rollback is forbidden");
    this.srdCalls.push(d);
    this.remoteDescription = d;
    this.signalingState = d.type === "offer" ? "have-remote-offer" : "stable"; // offer: implicit rollback
    if (d.type === "answer") this.negotiated();
  }
  async addIceCandidate(c: unknown) {
    if (!this.remoteDescription) throw new Error("no remote description");
    this.candidates.push(c);
  }
  restartIce() {
    this.restarts++;
  }
  close() {
    this.closed = true;
  }
  setConnection(state: string, ice = state) {
    this.connectionState = state;
    this.iceConnectionState = ice;
    this.emit("connectionstatechange");
    this.emit("iceconnectionstatechange");
  }
  // After negotiation a real sender has one encoding.
  private negotiated() {
    for (const t of this.transceivers) if (t.sender.params.encodings.length === 0) t.sender.params.encodings = [{}];
  }
}

export const flush = () => new Promise((r) => setImmediate(r));
```

(Move the new `import type` line to the top of the file next to the existing import.)

- [ ] **Step 3: Write the failing tests** — `mobile/test/codecs.test.ts`:

```ts
import { preferVp8 } from "../src/core/codecs";

test("VP8 first, everything else kept in order", () => {
  const c = (m: string) => ({ mimeType: m, clockRate: 90000 });
  expect(preferVp8([c("video/H264"), c("video/rtx"), c("video/VP8"), c("video/VP9")]).map((x) => x.mimeType))
    .toEqual(["video/VP8", "video/H264", "video/rtx", "video/VP9"]);
  expect(preferVp8([c("video/vp8")])[0].mimeType).toBe("video/vp8");
});

test("no VP8 available returns the list unchanged", () => {
  const list = [{ mimeType: "video/H264", clockRate: 90000 }];
  expect(preferVp8(list)).toEqual(list);
});
```

`mobile/test/peer.test.ts`:

```ts
import { Peer } from "../src/core/peer";
import { FakePC, FakeSig, FakeStream, FakeTrack, FakeTimers, flush, silentLog } from "./fakes";

const VP8 = { mimeType: "video/VP8", clockRate: 90000 };
const H264 = { mimeType: "video/H264", clockRate: 90000 };

function make() {
  const sig = new FakeSig();
  const pc = new FakePC();
  const timers = new FakeTimers();
  const events = { remote: [] as any[], gone: [] as any[], errors: [] as any[], failed: 0 };
  const peer = new Peer(sig, {
    createPeerConnection: () => pc,
    createStream: (t) => new FakeStream(t),
    createCandidate: (c) => ({ wrapped: c }),
    videoCodecs: () => [H264, VP8],
    log: silentLog,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  }, {
    remoteTrack: (e) => events.remote.push(e),
    peerGone: (e) => events.gone.push(e),
    error: (e) => events.errors.push(e),
    mediaFailed: () => events.failed++,
  });
  return { sig, pc, timers, events, peer };
}

test("start publishes sendonly transceivers and one offer carrying the kinds map", async () => {
  const { sig, pc, peer } = make();
  const mic = new FakeTrack("audio");
  const cam = new FakeTrack("video");
  await peer.start([{ track: mic, kind: "mic" }, { track: cam, kind: "camera" }]);
  pc.emit("negotiationneeded"); // browsers fire this too; must collapse into the same offer
  await flush();
  const offers = sig.ofType("offer");
  expect(offers).toHaveLength(1);
  const kinds = offers[0].kinds as Record<string, string>;
  const [micT, camT] = pc.transceivers;
  expect(kinds[micT.streams[0].id]).toBe("mic");
  expect(kinds[camT.streams[0].id]).toBe("camera");
  expect(camT.codecPrefs?.[0].mimeType).toBe("video/VP8");
  expect(micT.codecPrefs).toBeNull();
});

test("an offer needed while one is in flight is sent after the answer", async () => {
  const { sig, pc, peer } = make();
  await peer.start([{ track: new FakeTrack("audio"), kind: "mic" }]);
  await peer.publish(new FakeTrack("video"), "camera");
  pc.emit("negotiationneeded");
  await flush();
  expect(sig.ofType("offer")).toHaveLength(1);
  sig.receive({ type: "answer", sdp: "a1" });
  await flush();
  const offers = sig.ofType("offer");
  expect(offers).toHaveLength(2);
  expect(Object.values(offers[1].kinds)).toEqual(["mic", "camera"]);
});

test("glare: the polite client applies the server offer directly, answers, then re-offers", async () => {
  const { sig, pc, peer } = make();
  await peer.start([{ track: new FakeTrack("audio"), kind: "mic" }]);
  expect(pc.signalingState).toBe("have-local-offer");
  sig.receive({ type: "offer", sdp: "server-1" });
  await flush();
  expect(pc.srdCalls.map((d) => d.type)).toEqual(["offer"]); // never {type:"rollback"}
  expect(sig.ofType("answer")).toEqual([{ type: "answer", sdp: "answer-to-server-1" }]);
  expect(sig.ofType("offer")).toHaveLength(2); // our rolled-back offer, re-sent once stable
});

test("a server offer with no glare is answered and does not trigger a re-offer", async () => {
  const { sig, pc, peer } = make();
  await peer.start([]);
  sig.receive({ type: "answer", sdp: "a1" });
  await flush();
  sig.receive({ type: "offer", sdp: "server-2" });
  await flush();
  expect(sig.ofType("answer")).toHaveLength(1);
  expect(sig.ofType("offer")).toHaveLength(1);
  expect(pc.signalingState).toBe("stable");
});

test("local candidates trickle; the null end-of-candidates is not sent", async () => {
  const { sig, pc, peer } = make();
  await peer.start([]);
  pc.emit("icecandidate", { candidate: { candidate: "c1" } });
  pc.emit("icecandidate", { candidate: null });
  expect(sig.ofType("candidate")).toEqual([{ type: "candidate", candidate: { candidate: "c1" } }]);
});

test("remote candidates before a remote description are buffered, then drained", async () => {
  const { sig, pc, peer } = make();
  await peer.start([]);
  sig.receive({ type: "candidate", candidate: { candidate: "r1" } });
  await flush();
  expect(pc.candidates).toEqual([]);
  sig.receive({ type: "answer", sdp: "a1" });
  await flush();
  expect(pc.candidates).toEqual([{ wrapped: { candidate: "r1" } }]);
  sig.receive({ type: "candidate", candidate: { candidate: "r2" } });
  await flush();
  expect(pc.candidates).toHaveLength(2);
});

test("publishing an already-published kind swaps the track instead of adding an m-line", async () => {
  const { pc, peer } = make();
  await peer.start([{ track: new FakeTrack("video"), kind: "camera" }]);
  const next = new FakeTrack("video");
  await peer.publish(next, "camera");
  expect(pc.transceivers).toHaveLength(1);
  expect(pc.transceivers[0].sender.track).toBe(next);
});

test("replaceTrack swaps without renegotiation and reports whether a sender existed", async () => {
  const { sig, pc, peer } = make();
  await peer.start([{ track: new FakeTrack("video"), kind: "camera" }]);
  expect(await peer.replaceTrack("camera", null)).toBe(true);
  expect(pc.transceivers[0].sender.track).toBeNull();
  expect(await peer.replaceTrack("mic", new FakeTrack("audio"))).toBe(false);
  expect(sig.ofType("offer")).toHaveLength(1);
});

test("quality caps are applied once the sender has an encoding", async () => {
  const { sig, pc, peer } = make();
  peer.setQuality("low", "auto");
  await peer.start([{ track: new FakeTrack("video", 720), kind: "camera" }]);
  expect(pc.transceivers[0].sender.setParams).toHaveLength(0); // no encodings before negotiation
  sig.receive({ type: "answer", sdp: "a1" });
  await flush();
  const p = pc.transceivers[0].sender.setParams.at(-1);
  expect(p.encodings[0]).toMatchObject({ scaleResolutionDownBy: 2, maxFramerate: 15 });
});

test("close detaches every signaling handler and closes the connection", async () => {
  const { sig, pc, peer } = make();
  expect(sig.handlerCount()).toBe(4);
  peer.close();
  expect(sig.handlerCount()).toBe(0);
  expect(pc.closed).toBe(true);
});
```

- [ ] **Step 4: Run to verify failure**

Run: `cd mobile && npx jest test/codecs.test.ts test/peer.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 5: Implement** — `mobile/src/core/codecs.ts`:

```ts
import type { CodecLike } from "./types";

// The SFU registers only VP8 (and Opus). react-native-webrtc may prefer H.264, which
// the SFU would reject, so VP8 is moved to the front of the video codec preferences.
export function preferVp8(codecs: CodecLike[]): CodecLike[] {
  const isVp8 = (c: CodecLike) => c.mimeType.toLowerCase() === "video/vp8";
  if (!codecs.some(isVp8)) return codecs;
  return [...codecs.filter(isVp8), ...codecs.filter((c) => !isVp8(c))];
}
```

`mobile/src/core/peer.ts` (inbound tracks and ICE recovery are added in Task 7; the
`tracks` handler and track listener below are stubs Task 7 replaces):

```ts
// One RTCPeerConnection to the SFU, driven by perfect negotiation with this client
// as the POLITE peer. Port of internal/web/assets/net/peer.js — read its comments
// for the why behind each rule; the rules are kept exactly:
//  - no ICE servers (public-IP SFU);
//  - one sendonly transceiver per published kind, under its own MediaStream, with
//    {streamId: kind} sent alongside EVERY offer;
//  - an offer is deferred while one is in flight and flushed once stable;
//  - on glare, a bare setRemoteDescription(offer) is the rollback (never an explicit
//    {type:"rollback"}), then answer, then re-offer explicitly.
import { handleRemoteOffer, qualityTier, encodingCaps } from "../shared/web";
import { preferVp8 } from "./codecs";
import type {
  CodecLike, Frame, Kind, Logger, PeerConnectionLike, SenderLike, StreamLike, Timers, TrackEventLike, TrackLike,
} from "./types";

export type SignalingPort = {
  on(t: string, fn: (m: Frame) => void): unknown;
  off(t: string, fn: (m: Frame) => void): unknown;
  send(t: string, f?: Record<string, unknown>): void;
};

export interface PeerDeps extends Timers {
  createPeerConnection(): PeerConnectionLike;
  createStream(tracks: TrackLike[]): StreamLike;
  createCandidate(init: unknown): unknown;
  videoCodecs(): CodecLike[] | null;
  log: Logger;
}

export interface PeerEvents {
  remoteTrack(e: { participantId: string; kind: string; stream: StreamLike }): void;
  peerGone(e: { participantId?: string; kind?: string }): void;
  error(e: { error: unknown; phase: string }): void;
  mediaFailed(): void;
}

export class Peer {
  private pc: PeerConnectionLike;
  private makingOffer = false;
  private negotiationPending = false;
  private pendingCandidates: unknown[] = [];
  private senders = new Map<Kind, SenderLike>();
  private kindByStreamId = new Map<string, Kind>();
  private streamIdByKind = new Map<Kind, string>();
  private quality = { camera: "auto", screen: "auto" };
  private sigHandlers: Array<[string, (m: Frame) => void]>;

  constructor(private sig: SignalingPort, private deps: PeerDeps, private events: PeerEvents) {
    this.pc = deps.createPeerConnection();
    this.pc.addEventListener("icecandidate", (ev) => {
      if (ev.candidate) this.sig.send("candidate", { candidate: ev.candidate });
    });
    this.pc.addEventListener("negotiationneeded", () => {
      this.makeOffer().catch((err) => this.emitError(err, "negotiation"));
    });
    this.pc.addEventListener("track", (ev) => this.onTrack(ev));
    this.sigHandlers = [
      ["offer", (m) => void this.onRemoteOffer(m).catch((err) => this.emitError(err, "offer"))],
      ["answer", (m) => void this.onRemoteAnswer(m).catch((err) => this.emitError(err, "answer"))],
      ["candidate", (m) => void this.onRemoteCandidate(m).catch((err) => this.emitError(err, "candidate"))],
      ["tracks", (m) => this.onTracks(m)],
    ];
    for (const [t, fn] of this.sigHandlers) sig.on(t, fn);
  }

  async start(local: Array<{ track: TrackLike; kind: Kind }>): Promise<void> {
    for (const { track, kind } of local) this.addLocal(track, kind);
    await this.makeOffer();
  }

  async publish(track: TrackLike, kind: Kind): Promise<void> {
    const existing = this.senders.get(kind);
    if (existing) {
      await existing.replaceTrack(track);
      this.applyQuality(kind);
      return;
    }
    this.addLocal(track, kind); // fires negotiationneeded -> makeOffer
  }

  async replaceTrack(kind: Kind, track: TrackLike | null): Promise<boolean> {
    const sender = this.senders.get(kind);
    if (!sender) return false;
    await sender.replaceTrack(track);
    this.applyQuality(kind);
    return true;
  }

  unpublish(kind: Kind): void {
    const sender = this.senders.get(kind);
    if (!sender) return;
    this.senders.delete(kind);
    const sid = this.streamIdByKind.get(kind);
    if (sid) {
      this.streamIdByKind.delete(kind);
      this.kindByStreamId.delete(sid);
    }
    this.pc.removeTrack(sender);
  }

  setQuality(camera: string, screen: string): void {
    this.quality = { camera: camera || "auto", screen: screen || "auto" };
    this.applyQuality("camera");
    this.applyQuality("screen");
  }

  close(): void {
    for (const [t, fn] of this.sigHandlers) this.sig.off(t, fn);
    this.sigHandlers = [];
    this.closeExtras();
    this.pc.close();
  }

  // --- outbound ---

  private addLocal(track: TrackLike, kind: Kind) {
    const stream = this.deps.createStream([track]);
    const transceiver = this.pc.addTransceiver(track, { direction: "sendonly", streams: [stream] });
    if (track.kind === "video" && transceiver.setCodecPreferences) {
      const codecs = this.deps.videoCodecs();
      if (codecs && codecs.length) {
        try {
          transceiver.setCodecPreferences(preferVp8(codecs));
        } catch (err) {
          this.deps.log.warn("[peer] setCodecPreferences failed", err);
        }
      }
    }
    const prev = this.streamIdByKind.get(kind);
    if (prev) this.kindByStreamId.delete(prev);
    this.streamIdByKind.set(kind, stream.id);
    this.kindByStreamId.set(stream.id, kind);
    this.senders.set(kind, transceiver.sender);
    this.applyQuality(kind);
  }

  private applyQuality(kind: Kind): void {
    if (kind !== "camera" && kind !== "screen") return;
    const sender = this.senders.get(kind);
    if (!sender || !sender.track) return;
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) return; // not negotiated yet
    const enc = params.encodings[0];
    const h = sender.track.getSettings?.().height || 0;
    const caps = encodingCaps(qualityTier(this.quality[kind]), h);
    enc.scaleResolutionDownBy = caps.scaleResolutionDownBy;
    if (caps.maxFramerate) enc.maxFramerate = caps.maxFramerate;
    else delete enc.maxFramerate;
    sender.setParameters(params).catch((err) => this.deps.log.warn(`[quality] ${kind}: setParameters rejected`, err));
  }

  private reapplyQuality() {
    this.applyQuality("camera");
    this.applyQuality("screen");
  }

  private async makeOffer(): Promise<void> {
    if (this.makingOffer || this.pc.signalingState !== "stable") {
      this.negotiationPending = true;
      return;
    }
    this.negotiationPending = false;
    try {
      this.makingOffer = true;
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      this.sig.send("offer", { sdp: this.pc.localDescription!.sdp, kinds: Object.fromEntries(this.kindByStreamId) });
    } finally {
      this.makingOffer = false;
    }
  }

  private flushPendingOffer() {
    if (this.negotiationPending) this.makeOffer().catch((err) => this.emitError(err, "negotiation"));
  }

  // --- inbound signaling ---

  private async onRemoteOffer(msg: Frame) {
    const { action } = handleRemoteOffer({ makingOffer: this.makingOffer, signalingState: this.pc.signalingState });
    await this.pc.setRemoteDescription({ type: "offer", sdp: msg.sdp }); // implicit rollback on glare
    await this.drainCandidates();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.sig.send("answer", { sdp: this.pc.localDescription!.sdp });
    this.reapplyQuality();
    if (action === "rollback-then-answer") this.negotiationPending = true;
    this.flushPendingOffer();
  }

  private async onRemoteAnswer(msg: Frame) {
    await this.pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
    await this.drainCandidates();
    this.reapplyQuality();
    this.flushPendingOffer();
  }

  private async onRemoteCandidate(msg: Frame) {
    if (!msg.candidate) return;
    if (!this.pc.remoteDescription) {
      this.pendingCandidates.push(msg.candidate);
      return;
    }
    await this.pc.addIceCandidate(this.deps.createCandidate(msg.candidate));
  }

  private async drainCandidates() {
    const pending = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const c of pending) {
      try {
        await this.pc.addIceCandidate(this.deps.createCandidate(c));
      } catch (err) {
        this.emitError(err, "candidate");
      }
    }
  }

  // --- inbound media (Task 7) ---

  private onTracks(_msg: Frame) {}
  private onTrack(_ev: TrackEventLike) {}
  private closeExtras() {}

  private emitError(error: unknown, phase: string) {
    this.events.error({ error, phase });
  }
}
```

- [ ] **Step 6: Run tests**

Run: `cd mobile && npx jest test/codecs.test.ts test/peer.test.ts && npm run typecheck && npm run lint`
Expected: PASS. If "an offer needed while one is in flight" sends 3 offers, `start()` and the
emitted `negotiationneeded` both offered: confirm `makeOffer` sets `makingOffer` before its
first `await`.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/core/types.ts mobile/src/core/codecs.ts mobile/src/core/peer.ts mobile/test/fakes.ts mobile/test/codecs.test.ts mobile/test/peer.test.ts
git commit -m "feat(mobile): peer publishing and polite perfect negotiation"
```

---

### Task 7: Peer — remote tracks and media-failure recovery

**Files:**
- Modify: `mobile/src/core/peer.ts` (replace the three Task-6 stubs; add fields and constructor listeners)
- Test: `mobile/test/peerInbound.test.ts`

**Interfaces:**
- Consumes: everything from Task 6.
- Produces: `PeerEvents.remoteTrack` fires once per mid when both the `tracks` label and the `track` event are known; `peerGone` when a labelled mid disappears from a non-empty `tracks` list or its track ends; `mediaFailed` once, after one ICE restart fails to reconnect within 6000 ms (or immediately when `restartIce` is unavailable).

- [ ] **Step 1: Write the failing tests** — `mobile/test/peerInbound.test.ts`:

```ts
import { Peer } from "../src/core/peer";
import { FakePC, FakeSig, FakeStream, FakeTrack, FakeTimers, silentLog } from "./fakes";

function make(withRestart = true) {
  const sig = new FakeSig();
  const pc = new FakePC();
  if (!withRestart) (pc as any).restartIce = undefined;
  const timers = new FakeTimers();
  const ev = { remote: [] as any[], gone: [] as any[], failed: 0 };
  new Peer(sig, {
    createPeerConnection: () => pc, createStream: (t) => new FakeStream(t), createCandidate: (c) => c,
    videoCodecs: () => null, log: silentLog, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
  }, {
    remoteTrack: (e) => ev.remote.push(e), peerGone: (e) => ev.gone.push(e), error: () => {}, mediaFailed: () => ev.failed++,
  });
  return { sig, pc, timers, ev };
}

const trackEvent = (mid: string, kind = "video") => {
  const track = new FakeTrack(kind);
  return { track, transceiver: { mid }, streams: [new FakeStream([track])] };
};

test("label first, then media: one remote-track with a per-track stream", () => {
  const { sig, pc, ev } = make();
  sig.receive({ type: "tracks", tracks: [{ mid: "3", participantId: "p1", kind: "camera" }] });
  const te = trackEvent("3");
  pc.emit("track", te);
  pc.emit("track", te); // duplicate must not re-emit
  expect(ev.remote).toHaveLength(1);
  expect(ev.remote[0]).toMatchObject({ participantId: "p1", kind: "camera" });
  expect(ev.remote[0].stream.getTracks()).toEqual([te.track]);
  expect(ev.remote[0].stream).not.toBe(te.streams[0]);
});

test("media first, then label", () => {
  const { sig, pc, ev } = make();
  pc.emit("track", trackEvent("4", "audio"));
  expect(ev.remote).toHaveLength(0);
  sig.receive({ type: "tracks", tracks: [{ mid: "4", participantId: "p2", kind: "mic" }] });
  expect(ev.remote).toEqual([expect.objectContaining({ participantId: "p2", kind: "mic" })]);
});

test("an empty tracks list is ignored entirely, labels included", () => {
  const { sig, pc, ev } = make();
  sig.receive({ type: "tracks", tracks: [{ mid: "1", participantId: "p1", kind: "camera" }] });
  sig.receive({ type: "tracks", tracks: [] });
  pc.emit("track", trackEvent("1"));
  expect(ev.remote).toHaveLength(1);
  expect(ev.gone).toHaveLength(0);
});

test("a non-empty list retires held mids it no longer names", () => {
  const { sig, pc, ev } = make();
  sig.receive({ type: "tracks", tracks: [
    { mid: "1", participantId: "p1", kind: "camera" }, { mid: "2", participantId: "p2", kind: "mic" }] });
  pc.emit("track", trackEvent("1"));
  pc.emit("track", trackEvent("2", "audio"));
  sig.receive({ type: "tracks", tracks: [{ mid: "2", participantId: "p2", kind: "mic" }] });
  expect(ev.gone).toEqual([{ participantId: "p1", kind: "camera" }]);
});

test("a remote track ending retires it once", () => {
  const { sig, pc, ev } = make();
  sig.receive({ type: "tracks", tracks: [{ mid: "1", participantId: "p1", kind: "camera" }] });
  const te = trackEvent("1");
  pc.emit("track", te);
  te.track.end();
  sig.receive({ type: "tracks", tracks: [{ mid: "9", participantId: "p9", kind: "mic" }] });
  expect(ev.gone).toHaveLength(1);
});

test("ICE failure: one restart, then media-failed if not connected within 6s", () => {
  const { pc, timers, ev } = make();
  pc.setConnection("failed");
  expect(pc.restarts).toBe(1);
  pc.setConnection("failed"); // sibling events during the grace window
  expect(pc.restarts).toBe(1);
  timers.advance(5999);
  expect(ev.failed).toBe(0);
  timers.advance(1);
  expect(ev.failed).toBe(1);
  pc.setConnection("failed");
  expect(ev.failed).toBe(1);
});

test("recovering within the grace window cancels media-failed", () => {
  const { pc, timers, ev } = make();
  pc.setConnection("failed");
  pc.setConnection("connected");
  timers.advance(10_000);
  expect(ev.failed).toBe(0);
});

test("no restartIce support: media-failed immediately", () => {
  const { pc, ev } = make(false);
  pc.setConnection("failed");
  expect(ev.failed).toBe(1);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd mobile && npx jest test/peerInbound.test.ts`
Expected: FAIL — no `remoteTrack` emitted.

- [ ] **Step 3: Implement** — in `mobile/src/core/peer.ts`:

Add after the other `private` fields:

```ts
  private trackInfo = new Map<string, { participantId: string; kind: string }>();
  private incoming = new Map<string, { stream: StreamLike; emitted: boolean; info: { participantId: string; kind: string } | null }>();
  private restartedIce = false;
  private mediaFailedEmitted = false;
  private iceGraceTimer: unknown = null;
```

Add at the top of the file, after the imports:

```ts
// How long one ICE restart may take to reconnect before we give up.
const ICE_RESTART_GRACE_MS = 6000;
```

In the constructor, after the `track` listener:

```ts
    this.pc.addEventListener("connectionstatechange", () => this.onConnectionStateChange());
    this.pc.addEventListener("iceconnectionstatechange", () => this.onConnectionStateChange());
```

Replace the three stubs (`onTracks`, `onTrack`, `closeExtras`) with:

```ts
  // The SFU's mid -> {participantId, kind} labels. An EMPTY list carries no
  // information and is ignored entirely (see peer.js _onTracks for the incident).
  // A non-empty list is authoritative: held mids it no longer names are retired.
  private onTracks(msg: Frame) {
    const next = new Map<string, { participantId: string; kind: string }>();
    for (const t of msg.tracks || []) next.set(t.mid, { participantId: t.participantId, kind: t.kind });
    if (next.size === 0) return;
    for (const mid of [...this.incoming.keys()]) if (!next.has(mid)) this.onStreamGone(mid);
    this.trackInfo = next;
    for (const mid of next.keys()) this.emitRemoteTrack(mid);
  }

  private onTrack(ev: TrackEventLike) {
    const mid = ev.transceiver.mid;
    if (mid == null || this.incoming.has(mid)) return;
    // The SFU bundles a publisher's tracks under one stream id; wrap just this track.
    const stream = this.deps.createStream([ev.track]);
    this.incoming.set(mid, { stream, emitted: false, info: null });
    this.emitRemoteTrack(mid);
    ev.track.addEventListener?.("ended", () => this.onStreamGone(mid));
  }

  private emitRemoteTrack(mid: string) {
    const info = this.trackInfo.get(mid);
    const rec = this.incoming.get(mid);
    if (!info || !rec || rec.emitted) return;
    rec.emitted = true;
    rec.info = info;
    this.events.remoteTrack({ participantId: info.participantId, kind: info.kind, stream: rec.stream });
  }

  private onStreamGone(mid: string) {
    const rec = this.incoming.get(mid);
    if (!rec) return;
    this.incoming.delete(mid);
    const info = rec.info || this.trackInfo.get(mid);
    this.trackInfo.delete(mid);
    this.events.peerGone({ participantId: info?.participantId, kind: info?.kind });
  }

  // --- media-plane health: one ICE restart, then report ---

  private onConnectionStateChange() {
    if (this.pc.connectionState === "connected") {
      this.clearGrace();
      return;
    }
    if (this.pc.connectionState === "failed" || this.pc.iceConnectionState === "failed") this.handleMediaFailure();
  }

  private handleMediaFailure() {
    if (this.mediaFailedEmitted || this.iceGraceTimer !== null) return;
    if (!this.restartedIce && typeof this.pc.restartIce === "function") {
      this.restartedIce = true;
      try {
        this.pc.restartIce();
      } catch (err) {
        this.emitError(err, "ice-restart");
      }
      this.iceGraceTimer = this.deps.setTimeout(() => {
        this.iceGraceTimer = null;
        if (this.pc.connectionState !== "connected") this.emitMediaFailed();
      }, ICE_RESTART_GRACE_MS);
      return;
    }
    this.emitMediaFailed();
  }

  private emitMediaFailed() {
    if (this.mediaFailedEmitted) return;
    this.mediaFailedEmitted = true;
    this.clearGrace();
    this.events.mediaFailed();
  }

  private clearGrace() {
    if (this.iceGraceTimer !== null) {
      this.deps.clearTimeout(this.iceGraceTimer);
      this.iceGraceTimer = null;
    }
  }

  private closeExtras() {
    this.clearGrace();
  }
```

- [ ] **Step 4: Run all peer tests**

Run: `cd mobile && npx jest test/peer.test.ts test/peerInbound.test.ts && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/core/peer.ts mobile/test/peerInbound.test.ts
git commit -m "feat(mobile): pair remote tracks with SFU labels and recover from ICE failure"
```

---
### Task 8: Roster and grid (`core/roster.ts`, `core/grid.ts`)

**Files:**
- Create: `mobile/src/core/roster.ts`, `mobile/src/core/grid.ts`
- Test: `mobile/test/roster.test.ts`, `mobile/test/grid.test.ts`

**Interfaces:**
- Consumes: `stacksNarrow` (shared), `StreamLike` (types).
- Produces:
  ```ts
  export interface PeerInfo { id: string; name: string; role: string; mic: boolean; camera: boolean; ref?: string; gravatar?: string }
  export interface Participant { id: string; name: string; role: string; mic: boolean; camera: boolean; ref: string; gravatar: string;
    video: StreamLike | null; audio: StreamLike | null }
  export class Roster {
    seed(peers: PeerInfo[]): void; upsert(p: PeerInfo): void; remove(id: string): void;
    patch(id: string, fields: Partial<Pick<Participant, "name" | "role" | "mic" | "camera">>): void;
    setStream(id: string, kind: "camera" | "mic", stream: StreamLike | null): void;
    list(): Participant[]; subscribe(fn: () => void): () => void;
  }
  export function gridColumns(width: number, height: number, n: number): number;
  ```

Participant objects are replaced, never mutated, so React `memo` comparisons work.

- [ ] **Step 1: Write the failing tests** — `mobile/test/roster.test.ts`:

```ts
import { Roster } from "../src/core/roster";
import { FakeStream } from "./fakes";

const info = (id: string, extra = {}) => ({ id, name: id.toUpperCase(), role: "user", mic: true, camera: true, ...extra });

test("seed replaces everyone and drops streams; list keeps join order", () => {
  const r = new Roster();
  r.seed([info("a"), info("b")]);
  r.setStream("a", "camera", new FakeStream([]));
  r.seed([info("b"), info("c")]);
  expect(r.list().map((p) => p.id)).toEqual(["b", "c"]);
  expect(r.list().every((p) => p.video === null && p.audio === null)).toBe(true);
});

test("upsert keeps streams; patch replaces the object; remove notifies", () => {
  const r = new Roster();
  let n = 0;
  const unsub = r.subscribe(() => n++);
  r.upsert(info("a", { gravatar: "g", ref: "r1" }));
  const s = new FakeStream([]);
  r.setStream("a", "mic", s);
  r.upsert(info("a", { name: "Renamed" }));
  const before = r.list()[0];
  expect(before).toMatchObject({ name: "Renamed", audio: s, gravatar: "", ref: "" });
  r.patch("a", { mic: false });
  expect(r.list()[0]).not.toBe(before);
  expect(r.list()[0].mic).toBe(false);
  r.remove("a");
  expect(r.list()).toEqual([]);
  unsub();
  r.upsert(info("z"));
  expect(n).toBe(5);
});

test("a stream that arrives before its participant is attached on upsert", () => {
  const r = new Roster();
  const s = new FakeStream([]);
  r.setStream("late", "camera", s);
  expect(r.list()).toEqual([]);
  r.upsert(info("late"));
  expect(r.list()[0].video).toBe(s);
});

test("patch and setStream(null) on unknown ids are no-ops", () => {
  const r = new Roster();
  r.patch("nobody", { mic: false });
  r.setStream("nobody", "camera", null);
  expect(r.list()).toEqual([]);
});
```

`mobile/test/grid.test.ts`:

```ts
import { gridColumns } from "../src/core/grid";

test.each([
  [400, 800, 1, 1], // solo
  [400, 800, 3, 1], // portrait small call stacks (web narrow-stack rule)
  [400, 800, 5, 2],
  [400, 800, 9, 3],
  [800, 400, 2, 2], // landscape
  [800, 400, 5, 3],
  [800, 400, 16, 4],
  [800, 400, 30, 4],
])("%i x %i with %i tiles -> %i columns", (w, h, n, cols) => {
  expect(gridColumns(w, h, n)).toBe(cols);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd mobile && npx jest test/roster.test.ts test/grid.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement** — `mobile/src/core/roster.ts`:

```ts
import type { StreamLike } from "./types";

// A participant as the server describes it (signal.PeerInfo / PeerJoined).
export interface PeerInfo {
  id: string;
  name: string;
  role: string;
  mic: boolean;
  camera: boolean;
  ref?: string;
  gravatar?: string;
}

export interface Participant {
  id: string;
  name: string;
  role: string;
  mic: boolean;
  camera: boolean;
  ref: string;
  gravatar: string;
  video: StreamLike | null;
  audio: StreamLike | null;
}

type StreamSlot = "video" | "audio";
const slotFor = (kind: "camera" | "mic"): StreamSlot => (kind === "camera" ? "video" : "audio");

// The other participants in the room (the server never lists self). Objects are
// replaced on every change so UI memoisation can compare by identity.
export class Roster {
  private map = new Map<string, Participant>();
  // Remote media can be labelled before peer-joined is processed; hold it until then.
  private early = new Map<string, Partial<Record<StreamSlot, StreamLike>>>();
  private listeners = new Set<() => void>();

  seed(peers: PeerInfo[]): void {
    this.map.clear();
    this.early.clear();
    for (const p of peers) this.map.set(p.id, this.fromInfo(p, null));
    this.notify();
  }

  upsert(p: PeerInfo): void {
    this.map.set(p.id, this.fromInfo(p, this.map.get(p.id) || null));
    this.notify();
  }

  remove(id: string): void {
    this.early.delete(id);
    if (this.map.delete(id)) this.notify();
  }

  patch(id: string, fields: Partial<Pick<Participant, "name" | "role" | "mic" | "camera">>): void {
    const p = this.map.get(id);
    if (!p) return;
    this.map.set(id, { ...p, ...fields });
    this.notify();
  }

  setStream(id: string, kind: "camera" | "mic", stream: StreamLike | null): void {
    const slot = slotFor(kind);
    const p = this.map.get(id);
    if (!p) {
      if (stream) this.early.set(id, { ...this.early.get(id), [slot]: stream });
      return;
    }
    this.map.set(id, { ...p, [slot]: stream });
    this.notify();
  }

  list(): Participant[] {
    return [...this.map.values()];
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private fromInfo(p: PeerInfo, prev: Participant | null): Participant {
    const early = this.early.get(p.id);
    this.early.delete(p.id);
    return {
      id: p.id,
      name: p.name,
      role: p.role,
      mic: p.mic,
      camera: p.camera,
      ref: p.ref || "",
      gravatar: p.gravatar || "",
      video: early?.video ?? prev?.video ?? null,
      audio: early?.audio ?? prev?.audio ?? null,
    };
  }

  private notify() {
    for (const fn of [...this.listeners]) fn();
  }
}
```

`mobile/src/core/grid.ts`:

```ts
import { stacksNarrow } from "../shared/web";

// Columns for the call grid. Portrait small calls stack in one column using the web
// client's rule (lib/gridLayout.js), so both clients agree on when to stack.
export function gridColumns(width: number, height: number, n: number): number {
  if (n <= 1) return 1;
  if (stacksNarrow(width, height, n)) return 1;
  if (height > width) return n <= 8 ? 2 : 3;
  return Math.min(4, Math.ceil(Math.sqrt(n)));
}
```

- [ ] **Step 4: Run tests**

Run: `cd mobile && npx jest test/roster.test.ts test/grid.test.ts && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/core/roster.ts mobile/src/core/grid.ts mobile/test/roster.test.ts mobile/test/grid.test.ts
git commit -m "feat(mobile): participant roster and grid columns"
```

---

### Task 9: Gravatar hash, join-error wording, HTTP peeks (`gravatar.ts`, `errors.ts`, `api.ts`)

**Files:**
- Create: `mobile/src/core/gravatar.ts`, `mobile/src/core/errors.ts`, `mobile/src/core/api.ts`
- Test: `mobile/test/gravatar.test.ts`, `mobile/test/errors.test.ts`, `mobile/test/api.test.ts`

**Interfaces:**
- Consumes: `serverErrorDisposition` (shared), `RoomLink` (Task 4), `js-sha256`.
- Produces:
  ```ts
  export function gravatarHash(email: string): string;                      // "" for blank
  export function joinErrorText(code: string, message?: string): string;
  export function inCallErrorText(code: string, message?: string): string;
  export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;
  export function peekRoom(f: Fetcher, link: RoomLink): Promise<{ count: number; locked: boolean } | null>;
  export type InvitePeek = { status: "ok"; name: string } | { status: "invalid" } | { status: "unknown" };
  export function peekInvite(f: Fetcher, link: RoomLink): Promise<InvitePeek>;
  export function serverVersion(f: Fetcher, origin: string): Promise<string>;  // "" on failure
  ```

- [ ] **Step 1: Write the failing tests** — `mobile/test/gravatar.test.ts`:

```ts
import { gravatarHash } from "../src/core/gravatar";

// Same vector as internal/web/test/avatar.test.js, so both clients hash identically.
test("matches the web client's SHA-256 vector and normalizes case/space", () => {
  const want = "84059b07d4be67b806386c0aad8070a23f18836bbaae342275dc0a83414c32ee";
  expect(gravatarHash("MyEmailAddress@example.com")).toBe(want);
  expect(gravatarHash("  MYEMAILADDRESS@EXAMPLE.COM  ")).toBe(want);
});

test("blank input is empty", () => {
  expect(gravatarHash("")).toBe("");
  expect(gravatarHash("   ")).toBe("");
});
```

`mobile/test/errors.test.ts`:

```ts
import { joinErrorText, inCallErrorText } from "../src/core/errors";

test.each([
  ["bad-password", "Wrong password for this room."],
  ["banned", "You are banned from this room."],
  ["identified-only", "This room is for registered nicks only — join with an invite from !vc."],
  ["not-provisioned", "This room isn't active. Run !vc in its channel to open it."],
  ["token-invalid", "Your invite link is invalid."],
  ["token-expired", "Your invite link has expired — run !vc again for a fresh one."],
  ["protocol", "The server rejected the join request."],
  ["media", "The server could not set up media for this room."],
])("join error %s", (code, text) => {
  expect(joinErrorText(code, "dev message")).toBe(text);
});

test("unknown codes fall back to the server message, then a generic line", () => {
  expect(joinErrorText("weird", "server said")).toBe("server said");
  expect(joinErrorText("weird")).toBe("Something went wrong.");
});

test("in-call wording comes from the shared disposition", () => {
  expect(inCallErrorText("no-such-peer", "x")).toBe("They already left the call.");
  expect(inCallErrorText("other", "")).toBe("That action was refused.");
});
```

`mobile/test/api.test.ts`:

```ts
import { peekRoom, peekInvite, serverVersion, type Fetcher } from "../src/core/api";
import { parseRoomInput } from "../src/core/link";

function fetcher(routes: Record<string, { status: number; body?: unknown } | "throw">): Fetcher & { urls: string[] } {
  const urls: string[] = [];
  const f = (async (url: string) => {
    urls.push(url);
    const r = routes[url];
    if (!r || r === "throw") throw new Error("network");
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  }) as Fetcher & { urls: string[] };
  f.urls = urls;
  return f;
}

const link = parseRoomInput("https://vc.swiftirc.net/lounge#i=ab/c")!;

test("peekRoom", async () => {
  const f = fetcher({ "https://vc.swiftirc.net/api/rooms/lounge": { status: 200, body: { count: 3, locked: true } } });
  expect(await peekRoom(f, link)).toEqual({ count: 3, locked: true });
  expect(await peekRoom(fetcher({}), link)).toBeNull();
});

test("peekInvite: ok, invalid (404), unknown (other/network); id is URL-encoded", async () => {
  const url = "https://vc.swiftirc.net/api/invite/ab%2Fc";
  expect(await peekInvite(fetcher({ [url]: { status: 200, body: { name: "Ryan" } } }), link)).toEqual({ status: "ok", name: "Ryan" });
  expect(await peekInvite(fetcher({ [url]: { status: 404 } }), link)).toEqual({ status: "invalid" });
  expect(await peekInvite(fetcher({ [url]: { status: 500 } }), link)).toEqual({ status: "unknown" });
  expect(await peekInvite(fetcher({}), link)).toEqual({ status: "unknown" });
});

test("serverVersion", async () => {
  const f = fetcher({ "https://vc.swiftirc.net/api/version": { status: 200, body: { version: "abc123" } } });
  expect(await serverVersion(f, "https://vc.swiftirc.net")).toBe("abc123");
  expect(await serverVersion(fetcher({}), "https://vc.swiftirc.net")).toBe("");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd mobile && npx jest test/gravatar.test.ts test/errors.test.ts test/api.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement** — `mobile/src/core/gravatar.ts`:

```ts
import { sha256 } from "js-sha256";

// SHA-256 hex of the normalized email. Only the hash is ever sent; the raw email
// stays on the device. Matches gravatarHash in internal/web/assets/lib/avatar.js.
export function gravatarHash(email: string): string {
  const normalized = (email || "").trim().toLowerCase();
  return normalized ? sha256(normalized) : "";
}
```

`mobile/src/core/errors.ts`:

```ts
import { serverErrorDisposition } from "../shared/web";

// Join-reject wording, copied from ERROR_TEXT in internal/web/assets/ui/prejoin.js
// (that module is DOM code and cannot be imported). Keep the two in step.
const JOIN_ERROR_TEXT: Record<string, string> = {
  "bad-password": "Wrong password for this room.",
  banned: "You are banned from this room.",
  "identified-only": "This room is for registered nicks only — join with an invite from !vc.",
  "not-provisioned": "This room isn't active. Run !vc in its channel to open it.",
  "token-invalid": "Your invite link is invalid.",
  "token-expired": "Your invite link has expired — run !vc again for a fresh one.",
  protocol: "The server rejected the join request.",
  media: "The server could not set up media for this room.",
};

export function joinErrorText(code: string, message = ""): string {
  return JOIN_ERROR_TEXT[code] || serverErrorDisposition({ code, message, inCall: false }).text;
}

export function inCallErrorText(code: string, message = ""): string {
  return serverErrorDisposition({ code, message, inCall: true }).text;
}
```

`mobile/src/core/api.ts`:

```ts
import type { RoomLink } from "./link";

export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

// GET /api/rooms/{slug} -> {count, locked}; null when unreachable.
export async function peekRoom(f: Fetcher, link: RoomLink): Promise<{ count: number; locked: boolean } | null> {
  try {
    const res = await f(`${link.origin}/api/rooms/${link.slug}`);
    if (!res.ok) return null;
    const j = await res.json();
    return { count: Number(j?.count) || 0, locked: !!j?.locked };
  } catch {
    return null;
  }
}

export type InvitePeek = { status: "ok"; name: string } | { status: "invalid" } | { status: "unknown" };

// GET /api/invite/{id} -> {name}; 404 means unknown or expired. Does not consume the invite.
export async function peekInvite(f: Fetcher, link: RoomLink): Promise<InvitePeek> {
  try {
    const res = await f(`${link.origin}/api/invite/${encodeURIComponent(link.invite)}`);
    if (res.status === 404) return { status: "invalid" };
    if (!res.ok) return { status: "unknown" };
    const j = await res.json();
    return typeof j?.name === "string" ? { status: "ok", name: j.name } : { status: "unknown" };
  } catch {
    return { status: "unknown" };
  }
}

export async function serverVersion(f: Fetcher, origin: string): Promise<string> {
  try {
    const res = await f(`${origin}/api/version`);
    if (!res.ok) return "";
    const j = await res.json();
    return typeof j?.version === "string" ? j.version : "";
  } catch {
    return "";
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd mobile && npx jest test/gravatar.test.ts test/errors.test.ts test/api.test.ts && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/core/gravatar.ts mobile/src/core/errors.ts mobile/src/core/api.ts mobile/test/gravatar.test.ts mobile/test/errors.test.ts mobile/test/api.test.ts
git commit -m "feat(mobile): gravatar hash, join-error wording and server peeks"
```

---

### Task 10: Call controller (`core/call.ts`)

**Files:**
- Create: `mobile/src/core/call.ts`
- Test: `mobile/test/call.test.ts`

**Interfaces:**
- Consumes: `Signaling` (Task 5), `Peer`/`PeerEvents` (Tasks 6-7), `Roster`/`PeerInfo`/`Participant` (Task 8), `joinErrorText`/`inCallErrorText` (Task 9), `RoomLink`/`wsUrl` (Task 4).
- Produces:
  ```ts
  export type Facing = "user" | "environment";
  export type PeerLike = Pick<Peer, "start" | "publish" | "replaceTrack" | "setQuality" | "close">;
  export type SignalingLike = Pick<Signaling, "onOpen" | "onClose" | "on" | "connect" | "send" | "stop" | "reconnectNow" | "isOpen">;
  export interface MediaPort { getMic(): Promise<TrackLike | null>; getCamera(facing: Facing): Promise<TrackLike | null>;
    createStream(tracks: TrackLike[]): StreamLike }
  export interface SystemCallPort { start(callId: string, room: string, video: boolean): void; connected(callId: string): void;
    end(callId: string): void; setMuted(callId: string, muted: boolean): void }
  export interface CallDeps { createSignaling(url: string): SignalingLike; createPeer(sig: SignalingLike, events: PeerEvents): PeerLike;
    media: MediaPort; system: SystemCallPort; uuid(): string; log: Logger }
  export interface JoinRequest { link: RoomLink; name: string; password: string; gravatar: string; mic: boolean; camera: boolean }
  export type Phase = "idle" | "connecting" | "in-call" | "reconnecting" | "ended";
  export type Banner = "" | "reconnecting" | "media-lost";
  export interface CallState { phase: Phase; banner: Banner; slug: string; selfId: string; role: string; mic: boolean;
    camera: boolean; facing: Facing; localStream: StreamLike | null; participants: Participant[] }
  export type CallOutcome = { kind: "left" } | { kind: "rejected"; code: string; text: string }
    | { kind: "removed"; reason: "kicked" | "banned"; by: string };
  export interface CallEvents { change(state: CallState): void; end(outcome: CallOutcome): void; notice(text: string): void }
  export class Call {
    constructor(deps: CallDeps, events: CallEvents);
    getState(): CallState; join(req: JoinRequest): Promise<void>; leave(): void;
    setMic(on: boolean, fromSystem?: boolean): Promise<void>; setCamera(on: boolean): Promise<void>; flipCamera(): Promise<void>;
    onAppState(s: "active" | "background" | "inactive"): Promise<void>; onNetworkChange(connected: boolean): void;
    onSystemMute(muted: boolean): Promise<void>; onSystemEnd(): void; onHold(held: boolean): Promise<void>;
  }
  ```

Behaviour fixed by the spec, plus one deliberate departure from the web client: an
`error` is **fatal whenever it arrives before this socket's `joined`**, not only
before the first join. A ban or a newly-locked room met during a reconnect then ends
the call instead of reconnect-looping forever (the web client's `inCall: !prejoin`
would loop).

- [ ] **Step 1: Write the failing tests** — `mobile/test/call.test.ts`:

```ts
import { Call, type CallOutcome, type CallState, type JoinRequest } from "../src/core/call";
import type { PeerEvents } from "../src/core/peer";
import { parseRoomInput } from "../src/core/link";
import { Signaling } from "../src/core/signaling";
import type { Kind, TrackLike } from "../src/core/types";
import { FakeSocket, FakeStream, FakeTimers, FakeTrack, flush, silentLog } from "./fakes";

class FakePeer {
  started: Array<{ track: TrackLike; kind: Kind }> | null = null;
  closed = false;
  quality: string[] = [];
  published: Array<[Kind, TrackLike]> = [];
  replaced: Array<[Kind, TrackLike | null]> = [];
  private senders = new Set<Kind>();
  constructor(public events: PeerEvents) {}
  async start(local: Array<{ track: TrackLike; kind: Kind }>) {
    this.started = local;
    for (const l of local) this.senders.add(l.kind);
  }
  async publish(t: TrackLike, k: Kind) {
    this.published.push([k, t]);
    this.senders.add(k);
  }
  async replaceTrack(k: Kind, t: TrackLike | null) {
    if (!this.senders.has(k)) return false;
    this.replaced.push([k, t]);
    return true;
  }
  setQuality(c: string, s: string) {
    this.quality = [c, s];
  }
  close() {
    this.closed = true;
  }
}

function setup(opts: { micDenied?: boolean; camDenied?: boolean } = {}) {
  FakeSocket.all = [];
  const timers = new FakeTimers();
  const peers: FakePeer[] = [];
  const system: string[] = [];
  const notices: string[] = [];
  const ends: CallOutcome[] = [];
  const states: CallState[] = [];
  const mics: FakeTrack[] = [];
  const cams: FakeTrack[] = [];
  let ids = 0;
  const call = new Call({
    createSignaling: (url) => new Signaling(url, {
      createSocket: (u) => new FakeSocket(u), random: () => 0, log: silentLog,
      setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
    }),
    createPeer: (_sig, events) => {
      const p = new FakePeer(events);
      peers.push(p);
      return p;
    },
    media: {
      getMic: async () => (opts.micDenied ? null : (mics[mics.push(new FakeTrack("audio")) - 1])),
      getCamera: async () => (opts.camDenied ? null : (cams[cams.push(new FakeTrack("video")) - 1])),
      createStream: (t) => new FakeStream(t),
    },
    system: {
      start: (id, room, video) => system.push(`start ${id} ${room} ${video}`),
      connected: (id) => system.push(`connected ${id}`),
      end: (id) => system.push(`end ${id}`),
      setMuted: (id, m) => system.push(`muted ${id} ${m}`),
    },
    uuid: () => `u${++ids}`,
    log: silentLog,
  }, {
    change: (s) => states.push(s),
    end: (o) => ends.push(o),
    notice: (t) => notices.push(t),
  });
  return { call, timers, peers, system, notices, ends, states, mics, cams };
}

const req = (over: Partial<JoinRequest> = {}): JoinRequest => ({
  link: parseRoomInput("https://vc.swiftirc.net/lounge#i=inv1")!,
  name: "Ryan", password: "pw", gravatar: "g", mic: true, camera: true, ...over,
});
const joined = (over = {}) => ({
  type: "joined", selfId: "me", role: "user", quality: { camera: "low", screen: "auto" },
  peers: [{ id: "p1", name: "Alice", role: "op", mic: true, camera: false }], ...over,
});
const sock = () => FakeSocket.last();
const framesOf = (type: string) => FakeSocket.all.flatMap((s) => s.sent).filter((f) => f.type === type);

async function inCall(over: Partial<JoinRequest> = {}) {
  const t = setup();
  await t.call.join(req(over));
  sock().open();
  sock().receive(joined());
  await flush();
  return t;
}

test("join: system call first, join frame first on the socket, then in-call with a started peer", async () => {
  const { call, system, peers, mics, cams } = setup();
  await call.join(req());
  expect(system).toEqual(["start u2 lounge true"]);
  expect(sock().url).toBe("wss://vc.swiftirc.net/ws/lounge");
  sock().open();
  expect(sock().sent[0]).toEqual({
    type: "join", name: "Ryan", password: "pw", gravatar: "g", token: "", invite: "inv1", session: "u1", mic: true, camera: true,
  });
  sock().receive(joined());
  await flush();
  const s = call.getState();
  expect(s).toMatchObject({ phase: "in-call", banner: "", selfId: "me", role: "user", mic: true, camera: true });
  expect(s.participants.map((p) => p.name)).toEqual(["Alice"]);
  expect(s.localStream?.getTracks()).toEqual([cams[0]]);
  expect(system).toContain("connected u2");
  expect(peers[0].started).toEqual([{ track: mics[0], kind: "mic" }, { track: cams[0], kind: "camera" }]);
  expect(peers[0].quality).toEqual(["low", "auto"]);
});

test("reconnect: banner, same session, current media state, rebuilt peer, connected reported once", async () => {
  const { call, timers, peers, system } = await inCall();
  sock().drop();
  expect(call.getState()).toMatchObject({ phase: "reconnecting", banner: "reconnecting" });
  await call.setMic(false); // toggled while disconnected
  timers.advance(500);
  sock().open();
  expect(sock().sent[0]).toMatchObject({ type: "join", session: "u1", mic: false, camera: true });
  sock().receive(joined({ peers: [] }));
  await flush();
  expect(peers).toHaveLength(2);
  expect(peers[0].closed).toBe(true);
  expect(peers[1].started?.map((l) => l.kind)).toEqual(["mic", "camera"]);
  expect(call.getState()).toMatchObject({ phase: "in-call", banner: "", participants: [] });
  expect(system.filter((x) => x.startsWith("connected"))).toHaveLength(1);
});

test("an error before joined ends the call as rejected and never reconnects", async () => {
  const { call, timers, ends, system, mics } = setup();
  await call.join(req());
  sock().open();
  sock().receive({ type: "error", code: "bad-password", message: "x" });
  expect(ends).toEqual([{ kind: "rejected", code: "bad-password", text: "Wrong password for this room." }]);
  expect(call.getState().phase).toBe("ended");
  expect(system.at(-1)).toBe("end u2");
  expect(mics[0].stopped).toBe(true);
  timers.advance(60_000);
  expect(FakeSocket.all).toHaveLength(1);
});

test("an error in a call is a notice; the call continues", async () => {
  const { call, notices, ends } = await inCall();
  sock().receive({ type: "error", code: "no-such-peer", message: "x" });
  expect(notices).toEqual(["They already left the call."]);
  expect(ends).toEqual([]);
  expect(call.getState().phase).toBe("in-call");
});

test("an error after a reconnect but before re-joined is fatal (no reconnect loop)", async () => {
  const { call, timers, ends } = await inCall();
  sock().drop();
  timers.advance(500);
  sock().open();
  sock().receive({ type: "error", code: "banned", message: "x" });
  expect(ends).toEqual([{ kind: "rejected", code: "banned", text: "You are banned from this room." }]);
  timers.advance(60_000);
  expect(FakeSocket.all).toHaveLength(2);
  expect(call.getState().phase).toBe("ended");
});

test("kicked: removed, devices released, system call ended, never rejoins", async () => {
  const { call, timers, ends, system, peers, mics, cams } = await inCall();
  sock().receive({ type: "kicked", by: "Alice" });
  expect(ends).toEqual([{ kind: "removed", reason: "kicked", by: "Alice" }]);
  expect(sock().closed).toBe(true);
  expect(peers[0].closed).toBe(true);
  expect(mics[0].stopped && cams[0].stopped).toBe(true);
  expect(system.at(-1)).toBe("end u2");
  timers.advance(60_000);
  expect(FakeSocket.all).toHaveLength(1);
  expect(call.getState().phase).toBe("ended");
});

test("banned frame behaves like kicked", async () => {
  const { ends } = await inCall();
  sock().receive({ type: "banned", by: "Op" });
  expect(ends).toEqual([{ kind: "removed", reason: "banned", by: "Op" }]);
});

test("leave stops everything and reports left", async () => {
  const { call, ends, system } = await inCall();
  call.leave();
  call.leave();
  expect(ends).toEqual([{ kind: "left" }]);
  expect(system.filter((x) => x.startsWith("end"))).toHaveLength(1);
});

test("leave during device acquisition does not connect", async () => {
  const { call, ends } = setup();
  const p = call.join(req());
  call.leave();
  await p;
  expect(FakeSocket.all).toHaveLength(0);
  expect(ends).toEqual([{ kind: "left" }]);
});

test("mic toggle: track, media-state, system mute; the system's echo is a no-op", async () => {
  const { call, system, mics } = await inCall();
  await call.setMic(false);
  expect(mics[0].enabled).toBe(false);
  expect(framesOf("media-state")).toEqual([{ type: "media-state", mic: false, camera: true }]);
  expect(system.at(-1)).toBe("muted u2 true");
  const before = system.length;
  await call.onSystemMute(true); // CallKit reporting back our own setMuted
  expect(framesOf("media-state")).toHaveLength(1);
  expect(system).toHaveLength(before);
});

test("a mute from the system UI applies without calling back into it", async () => {
  const { call, system } = await inCall();
  const before = system.length;
  await call.onSystemMute(true);
  expect(call.getState().mic).toBe(false);
  expect(framesOf("media-state")).toEqual([{ type: "media-state", mic: false, camera: true }]);
  expect(system).toHaveLength(before);
});

test("hold mutes; unhold restores the previous mic state", async () => {
  const { call } = await inCall();
  await call.onHold(true);
  expect(call.getState().mic).toBe(false);
  await call.onHold(false);
  expect(call.getState().mic).toBe(true);
  await call.setMic(false);
  await call.onHold(true);
  await call.onHold(false);
  expect(call.getState().mic).toBe(false);
});

test("background turns the camera off; foreground restores it and reconnects a dead socket", async () => {
  const { call, peers, cams } = await inCall();
  await call.onAppState("background");
  expect(call.getState().camera).toBe(false);
  expect(cams[0].stopped).toBe(true);
  expect(peers[0].replaced.at(-1)).toEqual(["camera", null]);
  expect(framesOf("media-state").at(-1)).toMatchObject({ camera: false });
  sock().drop(); // died silently while backgrounded
  await call.onAppState("active");
  expect(FakeSocket.all).toHaveLength(2); // immediate, no backoff wait
  expect(call.getState().camera).toBe(true);
  expect(peers[0].replaced.at(-1)).toEqual(["camera", cams[1]]);
});

test("a camera the user turned off stays off after foregrounding", async () => {
  const { call, cams } = await inCall();
  await call.setCamera(false);
  await call.onAppState("background");
  await call.onAppState("active");
  expect(call.getState().camera).toBe(false);
  expect(cams).toHaveLength(1);
});

test("network regained reconnects immediately only when the socket is down", async () => {
  const { call } = await inCall();
  call.onNetworkChange(true);
  expect(FakeSocket.all).toHaveLength(1);
  sock().drop();
  call.onNetworkChange(true);
  expect(FakeSocket.all).toHaveLength(2);
});

test("permission denied: joins with devices off, later toggles retry and notice", async () => {
  const t = setup({ micDenied: true, camDenied: true });
  await t.call.join(req());
  sock().open();
  expect(sock().sent[0]).toMatchObject({ mic: false, camera: false });
  sock().receive(joined());
  await flush();
  expect(t.peers[0].started).toEqual([]);
  t.notices.length = 0;
  await t.call.setMic(true);
  await t.call.setCamera(true);
  expect(t.call.getState()).toMatchObject({ mic: false, camera: false });
  expect(t.notices).toEqual(["Microphone unavailable.", "Camera unavailable."]);
});

test("turning the camera on with no camera sender publishes it", async () => {
  const { call, peers, cams } = await inCall({ camera: false });
  await call.setCamera(true);
  expect(peers[0].published).toEqual([["camera", cams[0]]]);
  expect(framesOf("media-state").at(-1)).toMatchObject({ camera: true });
});

test("flip swaps the camera track in place", async () => {
  const { call, peers, cams } = await inCall();
  await call.flipCamera();
  expect(call.getState().facing).toBe("environment");
  expect(peers[0].replaced.at(-1)).toEqual(["camera", cams[1]]);
  expect(cams[0].stopped).toBe(true);
});

test("remote camera and mic streams land in the roster; screenshares are ignored", async () => {
  const { call, peers } = await inCall();
  const v = new FakeStream([]);
  peers[0].events.remoteTrack({ participantId: "p1", kind: "camera", stream: v });
  peers[0].events.remoteTrack({ participantId: "p1", kind: "screen", stream: new FakeStream([]) });
  expect(call.getState().participants[0].video).toBe(v);
  peers[0].events.peerGone({ participantId: "p1", kind: "camera" });
  expect(call.getState().participants[0].video).toBeNull();
});

test("roster frames: join, media state, rename, role, leave", async () => {
  const { call } = await inCall();
  sock().receive({ type: "peer-joined", id: "p2", name: "Bob", role: "guest", mic: false, camera: true });
  sock().receive({ type: "peer-media-state", id: "p2", mic: true, camera: false });
  sock().receive({ type: "peer-renamed", id: "p2", name: "Robert" });
  sock().receive({ type: "role", id: "p2", role: "op" });
  expect(call.getState().participants[1]).toMatchObject({ name: "Robert", role: "op", mic: true, camera: false });
  sock().receive({ type: "peer-left", id: "p2" });
  expect(call.getState().participants.map((p) => p.id)).toEqual(["p1"]);
});

test("self rename and role are kept for the next join", async () => {
  const { call, timers } = await inCall();
  sock().receive({ type: "peer-renamed", id: "me", name: "NewNick" });
  sock().receive({ type: "role", id: "me", role: "op" });
  expect(call.getState().role).toBe("op");
  sock().drop();
  timers.advance(500);
  sock().open();
  expect(sock().sent[0]).toMatchObject({ type: "join", name: "NewNick" });
});

test("media failure shows the banner and replaces the socket for a full rejoin", async () => {
  const { call, peers } = await inCall();
  peers[0].events.mediaFailed();
  expect(call.getState().banner).toBe("media-lost");
  expect(FakeSocket.all).toHaveLength(2);
  expect(FakeSocket.all[0].closed).toBe(true);
});

test("server-restarting shows the banner without stopping", async () => {
  const { call } = await inCall();
  sock().receive({ type: "server-restarting" });
  expect(call.getState().banner).toBe("reconnecting");
  expect(sock().closed).toBe(false);
});

test("op force-mute and quality frames apply", async () => {
  const { call, peers } = await inCall();
  sock().receive({ type: "muted", kind: "mic" });
  expect(call.getState().mic).toBe(false);
  sock().receive({ type: "muted", kind: "camera" });
  await flush();
  expect(call.getState().camera).toBe(false);
  sock().receive({ type: "quality", camera: "high", screen: "low" });
  expect(peers[0].quality).toEqual(["high", "low"]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd mobile && npx jest test/call.test.ts`
Expected: FAIL — module `../src/core/call` not found.

- [ ] **Step 3: Implement** — `mobile/src/core/call.ts`:

```ts
// The call controller: one room session from join to end. Owns the signaling
// socket, the media Peer (rebuilt on every server-side rejoin), local tracks, the
// roster and the system-call integration (CallKit / ConnectionService), and exposes
// one immutable CallState snapshot for the UI. Port of the join/rejoin/removal flow
// in internal/web/assets/app.js, plus the mobile lifecycle rules from the spec.
import { inCallErrorText, joinErrorText } from "./errors";
import { wsUrl, type RoomLink } from "./link";
import type { Peer, PeerEvents } from "./peer";
import { Roster, type Participant, type PeerInfo } from "./roster";
import type { Signaling } from "./signaling";
import type { Frame, Kind, Logger, StreamLike, TrackLike } from "./types";

export type Facing = "user" | "environment";
export type PeerLike = Pick<Peer, "start" | "publish" | "replaceTrack" | "setQuality" | "close">;
export type SignalingLike = Pick<Signaling, "onOpen" | "onClose" | "on" | "connect" | "send" | "stop" | "reconnectNow" | "isOpen">;

export interface MediaPort {
  getMic(): Promise<TrackLike | null>; // null: denied or unavailable
  getCamera(facing: Facing): Promise<TrackLike | null>;
  createStream(tracks: TrackLike[]): StreamLike;
}

export interface SystemCallPort {
  start(callId: string, room: string, video: boolean): void;
  connected(callId: string): void;
  end(callId: string): void;
  setMuted(callId: string, muted: boolean): void;
}

export interface CallDeps {
  createSignaling(url: string): SignalingLike;
  createPeer(sig: SignalingLike, events: PeerEvents): PeerLike;
  media: MediaPort;
  system: SystemCallPort;
  uuid(): string;
  log: Logger;
}

export interface JoinRequest {
  link: RoomLink;
  name: string;
  password: string;
  gravatar: string;
  mic: boolean;
  camera: boolean;
}

export type Phase = "idle" | "connecting" | "in-call" | "reconnecting" | "ended";
export type Banner = "" | "reconnecting" | "media-lost";

export interface CallState {
  phase: Phase;
  banner: Banner;
  slug: string;
  selfId: string;
  role: string;
  mic: boolean;
  camera: boolean;
  facing: Facing;
  localStream: StreamLike | null;
  participants: Participant[];
}

export type CallOutcome =
  | { kind: "left" }
  | { kind: "rejected"; code: string; text: string }
  | { kind: "removed"; reason: "kicked" | "banned"; by: string };

export interface CallEvents {
  change(state: CallState): void;
  end(outcome: CallOutcome): void;
  notice(text: string): void;
}

export class Call {
  private sig: SignalingLike | null = null;
  private peer: PeerLike | null = null;
  private roster = new Roster();
  private req: JoinRequest | null = null;
  private session = "";
  private callId = "";
  private micTrack: TrackLike | null = null;
  private camTrack: TrackLike | null = null;
  private joinedOnce = false;
  // True from each socket open (join sent) until that socket's `joined`: an `error`
  // in this window is a refused join and is fatal, even on a reconnect.
  private awaitingJoined = false;
  private cameraBeforeBackground = false;
  private micBeforeHold: boolean | null = null;
  private quality = { camera: "auto", screen: "auto" };
  private state: CallState = {
    phase: "idle", banner: "", slug: "", selfId: "", role: "", mic: false, camera: false,
    facing: "user", localStream: null, participants: [],
  };

  constructor(private deps: CallDeps, private events: CallEvents) {
    this.roster.subscribe(() => this.update({ participants: this.roster.list() }));
  }

  getState(): CallState {
    return this.state;
  }

  async join(req: JoinRequest): Promise<void> {
    if (this.state.phase !== "idle") throw new Error("Call.join may only be called once");
    this.req = req;
    this.session = this.deps.uuid(); // binds a #i= invite to this call, across reconnects
    this.callId = this.deps.uuid();
    this.update({ phase: "connecting", slug: req.link.slug });
    this.deps.system.start(this.callId, req.link.slug, req.camera);

    this.micTrack = await this.deps.media.getMic();
    if (this.micTrack) this.micTrack.enabled = req.mic;
    else if (req.mic) this.events.notice("Microphone unavailable — joining muted.");
    if (req.camera && this.isLive()) {
      this.camTrack = await this.deps.media.getCamera("user");
      if (!this.camTrack) this.events.notice("Camera unavailable — joining with it off.");
    }
    if (!this.isLive()) {
      this.releaseTracks(); // left while devices were being acquired
      return;
    }
    const mic = !!this.micTrack && req.mic;
    this.update({ mic, camera: !!this.camTrack });
    this.refreshLocalStream();
    if (!mic) this.deps.system.setMuted(this.callId, true);

    const sig = this.deps.createSignaling(wsUrl(req.link));
    this.sig = sig;
    sig.onOpen(() => {
      this.awaitingJoined = true;
      sig.send("join", this.joinFrame());
    });
    sig.onClose(() => {
      if (this.state.phase === "in-call") this.update({ phase: "reconnecting", banner: "reconnecting" });
    });
    sig.on("joined", (m) => this.onJoined(m));
    sig.on("error", (m) => this.onServerError(m));
    sig.on("kicked", (m) => this.finish({ kind: "removed", reason: "kicked", by: m.by || "" }));
    sig.on("banned", (m) => this.finish({ kind: "removed", reason: "banned", by: m.by || "" }));
    sig.on("server-restarting", () => this.update({ banner: "reconnecting" }));
    sig.on("peer-joined", (m) => this.roster.upsert(m as unknown as PeerInfo));
    sig.on("peer-left", (m) => this.roster.remove(m.id));
    sig.on("peer-media-state", (m) => this.roster.patch(m.id, { mic: !!m.mic, camera: !!m.camera }));
    sig.on("peer-renamed", (m) => this.onRenamed(m));
    sig.on("role", (m) => this.onRole(m));
    sig.on("muted", (m) => void this.onForceMuted(m.kind));
    sig.on("quality", (m) => this.onQuality(m));
    sig.connect();
  }

  leave(): void {
    this.finish({ kind: "left" });
  }

  async setMic(on: boolean, fromSystem = false): Promise<void> {
    if (!this.isLive() || on === this.state.mic) return; // equal: e.g. CallKit echoing our setMuted
    if (on && !this.micTrack) {
      const t = await this.deps.media.getMic();
      if (!t || !this.isLive()) {
        t?.stop();
        this.events.notice("Microphone unavailable.");
        if (fromSystem) this.deps.system.setMuted(this.callId, true);
        return;
      }
      this.micTrack = t;
      if (this.peer) await this.peer.publish(t, "mic");
    }
    if (this.micTrack) this.micTrack.enabled = on;
    this.update({ mic: on });
    if (!fromSystem) this.deps.system.setMuted(this.callId, !on);
    this.sendMediaState();
  }

  async setCamera(on: boolean): Promise<void> {
    if (!this.isLive() || on === this.state.camera) return;
    if (!on) {
      const old = this.camTrack;
      this.camTrack = null;
      this.update({ camera: false });
      this.refreshLocalStream();
      if (this.peer) await this.peer.replaceTrack("camera", null);
      old?.stop();
      this.sendMediaState();
      return;
    }
    const t = await this.deps.media.getCamera(this.state.facing);
    if (!t) {
      this.events.notice("Camera unavailable.");
      return;
    }
    if (!this.isLive() || this.state.camera) {
      t.stop();
      return;
    }
    this.camTrack = t;
    this.update({ camera: true });
    this.refreshLocalStream();
    if (this.peer && !(await this.peer.replaceTrack("camera", t))) await this.peer.publish(t, "camera");
    this.sendMediaState();
  }

  async flipCamera(): Promise<void> {
    const facing: Facing = this.state.facing === "user" ? "environment" : "user";
    if (!this.state.camera) {
      this.update({ facing });
      return;
    }
    const t = await this.deps.media.getCamera(facing);
    if (!t) {
      this.events.notice("Could not switch camera.");
      return;
    }
    const old = this.camTrack;
    this.camTrack = t;
    this.update({ facing });
    this.refreshLocalStream();
    if (this.peer) await this.peer.replaceTrack("camera", t);
    old?.stop();
  }

  // Camera off in the background on both platforms (spec); on return, restore it if
  // it was on, and reconnect at once if the socket died while we were away.
  async onAppState(s: "active" | "background" | "inactive"): Promise<void> {
    if (!this.isLive()) return;
    if (s === "background") {
      if (this.state.camera) {
        this.cameraBeforeBackground = true;
        await this.setCamera(false);
      }
      return;
    }
    if (s === "active") {
      if (this.sig && !this.sig.isOpen) this.sig.reconnectNow();
      if (this.cameraBeforeBackground) {
        this.cameraBeforeBackground = false;
        await this.setCamera(true);
      }
    }
  }

  onNetworkChange(connected: boolean): void {
    if (connected && this.isLive() && this.sig && !this.sig.isOpen) this.sig.reconnectNow();
  }

  async onSystemMute(muted: boolean): Promise<void> {
    await this.setMic(!muted, true);
  }

  onSystemEnd(): void {
    this.leave();
  }

  async onHold(held: boolean): Promise<void> {
    if (held) {
      if (this.micBeforeHold === null) this.micBeforeHold = this.state.mic;
      await this.setMic(false, true);
      return;
    }
    const restore = this.micBeforeHold;
    this.micBeforeHold = null;
    if (restore) await this.setMic(true, true);
  }

  // --- server frames ---

  private onJoined(m: Frame) {
    this.awaitingJoined = false;
    const first = !this.joinedOnce;
    this.joinedOnce = true;
    if (m.quality) this.quality = { camera: m.quality.camera || "auto", screen: m.quality.screen || "auto" };
    this.roster.seed((m.peers || []) as PeerInfo[]);
    this.update({ phase: "in-call", banner: "", selfId: m.selfId, role: m.role || "" });
    if (first) this.deps.system.connected(this.callId);
    this.rebuildPeer();
  }

  private onServerError(m: Frame) {
    if (this.awaitingJoined || !this.joinedOnce) {
      this.finish({ kind: "rejected", code: m.code || "error", text: joinErrorText(m.code || "", m.message || "") });
      return;
    }
    this.events.notice(inCallErrorText(m.code || "", m.message || ""));
  }

  private onRenamed(m: Frame) {
    if (m.id === this.state.selfId) {
      if (this.req) this.req = { ...this.req, name: m.name }; // the next join must carry it
      return;
    }
    this.roster.patch(m.id, { name: m.name });
  }

  private onRole(m: Frame) {
    if (m.id === this.state.selfId) this.update({ role: m.role });
    else this.roster.patch(m.id, { role: m.role });
  }

  private async onForceMuted(kind: string) {
    if (kind === "mic") await this.setMic(false);
    else if (kind === "camera") await this.setCamera(false);
  }

  private onQuality(m: Frame) {
    this.quality = { camera: m.camera || "auto", screen: m.screen || "auto" };
    this.peer?.setQuality(this.quality.camera, this.quality.screen);
  }

  // --- media ---

  // The server builds a fresh SFU peer on every join, so ours is rebuilt to match
  // and republishes whatever we currently send.
  private rebuildPeer() {
    this.peer?.close();
    const peer = this.deps.createPeer(this.sig!, {
      remoteTrack: (e) => {
        if (e.kind === "camera" || e.kind === "mic") this.roster.setStream(e.participantId, e.kind, e.stream);
      },
      peerGone: (e) => {
        if (e.participantId && (e.kind === "camera" || e.kind === "mic")) this.roster.setStream(e.participantId, e.kind, null);
      },
      error: (e) => this.deps.log.warn(`[call] peer ${e.phase} failed`, e.error),
      mediaFailed: () => {
        this.update({ banner: "media-lost" });
        this.sig?.reconnectNow();
      },
    });
    this.peer = peer;
    peer.setQuality(this.quality.camera, this.quality.screen);
    const local: Array<{ track: TrackLike; kind: Kind }> = [];
    if (this.micTrack) local.push({ track: this.micTrack, kind: "mic" });
    if (this.camTrack) local.push({ track: this.camTrack, kind: "camera" });
    peer.start(local).catch((err) => this.deps.log.warn("[call] peer start failed", err));
  }

  private sendMediaState() {
    if (this.state.phase === "in-call") this.sig?.send("media-state", { mic: this.state.mic, camera: this.state.camera });
  }

  private joinFrame() {
    const r = this.req!;
    return {
      name: r.name, password: r.password, gravatar: r.gravatar, token: r.link.token, invite: r.link.invite,
      session: this.session, mic: this.state.mic, camera: this.state.camera,
    };
  }

  private refreshLocalStream() {
    this.update({ localStream: this.camTrack ? this.deps.media.createStream([this.camTrack]) : null });
  }

  private releaseTracks() {
    this.micTrack?.stop();
    this.camTrack?.stop();
    this.micTrack = null;
    this.camTrack = null;
    this.update({ localStream: null });
  }

  private isLive(): boolean {
    return this.state.phase !== "idle" && this.state.phase !== "ended";
  }

  private finish(outcome: CallOutcome) {
    if (this.state.phase === "ended") return;
    this.sig?.stop();
    this.peer?.close();
    this.peer = null;
    this.releaseTracks();
    if (this.callId) this.deps.system.end(this.callId);
    this.update({ phase: "ended", banner: "" });
    this.events.end(outcome);
  }

  private update(patch: Partial<CallState>) {
    this.state = { ...this.state, ...patch };
    this.events.change(this.state);
  }
}
```

Note on `leave()` before `join()` resolves: `finish` runs with `callId` already set
(join assigns it synchronously before its first `await`), so the system call that
`join` started is always ended.

- [ ] **Step 4: Run tests**

Run: `cd mobile && npx jest test/call.test.ts && npm test && npm run typecheck && npm run lint`
Expected: PASS (whole suite).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/core/call.ts mobile/test/call.test.ts
git commit -m "feat(mobile): call controller with rejoin, lifecycle and system-call sync"
```

---
### Task 11: Native adapters (WebRTC, storage, lifecycle, audio route, linking, permissions)

Device-facing glue. The decisions inside them are pulled out into small pure modules
(`core/recent.ts`, `core/uuid.ts`, `core/audioRoutes.ts`) that are unit-tested; the
adapters themselves are verified by typecheck, lint, the Android build, and
MANUAL-TEST.md.

**Files:**
- Create: `mobile/src/core/recent.ts`, `mobile/src/core/uuid.ts`, `mobile/src/core/audioRoutes.ts`
- Create: `mobile/src/native/webrtc.ts`, `storage.ts`, `lifecycle.ts`, `audioRoute.ts`, `linking.ts`, `permissions.ts`
- Test: `mobile/test/recent.test.ts`, `mobile/test/uuid.test.ts`, `mobile/test/audioRoutes.test.ts`

**Interfaces:**
- Consumes: `MediaPort`, `Facing`, `Call` (Task 10); `RoomLink` (Task 4); core types.
- Produces:
  ```ts
  // core/recent.ts
  export interface RecentRoom { origin: string; host: string; slug: string; at: number }
  export function mergeRecent(list: RecentRoom[], link: RoomLink, now: number, max?: number): RecentRoom[];
  export function recentInput(r: RecentRoom): string;   // "https://host/slug" (never carries an invite)
  // core/uuid.ts
  export function uuidV4(random: () => number): string;
  // core/audioRoutes.ts
  export interface AudioRoutes { available: string[]; selected: string }
  export function nextRoute(r: AudioRoutes): string | null;
  export function routeLabel(route: string): string;
  // native/webrtc.ts
  export function createPeerConnection(): PeerConnectionLike; export function createStream(t: TrackLike[]): StreamLike;
  export function createCandidate(init: unknown): unknown; export function videoCodecs(): CodecLike[] | null; export const media: MediaPort;
  // native/storage.ts
  export interface Prefs { name: string; email: string; mic: boolean; camera: boolean }
  export function loadPrefs(): Promise<Prefs>; export function savePrefs(p: Prefs): Promise<void>;
  export function loadRecent(): Promise<RecentRoom[]>; export function rememberRoom(link: RoomLink): Promise<RecentRoom[]>;
  // native/lifecycle.ts
  export function watchLifecycle(call: Pick<Call, "onAppState" | "onNetworkChange">): () => void;
  // native/audioRoute.ts
  export function startCallAudio(video: boolean): void; export function stopCallAudio(): void;
  export function watchRoutes(fn: (r: AudioRoutes) => void): () => void; export function cycleRoute(r: AudioRoutes): Promise<void>;
  // native/linking.ts
  export function initialUrl(): Promise<string | null>; export function watchUrls(fn: (url: string) => void): () => void;
  // native/permissions.ts
  export function requestCallPermissions(wantCamera: boolean): Promise<void>;
  ```

- [ ] **Step 1: Write the failing tests** — `mobile/test/recent.test.ts`:

```ts
import { mergeRecent, recentInput } from "../src/core/recent";
import { parseRoomInput } from "../src/core/link";

const L = (s: string) => parseRoomInput(s)!;

test("newest first, deduped by host+slug, capped, invite never stored", () => {
  let list = mergeRecent([], L("https://vc.swiftirc.net/a#i=secret"), 1);
  list = mergeRecent(list, L("b"), 2);
  list = mergeRecent(list, L("A"), 3);
  expect(list.map((r) => [r.slug, r.at])).toEqual([["a", 3], ["b", 2]]);
  expect(recentInput(list[0])).toBe("https://vc.swiftirc.net/a");
  expect(JSON.stringify(list)).not.toContain("secret");
  for (let i = 0; i < 20; i++) list = mergeRecent(list, L(`r${i}`), 10 + i);
  expect(list).toHaveLength(10);
  expect(list[0].slug).toBe("r19");
});

test("same slug on another host is a separate entry", () => {
  const list = mergeRecent(mergeRecent([], L("x"), 1), L("http://localhost:8080/x"), 2);
  expect(list.map((r) => r.host)).toEqual(["localhost:8080", "vc.swiftirc.net"]);
});
```

`mobile/test/uuid.test.ts`:

```ts
import { uuidV4 } from "../src/core/uuid";

test("RFC 4122 v4 shape", () => {
  let i = 0;
  const seq = () => ((i++ * 0.137) % 1);
  const id = uuidV4(seq);
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(uuidV4(Math.random)).not.toBe(uuidV4(Math.random));
});
```

`mobile/test/audioRoutes.test.ts`:

```ts
import { nextRoute, routeLabel } from "../src/core/audioRoutes";

test("cycles through available routes in a fixed order", () => {
  const available = ["SPEAKER_PHONE", "EARPIECE", "BLUETOOTH"];
  expect(nextRoute({ available, selected: "EARPIECE" })).toBe("SPEAKER_PHONE");
  expect(nextRoute({ available, selected: "SPEAKER_PHONE" })).toBe("BLUETOOTH");
  expect(nextRoute({ available, selected: "BLUETOOTH" })).toBe("EARPIECE");
  expect(nextRoute({ available, selected: "" })).toBe("EARPIECE");
});

test("nothing to switch to", () => {
  expect(nextRoute({ available: ["SPEAKER_PHONE"], selected: "SPEAKER_PHONE" })).toBeNull();
  expect(nextRoute({ available: [], selected: "" })).toBeNull();
});

test("labels", () => {
  expect(routeLabel("BLUETOOTH")).toBe("Bluetooth");
  expect(routeLabel("WIRED_HEADSET")).toBe("Headset");
  expect(routeLabel("SPEAKER_PHONE")).toBe("Speaker");
  expect(routeLabel("EARPIECE")).toBe("Phone");
  expect(routeLabel("???")).toBe("Audio");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd mobile && npx jest test/recent.test.ts test/uuid.test.ts test/audioRoutes.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the pure modules** — `mobile/src/core/recent.ts`:

```ts
import type { RoomLink } from "./link";

export interface RecentRoom {
  origin: string;
  host: string;
  slug: string;
  at: number; // ms since epoch
}

const MAX_RECENT = 10;

// Recently joined rooms, newest first. Invites and tokens are never stored: an #i=
// invite is single-use, and a recent entry re-joins as a plain room link.
export function mergeRecent(list: RecentRoom[], link: RoomLink, now: number, max = MAX_RECENT): RecentRoom[] {
  const entry: RecentRoom = { origin: link.origin, host: link.host, slug: link.slug, at: now };
  const rest = list.filter((r) => !(r.host === link.host && r.slug === link.slug));
  return [entry, ...rest].slice(0, max);
}

export function recentInput(r: RecentRoom): string {
  return `${r.origin}/${r.slug}`;
}
```

`mobile/src/core/uuid.ts`:

```ts
// RFC 4122 version-4 UUID from an injected random source (Hermes has no
// crypto.randomUUID). Used for CallKit call ids and the per-call session nonce;
// the nonce only binds an invite to this call, it is not a credential.
export function uuidV4(random: () => number): string {
  const bytes = Array.from({ length: 16 }, () => Math.floor(random() * 256) & 0xff);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
```

`mobile/src/core/audioRoutes.ts`:

```ts
// Android audio routes as react-native-incall-manager names them.
const ORDER = ["EARPIECE", "SPEAKER_PHONE", "BLUETOOTH", "WIRED_HEADSET"];

export interface AudioRoutes {
  available: string[];
  selected: string;
}

// The route after `selected` among those available, in a fixed order; null when
// there is nothing else to switch to.
export function nextRoute(r: AudioRoutes): string | null {
  const avail = ORDER.filter((x) => r.available.includes(x));
  if (avail.length === 0) return null;
  const i = avail.indexOf(r.selected);
  if (i === -1) return avail[0];
  if (avail.length === 1) return null;
  return avail[(i + 1) % avail.length];
}

export function routeLabel(route: string): string {
  switch (route) {
    case "BLUETOOTH": return "Bluetooth";
    case "WIRED_HEADSET": return "Headset";
    case "SPEAKER_PHONE": return "Speaker";
    case "EARPIECE": return "Phone";
    default: return "Audio";
  }
}
```

- [ ] **Step 4: Run the pure tests**

Run: `cd mobile && npx jest test/recent.test.ts test/uuid.test.ts test/audioRoutes.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the adapters** — `mobile/src/native/webrtc.ts`:

```ts
import { mediaDevices, MediaStream, RTCIceCandidate, RTCPeerConnection, RTCRtpSender } from "react-native-webrtc";
import type { Facing, MediaPort } from "../core/call";
import type { CodecLike, PeerConnectionLike, StreamLike, TrackLike } from "../core/types";

// No ICE servers: the SFU advertises its public IP (spec, Global Constraints).
export function createPeerConnection(): PeerConnectionLike {
  return new RTCPeerConnection({ iceServers: [] }) as unknown as PeerConnectionLike;
}

export function createStream(tracks: TrackLike[]): StreamLike {
  return new MediaStream(tracks as any) as unknown as StreamLike;
}

export function createCandidate(init: unknown): unknown {
  return new RTCIceCandidate(init as any);
}

export function videoCodecs(): CodecLike[] | null {
  try {
    const caps = (RTCRtpSender as any).getCapabilities?.("video");
    return caps?.codecs ?? null;
  } catch {
    return null;
  }
}

async function firstTrack(constraints: object): Promise<TrackLike | null> {
  try {
    const stream = await mediaDevices.getUserMedia(constraints as any);
    return (stream.getTracks()[0] as unknown as TrackLike) || null;
  } catch {
    return null; // denied or no device: the call controller turns this into a notice
  }
}

export const media: MediaPort = {
  getMic: () => firstTrack({ audio: true, video: false }),
  getCamera: (facing: Facing) =>
    firstTrack({ audio: false, video: { facingMode: facing, width: 1280, height: 720, frameRate: 30 } }),
  createStream,
};
```

`mobile/src/native/storage.ts`:

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { RoomLink } from "../core/link";
import { mergeRecent, type RecentRoom } from "../core/recent";

export interface Prefs {
  name: string;
  email: string; // stays on the device; only its hash is sent
  mic: boolean;
  camera: boolean;
}

const PREFS_KEY = "coyote.prefs.v1";
const RECENT_KEY = "coyote.recent.v1";
export const DEFAULT_PREFS: Prefs = { name: "", email: "", mic: true, camera: true };

async function readJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

export async function loadPrefs(): Promise<Prefs> {
  return readJSON(PREFS_KEY, DEFAULT_PREFS);
}

export async function savePrefs(p: Prefs): Promise<void> {
  await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(p));
}

export async function loadRecent(): Promise<RecentRoom[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function rememberRoom(link: RoomLink): Promise<RecentRoom[]> {
  const next = mergeRecent(await loadRecent(), link, Date.now());
  await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next));
  return next;
}
```

`mobile/src/native/lifecycle.ts`:

```ts
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import type { Call } from "../core/call";

// Feeds foreground/background and network changes to the call. A network change
// that keeps "connected" (wifi -> cellular) still reports, because the socket
// usually dies with the old interface; the call only reconnects if it is down.
export function watchLifecycle(call: Pick<Call, "onAppState" | "onNetworkChange">): () => void {
  const app = AppState.addEventListener("change", (s) => {
    if (s === "active" || s === "background" || s === "inactive") void call.onAppState(s);
  });
  let last = { connected: true, type: "" };
  const net = NetInfo.addEventListener((st) => {
    const now = { connected: !!st.isConnected, type: String(st.type) };
    if (now.connected && (!last.connected || now.type !== last.type)) call.onNetworkChange(true);
    last = now;
  });
  return () => {
    app.remove();
    net();
  };
}
```

`mobile/src/native/audioRoute.ts`:

```ts
import { DeviceEventEmitter, Platform } from "react-native";
import InCallManager from "react-native-incall-manager";
import { nextRoute, type AudioRoutes } from "../core/audioRoutes";

// Video calls default to the speaker, audio-only to the earpiece with the proximity
// sensor; a connected headset takes precedence (InCallManager "auto").
export function startCallAudio(video: boolean): void {
  InCallManager.start({ media: video ? "video" : "audio", auto: true });
  InCallManager.setKeepScreenOn(true);
}

export function stopCallAudio(): void {
  InCallManager.setKeepScreenOn(false);
  InCallManager.stop();
}

let iosSpeaker = false;

// Android reports devices; iOS only exposes speaker on/off (Bluetooth is picked by
// the system, from Control Centre or the CallKit screen).
export function watchRoutes(fn: (r: AudioRoutes) => void): () => void {
  if (Platform.OS !== "android") {
    fn({ available: ["EARPIECE", "SPEAKER_PHONE"], selected: iosSpeaker ? "SPEAKER_PHONE" : "EARPIECE" });
    return () => {};
  }
  const sub = DeviceEventEmitter.addListener("onAudioDeviceChanged", (d: any) => {
    let available: string[] = [];
    try {
      available = JSON.parse(d?.availableAudioDeviceList || "[]");
    } catch {
      available = [];
    }
    fn({ available, selected: String(d?.selectedAudioDevice || "") });
  });
  return () => sub.remove();
}

export async function cycleRoute(r: AudioRoutes): Promise<void> {
  if (Platform.OS === "android") {
    const next = nextRoute(r);
    if (next) await InCallManager.chooseAudioRoute(next);
    return;
  }
  iosSpeaker = !iosSpeaker;
  InCallManager.setForceSpeakerphoneOn(iosSpeaker);
}
```

`mobile/src/native/linking.ts`:

```ts
import { Linking } from "react-native";

export function initialUrl(): Promise<string | null> {
  return Linking.getInitialURL();
}

export function watchUrls(fn: (url: string) => void): () => void {
  const sub = Linking.addEventListener("url", (e) => fn(e.url));
  return () => sub.remove();
}
```

`mobile/src/native/permissions.ts`:

```ts
import { PermissionsAndroid, Platform } from "react-native";

// Android runtime permissions, asked on the pre-join screen. iOS prompts on first
// capture, using the Info.plist usage strings. A denial is not an error here: the
// call controller joins with that device off and says so.
export async function requestCallPermissions(wantCamera: boolean): Promise<void> {
  if (Platform.OS !== "android") return;
  const P = PermissionsAndroid.PERMISSIONS;
  const list = [P.RECORD_AUDIO];
  if (wantCamera) list.push(P.CAMERA);
  if (Number(Platform.Version) >= 33) list.push(P.POST_NOTIFICATIONS);
  if (Number(Platform.Version) >= 31) list.push(P.BLUETOOTH_CONNECT);
  await PermissionsAndroid.requestMultiple(list);
}
```

If `npm run typecheck` reports that a react-native-webrtc / incall-manager export
named above does not exist (e.g. `RTCRtpSender`, `chooseAudioRoute`), read the
package's `index.d.ts` in `node_modules` and use the name it exports for the same
function; do not cast it away with `any` unless the package ships no types for it.

- [ ] **Step 6: Verify**

Run: `cd mobile && npm test && npm run typecheck && npm run lint && (cd android && source env.sh && ./gradlew assembleDebug)`
Expected: all PASS, `BUILD SUCCESSFUL`.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/core/recent.ts mobile/src/core/uuid.ts mobile/src/core/audioRoutes.ts mobile/src/native mobile/test/recent.test.ts mobile/test/uuid.test.ts mobile/test/audioRoutes.test.ts
git commit -m "feat(mobile): native adapters for media, storage, lifecycle, audio and links"
```

---

### Task 12: System-call bridge and call factory (`native/systemCall.ts`, `native/callFactory.ts`)

**Files:**
- Create: `mobile/src/native/systemCall.ts`, `mobile/src/native/callFactory.ts`
- Create: `mobile/src/core/systemCallRouter.ts`
- Test: `mobile/test/systemCallRouter.test.ts`

**Interfaces:**
- Consumes: `Call`, `CallEvents`, `SystemCallPort` (Task 10); `Signaling` (5); `Peer` (6-7); adapters (11); native module `CallService` (3).
- Produces:
  ```ts
  // core/systemCallRouter.ts — routes system-call events to the active call only
  export interface SystemCallTarget { onSystemMute(muted: boolean): unknown; onSystemEnd(): void; onHold(held: boolean): unknown }
  export class SystemCallRouter {
    track(callId: string): void; clear(callId: string): void;
    mute(callId: string, muted: boolean, t: SystemCallTarget): void; end(callId: string, t: SystemCallTarget): void;
    hold(callId: string, held: boolean, t: SystemCallTarget): void; endCurrent(t: SystemCallTarget): void;
  }
  // native/systemCall.ts
  export function setupSystemCalls(): Promise<void>;
  export function createSystemCall(target: () => SystemCallTarget | null): { port: SystemCallPort; dispose(): void };
  // native/callFactory.ts
  export function createCall(events: CallEvents): { call: Call; dispose(): void };
  ```

CallKit on iOS reports call UUIDs in **upper case** regardless of what was passed;
the router compares case-insensitively and ignores events for any call that is not
the active one (a late event from a previous call must not mute or end the next).

- [ ] **Step 1: Write the failing test** — `mobile/test/systemCallRouter.test.ts`:

```ts
import { SystemCallRouter } from "../src/core/systemCallRouter";

function target() {
  const log: string[] = [];
  return {
    log,
    onSystemMute: (m: boolean) => log.push(`mute ${m}`),
    onSystemEnd: () => log.push("end"),
    onHold: (h: boolean) => log.push(`hold ${h}`),
  };
}

test("routes events for the active call, case-insensitively", () => {
  const r = new SystemCallRouter();
  const t = target();
  r.track("abc-def");
  r.mute("ABC-DEF", true, t);
  r.hold("abc-def", true, t);
  r.end("ABC-def", t);
  expect(t.log).toEqual(["mute true", "hold true", "end"]);
});

test("ignores events for other or finished calls", () => {
  const r = new SystemCallRouter();
  const t = target();
  r.track("new");
  r.mute("old", true, t);
  r.clear("new");
  r.end("new", t);
  r.endCurrent(t);
  expect(t.log).toEqual([]);
});

test("endCurrent ends the tracked call (Android notification Leave)", () => {
  const r = new SystemCallRouter();
  const t = target();
  r.track("x");
  r.endCurrent(t);
  expect(t.log).toEqual(["end"]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd mobile && npx jest test/systemCallRouter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `mobile/src/core/systemCallRouter.ts`:

```ts
export interface SystemCallTarget {
  onSystemMute(muted: boolean): unknown;
  onSystemEnd(): void;
  onHold(held: boolean): unknown;
}

// CallKit / ConnectionService events carry a call UUID. Only the active call may
// react; iOS upper-cases UUIDs, so ids compare case-insensitively.
export class SystemCallRouter {
  private current: string | null = null;

  track(callId: string): void {
    this.current = callId.toLowerCase();
  }

  clear(callId: string): void {
    if (this.is(callId)) this.current = null;
  }

  mute(callId: string, muted: boolean, t: SystemCallTarget): void {
    if (this.is(callId)) void t.onSystemMute(muted);
  }

  end(callId: string, t: SystemCallTarget): void {
    if (this.is(callId)) t.onSystemEnd();
  }

  hold(callId: string, held: boolean, t: SystemCallTarget): void {
    if (this.is(callId)) void t.onHold(held);
  }

  endCurrent(t: SystemCallTarget): void {
    if (this.current) t.onSystemEnd();
  }

  private is(callId: string): boolean {
    return !!this.current && !!callId && callId.toLowerCase() === this.current;
  }
}
```

`mobile/src/native/systemCall.ts`:

```ts
import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import RNCallKeep from "react-native-callkeep";
import { RTCAudioSession } from "react-native-webrtc";
import type { SystemCallPort } from "../core/call";
import { SystemCallRouter, type SystemCallTarget } from "../core/systemCallRouter";

const { CallService } = NativeModules;
let setupDone: Promise<void> | null = null;

// One-time CallKit / ConnectionService registration. Android uses a self-managed
// ConnectionService (our own UI; the system handles Bluetooth buttons and holds us
// for a cellular call).
export function setupSystemCalls(): Promise<void> {
  if (!setupDone) {
    setupDone = RNCallKeep.setup({
      ios: { appName: "Coyote", supportsVideo: true, maximumCallGroups: "1", maximumCallsPerCallGroup: "1", includesCallsInRecents: false },
      android: {
        alertTitle: "Calling accounts",
        alertDescription: "Coyote needs this to keep calls running in the background",
        cancelButton: "Cancel",
        okButton: "OK",
        selfManaged: true,
        additionalPermissions: [],
      },
    }).then(() => {
      if (Platform.OS === "android") RNCallKeep.setAvailable(true);
    });
  }
  return setupDone;
}

const EVENTS = ["didPerformSetMutedCallAction", "endCall", "didToggleHoldCallAction", "didActivateAudioSession", "didDeactivateAudioSession"] as const;

export function createSystemCall(target: () => SystemCallTarget | null): { port: SystemCallPort; dispose(): void } {
  const router = new SystemCallRouter();
  const withTarget = (fn: (t: SystemCallTarget) => void) => {
    const t = target();
    if (t) fn(t);
  };

  RNCallKeep.addEventListener("didPerformSetMutedCallAction", ({ muted, callUUID }: any) => withTarget((t) => router.mute(callUUID, muted, t)));
  RNCallKeep.addEventListener("endCall", ({ callUUID }: any) => withTarget((t) => router.end(callUUID, t)));
  RNCallKeep.addEventListener("didToggleHoldCallAction", ({ hold, callUUID }: any) => withTarget((t) => router.hold(callUUID, hold, t)));
  // CallKit owns the iOS audio session: libwebrtc's audio unit may only run while
  // CallKit has it active. Getting this wrong is a silent call (MANUAL-TEST item 1).
  RNCallKeep.addEventListener("didActivateAudioSession", () => {
    if (Platform.OS === "ios") RTCAudioSession.audioSessionDidActivate();
  });
  RNCallKeep.addEventListener("didDeactivateAudioSession", () => {
    if (Platform.OS === "ios") RTCAudioSession.audioSessionDidDeactivate();
  });
  const leaveSub = Platform.OS === "android"
    ? new NativeEventEmitter(CallService).addListener("CallServiceLeave", () => withTarget((t) => router.endCurrent(t)))
    : null;

  const port: SystemCallPort = {
    start(callId, room, video) {
      router.track(callId);
      RNCallKeep.startCall(callId, `#${room}`, `#${room}`, "generic", video);
      if (Platform.OS === "android") CallService.start(room);
    },
    connected(callId) {
      if (Platform.OS === "ios") RNCallKeep.reportConnectedOutgoingCallWithUUID(callId);
      else RNCallKeep.setCurrentCallActive(callId);
    },
    end(callId) {
      router.clear(callId); // our own endCall must not echo back as a leave
      RNCallKeep.endCall(callId);
      if (Platform.OS === "android") CallService.stop();
    },
    setMuted(callId, muted) {
      RNCallKeep.setMutedCall(callId, muted);
    },
  };

  return {
    port,
    dispose() {
      for (const e of EVENTS) RNCallKeep.removeEventListener(e);
      leaveSub?.remove();
    },
  };
}
```

`mobile/src/native/callFactory.ts`:

```ts
import { Call, type CallEvents } from "../core/call";
import { Peer } from "../core/peer";
import { Signaling } from "../core/signaling";
import type { SocketLike } from "../core/types";
import { uuidV4 } from "../core/uuid";
import { watchLifecycle } from "./lifecycle";
import { createSystemCall } from "./systemCall";
import { createCandidate, createPeerConnection, createStream, media, videoCodecs } from "./webrtc";

const timers = {
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

// Wires a Call to every native port. One Call per room session; dispose() when it ends.
export function createCall(events: CallEvents): { call: Call; dispose(): void } {
  let call: Call | null = null;
  const system = createSystemCall(() => call);
  call = new Call({
    createSignaling: (url) => new Signaling(url, {
      createSocket: (u) => new WebSocket(u) as unknown as SocketLike,
      random: Math.random,
      log: console,
      ...timers,
    }),
    createPeer: (sig, ev) => new Peer(sig, { createPeerConnection, createStream, createCandidate, videoCodecs, log: console, ...timers }, ev),
    media,
    system: system.port,
    uuid: () => uuidV4(Math.random),
    log: console,
  }, events);
  const stopLifecycle = watchLifecycle(call);
  return {
    call,
    dispose() {
      stopLifecycle();
      system.dispose();
    },
  };
}
```

- [ ] **Step 4: Verify**

Run: `cd mobile && npm test && npm run typecheck && npm run lint && (cd android && source env.sh && ./gradlew assembleDebug)`
Expected: PASS, `BUILD SUCCESSFUL`. As in Task 11, if a CallKeep / webrtc export
name differs in the installed typings (e.g. `audioSessionDidActivate`), use the
installed package's name for the same function.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/core/systemCallRouter.ts mobile/src/native/systemCall.ts mobile/src/native/callFactory.ts mobile/test/systemCallRouter.test.ts
git commit -m "feat(mobile): CallKit/ConnectionService bridge and call factory"
```

---

### Task 13: Call context, Home and PreJoin screens

**Files:**
- Create: `mobile/src/ui/CallContext.tsx`, `mobile/src/ui/theme.ts`, `mobile/src/ui/navigation.ts`
- Create: `mobile/src/ui/screens/Home.tsx`, `mobile/src/ui/screens/PreJoin.tsx`
- Create: `mobile/src/ui/components/Avatar.tsx`

**Interfaces:**
- Consumes: `createCall` (12), `setupSystemCalls` (12), storage/permissions/webrtc adapters (11), `peekRoom`/`peekInvite`/`serverVersion` (9), `nickFromToken` (4), `gravatarHash` (9), `parseRoomInput`/`DEFAULT_HOST` (4), `avatarFor`/`gravatarUrl` (shared).
- Produces:
  ```ts
  // navigation.ts
  export type RootStack = { Home: { message?: string } | undefined; PreJoin: { link: RoomLink; error?: string }; Call: undefined };
  // CallContext.tsx
  export interface CallCtx { state: CallState | null; outcome: CallOutcome | null; notices: string[];
    join(req: JoinRequest): Promise<void>; leave(): void; call(): Call | null }
  export function CallProvider(props: { children: React.ReactNode }): JSX.Element;
  export function useCall(): CallCtx;
  // Avatar.tsx
  export function Avatar(props: { name: string; gravatar: string; size: number }): JSX.Element;
  ```

UI code is verified by typecheck, lint, the Android build, and MANUAL-TEST.md.

- [ ] **Step 1: Shared UI pieces** — `mobile/src/ui/navigation.ts`:

```ts
import type { RoomLink } from "../core/link";

export type RootStack = {
  Home: { message?: string } | undefined;
  PreJoin: { link: RoomLink; error?: string };
  Call: undefined;
};
```

`mobile/src/ui/theme.ts`:

```ts
export const colors = {
  bg: "#111214",
  surface: "#1d1f23",
  text: "#f2f2f2",
  muted: "#9aa0a6",
  accent: "#e8833a", // coyote orange
  danger: "#d93a3a",
  border: "#2c2f35",
};
export const radius = 12;
```

`mobile/src/ui/components/Avatar.tsx`:

```tsx
import React, { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { avatarFor, gravatarUrl } from "../../shared/web";

// Gravatar when the participant has one, else coloured initials (same palette and
// hashing as the web client's avatar.js).
export function Avatar({ name, gravatar, size }: { name: string; gravatar: string; size: number }) {
  const [failed, setFailed] = useState(false);
  const url = gravatar ? gravatarUrl(gravatar, Math.round(size * 2)) : "";
  const { initial, bg, fg } = avatarFor(name);
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (url && !failed) {
    return <Image source={{ uri: url }} style={box} onError={() => setFailed(true)} accessibilityLabel={name} />;
  }
  return (
    <View style={[styles.initials, box, { backgroundColor: bg }]} accessibilityLabel={name}>
      <Text style={{ color: fg, fontSize: size * 0.45, fontWeight: "600" }}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({ initials: { alignItems: "center", justifyContent: "center" } });
```

- [ ] **Step 2: Call context** — `mobile/src/ui/CallContext.tsx`:

```tsx
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Call, CallOutcome, CallState, JoinRequest } from "../core/call";
import { createCall } from "../native/callFactory";
import { setupSystemCalls } from "../native/systemCall";

export interface CallCtx {
  state: CallState | null;
  outcome: CallOutcome | null;
  notices: string[];
  join(req: JoinRequest): Promise<void>;
  leave(): void;
  call(): Call | null;
}

const Ctx = createContext<CallCtx | null>(null);
const NOTICE_MS = 4000;

export function CallProvider({ children }: { children: React.ReactNode }) {
  const active = useRef<{ call: Call; dispose(): void } | null>(null);
  const [state, setState] = useState<CallState | null>(null);
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [notices, setNotices] = useState<string[]>([]);

  // Clears the previous call's state and outcome synchronously (before the first
  // await) so a Call screen navigated to in the same tick never sees the old "ended".
  const join = useCallback(async (req: JoinRequest) => {
    active.current?.call.leave();
    setOutcome(null);
    setState(null);
    await setupSystemCalls();
    const made = createCall({
      change: (s) => setState(s),
      end: (o) => {
        setOutcome(o);
        made.dispose();
        if (active.current === made) active.current = null;
      },
      notice: (text) => {
        setNotices((n) => [...n, text]);
        setTimeout(() => setNotices((n) => n.slice(1)), NOTICE_MS);
      },
    });
    active.current = made;
    await made.call.join(req);
  }, []);

  const leave = useCallback(() => active.current?.call.leave(), []);
  const call = useCallback(() => active.current?.call ?? null, []);
  useEffect(() => () => active.current?.call.leave(), []);

  return <Ctx.Provider value={{ state, outcome, notices, join, leave, call }}>{children}</Ctx.Provider>;
}

export function useCall(): CallCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCall outside CallProvider");
  return v;
}
```

- [ ] **Step 3: Home** — `mobile/src/ui/screens/Home.tsx`:

```tsx
import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect, type NavigationProp, useNavigation, type RouteProp, useRoute } from "@react-navigation/native";
import { serverVersion } from "../../core/api";
import { DEFAULT_HOST, parseRoomInput } from "../../core/link";
import { recentInput, type RecentRoom } from "../../core/recent";
import { loadRecent } from "../../native/storage";
import type { RootStack } from "../navigation";
import { colors, radius } from "../theme";

export function Home() {
  const nav = useNavigation<NavigationProp<RootStack>>();
  const route = useRoute<RouteProp<RootStack, "Home">>();
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [recent, setRecent] = useState<RecentRoom[]>([]);
  const [version, setVersion] = useState("");

  useFocusEffect(useCallback(() => {
    loadRecent().then(setRecent);
  }, []));
  useEffect(() => {
    serverVersion(fetch, `https://${DEFAULT_HOST}`).then(setVersion);
  }, []);

  const go = (text: string) => {
    const link = parseRoomInput(text);
    if (!link) {
      setError("That isn't a room name or a Coyote link.");
      return;
    }
    setError("");
    nav.navigate("PreJoin", { link });
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Coyote</Text>
      {route.params?.message ? <Text style={styles.message}>{route.params.message}</Text> : null}
      <TextInput
        style={styles.input}
        placeholder={`Room name or link (${DEFAULT_HOST})`}
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        value={input}
        onChangeText={setInput}
        onSubmitEditing={() => go(input)}
        returnKeyType="go"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable style={styles.button} onPress={() => go(input)} accessibilityRole="button">
        <Text style={styles.buttonText}>Continue</Text>
      </Pressable>
      <Text style={styles.section}>Recent</Text>
      <FlatList
        data={recent}
        keyExtractor={(r) => `${r.host}/${r.slug}`}
        ListEmptyComponent={<Text style={styles.muted}>Rooms you join appear here.</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.recent} onPress={() => go(recentInput(item))}>
            <Text style={styles.recentText}>#{item.slug}</Text>
            {item.host !== DEFAULT_HOST ? <Text style={styles.muted}>{item.host}</Text> : null}
          </Pressable>
        )}
      />
      <Text style={styles.about}>Server {DEFAULT_HOST}{version ? ` · ${version}` : ""}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: 20, paddingTop: 48 },
  title: { color: colors.text, fontSize: 32, fontWeight: "700", marginBottom: 16 },
  message: { color: colors.text, backgroundColor: colors.surface, padding: 12, borderRadius: radius, marginBottom: 12 },
  input: { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius, padding: 14, fontSize: 16 },
  error: { color: colors.danger, marginTop: 8 },
  button: { backgroundColor: colors.accent, borderRadius: radius, padding: 14, alignItems: "center", marginTop: 12 },
  buttonText: { color: "#000", fontWeight: "700", fontSize: 16 },
  section: { color: colors.muted, marginTop: 28, marginBottom: 8, textTransform: "uppercase", fontSize: 12 },
  recent: { paddingVertical: 12, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  recentText: { color: colors.text, fontSize: 16 },
  muted: { color: colors.muted },
  about: { color: colors.muted, fontSize: 12, textAlign: "center", marginTop: 12 },
});
```

- [ ] **Step 4: PreJoin** — `mobile/src/ui/screens/PreJoin.tsx`:

```tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useFocusEffect, useNavigation, useRoute, type NavigationProp, type RouteProp } from "@react-navigation/native";
import { RTCView } from "react-native-webrtc";
import { peekInvite, peekRoom } from "../../core/api";
import { gravatarHash } from "../../core/gravatar";
import { nickFromToken } from "../../core/token";
import type { StreamLike, TrackLike } from "../../core/types";
import { requestCallPermissions } from "../../native/permissions";
import { loadPrefs, rememberRoom, savePrefs } from "../../native/storage";
import { media } from "../../native/webrtc";
import { useCall } from "../CallContext";
import type { RootStack } from "../navigation";
import { colors, radius } from "../theme";

const PEEK_MS = 3000;

export function PreJoin() {
  const nav = useNavigation<NavigationProp<RootStack>>();
  const { params } = useRoute<RouteProp<RootStack, "PreJoin">>();
  const { link } = params;
  const { join } = useCall();
  const [name, setName] = useState("");
  const [lockedName, setLockedName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mic, setMic] = useState(true);
  const [camera, setCamera] = useState(true);
  const [room, setRoom] = useState<{ count: number; locked: boolean } | null>(null);
  const [error, setError] = useState(params.error || "");
  const [joining, setJoining] = useState(false);
  const [preview, setPreview] = useState<StreamLike | null>(null);
  const previewTrack = useRef<TrackLike | null>(null);

  useEffect(() => {
    loadPrefs().then((p) => {
      setName((n) => n || p.name);
      setEmail(p.email);
      setMic(p.mic);
      setCamera(p.camera);
    });
    if (link.invite) {
      peekInvite(fetch, link).then((r) => {
        if (r.status === "ok" && r.name) {
          setLockedName(r.name);
          setName(r.name);
        } else if (r.status === "invalid") setError("Your invite link is invalid.");
      });
    } else if (link.token) {
      const nick = nickFromToken(link.token);
      if (nick) {
        setLockedName(nick);
        setName(nick);
      }
    }
  }, [link]);

  useEffect(() => setError(params.error || ""), [params.error]);

  // Occupancy and lock state, polled while this screen is focused.
  useFocusEffect(useCallback(() => {
    let live = true;
    const tick = () => peekRoom(fetch, link).then((r) => live && setRoom(r));
    tick();
    const id = setInterval(tick, PEEK_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [link]));

  // Camera preview while focused; released before joining (the call acquires its own).
  const stopPreview = useCallback(() => {
    previewTrack.current?.stop();
    previewTrack.current = null;
    setPreview(null);
  }, []);
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    if (camera) {
      requestCallPermissions(true).then(() => media.getCamera("user")).then((t) => {
        if (cancelled || !t) {
          t?.stop();
          return;
        }
        previewTrack.current = t;
        setPreview(media.createStream([t]));
      });
    }
    return () => {
      cancelled = true;
      stopPreview();
    };
  }, [camera, stopPreview]));

  const onJoin = async () => {
    const finalName = (lockedName || name).trim();
    if (!finalName) {
      setError("Enter a display name.");
      return;
    }
    setJoining(true);
    setError("");
    stopPreview();
    await requestCallPermissions(camera);
    await savePrefs({ name: lockedName ? name : finalName, email, mic, camera });
    await rememberRoom(link);
    const joined = join({ link, name: finalName, password, gravatar: gravatarHash(email), mic, camera });
    nav.navigate("Call"); // after join() has synchronously cleared the previous call's state
    await joined;
    setJoining(false);
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>#{link.slug}</Text>
      <Text style={styles.muted}>
        {room ? `${room.count} in call${room.locked ? " · password required" : ""}` : link.host}
      </Text>
      <View style={styles.preview}>
        {camera && preview?.toURL ? (
          <RTCView streamURL={preview.toURL()} style={StyleSheet.absoluteFill} objectFit="cover" mirror />
        ) : (
          <Text style={styles.muted}>Camera off</Text>
        )}
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Microphone</Text>
        <Switch value={mic} onValueChange={setMic} />
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Camera</Text>
        <Switch value={camera} onValueChange={setCamera} />
      </View>
      <TextInput
        style={[styles.input, lockedName ? styles.locked : null]}
        placeholder="Display name"
        placeholderTextColor={colors.muted}
        value={lockedName || name}
        editable={!lockedName}
        onChangeText={setName}
        maxLength={64}
      />
      <TextInput
        style={styles.input}
        placeholder="Email for Gravatar (optional, stays on this device)"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      {room?.locked ? (
        <TextInput
          style={styles.input}
          placeholder="Room password"
          placeholderTextColor={colors.muted}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable style={styles.button} onPress={onJoin} disabled={joining} accessibilityRole="button">
        {joining ? <ActivityIndicator color="#000" /> : <Text style={styles.buttonText}>Join</Text>}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingTop: 32 },
  title: { color: colors.text, fontSize: 28, fontWeight: "700" },
  muted: { color: colors.muted },
  preview: { aspectRatio: 3 / 4, maxHeight: 360, backgroundColor: colors.surface, borderRadius: radius, overflow: "hidden", alignItems: "center", justifyContent: "center", marginVertical: 16 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8 },
  label: { color: colors.text, fontSize: 16 },
  input: { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius, padding: 14, fontSize: 16, marginTop: 12 },
  locked: { opacity: 0.7 },
  error: { color: colors.danger, marginTop: 12 },
  button: { backgroundColor: colors.accent, borderRadius: radius, padding: 14, alignItems: "center", marginTop: 20 },
  buttonText: { color: "#000", fontWeight: "700", fontSize: 16 },
});
```

The password field shows only when the room reports `locked`; a `bad-password`
rejection returns here with that error and the field visible (the next peek shows
it locked).

- [ ] **Step 5: Verify**

Run: `cd mobile && npm run typecheck && npm run lint && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/ui
git commit -m "feat(mobile): call context, home and pre-join screens"
```

---

### Task 14: Call screen and app shell (links, navigation, outcomes)

**Files:**
- Create: `mobile/src/ui/screens/Call.tsx`
- Create: `mobile/src/ui/components/Tile.tsx`, `SelfView.tsx`, `Controls.tsx`, `Banner.tsx`
- Modify: `mobile/src/ui/App.tsx` (replace placeholder)

**Interfaces:**
- Consumes: `useCall` (13), `RootStack` (13), `gridColumns` (8), `Avatar` (13), audio-route adapter (11), `routeLabel` (11), linking adapter (11), `parseRoomInput` (4).
- Produces: the runnable app.

- [ ] **Step 1: Tile, SelfView, Banner, Controls** —

`mobile/src/ui/components/Tile.tsx`:

```tsx
import React, { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { RTCView } from "react-native-webrtc";
import type { Participant } from "../../core/roster";
import { colors } from "../theme";
import { Avatar } from "./Avatar";

export const Tile = memo(function Tile({ p, width, height }: { p: Participant; width: number; height: number }) {
  const showVideo = p.camera && p.video?.toURL;
  return (
    <View style={[styles.tile, { width, height }]}>
      {showVideo ? (
        <RTCView streamURL={p.video!.toURL!()} style={StyleSheet.absoluteFill} objectFit="cover" />
      ) : (
        <Avatar name={p.name} gravatar={p.gravatar} size={Math.min(width, height) * 0.4} />
      )}
      <View style={styles.label}>
        {p.role === "op" ? <Text style={styles.op}>@</Text> : null}
        <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
        {!p.mic ? <Text style={styles.muted} accessibilityLabel="muted">🔇</Text> : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  tile: { backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", overflow: "hidden", borderWidth: 1, borderColor: colors.bg },
  label: { position: "absolute", left: 6, bottom: 6, right: 6, flexDirection: "row", alignItems: "center" },
  op: { color: colors.accent, fontWeight: "700", marginRight: 2 },
  name: { color: colors.text, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, flexShrink: 1 },
  muted: { marginLeft: 4 },
});
```

`mobile/src/ui/components/SelfView.tsx`:

```tsx
import React, { useRef } from "react";
import { Animated, PanResponder, StyleSheet } from "react-native";
import { RTCView } from "react-native-webrtc";
import type { StreamLike } from "../../core/types";
import { colors } from "../theme";

// Mirrored, draggable picture-in-picture self view. Hidden when the camera is off.
export function SelfView({ stream }: { stream: StreamLike | null }) {
  const pos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => pos.extractOffset(),
    onPanResponderMove: Animated.event([null, { dx: pos.x, dy: pos.y }], { useNativeDriver: false }),
    onPanResponderRelease: () => pos.flattenOffset(),
  })).current;
  if (!stream?.toURL) return null;
  return (
    <Animated.View style={[styles.pip, { transform: pos.getTranslateTransform() }]} {...pan.panHandlers}>
      <RTCView streamURL={stream.toURL()} style={StyleSheet.absoluteFill} objectFit="cover" mirror zOrder={1} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pip: { position: "absolute", right: 12, top: 56, width: 96, height: 128, borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
});
```

`mobile/src/ui/components/Banner.tsx`:

```tsx
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Banner as BannerKind } from "../../core/call";
import { colors } from "../theme";

const TEXT: Record<Exclude<BannerKind, "">, string> = {
  reconnecting: "Reconnecting…",
  "media-lost": "Media connection lost — rejoining…",
};

export function Banner({ kind, notices }: { kind: BannerKind; notices: string[] }) {
  if (!kind && notices.length === 0) return null;
  return (
    <View style={styles.wrap} pointerEvents="none">
      {kind ? <Text style={[styles.item, styles.banner]}>{TEXT[kind]}</Text> : null}
      {notices.map((n, i) => (
        <Text key={`${i}-${n}`} style={styles.item}>{n}</Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", top: 12, left: 12, right: 120, gap: 6 },
  item: { color: colors.text, backgroundColor: "rgba(0,0,0,0.75)", padding: 8, borderRadius: 8, overflow: "hidden" },
  banner: { backgroundColor: colors.accent, color: "#000", fontWeight: "600" },
});
```

`mobile/src/ui/components/Controls.tsx`:

```tsx
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";

interface Props {
  mic: boolean;
  camera: boolean;
  routeLabel: string;
  onMic(): void;
  onCamera(): void;
  onFlip(): void;
  onRoute(): void;
  onLeave(): void;
}

// The call's control bar. Sub-project 2 adds chat, polls and soundboard buttons to
// the `more` slot, so the layout already reserves a flexible row.
export function Controls(p: Props) {
  const Btn = ({ label, onPress, active = true, danger = false, a11y }: { label: string; onPress(): void; active?: boolean; danger?: boolean; a11y: string }) => (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y}
      style={[styles.btn, !active && styles.off, danger && styles.danger]}>
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={styles.bar}>
      <Btn label={p.mic ? "🎙" : "🔇"} onPress={p.onMic} active={p.mic} a11y={p.mic ? "Mute microphone" : "Unmute microphone"} />
      <Btn label={p.camera ? "📷" : "🚫"} onPress={p.onCamera} active={p.camera} a11y={p.camera ? "Turn camera off" : "Turn camera on"} />
      <Btn label="🔄" onPress={p.onFlip} a11y="Switch camera" />
      <Btn label={p.routeLabel} onPress={p.onRoute} a11y={`Audio output: ${p.routeLabel}`} />
      <Btn label="Leave" onPress={p.onLeave} danger a11y="Leave call" />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", justifyContent: "space-evenly", alignItems: "center", paddingVertical: 12, paddingBottom: 28, backgroundColor: colors.bg },
  btn: { minWidth: 52, height: 52, borderRadius: 26, paddingHorizontal: 12, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  off: { backgroundColor: "#3a3d44" },
  danger: { backgroundColor: colors.danger },
  text: { color: colors.text, fontSize: 18, fontWeight: "600" },
});
```

- [ ] **Step 2: Call screen** — `mobile/src/ui/screens/Call.tsx`:

```tsx
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { CommonActions, useNavigation, type NavigationProp } from "@react-navigation/native";
import { routeLabel, type AudioRoutes } from "../../core/audioRoutes";
import { gridColumns } from "../../core/grid";
import { cycleRoute, startCallAudio, stopCallAudio, watchRoutes } from "../../native/audioRoute";
import { useCall } from "../CallContext";
import { Banner } from "../components/Banner";
import { Controls } from "../components/Controls";
import { SelfView } from "../components/SelfView";
import { Tile } from "../components/Tile";
import type { RootStack } from "../navigation";
import { colors } from "../theme";

const CONTROLS_H = 92;

export function Call() {
  const nav = useNavigation<NavigationProp<RootStack>>();
  const { state, notices, leave, call, outcome } = useCall();
  const { width, height } = useWindowDimensions();
  const [routes, setRoutes] = useState<AudioRoutes>({ available: [], selected: "" });
  const audioStarted = useRef(false);

  // Call audio starts once the call is up, in video mode if the camera is on.
  useEffect(() => {
    if (state?.phase === "in-call" && !audioStarted.current) {
      audioStarted.current = true;
      startCallAudio(state.camera);
    }
  }, [state?.phase, state?.camera]);
  useEffect(() => {
    const stop = watchRoutes(setRoutes);
    return () => {
      stop();
      if (audioStarted.current) stopCallAudio();
    };
  }, []);

  // Leaving this screen for any reason follows the outcome.
  useEffect(() => {
    if (!outcome || state?.phase !== "ended") return;
    if (outcome.kind === "rejected") {
      const prev = nav.getState()?.routes.find((r) => r.name === "PreJoin");
      if (prev) {
        nav.dispatch(CommonActions.reset({
          index: 1,
          routes: [{ name: "Home" }, { name: "PreJoin", params: { ...(prev.params as object), error: outcome.text } }],
        }));
        return;
      }
    }
    const message = outcome.kind === "removed"
      ? `You were ${outcome.reason === "kicked" ? "removed from" : "banned from"} the call${outcome.by ? ` by ${outcome.by}` : ""}.`
      : outcome.kind === "rejected" ? outcome.text : undefined;
    nav.dispatch(CommonActions.reset({ index: 0, routes: [{ name: "Home", params: message ? { message } : undefined }] }));
  }, [outcome, state?.phase, nav]);

  if (!state) return <View style={styles.root} />;
  const people = state.participants;
  const gridH = height - CONTROLS_H;
  const cols = gridColumns(width, gridH, people.length);
  const rows = Math.max(1, Math.ceil(people.length / cols));
  const tileW = width / cols;
  const tileH = gridH / rows;

  return (
    <View style={styles.root}>
      <View style={[styles.grid, { height: gridH }]}>
        {people.length === 0 ? (
          <Text style={styles.waiting}>{state.phase === "connecting" ? "Connecting…" : `Waiting for others in #${state.slug}…`}</Text>
        ) : (
          people.map((p) => <Tile key={p.id} p={p} width={tileW} height={tileH} />)
        )}
      </View>
      <SelfView stream={state.camera ? state.localStream : null} />
      <Banner kind={state.banner} notices={notices} />
      <Controls
        mic={state.mic}
        camera={state.camera}
        routeLabel={routeLabel(routes.selected)}
        onMic={() => void call()?.setMic(!state.mic)}
        onCamera={() => void call()?.setCamera(!state.camera)}
        onFlip={() => void call()?.flipCamera()}
        onRoute={() => void cycleRoute(routes)}
        onLeave={leave}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  grid: { flexDirection: "row", flexWrap: "wrap", alignContent: "flex-start" },
  waiting: { color: colors.muted, textAlign: "center", width: "100%", marginTop: "50%" },
});
```

- [ ] **Step 3: App shell** — replace `mobile/src/ui/App.tsx`:

```tsx
import React, { useEffect, useRef } from "react";
import { Alert, StatusBar } from "react-native";
import { NavigationContainer, type NavigationContainerRef } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { parseRoomInput } from "../core/link";
import { initialUrl, watchUrls } from "../native/linking";
import { CallProvider, useCall } from "./CallContext";
import type { RootStack } from "./navigation";
import { Call } from "./screens/Call";
import { Home } from "./screens/Home";
import { PreJoin } from "./screens/PreJoin";
import { colors } from "./theme";

const Stack = createNativeStackNavigator<RootStack>();

// Opens tapped room links: valid links go to PreJoin (asking first if a call is
// live), anything else to Home.
function LinkHandler({ nav }: { nav: React.RefObject<NavigationContainerRef<RootStack> | null> }) {
  const { state, leave } = useCall();
  // Refs, so the effect below runs once: re-running it would re-open the cold-start link.
  const live = useRef(false);
  const current = useRef("");
  const leaveRef = useRef(leave);
  live.current = !!state && state.phase !== "ended" && state.phase !== "idle";
  current.current = state?.slug || "";
  leaveRef.current = leave;

  useEffect(() => {
    const open = (url: string | null, tries = 0) => {
      if (!url) return;
      if (!nav.current?.isReady()) {
        // A cold-start link can resolve before the navigator mounts.
        if (tries < 20) setTimeout(() => open(url, tries + 1), 100);
        return;
      }
      const link = parseRoomInput(url);
      if (!link) {
        if (!live.current) nav.current.navigate("Home");
        return;
      }
      if (!live.current) {
        nav.current.navigate("PreJoin", { link });
        return;
      }
      Alert.alert("Switch rooms?", `Leave #${current.current} and join #${link.slug}?`, [
        { text: "Stay", style: "cancel" },
        { text: "Switch", style: "destructive", onPress: () => {
          leaveRef.current();
          setTimeout(() => nav.current?.navigate("PreJoin", { link }), 0);
        } },
      ]);
    };
    initialUrl().then((u) => open(u));
    return watchUrls((u) => open(u));
  }, [nav]);
  return null;
}

export default function App() {
  const nav = useRef<NavigationContainerRef<RootStack>>(null);
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <CallProvider>
        <NavigationContainer ref={nav}>
          <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.text, contentStyle: { backgroundColor: colors.bg } }}>
            <Stack.Screen name="Home" component={Home} options={{ headerShown: false }} />
            <Stack.Screen name="PreJoin" component={PreJoin} options={{ title: "Join" }} />
            <Stack.Screen name="Call" component={Call} options={{ headerShown: false, gestureEnabled: false }} />
          </Stack.Navigator>
        </NavigationContainer>
        <LinkHandler nav={nav} />
      </CallProvider>
    </SafeAreaProvider>
  );
}
```

- [ ] **Step 4: Verify**

Run: `cd mobile && npm run typecheck && npm run lint && npm test && (cd android && source env.sh && ./gradlew assembleDebug)`
Expected: PASS, `BUILD SUCCESSFUL`.

- [ ] **Step 5: Smoke-run on an Android emulator or device if one is available here**
(`adb devices` lists one): `npx react-native run-android`, join a room on
`vc.swiftirc.net` with a browser tab in the same room, and confirm two-way video. If
none is available, say so in the task report — do not claim the app runs.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/ui
git commit -m "feat(mobile): call screen, link handling and app shell"
```

- [ ] **Step 7: Maintainer checkpoint — stop and ask.** Ask the maintainer to build on
their Mac and run MANUAL-TEST.md items 1-4 on an iPhone (Task 15 writes the file; if
Task 15 is not done yet, give them items 1-4 from the list in Task 15 Step 1 inline).

---

### Task 15: Device test checklist, release guide and docs

**Files:**
- Create: `mobile/MANUAL-TEST.md`, `mobile/RELEASE.md`, `mobile/README.md`
- Modify: `README.md` (Architecture + Status + Testing sections)

**Interfaces:** none (documentation).

- [ ] **Step 1: `mobile/MANUAL-TEST.md`** —

```markdown
# Mobile manual test checklist

Run on a real iPhone and a real Android phone before every TestFlight / closed-testing
build, against `vc.swiftirc.net` with at least one browser participant. This layer has
no automated coverage; treat the list as load-bearing, as with the root MANUAL-TEST.md.
Each change that touches iOS-only native code or configuration names the items to re-run.

1. **Two-way audio (iOS CallKit audio session).** Join with mic on. The browser hears
   you and you hear the browser. A silent call here means the CallKit
   didActivateAudioSession → RTCAudioSession hand-off is broken.
2. **Two-way video.** Camera on: the browser sees you; you see the browser's camera.
   A black remote tile means VP8 was not negotiated or a `tracks` pairing failed.
3. **Lock the screen mid-call** for 1 minute. Audio continues both ways; the browser
   shows your avatar placeholder (camera off). Unlock: your camera comes back.
4. **Switch to another app for 2 minutes** and return. The call is intact or rejoins
   within a few seconds ("Reconnecting…" banner, then gone).
5. **Mute from the system UI**: iOS lock screen / Control Centre call controls;
   Android notification shade. The in-app mic button matches, and the browser's
   muted badge matches.
6. **End from the system UI** (iOS lock-screen end; Android notification "Leave").
   You leave the room; the browser sees you go.
7. **A cellular call arrives mid-meeting.** Coyote is held and your mic muted; after
   hanging up, the mic returns to its previous state.
8. **Bluetooth headset** connect and disconnect mid-call: audio follows. On Android the
   route button cycles Phone / Speaker / Bluetooth; on iOS it toggles the speaker.
9. **Airplane mode for 10 seconds**, then off: the app rejoins and media resumes.
10. **Tap an `#i=` invite link** in an IRC client: the app opens on Join with the
    invite's name locked. Join. Then open the same link on a second device: it is refused
    ("Your invite link is invalid.").
11. **Get kicked** by an op in the browser: the app returns to Home with "You were
    removed from the call by <op>." and does not rejoin.
12. **Restart the server** mid-call: "Reconnecting…", then back in the call.
13. **Wrong room password**: back on Join with "Wrong password for this room."
14. **Deny camera permission** (fresh install): you join with the camera off and a
    notice; turning the camera on later shows "Camera unavailable."
15. **Tap a link while already in a call**: "Switch rooms?" prompt; Stay keeps the call.
16. **Android: swipe the app away from recents** mid-call: the notification and call
    end cleanly (no orphaned "In call" notification).
```

- [ ] **Step 2: `mobile/RELEASE.md`** —

````markdown
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

- Server: set `WVC_APPLE_APP_ID=<TEAMID>.net.swiftirc.coyote`,
  `WVC_ANDROID_PACKAGE=net.swiftirc.coyote` and
  `WVC_ANDROID_CERT_SHA256=<Play Console → App integrity → App signing SHA-256>` so
  room links open the apps (see docs/DEPLOY.md).

## Version

Bump both in one commit before each release:
- iOS: `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` in `ios/Coyote.xcodeproj/project.pbxproj`.
- Android: `versionName` and `versionCode` in `android/app/build.gradle`.

## iOS → TestFlight

```bash
cd mobile && npm ci && (cd ios && pod install)
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
````

Add release signing to `mobile/android/app/build.gradle` so `bundleRelease` uses those
properties (inside `android { signingConfigs { … } }`, alongside the generated `debug`):

```groovy
        release {
            if (project.hasProperty("COYOTE_UPLOAD_STORE_FILE")) {
                storeFile file(COYOTE_UPLOAD_STORE_FILE)
                storePassword COYOTE_UPLOAD_STORE_PASSWORD
                keyAlias COYOTE_UPLOAD_KEY_ALIAS
                keyPassword COYOTE_UPLOAD_KEY_PASSWORD
            }
        }
```

and in `buildTypes { release { … } }` replace `signingConfig signingConfigs.debug` with
`signingConfig signingConfigs.release`. Verify on Linux that `./gradlew assembleDebug`
still succeeds (release signing is only exercised on the Mac).

- [ ] **Step 3: `mobile/README.md`** — short developer guide:

```markdown
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

Releases: RELEASE.md. Device checklist: MANUAL-TEST.md.
```

- [ ] **Step 4: Root `README.md`** — in "Architecture" add a bullet after `internal/web`:
`- **\`mobile/\`** — the iOS and Android apps (React Native), a second client of the same protocol; see \`mobile/README.md\`.`
In "Testing" add `cd mobile && npm test && npm run typecheck   # mobile core (Jest)`. In
"Status" add `- **Mobile apps (Foundation)** — calls, links, background survival. **In TestFlight / closed testing.**`

- [ ] **Step 5: Verify**

Run: `cd mobile && npm test && npm run typecheck && npm run lint && cd .. && go test ./... && (cd mobile/android && source env.sh && ./gradlew assembleDebug)`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add mobile/MANUAL-TEST.md mobile/RELEASE.md mobile/README.md mobile/android/app/build.gradle README.md
git commit -m "docs(mobile): device checklist, release guide and developer readme"
```

- [ ] **Step 7: Maintainer checkpoint — stop and ask.** Ask the maintainer to run the
full `mobile/MANUAL-TEST.md` on both platforms from the Mac and report failures; each
failure becomes a follow-up fix before the first TestFlight upload.
