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
