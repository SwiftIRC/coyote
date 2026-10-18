import { ChatLog, CHAT_MAX, LOG_MAX, unreadLabel } from "../src/core/chat";
import { hhmm, moderationText } from "../src/core/chatText";

function make(connected = true) {
  const sent: Array<{ type: string; fields: Record<string, unknown> }> = [];
  const log = new ChatLog((type, fields) => {
    if (!connected) return false;
    sent.push({ type, fields });
    return true;
  }, () => 1_700_000_000_000);
  return { log, sent };
}

test("chat frames append in order; snapshot identity changes only on change", () => {
  const { log } = make();
  const s0 = log.getSnapshot();
  expect(log.getSnapshot()).toBe(s0);
  log.onChat({ type: "chat", from: "Alice", text: "hi", ts: 10 });
  log.onChat({ type: "chat", from: "Bob", text: "yo", ts: 11 });
  const s1 = log.getSnapshot();
  expect(s1).not.toBe(s0);
  expect(s1.entries.map((e) => (e.kind === "message" ? `${e.from}:${e.text}` : e.kind === "poll" ? "" : e.text))).toEqual(["Alice:hi", "Bob:yo"]);
  expect(new Set(s1.entries.map((e) => e.key)).size).toBe(2);
});

test("unread counts messages while closed, opening zeroes it, open keeps it at 0", () => {
  const { log } = make();
  log.onChat({ type: "chat", from: "A", text: "1", ts: 1 });
  log.onChat({ type: "chat", from: "A", text: "2", ts: 2 });
  expect(log.getSnapshot().unread).toBe(2);
  log.setOpen(true);
  expect(log.getSnapshot()).toMatchObject({ unread: 0, open: true });
  log.onChat({ type: "chat", from: "A", text: "3", ts: 3 });
  expect(log.getSnapshot().unread).toBe(0);
  log.setOpen(false);
  log.onModeration({ type: "moderation", actor: "Op", action: "lock" });
  log.notice("Something went wrong");
  expect(log.getSnapshot().unread).toBe(0); // system lines never count
});

test("system lines: moderation text and notices", () => {
  const { log } = make();
  log.onModeration({ type: "moderation", actor: "Op", action: "kick", target: "Bob" });
  log.notice("Room is full");
  const texts = log.getSnapshot().entries.map((e) => (e.kind === "poll" ? "" : e.text));
  expect(texts).toEqual(["Op kicked Bob", "Room is full"]);
  expect(log.getSnapshot().entries.every((e) => e.kind === "system")).toBe(true);
});

test("the log keeps at most LOG_MAX entries, dropping the oldest", () => {
  const { log } = make();
  for (let i = 0; i < LOG_MAX + 5; i++) log.onChat({ type: "chat", from: "A", text: String(i), ts: i });
  const e = log.getSnapshot().entries;
  expect(e).toHaveLength(LOG_MAX);
  expect(e[0].kind === "poll" ? "" : e[0].text).toBe("5");
});

const msg = (ts: number) => ({ type: "chat", from: "A", text: "m" + ts, ts });

test("clear empties the log but keeps unread; a read history replayed stays read", () => {
  const { log } = make();
  log.onChat(msg(1));
  log.onChat(msg(2));
  log.setOpen(true);
  log.setOpen(false);
  log.clear();
  expect(log.getSnapshot()).toMatchObject({ entries: [], unread: 0 });
  log.onChat(msg(1)); // replay
  log.onChat(msg(2));
  expect(log.getSnapshot()).toMatchObject({ unread: 0 });
  expect(log.getSnapshot().entries).toHaveLength(2);
});

test("unread messages replayed after clear are not counted twice", () => {
  const { log } = make();
  log.onChat(msg(1));
  log.onChat(msg(2));
  log.clear();
  expect(log.getSnapshot().unread).toBe(2);
  log.onChat(msg(1));
  log.onChat(msg(2));
  expect(log.getSnapshot().unread).toBe(2);
});

test("a genuinely newer message after clear counts", () => {
  const { log } = make();
  log.onChat(msg(1));
  log.setOpen(true);
  log.setOpen(false);
  log.clear();
  log.onChat(msg(1));
  log.onChat(msg(5));
  expect(log.getSnapshot().unread).toBe(1);
});

test("send trims, refuses empty and over-long, reports offline, never echoes locally", () => {
  const { log, sent } = make();
  expect(log.send("   ")).toBe("empty");
  expect(log.send("x".repeat(CHAT_MAX + 1))).toBe("too-long");
  expect(log.send("  hello  ")).toBe("sent");
  expect(sent).toEqual([{ type: "chat", fields: { text: "hello" } }]);
  expect(log.getSnapshot().entries).toEqual([]);
  expect(log.send("😀".repeat(CHAT_MAX))).toBe("sent"); // counted in code points, like the server's runes
  const off = make(false);
  expect(off.log.send("hello")).toBe("offline");
});

test("hostile text stays plain: no non-http link is ever produced downstream", () => {
  const { log } = make();
  // eslint-disable-next-line no-script-url
  log.onChat({ type: "chat", from: "<b>x</b>", text: "javascript:alert(1) <script>", ts: 1 });
  const e = log.getSnapshot().entries[0];
  // eslint-disable-next-line no-script-url
  expect(e).toMatchObject({ kind: "message", from: "<b>x</b>", text: "javascript:alert(1) <script>" });
});

test("unreadLabel", () => {
  expect(unreadLabel(0)).toBe("");
  expect(unreadLabel(7)).toBe("7");
  expect(unreadLabel(100)).toBe("99+");
});

test("moderationText matches the web wording", () => {
  expect(moderationText({ actor: "Op", action: "mute", target: "Bob", kind: "camera" })).toBe("Op muted Bob (camera)");
  expect(moderationText({ actor: "Op", action: "quality", target: "camera", kind: "low" })).toBe("Op set camera quality to Low");
  expect(moderationText({ action: "unlock" })).toBe("someone unlocked the room");
  expect(moderationText({ actor: "Op", action: "poll-open" })).toBe("Op started a poll");
  expect(moderationText({ actor: "Op", action: "zap", target: "Bob" })).toBe("Op zap Bob");
});

test("hhmm formats local time and falls back to now for a missing ts", () => {
  const d = new Date(2026, 0, 2, 9, 5);
  expect(hhmm(d.getTime() / 1000, 0)).toBe("09:05");
  expect(hhmm(0, d.getTime())).toBe("09:05");
});

test("poll open adds a card and counts unread; close counts unread; update doesn't", () => {
  const { log } = make();
  log.onPollEvent("open", "p1");
  expect(log.getSnapshot().entries.at(-1)).toMatchObject({ kind: "poll", pollId: "p1" });
  expect(log.getSnapshot().unread).toBe(1);
  log.onPollEvent("update", "p1");
  expect(log.getSnapshot().unread).toBe(1);
  expect(log.getSnapshot().entries).toHaveLength(1);
  log.onPollEvent("close", "p1");
  expect(log.getSnapshot().unread).toBe(2);
  expect(log.getSnapshot().entries).toHaveLength(1);
  log.setOpen(true);
  log.onPollEvent("open", "p2");
  expect(log.getSnapshot().unread).toBe(0);
});

// The unsent draft lives in the log, so it survives the chat sheet unmounting
// (Android picture-in-picture replaces the call screen with one tile).
test("the draft is kept until a send goes out, and doesn't notify", () => {
  const { log } = make();
  const s0 = log.getSnapshot();
  expect(log.draft).toBe("");
  log.setDraft("half a thou");
  expect(log.draft).toBe("half a thou");
  expect(log.getSnapshot()).toBe(s0); // typing doesn't re-render chat readers
  expect(log.send("   ")).toBe("empty");
  expect(log.draft).toBe("half a thou");
  expect(log.send("half a thought")).toBe("sent");
  expect(log.draft).toBe("");
});

test("a send that fails keeps the draft", () => {
  const { log } = make(false);
  log.setDraft("hello");
  expect(log.send("hello")).toBe("offline");
  expect(log.draft).toBe("hello");
});
