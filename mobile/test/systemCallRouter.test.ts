import { SystemCallRouter } from "../src/core/systemCallRouter";

function target() {
  const log: string[] = [];
  return {
    log,
    onSystemMute: (m: boolean) => log.push(`mute ${m}`),
    onSystemEnd: () => log.push("end"),
    onHold: (h: boolean) => log.push(`hold ${h}`),
  };
}

test("routes events for the active call, case-insensitively", () => {
  const r = new SystemCallRouter();
  const t = target();
  r.track("abc-def");
  r.mute("ABC-DEF", true, t);
  r.hold("abc-def", true, t);
  r.end("ABC-def", t);
  expect(t.log).toEqual(["mute true", "hold true", "end"]);
});

test("ignores events for other or finished calls", () => {
  const r = new SystemCallRouter();
  const t = target();
  r.track("new");
  r.mute("old", true, t);
  r.clear("new");
  r.end("new", t);
  r.endCurrent(t);
  expect(t.log).toEqual([]);
});

test("endCurrent ends the tracked call (Android notification Leave)", () => {
  const r = new SystemCallRouter();
  const t = target();
  r.track("x");
  r.endCurrent(t);
  expect(t.log).toEqual(["end"]);
});
