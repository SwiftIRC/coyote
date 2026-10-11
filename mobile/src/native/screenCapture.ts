import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import { mediaDevices } from "react-native-webrtc";
import { captureCancelled, type ScreenCapturePort } from "../core/screenShare";
import type { TrackLike } from "../core/types";

const { CoyoteScreenShare } = NativeModules;

// How long iOS waits for the broadcast extension to connect after opening the
// system sheet; no connection by then means the sheet was dismissed.
export const BROADCAST_WAIT_MS = 30000;

async function displayTrack(): Promise<TrackLike> {
  const stream = await mediaDevices.getDisplayMedia({ video: true } as any);
  const track = stream.getVideoTracks()[0];
  if (!track) throw new Error("no screen track");
  return track as unknown as TrackLike;
}

async function startAndroid(): Promise<TrackLike> {
  try {
    return await displayTrack();
  } catch (e) {
    if (String((e as { message?: unknown })?.message ?? "").includes("NotAllowedError")) throw captureCancelled();
    throw e;
  }
}

// getDisplayMedia opens react-native-webrtc's socket server first; the extension
// connects to it once the user taps Start Broadcast, and announces that.
async function startIos(): Promise<TrackLike> {
  if (!CoyoteScreenShare) throw new Error("CoyoteScreenShare native module missing");
  const track = await displayTrack();
  const emitter = new NativeEventEmitter(CoyoteScreenShare);
  return new Promise<TrackLike>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const sub = emitter.addListener("CoyoteBroadcastStarted", () => finish(true));
    function finish(ok: boolean) {
      if (timer) clearTimeout(timer);
      sub.remove();
      if (ok) {
        resolve(track);
      } else {
        track.stop();
        reject(captureCancelled());
      }
    }
    timer = setTimeout(() => finish(false), BROADCAST_WAIT_MS);
    CoyoteScreenShare.showPicker();
  });
}

export const screenCapture: ScreenCapturePort = {
  start: () => (Platform.OS === "ios" ? startIos() : startAndroid()),
};
