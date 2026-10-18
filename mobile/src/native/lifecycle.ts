import { AppState, Platform } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import type { Call } from "../core/call";
import { watchVisibility } from "./pip";

type AppPhase = "active" | "background" | "inactive";

// Feeds foreground/background and network changes to the call. A network change
// that keeps "connected" (wifi -> cellular) still reports, because the socket
// usually dies with the old interface; the call only reconnects if it is down.
export function watchLifecycle(call: Pick<Call, "onAppState" | "onNetworkChange">): () => void {
  const report = (s: AppPhase) => call.onAppState(s).catch((e: unknown) => console.warn("onAppState failed", e));
  // Android: the activity's on-screen state, not AppState, which says "background" on
  // pause, and a call shrunk into picture-in-picture is paused but still on screen (its
  // camera keeps sending). Assumed visible at start; repeats are dropped so a restore
  // can't run twice.
  let visible = true;
  const stopVisibility = Platform.OS === "android"
    ? watchVisibility((v) => {
      if (v === visible) return;
      visible = v;
      report(v ? "active" : "background");
    })
    : null;
  const app = stopVisibility ? null : AppState.addEventListener("change", (s) => {
    if (s === "active" || s === "background" || s === "inactive") report(s);
  });
  let last: { connected: boolean; type: string } | null = null; // first event is the baseline
  const net = NetInfo.addEventListener((st) => {
    const now = { connected: !!st.isConnected, type: String(st.type) };
    if (last && now.connected && (!last.connected || now.type !== last.type)) call.onNetworkChange(true);
    last = now;
  });
  return () => {
    stopVisibility?.();
    app?.remove();
    net();
  };
}
