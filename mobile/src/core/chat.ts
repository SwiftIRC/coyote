// The call's chat log: messages (including the server's replay after `joined`),
// moderation lines and local notices. Unread counts messages only, and only while
// the sheet is closed. Snapshots are replaced on change so useSyncExternalStore can
// compare by identity.
import { moderationText } from "./chatText";
import type { Frame } from "./types";

export type Sender = (type: string, fields: Record<string, unknown>) => boolean;
export type ChatEntry =
  | { key: number; kind: "message"; from: string; text: string; ts: number }
  | { key: number; kind: "system"; text: string; ts: number };
export interface ChatSnapshot { entries: ChatEntry[]; unread: number; open: boolean }
export type SendResult = "sent" | "empty" | "too-long" | "offline";

export const CHAT_MAX = 2000; // server limit, in runes
export const LOG_MAX = 500;

export function unreadLabel(n: number): string {
  if (n <= 0) return "";
  return n > 99 ? "99+" : String(n);
}

export class ChatLog {
  private snap: ChatSnapshot = { entries: [], unread: 0, open: false };
  private seq = 0;
  private listeners = new Set<() => void>();

  constructor(private sender: Sender, private nowMs: () => number) {}

  onChat(m: Frame): void {
    const entry: ChatEntry = { key: ++this.seq, kind: "message", from: String(m.from ?? ""), text: String(m.text ?? ""), ts: Number(m.ts) || 0 };
    this.push(entry, !this.snap.open);
  }

  onModeration(m: Frame): void {
    this.system(moderationText({ actor: m.actor, action: m.action, target: m.target, kind: m.kind }));
  }

  notice(text: string): void {
    this.system(text);
  }

  clear(): void {
    this.set({ ...this.snap, entries: [], unread: 0 });
  }

  setOpen(open: boolean): void {
    if (open === this.snap.open && (!open || this.snap.unread === 0)) return;
    this.set({ ...this.snap, open, unread: open ? 0 : this.snap.unread });
  }

  send(text: string): SendResult {
    const t = text.trim();
    if (!t) return "empty";
    if ([...t].length > CHAT_MAX) return "too-long";
    return this.sender("chat", { text: t }) ? "sent" : "offline";
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): ChatSnapshot => this.snap;

  private system(text: string) {
    this.push({ key: ++this.seq, kind: "system", text, ts: Math.floor(this.nowMs() / 1000) }, false);
  }

  private push(entry: ChatEntry, countUnread: boolean) {
    const entries = [...this.snap.entries, entry];
    if (entries.length > LOG_MAX) entries.splice(0, entries.length - LOG_MAX);
    this.set({ ...this.snap, entries, unread: this.snap.unread + (countUnread ? 1 : 0) });
  }

  private set(next: ChatSnapshot) {
    this.snap = next;
    for (const fn of [...this.listeners]) fn();
  }
}
