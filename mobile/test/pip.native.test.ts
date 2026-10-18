// The picture-in-picture native glue, with react-native mocked.
export {};
type Listener = (e: unknown) => void;

function load(os: "ios" | "android", module = true) {
  jest.resetModules();
  const native = { setPip: jest.fn() };
  const listeners = new Map<string, Set<Listener>>();
  class NativeEventEmitter {
    addListener(name: string, fn: Listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(fn);
      return { remove: () => listeners.get(name)!.delete(fn) };
    }
  }
  jest.doMock("react-native", () => ({
    Platform: { OS: os },
    NativeModules: module ? { CoyotePip: native } : {},
    NativeEventEmitter,
  }));
  let mod: typeof import("../src/native/pip") | undefined;
  jest.isolateModules(() => {
    mod = require("../src/native/pip");
  });
  return { mod: mod!, native, emit: (name: string, e: unknown) => listeners.get(name)?.forEach((fn) => fn(e)), listeners };
}

test("setPip passes the params to the module on Android", () => {
  const { mod, native } = load("android");
  mod.setPip({ enabled: true, micOn: false, aspect: "screen" });
  expect(native.setPip).toHaveBeenCalledWith(true, false, "screen");
});

test("iOS: setPip does nothing and there is no visibility source", () => {
  const { mod, native } = load("ios");
  mod.setPip({ enabled: true, micOn: true, aspect: "person" });
  expect(native.setPip).not.toHaveBeenCalled();
  expect(mod.watchVisibility(() => {})).toBeNull();
  const fn = jest.fn();
  mod.watchPip(fn)();
  mod.watchPipActions(fn)();
  expect(fn).not.toHaveBeenCalled();
});

test("Android without the module: no visibility source, no crash", () => {
  const { mod } = load("android", false);
  expect(mod.watchVisibility(() => {})).toBeNull();
  expect(() => mod.setPip({ enabled: false, micOn: false, aspect: "person" })).not.toThrow();
});

test("events reach their watchers; malformed ones are dropped; unsubscribe stops them", () => {
  const { mod, emit, listeners } = load("android");
  const pip = jest.fn();
  const act = jest.fn();
  const vis = jest.fn();
  const stopPip = mod.watchPip(pip);
  const stopAct = mod.watchPipActions(act);
  const stopVis = mod.watchVisibility(vis)!;
  emit("CoyotePipChanged", { inPip: true });
  emit("CoyotePipChanged", {});
  emit("CoyotePipAction", { action: "mic" });
  emit("CoyotePipAction", { action: "dance" });
  emit("CoyotePipVisibility", { visible: false });
  emit("CoyotePipVisibility", { visible: "no" });
  expect(pip.mock.calls).toEqual([[true], [false]]);
  expect(act.mock.calls).toEqual([["mic"]]);
  expect(vis.mock.calls).toEqual([[false]]);
  stopPip(); stopAct(); stopVis();
  for (const s of listeners.values()) expect(s.size).toBe(0);
});
