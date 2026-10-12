import { DeviceEventEmitter, NativeEventEmitter, NativeModules, Platform } from "react-native";
import InCallManager from "react-native-incall-manager";
import { androidInputs, fromInCallManager, outputForInput, parseRoutes, toInCallManager, type Routes } from "../core/audioRoutes";

const { CoyoteAudioRoute } = NativeModules;

// Android: "telecom" once CoyoteAudioRoute attached to the call's Telecom connection
// (it then owns routing, screen-on and proximity); "fallback" when it found none and
// incall-manager does it all as before. iOS: incall-manager as before ("ios").
let mode: "idle" | "telecom" | "fallback" | "ios" = "idle";
// Bumped by every start/stop; a start that finds it moved on was left mid-way.
let token = 0;

// Video calls start on the speaker, audio-only on the earpiece; a connected headset
// takes precedence.
export async function startCallAudio(callId: string, video: boolean): Promise<void> {
  const mine = ++token;
  if (Platform.OS === "android" && CoyoteAudioRoute) {
    const ok: boolean = await CoyoteAudioRoute.start(callId, video).catch(() => false);
    if (mine !== token) return;
    if (ok) {
      mode = "telecom";
      return;
    }
  }
  mode = Platform.OS === "android" ? "fallback" : "ios";
  InCallManager.start({ media: video ? "video" : "audio", auto: true });
  InCallManager.setKeepScreenOn(true);
}

export function stopCallAudio(): void {
  token++;
  if (Platform.OS === "android") CoyoteAudioRoute?.stop();
  if (Platform.OS === "ios") CoyoteAudioRoute?.resetInput(); // a picked mic is session-wide
  if (mode === "fallback" || mode === "ios") {
    InCallManager.setKeepScreenOn(false);
    InCallManager.stop();
  }
  mode = "idle";
}

// Every change of outputs or selection. Android's module reports when it attaches;
// iOS reports the current output right away, then on every route change.
export function watchRoutes(fn: (r: Routes) => void): () => void {
  const subs: { remove(): void }[] = [];
  if (CoyoteAudioRoute) {
    subs.push(new NativeEventEmitter(CoyoteAudioRoute).addListener("CoyoteAudioRoutes", (e) => {
      const r = parseRoutes(e);
      fn(Platform.OS === "android" ? androidInputs(r) : r);
    }));
    if (Platform.OS === "ios") {
      CoyoteAudioRoute.routes().then((r: unknown) => fn(parseRoutes(r))).catch(() => {});
    }
  }
  if (Platform.OS === "android") {
    subs.push(DeviceEventEmitter.addListener("onAudioDeviceChanged", (e: unknown) => {
      if (mode === "fallback") fn(androidInputs(fromInCallManager(e)));
    }));
  }
  return () => subs.forEach((s) => s.remove());
}

// Android only: iOS picks outputs in the system route picker (in the devices sheet).
export async function selectOutput(id: string): Promise<void> {
  if (mode === "telecom") return CoyoteAudioRoute.select(id);
  if (mode === "fallback") {
    const route = toInCallManager(id);
    if (!route) throw new Error(`unknown audio output ${id}`);
    await InCallManager.chooseAudioRoute(route);
    return;
  }
  throw new Error("audio output selection is not available");
}

// iOS: the preferred input. Android: mics follow outputs, so switch the output the
// mic belongs to (nothing to do when it's already in use).
export async function selectInput(routes: Routes, id: string, video: boolean): Promise<void> {
  if (Platform.OS === "ios") {
    if (!CoyoteAudioRoute) throw new Error("microphone selection is not available");
    return CoyoteAudioRoute.selectInput(id);
  }
  const out = outputForInput(routes, id, video);
  if (out) await selectOutput(out);
}
