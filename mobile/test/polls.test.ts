import { Polls, validatePoll } from "../src/core/polls";

function make(op = false, connected = true) {
  const sent: Array<{ type: string; fields: Record<string, unknown> }> = [];
  const polls = new Polls((type, fields) => {
    if (!connected) return false;
    sent.push({ type, fields });
    return true;
  }, () => op);
  return { polls, sent };
}
const ev = (over = {}) => ({ type: "poll", action: "open", id: "p1", question: "Lunch?", options: ["Pizza", "Tacos"], tallies: [0, 0], by: "Op", open: true, ...over });

test("open, update and close; snapshot identity changes only on change", () => {
  const { polls } = make();
  expect(polls.getSnapshot()).toBeNull();
  polls.onPoll(ev());
  const s1 = polls.getSnapshot();
  expect(s1).toMatchObject({ id: "p1", question: "Lunch?", tallies: [0, 0], open: true, yourVote: null });
  expect(polls.getSnapshot()).toBe(s1);
  polls.onPoll(ev({ action: "update", tallies: [2, 1] }));
  expect(polls.getSnapshot()!.tallies).toEqual([2, 1]);
  polls.onPoll(ev({ action: "close", tallies: [2, 1], open: false }));
  expect(polls.getSnapshot()).toMatchObject({ open: false, tallies: [2, 1] });
});

test("voting sends and remembers locally; changing a vote works; a new poll forgets it", () => {
  const { polls, sent } = make();
  polls.onPoll(ev());
  expect(polls.vote(1)).toBe("sent");
  expect(sent).toEqual([{ type: "vote", fields: { pollId: "p1", choice: 1 } }]);
  expect(polls.getSnapshot()!.yourVote).toBe(1);
  polls.onPoll(ev({ action: "update", tallies: [0, 1] }));
  expect(polls.getSnapshot()!.yourVote).toBe(1); // updates never clear it
  expect(polls.vote(0)).toBe("sent");
  expect(polls.getSnapshot()!.yourVote).toBe(0);
  polls.onPoll(ev({ id: "p2" }));
  expect(polls.getSnapshot()).toMatchObject({ id: "p2", yourVote: null });
});

test("vote refuses closed, out-of-range and offline without changing state", () => {
  const off = make(false, false);
  off.polls.onPoll(ev());
  expect(off.polls.vote(0)).toBe("offline");
  expect(off.polls.getSnapshot()!.yourVote).toBeNull();
  const { polls, sent } = make();
  expect(polls.vote(0)).toBe("closed"); // no poll
  polls.onPoll(ev());
  expect(polls.vote(5)).toBe("invalid");
  polls.onPoll(ev({ action: "close", open: false }));
  expect(polls.vote(0)).toBe("closed");
  expect(sent).toEqual([]);
});

test("seed from joined.poll restores tallies and your vote; absent clears", () => {
  const { polls } = make();
  polls.seed({ type: "", id: "p9", question: "Q", options: ["a", "b"], tallies: [3, 4], by: "Op", open: true, yourVote: 1 } as never);
  expect(polls.getSnapshot()).toMatchObject({ id: "p9", tallies: [3, 4], yourVote: 1 });
  polls.seed(undefined);
  expect(polls.getSnapshot()).toBeNull();
});

test("create and close are op-only and validated", () => {
  const user = make(false);
  expect(user.polls.create("Q?", ["a", "b"])).toBe("not-op");
  const { polls, sent } = make(true);
  expect(polls.create("  ", ["a", "b"])).toBe("invalid");
  expect(polls.create("Q?", ["only one", "  "])).toBe("invalid");
  expect(polls.create("Q?", [" a ", "b", ""])).toBe("sent");
  expect(sent[0]).toEqual({ type: "create-poll", fields: { question: "Q?", options: ["a", "b"] } });
  expect(polls.close()).toBe("closed"); // nothing open yet
  polls.onPoll(ev());
  expect(polls.close()).toBe("sent");
  expect(sent[1]).toEqual({ type: "close-poll", fields: { pollId: "p1" } });
  expect(user.polls.close()).toBe("not-op");
});

test("validatePoll enforces the server's limits", () => {
  expect(validatePoll("x".repeat(201), ["a", "b"])).toBeNull();
  expect(validatePoll("Q", ["a", "x".repeat(81)])).toBeNull();
  expect(validatePoll("Q", ["1", "2", "3", "4", "5", "6", "7"])).toBeNull();
  expect(validatePoll(" Q ", [" a ", " b "])).toEqual({ question: "Q", options: ["a", "b"] });
});
