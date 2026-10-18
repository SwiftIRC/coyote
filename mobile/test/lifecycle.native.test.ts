// watchLifecycle: Android follows the activity's on-screen state, iOS AppState.
export {};
type Listener = (e: unknown) => void;

function load(os: "ios" | "android", module = true) {
  jest.resetModules();
  const listeners = new Map<string, Set<Listener>>();
  const add = (name: string, fn: Listener) => {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name)!.add(fn);
    return { remove: () => listeners.get(name)!.delete(fn) };
  };
  class NativeEventEmitter {
    addListener(name: string, fn: Listener) { return add(name, fn); }
  }
  jest.doMock("react-native", () => ({
    Platform: { OS: os },
    NativeModules: module ? { CoyotePip: { setPip: jest.fn() } } : {},
    NativeEventEmitter,
    AppState: { addEventListener: (_: string, fn: Listener) => add("AppState", fn) },
  }));
  jest.doMock("@react-native-community/netinfo", () => ({
    __esModule: true,
    default: { addEventListener: (fn: Listener) => { const s = add("NetInfo", fn); return () => s.remove(); } },
  }));
  let mod: typeof import("../src/native/lifecycle") | undefined;
  jest.isolateModules(() => {
    mod = require("../src/native/lifecycle");
  });
  const call = { onAppState: jest.fn(async () => {}), onNetworkChange: jest.fn() };
  const stop = mod!.watchLifecycle(call);
  return { call, stop, listeners, emit: (name: string, e: unknown) => listeners.get(name)?.forEach((fn) => fn(e)) };
}

test("Android: stop → background, start → active; AppState is ignored", () => {
  const { call, emit } = load("android");
  emit("AppState", "background"); // shrinking into PiP pauses the activity
  expect(call.onAppState).not.toHaveBeenCalled();
  emit("CoyotePipVisibility", { visible: false });
  emit("CoyotePipVisibility", { visible: true });
  expect(call.onAppState.mock.calls).toEqual([["background"], ["active"]]);
});

test("Android: repeats are dropped, including a first 'visible'", () => {
  const { call, emit } = load("android");
  emit("CoyotePipVisibility", { visible: true });
  emit("CoyotePipVisibility", { visible: false });
  emit("CoyotePipVisibility", { visible: false });
  emit("CoyotePipVisibility", { visible: true });
  emit("CoyotePipVisibility", { visible: true });
  expect(call.onAppState.mock.calls).toEqual([["background"], ["active"]]);
});

test("Android without the module falls back to AppState", () => {
  const { call, emit } = load("android", false);
  emit("AppState", "background");
  expect(call.onAppState.mock.calls).toEqual([["background"]]);
});

test("iOS: AppState as before", () => {
  const { call, emit } = load("ios");
  emit("AppState", "inactive");
  emit("AppState", "background");
  emit("AppState", "active");
  emit("AppState", "unknown");
  expect(call.onAppState.mock.calls).toEqual([["inactive"], ["background"], ["active"]]);
});

test("unsubscribes everything", () => {
  const { stop, listeners } = load("android");
  stop();
  for (const s of listeners.values()) expect(s.size).toBe(0);
});
