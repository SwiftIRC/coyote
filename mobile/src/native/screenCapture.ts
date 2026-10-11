import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import { mediaDevices } from "react-native-webrtc";
import { captureCancelled, discard, type ScreenCapturePort } from "../core/screenShare";
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
// connects to it once the user taps Start Broadcast, and announces that. No
// connection within the wait means the sheet was dismissed (a cancel); a picker
// that can't open at all fails at once (a plain error, so the user is told).
async function startIos(): Promise<TrackLike> {
  if (!CoyoteScreenShare) throw new Error("CoyoteScreenShare native module missing");
  const track = await displayTrack();
  const emitter = new NativeEventEmitter(CoyoteScreenShare);
  return new Promise<TrackLike>((resolve, reject) => {
    let settled = false;
    const sub = emitter.addListener("CoyoteBroadcastStarted", () => finish(null));
    const timer = setTimeout(() => finish(captureCancelled()), BROADCAST_WAIT_MS);
    function finish(err: Error | null) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sub.remove();
      if (err) {
        discard(track);
        reject(err);
      } else {
        resolve(track);
      }
    }
    Promise.resolve()
      .then(() => CoyoteScreenShare.showPicker())
      .catch((e: unknown) => {
        const why = String((e as { message?: unknown })?.message ?? e);
        finish(new Error(`broadcast picker failed: ${why}`));
      });
  });
}

export const screenCapture: ScreenCapturePort = {
  start: () => (Platform.OS === "ios" ? startIos() : startAndroid()),
};
