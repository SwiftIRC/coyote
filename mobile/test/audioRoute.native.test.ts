// The audio-route native glue, with react-native and incall-manager mocked.
export {}; // a module, so its helpers don't collide with other script-style tests
import { androidInputs, NO_ROUTES } from "../src/core/audioRoutes";
type Listener = (e: unknown) => void;

function load(os: "ios" | "android", opts: { module?: boolean; start?: () => Promise<boolean> } = {}) {
  jest.resetModules();
  const native = {
    start: jest.fn(opts.start ?? (async () => true)),
    stop: jest.fn(),
    routes: jest.fn(async () => ({ outputs: [{ id: "u1", kind: "speaker", name: "Speaker" }], selected: "u1" })),
    select: jest.fn(async () => undefined),
    selectInput: jest.fn(async () => undefined),
    resetInput: jest.fn(),
  };
  const icm = {
    start: jest.fn(), stop: jest.fn(), setKeepScreenOn: jest.fn(),
    chooseAudioRoute: jest.fn(async () => ({})),
  };
  const moduleListeners = new Set<Listener>();
  const deviceListeners = new Map<string, Set<Listener>>();
  class NativeEventEmitter {
    addListener(_name: string, fn: Listener) {
      moduleListeners.add(fn);
      return { remove: () => moduleListeners.delete(fn) };
    }
  }
  const DeviceEventEmitter = {
    addListener(name: string, fn: Listener) {
      if (!deviceListeners.has(name)) deviceListeners.set(name, new Set());
      deviceListeners.get(name)!.add(fn);
      return { remove: () => deviceListeners.get(name)!.delete(fn) };
    },
  };
  jest.doMock("react-native", () => ({
    Platform: { OS: os },
    NativeModules: opts.module === false ? {} : { CoyoteAudioRoute: native },
    NativeEventEmitter,
    DeviceEventEmitter,
  }));
  jest.doMock("react-native-incall-manager", () => ({ __esModule: true, default: icm }));
  let mod: typeof import("../src/native/audioRoute") | undefined;
  jest.isolateModules(() => {
    mod = require("../src/native/audioRoute");
  });
  return {
    mod: mod!, native, icm,
    emit: (e: unknown) => moduleListeners.forEach((fn) => fn(e)),
    emitIcm: (e: unknown) => deviceListeners.get("onAudioDeviceChanged")?.forEach((fn) => fn(e)),
    moduleListeners, deviceListeners,
  };
}

const flush = () => new Promise((r) => setImmediate(r));

test("Android with a Telecom connection: CoyoteAudioRoute only, no incall-manager", async () => {
  const t = load("android");
  await t.mod.startCallAudio("c1", true);
  expect(t.native.start).toHaveBeenCalledWith("c1", true);
  expect(t.icm.start).not.toHaveBeenCalled();
  await t.mod.selectOutput("bt:AA");
  expect(t.native.select).toHaveBeenCalledWith("bt:AA");
  t.mod.stopCallAudio();
  expect(t.native.stop).toHaveBeenCalled();
  expect(t.icm.stop).not.toHaveBeenCalled();
});

test("Android without a Telecom connection falls back to incall-manager", async () => {
  const t = load("android", { start: async () => false });
  await t.mod.startCallAudio("c1", false);
  expect(t.icm.start).toHaveBeenCalledWith({ media: "audio", auto: true });
  expect(t.icm.setKeepScreenOn).toHaveBeenCalledWith(true);
  await t.mod.selectOutput("speaker");
  expect(t.icm.chooseAudioRoute).toHaveBeenCalledWith("SPEAKER_PHONE");
  t.mod.stopCallAudio();
  expect(t.icm.setKeepScreenOn).toHaveBeenLastCalledWith(false);
  expect(t.icm.stop).toHaveBeenCalled();
});

test("a failing native start also falls back", async () => {
  const t = load("android", { start: async () => { throw new Error("boom"); } });
  await t.mod.startCallAudio("c1", true);
  expect(t.icm.start).toHaveBeenCalledWith({ media: "video", auto: true });
});

test("leaving while start still waits for the connection starts nothing afterwards", async () => {
  let resolve: (ok: boolean) => void = () => {};
  const t = load("android", { start: () => new Promise<boolean>((r) => { resolve = r; }) });
  const started = t.mod.startCallAudio("c1", true);
  t.mod.stopCallAudio();
  resolve(false);
  await started;
  expect(t.icm.start).not.toHaveBeenCalled();
  expect(t.icm.setKeepScreenOn).not.toHaveBeenCalled();
  await expect(t.mod.selectOutput("speaker")).rejects.toThrow();
});

test("watchRoutes: Telecom events always, incall-manager events only in fallback", async () => {
  const t = load("android", { start: async () => false });
  const seen: unknown[] = [];
  const stop = t.mod.watchRoutes((r) => seen.push(r));
  expect(t.native.routes).not.toHaveBeenCalled(); // Android reports on attach
  t.emitIcm({ availableAudioDeviceList: '["SPEAKER_PHONE"]', selectedAudioDevice: "SPEAKER_PHONE" });
  expect(seen).toEqual([]); // not in fallback yet
  await t.mod.startCallAudio("c1", true);
  t.emitIcm({ availableAudioDeviceList: '["SPEAKER_PHONE"]', selectedAudioDevice: "SPEAKER_PHONE" });
  t.emit({ outputs: [{ id: "speaker", kind: "speaker", name: "Speaker" }, { id: "x", kind: "nope", name: "?" }], selected: "speaker" });
  const mic = { id: "builtin", kind: "builtin", name: "Phone microphone" };
  expect(seen).toEqual([
    { outputs: [{ id: "speaker", kind: "speaker", name: "Speaker" }], selected: "speaker", inputs: [mic], input: "builtin" },
    { outputs: [{ id: "speaker", kind: "speaker", name: "Speaker" }], selected: "speaker", inputs: [mic], input: "builtin" },
  ]);
  stop();
  expect(t.moduleListeners.size).toBe(0);
  expect(t.deviceListeners.get("onAudioDeviceChanged")!.size).toBe(0);
});

test("iOS: incall-manager as before, current output fetched at once and followed", async () => {
  const t = load("ios");
  const seen: unknown[] = [];
  t.mod.watchRoutes((r) => seen.push(r));
  await flush();
  expect(seen).toEqual([{ outputs: [{ id: "u1", kind: "speaker", name: "Speaker" }], selected: "u1", inputs: [], input: "" }]);
  await t.mod.startCallAudio("c1", true);
  expect(t.native.start).not.toHaveBeenCalled();
  expect(t.icm.start).toHaveBeenCalledWith({ media: "video", auto: true });
  await expect(t.mod.selectOutput("u1")).rejects.toThrow();
  t.mod.stopCallAudio();
  expect(t.icm.stop).toHaveBeenCalled();
});

test("without the native module: fallback on Android, still no crash on watch", async () => {
  const t = load("android", { module: false });
  const stop = t.mod.watchRoutes(() => {});
  await t.mod.startCallAudio("c1", true);
  expect(t.icm.start).toHaveBeenCalled();
  stop();
});

const androidRoutes = (selected: string) => androidInputs({
  outputs: [{ id: "speaker", kind: "speaker", name: "Speaker" }, { id: "bt:AA", kind: "bluetooth", name: "Buds" }],
  selected, inputs: [], input: "",
});

test("Android payloads gain the microphones their outputs bring", async () => {
  const t = load("android");
  await t.mod.startCallAudio("c1", false);
  const seen: unknown[] = [];
  t.mod.watchRoutes((r) => seen.push(r));
  t.emit({ outputs: [{ id: "speaker", kind: "speaker", name: "Speaker" }, { id: "bt:AA", kind: "bluetooth", name: "Buds" }], selected: "bt:AA" });
  expect(seen.at(-1)).toMatchObject({ input: "bt:AA", inputs: [{ id: "builtin" }, { id: "bt:AA", name: "Buds" }] });
});

test("the Android fallback's routes gain microphones too", async () => {
  const t = load("android", { start: async () => false });
  await t.mod.startCallAudio("c1", false);
  const seen: unknown[] = [];
  t.mod.watchRoutes((r) => seen.push(r));
  t.emitIcm({ availableAudioDeviceList: '["EARPIECE","SPEAKER_PHONE"]', selectedAudioDevice: "SPEAKER_PHONE" });
  expect(seen.at(-1)).toMatchObject({ input: "builtin", inputs: [{ id: "builtin" }] });
});

test("Android selectInput switches to the output the mic belongs to", async () => {
  const t = load("android");
  await t.mod.startCallAudio("c1", true);
  await t.mod.selectInput(androidRoutes("bt:AA"), "builtin", true);
  expect(t.native.select).toHaveBeenCalledWith("speaker");
  t.native.select.mockClear();
  await t.mod.selectInput(androidRoutes("bt:AA"), "bt:AA", true);
  expect(t.native.select).not.toHaveBeenCalled();
  expect(t.native.selectInput).not.toHaveBeenCalled();
});

test("iOS selectInput sets the preferred input natively; its payloads keep their inputs", async () => {
  const t = load("ios");
  await t.mod.selectInput(NO_ROUTES, "uid-1", false);
  expect(t.native.selectInput).toHaveBeenCalledWith("uid-1");
  const seen: unknown[] = [];
  t.mod.watchRoutes((r) => seen.push(r));
  t.emit({ outputs: [], selected: "", inputs: [{ id: "uid-1", kind: "usb", name: "USB Mic" }], input: "uid-1" });
  expect(seen.at(-1)).toMatchObject({ input: "uid-1", inputs: [{ id: "uid-1", kind: "usb" }] });
});

// setPreferredInput is session-wide and outlives the call: a mic picked in one call
// must not carry into the next ("no persistence").
test("iOS: leaving the call clears the preferred microphone", async () => {
  const t = load("ios");
  await t.mod.startCallAudio("c1", false);
  t.mod.stopCallAudio();
  expect(t.native.resetInput).toHaveBeenCalled();
});

test("Android: leaving the call has no preferred microphone to clear", async () => {
  const t = load("android");
  await t.mod.startCallAudio("c1", false);
  t.mod.stopCallAudio();
  expect(t.native.resetInput).not.toHaveBeenCalled();
});
