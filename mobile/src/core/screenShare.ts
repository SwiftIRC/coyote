// Sending a screenshare: the share's state and track, and the four ways it ends
// (the user, the system UI ending the track, an op's stop-share, leaving). The
// capture itself is a native port; publishing goes through the call's host.
// Snapshots are replaced on change for useSyncExternalStore.
import type { Logger, TrackLike } from "./types";

export type ShareStatus = "idle" | "starting" | "sharing";
export type StopReason = "user" | "ended" | "op" | "leave";
export interface ShareSnapshot {
  status: ShareStatus;
}

export interface ScreenCapturePort {
  // Resolves with a live video track once capture runs; rejects with
  // captureCancelled() when the user dismissed the system sheet or prompt.
  start(): Promise<TrackLike>;
}

export interface ShareHost {
  publish(track: TrackLike): Promise<void>;
  unpublish(): void;
  notice(text: string): void;
  canShare(): boolean;
}

export const SHARE_TEXT = {
  failed: "Couldn't start screen sharing.",
  op: "An op stopped your screen share.",
};

export function captureCancelled(): Error {
  const e = new Error("screen capture cancelled");
  e.name = "CaptureCancelled";
  return e;
}

// Stop, then release: stop() alone leaves the native track and capturer alive.
export function discard(track: TrackLike): void {
  track.stop();
  track.release?.();
}

const isCancelled = (e: unknown) => !!e && (e as { name?: unknown }).name === "CaptureCancelled";

export class ScreenShare {
  private snap: ShareSnapshot = { status: "idle" };
  private track: TrackLike | null = null;
  // Bumped by every stop(); a capture that resolves under an older generation was
  // abandoned while starting and is released, not published.
  private gen = 0;
  private listeners = new Set<() => void>();

  constructor(
    private capture: ScreenCapturePort,
    private host: ShareHost,
    private log: Logger,
  ) {}

  async start(): Promise<void> {
    if (this.snap.status !== "idle" || !this.host.canShare()) return;
    const gen = this.gen;
    this.set("starting");
    let track: TrackLike;
    try {
      track = await this.capture.start();
    } catch (e) {
      if (gen !== this.gen) return;
      this.set("idle");
      if (!isCancelled(e)) {
        this.log.warn("[share] capture failed", e);
        this.host.notice(SHARE_TEXT.failed);
      }
      return;
    }
    if (gen !== this.gen) {
      discard(track);
      return;
    }
    this.track = track;
    track.addEventListener?.("ended", () => {
      if (this.track === track) this.stop("ended");
    });
    this.set("sharing");
    try {
      await this.host.publish(track);
    } catch (e) {
      if (this.track !== track) return;
      this.log.warn("[share] publish failed", e);
      this.stop("ended");
      this.host.notice(SHARE_TEXT.failed);
    }
  }

  stop(reason: StopReason): void {
    if (this.snap.status === "idle") return;
    this.gen++;
    const track = this.track;
    this.track = null;
    if (track) {
      this.host.unpublish();
      discard(track);
    }
    this.set("idle");
    if (reason === "op" && track) this.host.notice(SHARE_TEXT.op);
  }

  // The track a rebuilt peer must republish, or null.
  liveTrack(): TrackLike | null {
    return this.snap.status === "sharing" ? this.track : null;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): ShareSnapshot => this.snap;

  private set(status: ShareStatus) {
    this.snap = { status };
    for (const fn of [...this.listeners]) fn();
  }
}
