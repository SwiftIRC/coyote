/// <reference types="node" />
import * as fs from "fs";
import * as path from "path";

// Under the New Architecture, legacy Android modules load through the TurboModule
// interop layer, which throws (fatally, in release) on the first property access
// if a module exports two @ReactMethods with the same name. Guard every native
// dependency, since overloads compile fine and only fail on device.

function sources(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sources(p, out);
    else if (/\.(java|kt)$/.test(e.name)) out.push(p);
  }
  return out;
}

function exportedNames(src: string): string[] {
  const names: string[] = [];
  const re = /@ReactMethod(?:\([^)]*\))?\s+(?:public\s+|override\s+)*(?:fun\s+|[\w<>[\],\s]+?\s+)(\w+)\s*\(/g;
  for (let m = re.exec(src); m; m = re.exec(src)) names.push(m[1]);
  return names;
}

const deps = ["react-native-callkeep", "react-native-webrtc", "react-native-incall-manager"];

test.each(deps)("%s exports no overloaded @ReactMethods", (dep) => {
  const root = path.join(__dirname, "..", "node_modules", dep, "android");
  const dupes: string[] = [];
  for (const file of sources(root)) {
    const names = exportedNames(fs.readFileSync(file, "utf8"));
    for (const n of new Set(names)) {
      if (names.filter((x) => x === n).length > 1) dupes.push(`${path.basename(file)}: ${n}`);
    }
  }
  expect(dupes).toEqual([]);
});

test("the scanner sees exported methods", () => {
  expect(exportedNames("@ReactMethod\n  public void a(String x) {}\n@ReactMethod\nfun b() {}")).toEqual(["a", "b"]);
});

// TelecomManager.getPhoneAccount needs READ_PHONE_NUMBERS (API 31+), a phone
// permission this app never requests, so callkeep's ConnectionService must not
// call it unguarded: on Android 16 it threw from onCreateOutgoingConnection.
test("callkeep's ConnectionService never calls getPhoneAccount unguarded", () => {
  const file = path.join(__dirname, "..", "node_modules", "react-native-callkeep", "android",
    "src", "main", "java", "io", "wazo", "callkeep", "VoiceConnectionService.java");
  const src = fs.readFileSync(file, "utf8");
  const unguarded: number[] = [];
  for (let i = src.indexOf("getPhoneAccount("); i >= 0; i = src.indexOf("getPhoneAccount(", i + 1)) {
    const tryAt = src.lastIndexOf("try {", i);
    const catchAt = src.indexOf("catch (SecurityException", tryAt);
    const closedBefore = tryAt >= 0 && src.slice(tryAt, i).includes("} catch");
    if (tryAt < 0 || closedBefore || catchAt < i) unguarded.push(src.slice(0, i).split("\n").length);
  }
  expect(unguarded).toEqual([]);
});

test("CoyoteSounds exports preload/play/stop on both platforms and never touches the audio session", () => {
  const app = path.join(__dirname, "..");
  const kt = fs.readFileSync(path.join(app, "android", "app", "src", "main", "java", "net", "swiftirc", "coyote", "CoyoteSoundsModule.kt"), "utf8");
  expect(exportedNames(kt).sort()).toEqual(["addListener", "play", "preload", "removeListeners", "stop"]);
  const m = fs.readFileSync(path.join(app, "ios", "Coyote", "CoyoteSounds.m"), "utf8");
  for (const sig of ["preload:(NSString *)id uri:(NSString *)uri", "play:(NSString *)id", "stop:(NSString *)id"]) expect(m).toContain(sig);
  const swift = fs.readFileSync(path.join(app, "ios", "Coyote", "CoyoteSounds.swift"), "utf8");
  expect(swift).not.toMatch(/setCategory|setMode|setActive/);
  expect(kt).not.toMatch(/setMode\(|requestAudioFocus|setSpeakerphoneOn/);
});

test("CoyoteSounds downloads remote clips off the main thread and reports loads", () => {
  const app = path.join(__dirname, "..");
  const kt = fs.readFileSync(path.join(app, "android", "app", "src", "main", "java", "net", "swiftirc", "coyote", "CoyoteSoundsModule.kt"), "utf8");
  const swift = fs.readFileSync(path.join(app, "ios", "Coyote", "CoyoteSounds.swift"), "utf8");
  expect(kt).toContain("CoyoteSoundLoaded");
  expect(kt).toMatch(/Executors\.newSingleThreadExecutor/);
  expect(swift).toContain("CoyoteSoundLoaded");
  expect(swift).toMatch(/downloadTask/);
  expect(swift).not.toMatch(/methodQueue/); // 2a Ruling: main-thread confinement
  expect(swift).not.toMatch(/setCategory|setMode|setActive/);
});

test("Android declares the media-projection foreground-service permission (Android 14+)", () => {
  const manifest = fs.readFileSync(path.join(__dirname, "..", "android", "app", "src", "main", "AndroidManifest.xml"), "utf8");
  expect(manifest).toContain('android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION');
});

// Android RTCView keeps rendering at its old size when React Native resizes it (the
// grid gaining a tile) until the frame resolution changes. The patch re-runs the same
// relayout the resolution-change path uses whenever the view's size changes.
test("react-native-webrtc's Android RTCView re-lays out its renderer on resize (patched)", () => {
  const view = fs.readFileSync(path.join(__dirname, "..", "node_modules", "react-native-webrtc", "android", "src",
    "main", "java", "com", "oney", "WebRTCModule", "WebRTCView.java"), "utf8");
  const at = view.indexOf("protected void onSizeChanged(int w, int h, int oldw, int oldh)");
  expect(at).toBeGreaterThan(-1);
  expect(view.slice(at, at + 400)).toContain("post(requestSurfaceViewRendererLayoutRunnable)");
  expect(fs.existsSync(path.join(__dirname, "..", "patches", "react-native-webrtc+124.0.8.patch"))).toBe(true);
});

// react-native-webrtc only starts its mediaProjection foreground service when the app
// opts in; without it Android 14+ throws SecurityException in startCapture, which the
// library merely logs, leaving a "live" screen track that never sends a frame.
test("Android opts in to react-native-webrtc's MediaProjectionService before React loads", () => {
  const file = path.join(__dirname, "..", "android", "app", "src", "main", "java", "net", "swiftirc", "coyote", "MainApplication.kt");
  const src = fs.readFileSync(file, "utf8");
  const optIn = src.indexOf("WebRTCModuleOptions.getInstance().enableMediaProjectionService = true");
  expect(optIn).toBeGreaterThan(-1);
  expect(optIn).toBeLessThan(src.indexOf("loadReactNative(this)"));
});

test("CoyoteScreenShare exports showPicker and relays the extension's started notification", () => {
  const app = path.join(__dirname, "..");
  const m = fs.readFileSync(path.join(app, "ios", "Coyote", "CoyoteScreenShare.m"), "utf8");
  expect(m).toContain("RCT_EXTERN_MODULE(CoyoteScreenShare, RCTEventEmitter)");
  expect(m).toContain("RCT_EXTERN_METHOD(showPicker:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)");
  const swift = fs.readFileSync(path.join(app, "ios", "Coyote", "CoyoteScreenShare.swift"), "utf8");
  expect(swift).toContain('"net.swiftirc.coyote.broadcast.started"');
  expect(swift).toContain('"CoyoteBroadcastStarted"');
  expect(swift).toContain("RPSystemBroadcastPickerView");
  expect(swift).toContain("@objc(showPicker:rejecter:)");
  expect(swift).toContain('reject("no_window"');
  expect(swift).toContain('reject("no_picker_button"');
  const pbx = fs.readFileSync(path.join(app, "ios", "Coyote.xcodeproj", "project.pbxproj"), "utf8");
  expect(pbx).toContain("CoyoteScreenShare.swift in Sources");
  expect(pbx).toContain("CoyoteScreenShare.m in Sources");
});

describe("iOS broadcast extension", () => {
  const ios = path.join(__dirname, "..", "ios");
  const read = (...p: string[]) => fs.readFileSync(path.join(ios, ...p), "utf8");
  const GROUP = "group.net.swiftirc.coyote";

  test("the app points react-native-webrtc at the App Group and the extension", () => {
    const plist = read("Coyote", "Info.plist");
    expect(plist).toMatch(/<key>RTCAppGroupIdentifier<\/key>\s*<string>group\.net\.swiftirc\.coyote<\/string>/);
    expect(plist).toMatch(/<key>RTCScreenSharingExtension<\/key>\s*<string>net\.swiftirc\.coyote\.broadcast<\/string>/);
  });

  test("app and extension share the App Group", () => {
    for (const f of [["Coyote", "Coyote.entitlements"], ["CoyoteBroadcast", "CoyoteBroadcast.entitlements"]]) {
      const e = read(...f);
      expect(e).toContain("com.apple.security.application-groups");
      expect(e).toContain(`<string>${GROUP}</string>`);
    }
    expect(read("CoyoteBroadcast", "SampleHandler.swift")).toContain(`"${GROUP}"`);
  });

  test("the extension is a sample-buffer broadcast upload extension", () => {
    const plist = read("CoyoteBroadcast", "Info.plist");
    expect(plist).toContain("com.apple.broadcast-services-upload");
    expect(plist).toContain("RPBroadcastProcessModeSampleBuffer");
    expect(plist).toContain("$(PRODUCT_MODULE_NAME).SampleHandler");
  });

  test("the extension speaks react-native-webrtc's socket protocol and posts started", () => {
    const up = read("CoyoteBroadcast", "SampleUploader.swift");
    for (const h of ["Content-Length", "Buffer-Width", "Buffer-Height", "Buffer-Orientation"]) expect(up).toContain(`"${h}"`);
    const sh = read("CoyoteBroadcast", "SampleHandler.swift");
    expect(sh).toContain('"rtc_SSFD"');
    expect(sh).toContain('"net.swiftirc.coyote.broadcast.started"');
  });

  test("the project builds, embeds and versions the extension with the app", () => {
    const pbx = read("Coyote.xcodeproj", "project.pbxproj");
    expect(pbx).toContain('productType = "com.apple.product-type.app-extension"');
    expect(pbx).toContain("PRODUCT_BUNDLE_IDENTIFIER = net.swiftirc.coyote.broadcast;");
    expect(pbx).toContain("CoyoteBroadcast.appex in Embed Foundation Extensions");
    expect(pbx).toContain("isa = PBXTargetDependency;");
    const versions = [...pbx.matchAll(/MARKETING_VERSION = ([\d.]+);/g)].map((m) => m[1]);
    const builds = [...pbx.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((m) => m[1]);
    expect(versions.length).toBe(4);
    expect(new Set(versions).size).toBe(1);
    expect(builds.length).toBe(4);
    expect(new Set(builds).size).toBe(1);
  });
});

test("iOS CoyoteBackground: module, processor registration and project wiring", () => {
  const ios = path.join(__dirname, "..", "ios");
  const m = fs.readFileSync(path.join(ios, "Coyote", "CoyoteBackground.m"), "utf8");
  expect(m).toContain("RCT_EXTERN_MODULE(CoyoteBackground, RCTEventEmitter)");
  expect(m).toContain("RCT_EXTERN_METHOD(setEffect:(NSDictionary *)effect resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)");
  expect(m).toContain("RCT_EXTERN_METHOD(clear)");
  for (const f of fs.readdirSync(path.join(ios, "Coyote"))) {
    if (!/\.(m|mm|h)$/.test(f)) continue;
    expect([f, /#import\s*["<]Coyote-Swift\.h[">]/.test(fs.readFileSync(path.join(ios, "Coyote", f), "utf8"))]).toEqual([f, false]);
  }
  const proc = fs.readFileSync(path.join(ios, "Coyote", "CoyoteBackgroundProcessor.m"), "utf8");
  expect(proc).toContain("@interface CoyoteBackgroundEngine : NSObject");
  expect(proc).toContain('forName:@"coyote-background"');
  expect(proc).toContain("RTCVideoRotation_0");
  const swift = fs.readFileSync(path.join(ios, "Coyote", "CoyoteBackground.swift"), "utf8");
  expect(swift).toContain("VNGeneratePersonSegmentationRequest");
  expect(swift).toContain('"CoyoteBackgroundTripped"');
  expect(swift).toContain("@objc(setEffect:resolver:rejecter:)");
  expect(swift).toContain("@objc(clear)");
  expect(swift).toContain("budgetMs = 45.0");
  const pbx = fs.readFileSync(path.join(ios, "Coyote.xcodeproj", "project.pbxproj"), "utf8");
  expect(pbx).toContain("CoyoteBackground.swift in Sources");
  expect(pbx).toContain("CoyoteBackground.m in Sources");
  expect(pbx).toContain("CoyoteBackgroundProcessor.m in Sources");
});

test("Android CoyoteBackground: exports, registration, ML Kit, frame ownership", () => {
  const dir = path.join(__dirname, "..", "android", "app", "src", "main", "java", "net", "swiftirc", "coyote");
  const mod = fs.readFileSync(path.join(dir, "CoyoteBackgroundModule.kt"), "utf8");
  expect(exportedNames(mod).sort()).toEqual(["addListener", "clear", "removeListeners", "setEffect"]);
  expect(mod).toContain('"CoyoteBackgroundTripped"');
  const app = fs.readFileSync(path.join(dir, "MainApplication.kt"), "utf8");
  expect(app).toContain('ProcessorProvider.addProcessor("coyote-background"');
  expect(app).toContain("CoyoteBackgroundPackage()");
  const engine = fs.readFileSync(path.join(dir, "BackgroundEngine.kt"), "utf8");
  expect(engine).toContain("SelfieSegmenterOptions.STREAM_MODE");
  expect(engine).toContain("BUDGET_MS = 45.0");
  expect(engine).not.toMatch(/return\s+frame\b/); // never hand the input frame back
  expect(engine).toContain("catch (timeout: TimeoutException)"); // a model still loading passes frames through
  expect(engine).not.toContain("SHORT_SIDE"); // the short side follows the camera's aspect
  expect(mod).toContain("BackgroundEngine.configure(null)"); // clear() frees the scene
  const gradle = fs.readFileSync(path.join(__dirname, "..", "android", "app", "build.gradle"), "utf8");
  expect(gradle).toContain("com.google.mlkit:segmentation-selfie:16.0.0-beta6");
});

// CoyoteAudioRoute follows Telecom's routes through callkeep's VoiceConnection
// (patched): a ping only, so callkeep's synthetic mute states (no Bluetooth
// devices) never reach the picker.
test("callkeep's VoiceConnection forwards audio-route changes", () => {
  const file = path.join(__dirname, "..", "node_modules", "react-native-callkeep", "android",
    "src", "main", "java", "io", "wazo", "callkeep", "VoiceConnection.java");
  const src = fs.readFileSync(file, "utf8");
  expect(src).toMatch(/public interface AudioRouteListener\s*\{\s*void onAudioRouteChanged\(VoiceConnection connection\);\s*\}/);
  expect(src).toContain("public static volatile AudioRouteListener audioRouteListener");
  expect(src).toMatch(/public void onCallEndpointChanged\(CallEndpoint endpoint\)/);
  expect(src).toMatch(/public void onAvailableCallEndpointsChanged\(List<CallEndpoint> endpoints\)/);
  // Forwarded before the mute early return, so route-only changes reach the app.
  const body = src.slice(src.indexOf("public void onCallAudioStateChanged"));
  const notify = body.indexOf("notifyAudioRoute();");
  expect(notify).toBeGreaterThan(0);
  expect(notify).toBeLessThan(body.indexOf("return;"));
});

test("CoyoteAudioRoute routes only through Telecom and reads Telecom's real state", () => {
  const app = path.join(__dirname, "..");
  const dir = path.join(app, "android", "app", "src", "main", "java", "net", "swiftirc", "coyote");
  const kt = fs.readFileSync(path.join(dir, "CoyoteAudioRouteModule.kt"), "utf8");
  expect(exportedNames(kt).sort()).toEqual(["addListener", "removeListeners", "routes", "select", "start", "stop"]);
  expect(kt).toContain('"CoyoteAudioRoutes"');
  expect(kt).not.toMatch(/setSpeakerphoneOn|setCommunicationDevice|startBluetoothSco|setMode\(/);
  // Mute pushes a synthetic CallAudioState through callkeep; never route from it.
  expect(kt).toContain("c.callAudioState");
  expect(kt).toContain("override fun onAudioRouteChanged(connection: VoiceConnection)");
  // Kotlin's `and` binds looser than `!=`: masks must be parenthesised.
  expect(kt).not.toMatch(/mask and [\w.]+ !=/);
  expect(fs.readFileSync(path.join(dir, "MainApplication.kt"), "utf8")).toContain("add(CoyoteAudioRoutePackage())");
});

test("iOS CoyoteAudioRoute reports routes and sets the preferred input; CoyoteRoutePicker wraps AVRoutePickerView; both are built", () => {
  const ios = path.join(__dirname, "..", "ios");
  const read = (f: string) => fs.readFileSync(path.join(ios, "Coyote", f), "utf8");
  expect(read("CoyoteAudioRoute.m")).toContain("RCT_EXTERN_MODULE(CoyoteAudioRoute, RCTEventEmitter)");
  expect(read("CoyoteAudioRoute.m")).toContain("routes:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject");
  expect(read("CoyoteAudioRoute.m")).toContain("selectInput:(NSString *)uid resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject");
  const swift = read("CoyoteAudioRoute.swift");
  expect(swift).toContain("routeChangeNotification");
  expect(swift).toContain('"CoyoteAudioRoutes"');
  expect(swift).toContain("@objc(selectInput:resolver:rejecter:)");
  expect(swift).toContain("setPreferredInput");
  expect(swift).toContain("availableInputs");
  expect(swift).not.toMatch(/setCategory|setMode|setActive|overrideOutputAudioPort/);
  expect(read("CoyoteRoutePicker.m")).toContain("RCT_EXTERN_MODULE(CoyoteRoutePickerManager, RCTViewManager)");
  expect(read("CoyoteRoutePicker.swift")).toContain("AVRoutePickerView");
  const pbx = fs.readFileSync(path.join(ios, "Coyote.xcodeproj", "project.pbxproj"), "utf8");
  for (const f of ["CoyoteAudioRoute.swift", "CoyoteAudioRoute.m", "CoyoteRoutePicker.swift", "CoyoteRoutePicker.m"]) {
    // PBXBuildFile definition + Sources phase entry.
    expect(pbx.split(`/* ${f} in Sources */`).length - 1).toBe(2);
  }
});

// Some OEM builds may never deliver CallEndpoints to a self-managed connection: on
// API 34+ an empty endpoint list must fall back to CallAudioState for listing,
// the selection and switching, or the picker is empty for the whole call.
test("CoyoteAudioRoute falls back to CallAudioState when no CallEndpoints arrive", () => {
  const kt = fs.readFileSync(path.join(__dirname, "..", "android", "app", "src", "main", "java", "net", "swiftirc", "coyote", "CoyoteAudioRouteModule.kt"), "utf8");
  expect(kt).toMatch(/private fun endpoints\(c: VoiceConnection\): List<CallEndpoint>/);
  expect(kt.match(/val eps = endpoints\(c\)\s*\n\s*if \(eps\.isNotEmpty\(\)\)/g)?.length).toBe(3); // outputs, selectedId, selectOn
  expect(kt).not.toMatch(/if \(Build\.VERSION\.SDK_INT >= 34\) \{\s*\n\s*return c\.availableEndpoints/);
});
