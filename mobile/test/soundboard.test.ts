import { clipId, Soundboard } from "../src/core/soundboard";

function make(connected = true) {
  const sent: any[] = [];
  const clips = { loads: [] as string[][], plays: [] as string[], stops: [] as string[] };
  const board = new Soundboard((type, fields) => {
    if (!connected) return false;
    sent.push({ type, ...fields });
    return true;
  }, {
    load: (id, url) => clips.loads.push([id, url]),
    play: (id) => clips.plays.push(id),
    stop: (id) => clips.stops.push(id),
  });
  return { board, sent, clips };
}
const LIST = [{ id: "1f680", label: "🚀", src: "/v/abc/sounds/board/1f680.mp3" }, { id: "1f9ea", label: "🧪", src: "/v/abc/sounds/board/1f9ea.mp3" }];

test("setBoard normalises, loads every clip by absolute URL, and tracks load state", () => {
  const { board, clips } = make();
  expect(board.getSnapshot().sounds).toBeNull();
  board.setBoard([...LIST, { id: "" }], "https://vc.swiftirc.net");
  expect(board.getSnapshot().sounds).toEqual(LIST);
  expect(clips.loads).toEqual([
    ["clip:1f680", "https://vc.swiftirc.net/v/abc/sounds/board/1f680.mp3"],
    ["clip:1f9ea", "https://vc.swiftirc.net/v/abc/sounds/board/1f9ea.mp3"],
  ]);
  expect(board.getSnapshot().clips).toEqual({ "1f680": "loading", "1f9ea": "loading" });
  board.onLoaded(clipId("1f680"), true);
  board.onLoaded(clipId("1f9ea"), false);
  expect(board.getSnapshot().clips).toEqual({ "1f680": "ready", "1f9ea": "failed" });
});

test("start sends intent; the broadcast plays for everyone and marks it mine; stop/ended", () => {
  const { board, sent, clips } = make();
  board.setBoard(LIST, "https://h");
  board.onLoaded(clipId("1f680"), true);
  expect(board.start("1f680")).toBe("sent");
  expect(sent).toEqual([{ type: "sound", action: "start", id: "1f680" }]);
  expect(board.getSnapshot().playing).toBeNull(); // nothing until the server says so
  board.onSound({ type: "sound", action: "start", id: "1f680", by: "Ryan" });
  expect(board.getSnapshot().playing).toEqual({ id: "1f680", mine: true });
  expect(clips.plays).toEqual(["clip:1f680"]);
  expect(board.start("1f9ea")).toBe("busy");
  board.onEnded(clipId("1f680")); // finished naturally: the starter sends stop
  expect(sent.at(-1)).toEqual({ type: "sound", action: "stop", id: "1f680" });
  board.onSound({ type: "sound", action: "stop", id: "1f680", by: "Ryan" });
  expect(board.getSnapshot().playing).toBeNull();
  expect(clips.stops).toEqual(["clip:1f680"]);
});

test("someone else's clip: plays, locks, ended does not send stop, stop() is refused", () => {
  const { board, sent } = make();
  board.setBoard(LIST, "https://h");
  board.onLoaded(clipId("1f9ea"), true);
  board.onSound({ type: "sound", action: "start", id: "1f9ea", by: "Alice" });
  expect(board.getSnapshot().playing).toEqual({ id: "1f9ea", mine: false });
  board.onEnded(clipId("1f9ea"));
  expect(board.stop()).toBe("not-mine");
  expect(sent).toEqual([]);
});

test("a clip that never loaded isn't played; offline start is refused; reset unlocks", () => {
  const { board, clips } = make();
  board.setBoard(LIST, "https://h");
  board.onSound({ type: "sound", action: "start", id: "1f680", by: "A" });
  expect(clips.plays).toEqual([]); // still loading
  expect(board.getSnapshot().playing).toEqual({ id: "1f680", mine: false });
  board.reset(); // rejoin: the server doesn't replay a playing sound to joiners
  expect(board.getSnapshot().playing).toBeNull();
  expect(board.getSnapshot().sounds).toEqual(LIST); // the list survives a rejoin
  const off = make(false);
  off.board.setBoard(LIST, "https://h");
  expect(off.board.start("1f680")).toBe("offline");
});

test("unavailable hides the board and start refuses", () => {
  const { board } = make();
  board.unavailable();
  expect(board.getSnapshot().sounds).toBeNull();
  expect(board.start("1f680")).toBe("unavailable");
});
