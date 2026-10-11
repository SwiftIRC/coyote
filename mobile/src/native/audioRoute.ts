import { DeviceEventEmitter, Platform } from "react-native";
import InCallManager from "react-native-incall-manager";
import { nextRoute, type AudioRoutes } from "../core/audioRoutes";
import { iosInitialSpeaker, iosRoutes } from "../core/iosRoute";

// Video calls default to the speaker, audio-only to the earpiece with the proximity
// sensor; a connected headset takes precedence (InCallManager "auto").
export function startCallAudio(video: boolean): void {
  setIosSpeaker(iosInitialSpeaker(video));
  InCallManager.start({ media: video ? "video" : "audio", auto: true });
  InCallManager.setKeepScreenOn(true);
}

export function stopCallAudio(): void {
  InCallManager.setKeepScreenOn(false);
  InCallManager.stop();
  setIosSpeaker(false);
}

// iOS speaker state, with the route subscribers to notify: the call screen subscribes
// before startCallAudio runs, so changes are re-emitted.
let iosSpeaker = false;
const iosListeners = new Set<(r: AudioRoutes) => void>();

function setIosSpeaker(on: boolean): void {
  iosSpeaker = on;
  iosListeners.forEach((fn) => fn(iosRoutes(iosSpeaker)));
}

// Android reports devices; iOS only exposes speaker on/off (Bluetooth is picked by
// the system, from Control Centre or the CallKit screen).
export function watchRoutes(fn: (r: AudioRoutes) => void): () => void {
  if (Platform.OS !== "android") {
    iosListeners.add(fn);
    fn(iosRoutes(iosSpeaker));
    return () => {
      iosListeners.delete(fn);
    };
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
  InCallManager.setForceSpeakerphoneOn(!iosSpeaker);
  setIosSpeaker(!iosSpeaker);
}
