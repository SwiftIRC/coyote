import { Chimes, type ChimeName } from "../src/core/chimes";
import { FakeTimers } from "./fakes";

function make() {
  const played: ChimeName[] = [];
  const timers = new FakeTimers();
  const c = new Chimes((n) => played.push(n), timers);
  return { c, played, timers };
}

test("seeding from joined.peers is silent; a new arrival chimes", () => {
  const { c, played } = make();
  c.seed([{ ref: "a" }, { ref: "b" }]);
  expect(played).toEqual([]);
  c.joined("z");
  expect(played).toEqual(["join"]);
});

test("a leave chimes after 6 s; a rejoin within the grace is silent", () => {
  const { c, played, timers } = make();
  c.seed([{ ref: "a" }]);
  c.left("a");
  timers.advance(5000);
  c.joined("a");
  timers.advance(10_000);
  expect(played).toEqual([]);
  c.left("a");
  timers.advance(6000);
  expect(played).toEqual(["drop"]);
});

test("share bloops once per share, not again after our own rejoin", () => {
  const { c, played } = make();
  c.seed([{ ref: "a" }]);
  c.shareStarted("a");
  c.shareStarted("a"); // screen-audio arriving after screen
  expect(played).toEqual(["bloop"]);
  c.seed([{ ref: "a" }]); // rejoin: tracks re-arrive
  c.shareStarted("a");
  expect(played).toEqual(["bloop"]);
  c.shareStopped("a");
  c.shareStarted("a");
  expect(played).toEqual(["bloop", "bloop"]);
});

test("a sharer leaving forgets their share; dispose cancels pending drops", () => {
  const { c, played, timers } = make();
  c.seed([{ ref: "a" }]);
  c.shareStarted("a");
  c.left("a");
  c.dispose();
  timers.advance(10_000);
  expect(played).toEqual(["bloop"]);
  c.joined("a");
  c.shareStarted("a");
  expect(played).toEqual(["bloop", "join", "bloop"]);
});
