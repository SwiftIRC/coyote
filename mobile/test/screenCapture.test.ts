// The native screen-capture port, with react-native and react-native-webrtc
// mocked: Android's getDisplayMedia path and iOS's broadcast-picker wait.
import { FakeTrack } from "./fakes";

type Listener = () => void;

interface Env {
  track: FakeTrack;
  getDisplayMedia: jest.Mock;
  showPicker: jest.Mock;
  listeners: Set<Listener>;
  emit(): void;
  start(): Promise<unknown>;
  waitMs: number;
}

function load(os: "ios" | "android", opts: { module?: boolean; picker?: () => Promise<unknown> } = {}): Env {
  jest.resetModules();
  const track = new FakeTrack("video");
  const getDisplayMedia = jest.fn(async () => ({ getVideoTracks: () => [track] }));
  const showPicker = jest.fn(opts.picker ?? (async () => null));
  const listeners = new Set<Listener>();
  class NativeEventEmitter {
    addListener(_name: string, fn: Listener) {
      listeners.add(fn);
      return { remove: () => listeners.delete(fn) };
    }
  }
  jest.doMock("react-native", () => ({
    Platform: { OS: os },
    NativeModules: opts.module === false ? {} : { CoyoteScreenShare: { showPicker } },
    NativeEventEmitter,
  }));
  jest.doMock("react-native-webrtc", () => ({ mediaDevices: { getDisplayMedia } }));
  let mod: typeof import("../src/native/screenCapture") | undefined;
  jest.isolateModules(() => {
    mod = require("../src/native/screenCapture");
  });
  return {
    track,
    getDisplayMedia,
    showPicker,
    listeners,
    emit: () => {
      for (const fn of [...listeners]) fn();
    },
    start: () => mod!.screenCapture.start(),
    waitMs: mod!.BROADCAST_WAIT_MS,
  };
}

// Let the getDisplayMedia await and the picker call run.
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

afterEach(() => {
  jest.useRealTimers();
  jest.dontMock("react-native");
  jest.dontMock("react-native-webrtc");
});

describe("Android", () => {
  test("a granted capture returns the screen track", async () => {
    const env = load("android");
    await expect(env.start()).resolves.toBe(env.track);
    expect(env.showPicker).not.toHaveBeenCalled();
  });

  test("a NotAllowedError (consent denied) is a cancel", async () => {
    const env = load("android");
    env.getDisplayMedia.mockRejectedValueOnce(new Error("NotAllowedError: Permission denied"));
    await expect(env.start()).rejects.toMatchObject({ name: "CaptureCancelled" });
  });

  test("any other failure is rethrown as is, not a cancel", async () => {
    const env = load("android");
    const boom = new Error("boom");
    env.getDisplayMedia.mockRejectedValueOnce(boom);
    const e = await env.start().catch((x: Error) => x) as Error;
    expect(e).toBe(boom);
    expect(e.name).not.toBe("CaptureCancelled");
  });
});

describe("iOS", () => {
  test("the extension's started event resolves with the track and drops the listener", async () => {
    const env = load("ios");
    const p = env.start();
    await settle();
    expect(env.showPicker).toHaveBeenCalledTimes(1);
    expect(env.listeners.size).toBe(1);
    env.emit();
    await expect(p).resolves.toBe(env.track);
    expect(env.listeners.size).toBe(0);
    expect(env.track.stopped).toBe(false);
  });

  test("no broadcast within the wait is a cancel; the track is stopped and released", async () => {
    jest.useFakeTimers();
    const env = load("ios");
    const p = env.start();
    const out = p.catch((e: Error) => e) as Promise<Error>;
    await settle();
    jest.advanceTimersByTime(env.waitMs - 1);
    expect(env.track.stopped).toBe(false);
    jest.advanceTimersByTime(1);
    const e = await out;
    expect(e.name).toBe("CaptureCancelled");
    expect(env.track.stopped).toBe(true);
    expect(env.track.released).toBe(true);
    expect(env.listeners.size).toBe(0);
  });

  test("a picker failure rejects at once with a plain error; track stopped and released, timer cleared", async () => {
    jest.useFakeTimers();
    const env = load("ios", { picker: async () => Promise.reject(new Error("Broadcast picker button not found")) });
    const e = await env.start().catch((x: Error) => x) as Error;
    expect(e).toBeInstanceOf(Error);
    expect(e.name).not.toBe("CaptureCancelled");
    expect(env.track.stopped).toBe(true);
    expect(env.track.released).toBe(true);
    expect(env.listeners.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("settles once: a picker rejection after the broadcast started leaves the live track alone", async () => {
    let fail: (e: Error) => void = () => undefined;
    const env = load("ios", { picker: () => new Promise((_resolve, reject) => (fail = reject)) });
    const p = env.start();
    await settle();
    env.emit();
    await expect(p).resolves.toBe(env.track);
    fail(new Error("late"));
    await settle();
    expect(env.track.stopped).toBe(false);
    expect(env.track.released).toBe(false);
  });

  test("a missing CoyoteScreenShare module rejects", async () => {
    const env = load("ios", { module: false });
    await expect(env.start()).rejects.toThrow("CoyoteScreenShare");
    expect(env.getDisplayMedia).not.toHaveBeenCalled();
  });
});
