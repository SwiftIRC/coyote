import { useEffect, useState, useSyncExternalStore } from "react";
import type { ChatSnapshot } from "../core/chat";
import type { ModSnapshot } from "../core/moderation";
import type { PollView } from "../core/polls";
import type { ShareSnapshot } from "../core/screenShare";
import type { BoardSnapshot } from "../core/soundboard";
import { formatDuration } from "../shared/web";
import { useCall } from "./CallContext";

type Store<T> = { subscribe(fn: () => void): () => void; getSnapshot(): T };
const noopSubscribe = () => () => {};

export function useStore<T>(store: Store<T> | null, fallback: T): T {
  return useSyncExternalStore(store ? store.subscribe : noopSubscribe, store ? store.getSnapshot : () => fallback);
}

const EMPTY_CHAT: ChatSnapshot = { entries: [], unread: 0, open: false };

export function useChat(): ChatSnapshot {
  // CallProvider's value changes with every call state change, so this re-renders and re-reads call().
  const { call } = useCall();
  return useStore(call()?.chat ?? null, EMPTY_CHAT);
}

// The room timer as "m:ss" / "h:mm:ss", or null when the server didn't send roomAge.
export function useElapsed(): string | null {
  const { call } = useCall();
  const start = useStore(call()?.clock ?? null, null as number | null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (start === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [start]);
  return start === null ? null : formatDuration((now - start) / 1000);
}

export function usePoll(): PollView | null {
  const { call } = useCall();
  return useStore(call()?.polls ?? null, null as PollView | null);
}

const EMPTY_BOARD: BoardSnapshot = { sounds: null, playing: null, clips: {} };

export function useSoundboard(): BoardSnapshot {
  const { call } = useCall();
  return useStore(call()?.soundboard ?? null, EMPTY_BOARD);
}

const EMPTY_MOD: ModSnapshot = { locked: false, quality: { camera: "auto", screen: "auto" } };

const EMPTY_SHARE: ShareSnapshot = { status: "idle" };

export function useScreenShare(): ShareSnapshot {
  const { call } = useCall();
  return useStore(call()?.screenShare ?? null, EMPTY_SHARE);
}

export function useModeration(): ModSnapshot {
  const { call } = useCall();
  return useStore(call()?.moderation ?? null, EMPTY_MOD);
}

const EMPTY_VOLUMES: Record<string, number> = {};

export function useVolumes(): Record<string, number> {
  const { call } = useCall();
  return useStore(call()?.volumes ?? null, EMPTY_VOLUMES);
}
