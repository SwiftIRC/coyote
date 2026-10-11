import { Call, type CallEvents } from "../core/call";
import { Peer } from "../core/peer";
import { Signaling } from "../core/signaling";
import type { SocketLike } from "../core/types";
import { uuidV4 } from "../core/uuid";
import { watchLifecycle } from "./lifecycle";
import { playChime } from "./sounds";
import { createSystemCall } from "./systemCall";
import { createCandidate, createPeerConnection, createStream, media, videoCodecs } from "./webrtc";

const timers = {
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

// Wires a Call to every native port. One Call per room session; dispose() when it ends.
export function createCall(events: CallEvents): { call: Call; dispose(): void } {
  let call: Call | null = null;
  const system = createSystemCall(() => call);
  call = new Call({
    createSignaling: (url) => new Signaling(url, {
      createSocket: (u) => new WebSocket(u) as unknown as SocketLike,
      random: Math.random,
      log: console,
      ...timers,
    }),
    createPeer: (sig, ev) => new Peer(sig, { createPeerConnection, createStream, createCandidate, videoCodecs, log: console, ...timers }, ev),
    media,
    system: system.port,
    uuid: () => uuidV4(Math.random),
    log: console,
    timers,
    now: () => Date.now(),
    playChime,
  }, events);
  const stopLifecycle = watchLifecycle(call);
  return {
    call,
    dispose() {
      stopLifecycle();
      system.dispose();
    },
  };
}
