// The room's one poll (a new one replaces the old). The server never echoes your own
// vote, so it is remembered here, and restored from joined.poll.yourVote on rejoin.
// Snapshots are replaced on change for useSyncExternalStore.
import type { Sender } from "./chat";
import type { Frame } from "./types";

export interface PollView {
  id: string;
  question: string;
  options: string[];
  tallies: number[];
  by: string;
  open: boolean;
  yourVote: number | null;
}
export type PollResult = "sent" | "offline" | "not-op" | "invalid" | "closed";

export const QUESTION_MAX = 200;
export const OPTION_MAX = 80;
export const OPTIONS_MIN = 2;
export const OPTIONS_MAX = 6;

const runes = (s: string) => [...s].length;

export function validatePoll(question: string, options: string[]): { question: string; options: string[] } | null {
  const q = question.trim();
  const opts = options.map((o) => o.trim()).filter((o) => o !== "");
  if (!q || runes(q) > QUESTION_MAX) return null;
  if (opts.length < OPTIONS_MIN || opts.length > OPTIONS_MAX) return null;
  if (opts.some((o) => runes(o) > OPTION_MAX)) return null;
  return { question: q, options: opts };
}

function fromFrame(m: Frame, yourVote: number | null): PollView {
  return {
    id: String(m.id ?? ""),
    question: String(m.question ?? ""),
    options: Array.isArray(m.options) ? m.options.map(String) : [],
    tallies: Array.isArray(m.tallies) ? m.tallies.map((t: unknown) => Number(t) || 0) : [],
    by: String(m.by ?? ""),
    open: !!m.open,
    yourVote,
  };
}

export class Polls {
  private snap: PollView | null = null;
  private listeners = new Set<() => void>();

  constructor(private sender: Sender, private isOp: () => boolean) {}

  seed(snap: Frame | undefined | null): void {
    if (!snap || !snap.id) {
      this.set(null);
      return;
    }
    const yv = typeof snap.yourVote === "number" ? snap.yourVote : null;
    this.set(fromFrame(snap, yv));
  }

  onPoll(m: Frame): void {
    const same = this.snap && this.snap.id === m.id;
    this.set(fromFrame(m, same ? this.snap!.yourVote : null));
  }

  vote(choice: number): PollResult {
    const p = this.snap;
    if (!p || !p.open) return "closed";
    if (!Number.isInteger(choice) || choice < 0 || choice >= p.options.length) return "invalid";
    if (!this.sender("vote", { pollId: p.id, choice })) return "offline";
    this.set({ ...p, yourVote: choice });
    return "sent";
  }

  create(question: string, options: string[]): PollResult {
    if (!this.isOp()) return "not-op";
    const v = validatePoll(question, options);
    if (!v) return "invalid";
    return this.sender("create-poll", { question: v.question, options: v.options }) ? "sent" : "offline";
  }

  close(): PollResult {
    if (!this.isOp()) return "not-op";
    const p = this.snap;
    if (!p || !p.open) return "closed";
    return this.sender("close-poll", { pollId: p.id }) ? "sent" : "offline";
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): PollView | null => this.snap;

  private set(next: PollView | null) {
    this.snap = next;
    for (const fn of [...this.listeners]) fn();
  }
}
