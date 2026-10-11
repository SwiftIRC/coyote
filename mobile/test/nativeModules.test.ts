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
