// The background-effect native port, with react-native mocked.
type Listener = (e: unknown) => void;

function load(os: "ios" | "android", opts: { module?: boolean } = {}) {
  jest.resetModules();
  const setEffect = jest.fn(async () => null);
  const listeners = new Set<Listener>();
  class NativeEventEmitter {
    addListener(_name: string, fn: Listener) {
      listeners.add(fn);
      return { remove: () => listeners.delete(fn) };
    }
  }
  jest.doMock("react-native", () => ({
    Platform: { OS: os },
    NativeModules: opts.module === false ? {} : { CoyoteBackground: { setEffect } },
    NativeEventEmitter,
  }));
  let mod: typeof import("../src/native/background") | undefined;
  jest.isolateModules(() => {
    mod = require("../src/native/background");
  });
  return { mod: mod!, setEffect, emit: (e: unknown) => listeners.forEach((fn) => fn(e)), listeners };
}

function track() {
  const calls: unknown[] = [];
  return { id: "t1", kind: "video", enabled: true, stop() {}, _setVideoEffects: (n: unknown) => calls.push(n), calls };
}

test("setEffect forwards the effect to the native module", async () => {
  const { mod, setEffect } = load("ios");
  await mod.effectPort.setEffect({ kind: "blur", radius: 0.012 });
  expect(setEffect).toHaveBeenCalledWith({ kind: "blur", radius: 0.012 });
});

test("setEffect rejects when the native module is missing", async () => {
  const { mod } = load("android", { module: false });
  await expect(mod.effectPort.setEffect({ kind: "blur", radius: 0.012 })).rejects.toThrow();
});

test("attach installs the coyote-background processor", () => {
  const { mod } = load("ios");
  const t = track();
  mod.effectPort.attach(t);
  expect(mod.PROCESSOR).toBe("coyote-background");
  expect(t.calls).toEqual([["coyote-background"]]);
});

test("detach: [] on iOS, null on Android", () => {
  const ios = load("ios");
  const a = track();
  ios.mod.effectPort.detach(a);
  expect(a.calls).toEqual([[]]);
  const android = load("android");
  const b = track();
  android.mod.effectPort.detach(b);
  expect(b.calls).toEqual([null]);
});

test("attach/detach on a track without effects support do nothing", () => {
  const { mod } = load("ios");
  const t = { id: "x", kind: "video", enabled: true, stop() {} };
  expect(() => mod.effectPort.attach(t)).not.toThrow();
  expect(() => mod.effectPort.detach(t)).not.toThrow();
});

test("trip events reach the listener with a valid reason only; unsubscribe works", () => {
  const { mod, emit, listeners } = load("android");
  const got: string[] = [];
  const off = mod.onBackgroundTripped((r) => got.push(r));
  emit({ reason: "slow" });
  emit({ reason: "bogus" });
  emit({ reason: "failed" });
  expect(got).toEqual(["slow", "failed"]);
  off();
  expect(listeners.size).toBe(0);
});
