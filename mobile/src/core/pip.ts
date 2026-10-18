import type { CallState } from "./call";
import type { Participant } from "./roster";

// What the Android picture-in-picture window shows: someone's screenshare, else the
// first person in grid order, else yourself when alone. Your own share never: it's
// what you're already looking at.
export type PipTile =
  | { kind: "screen"; p: Participant }
  | { kind: "person"; p: Participant }
  | { kind: "self" };

export type PipAspect = "screen" | "person"; // 16:9 / 3:4
export type PipAction = "mic" | "hangup";

export interface PipParams {
  enabled: boolean; // PiP allowed: the call is up
  micOn: boolean; // for the mic button's icon and label
  aspect: PipAspect;
}

export const PIP_OFF: PipParams = { enabled: false, micOn: false, aspect: "person" };

export function pipTile(people: Participant[]): PipTile {
  const sharer = people.find((p) => !!p.screen); // an audio-only share has nothing to show
  if (sharer) return { kind: "screen", p: sharer };
  return people.length ? { kind: "person", p: people[0] } : { kind: "self" };
}

// How many others are in the call besides the one shown ("+N").
export function pipOthers(t: PipTile, people: Participant[]): number {
  return t.kind === "self" ? 0 : people.length - 1;
}

export function pipParams(s: Pick<CallState, "phase" | "mic" | "participants"> | null): PipParams {
  if (!s || (s.phase !== "in-call" && s.phase !== "reconnecting")) return PIP_OFF;
  return { enabled: true, micOn: s.mic, aspect: pipTile(s.participants).kind === "screen" ? "screen" : "person" };
}

export function runPipAction(a: PipAction, h: { toggleMic(): void; hangup(): void }): void {
  if (a === "mic") h.toggleMic();
  else h.hangup();
}
