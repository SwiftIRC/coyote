import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import RNCallKeep from "react-native-callkeep";
import { RTCAudioSession } from "react-native-webrtc";
import type { SystemCallPort } from "../core/call";
import { SystemCallRouter, type SystemCallTarget } from "../core/systemCallRouter";

const { CallService } = NativeModules;
let setupDone: Promise<void> | null = null;

// One-time CallKit / ConnectionService registration. Android uses a self-managed
// ConnectionService (our own UI; the system handles Bluetooth buttons and holds us
// for a cellular call).
export function setupSystemCalls(): Promise<void> {
  if (!setupDone) {
    setupDone = RNCallKeep.setup({
      ios: { appName: "Coyote", supportsVideo: true, maximumCallGroups: "1", maximumCallsPerCallGroup: "1", includesCallsInRecents: false },
      android: {
        alertTitle: "Calling accounts",
        alertDescription: "Coyote needs this to keep calls running in the background",
        cancelButton: "Cancel",
        okButton: "OK",
        selfManaged: true,
        additionalPermissions: [],
      },
    }).then(() => {
      if (Platform.OS === "android") RNCallKeep.setAvailable(true);
    }).catch((e) => {
      setupDone = null; // allow a retry
      throw e;
    });
  }
  return setupDone;
}

export function createSystemCall(target: () => SystemCallTarget | null): { port: SystemCallPort; dispose(): void } {
  const router = new SystemCallRouter(console);
  // Own subscriptions only: removeEventListener(type) would clear another call's handlers.
  const subs: { remove(): void }[] = [];
  const withTarget = (fn: (t: SystemCallTarget) => void) => {
    try {
      const t = target();
      if (t) fn(t);
    } catch (e) {
      console.warn("system call event failed", e);
    }
  };

  subs.push(RNCallKeep.addEventListener("didPerformSetMutedCallAction", ({ muted, callUUID }) => withTarget((t) => router.mute(callUUID, muted, t))));
  subs.push(RNCallKeep.addEventListener("endCall", ({ callUUID }) => withTarget((t) => router.end(callUUID, t))));
  subs.push(RNCallKeep.addEventListener("didToggleHoldCallAction", ({ hold, callUUID }) => withTarget((t) => router.hold(callUUID, hold, t))));
  // CallKit owns the iOS audio session: libwebrtc's audio unit may only run while
  // CallKit has it active. Getting this wrong is a silent call (MANUAL-TEST item 1).
  subs.push(RNCallKeep.addEventListener("didActivateAudioSession", () => {
    if (Platform.OS === "ios") RTCAudioSession.audioSessionDidActivate();
  }));
  subs.push(RNCallKeep.addEventListener("didDeactivateAudioSession", () => {
    if (Platform.OS === "ios") RTCAudioSession.audioSessionDidDeactivate();
  }));
  const leaveSub = Platform.OS === "android"
    ? new NativeEventEmitter(CallService).addListener("CallServiceLeave", () => withTarget((t) => router.endCurrent(t)))
    : null;

  const port: SystemCallPort = {
    start(callId, room, video) {
      router.track(callId);
      RNCallKeep.startCall(callId, `#${room}`, `#${room}`, "generic", video);
      if (Platform.OS === "android") CallService.start(room);
    },
    connected(callId) {
      if (Platform.OS === "ios") RNCallKeep.reportConnectedOutgoingCallWithUUID(callId);
      else RNCallKeep.setCurrentCallActive(callId);
    },
    end(callId) {
      router.clear(callId); // our own endCall must not echo back as a leave
      RNCallKeep.endCall(callId);
      if (Platform.OS === "android") CallService.stop();
    },
    setMuted(callId, muted) {
      RNCallKeep.setMutedCall(callId, muted);
    },
  };

  return {
    port,
    dispose() {
      for (const s of subs) s.remove();
      leaveSub?.remove();
    },
  };
}
