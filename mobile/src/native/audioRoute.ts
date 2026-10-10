import { DeviceEventEmitter, Platform } from "react-native";
import InCallManager from "react-native-incall-manager";
import { nextRoute, type AudioRoutes } from "../core/audioRoutes";

// Video calls default to the speaker, audio-only to the earpiece with the proximity
// sensor; a connected headset takes precedence (InCallManager "auto").
export function startCallAudio(video: boolean): void {
  InCallManager.start({ media: video ? "video" : "audio", auto: true });
  InCallManager.setKeepScreenOn(true);
}

export function stopCallAudio(): void {
  InCallManager.setKeepScreenOn(false);
  InCallManager.stop();
}

let iosSpeaker = false;

// Android reports devices; iOS only exposes speaker on/off (Bluetooth is picked by
// the system, from Control Centre or the CallKit screen).
export function watchRoutes(fn: (r: AudioRoutes) => void): () => void {
  if (Platform.OS !== "android") {
    fn({ available: ["EARPIECE", "SPEAKER_PHONE"], selected: iosSpeaker ? "SPEAKER_PHONE" : "EARPIECE" });
    return () => {};
  }
  const sub = DeviceEventEmitter.addListener("onAudioDeviceChanged", (d: any) => {
    let available: string[] = [];
    try {
      available = JSON.parse(d?.availableAudioDeviceList || "[]");
    } catch {
      available = [];
    }
    fn({ available, selected: String(d?.selectedAudioDevice || "") });
  });
  return () => sub.remove();
}

export async function cycleRoute(r: AudioRoutes): Promise<void> {
  if (Platform.OS === "android") {
    const next = nextRoute(r);
    if (next) await InCallManager.chooseAudioRoute(next);
    return;
  }
  iosSpeaker = !iosSpeaker;
  InCallManager.setForceSpeakerphoneOn(iosSpeaker);
}
