import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import type { Call } from "../core/call";

// Feeds foreground/background and network changes to the call. A network change
// that keeps "connected" (wifi -> cellular) still reports, because the socket
// usually dies with the old interface; the call only reconnects if it is down.
export function watchLifecycle(call: Pick<Call, "onAppState" | "onNetworkChange">): () => void {
  const app = AppState.addEventListener("change", (s) => {
    if (s === "active" || s === "background" || s === "inactive") {
      call.onAppState(s).catch((e: unknown) => console.warn("onAppState failed", e));
    }
  });
  let last = { connected: true, type: "" };
  const net = NetInfo.addEventListener((st) => {
    const now = { connected: !!st.isConnected, type: String(st.type) };
    if (now.connected && (!last.connected || now.type !== last.type)) call.onNetworkChange(true);
    last = now;
  });
  return () => {
    app.remove();
    net();
  };
}
