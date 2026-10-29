import { captureConsole, countTap, formatArg, formatReport, statsLines, Trail } from "../src/core/debug";

test("seven quick taps fire; a slow tap starts over", () => {
  let s = { n: 0, at: 0 };
  let fired = 0;
  const tap = (t: number) => {
    const r = countTap(s, t);
    s = r;
    if (r.fire) fired++;
  };
  for (let i = 0; i < 6; i++) tap(10_000 + i * 500);
  expect(fired).toBe(0);
  tap(15_000); // too slow: count restarts at 1
  for (let i = 1; i < 6; i++) tap(15_000 + i * 100);
  expect(fired).toBe(0);
  tap(15_600); // seventh in a row
  expect(fired).toBe(1);
  expect(s.n).toBe(0);
});

test("Trail keeps the newest lines with timestamps", () => {
  let t = Date.UTC(2026, 9, 29, 12, 0, 0, 5);
  const trail = new Trail(3, () => t++);
  for (const s of ["a", "b", "c", "d"]) trail.add(s);
  expect(trail.lines()).toEqual(["12:00:00.006 b", "12:00:00.007 c", "12:00:00.008 d"]);
});

test("formatArg handles errors, objects, cycles and long values", () => {
  expect(formatArg("x")).toBe("x");
  expect(formatArg(new TypeError("boom"))).toBe("TypeError: boom");
  expect(formatArg({ a: 1 })).toBe('{"a":1}');
  const cyc: Record<string, unknown> = {};
  cyc.self = cyc;
  expect(formatArg(cyc)).toBe("[object Object]");
  expect(formatArg(undefined)).toBe("undefined");
  expect(formatArg("y".repeat(600))).toHaveLength(600); // strings are not cut
  expect(formatArg({ s: "y".repeat(600) }).endsWith("…")).toBe(true);
});

test("captureConsole records and still prints, and undoes", () => {
  const printed: string[] = [];
  const c = {
    log: (...a: unknown[]) => printed.push(`log ${a.join(" ")}`),
    info: (...a: unknown[]) => printed.push(`info ${a.join(" ")}`),
    warn: (...a: unknown[]) => printed.push(`warn ${a.join(" ")}`),
    error: (...a: unknown[]) => printed.push(`error ${a.join(" ")}`),
  };
  const trail = new Trail(10, () => 0);
  const undo = captureConsole(c, trail);
  c.info("[peer]", "track", 1);
  c.warn("flip failed", new Error("no"));
  expect(printed).toEqual(["info [peer] track 1", "warn flip failed Error: no"]);
  expect(trail.lines()).toEqual(["00:00:00.000 [peer] track 1", "00:00:00.000 WARN flip failed Error: no"]);
  undo();
  c.error("after");
  expect(trail.lines()).toHaveLength(2);
});

test("statsLines summarises streams and names known mids", () => {
  const lines = statsLines(
    [
      { type: "inbound-rtp", kind: "video", mid: "1", packetsReceived: 10, packetsLost: 0, framesDecoded: 9, frameWidth: 640, frameHeight: 360 },
      { type: "inbound-rtp", kind: "audio", mid: "7", packetsReceived: 5, packetsLost: 1, concealedSamples: 3 },
      { type: "outbound-rtp", kind: "video", packetsSent: 4, frameWidth: 1280, frameHeight: 720, qualityLimitationReason: "none" },
      { type: "candidate-pair", nominated: true, state: "succeeded", currentRoundTripTime: 0.05, bytesReceived: 100, bytesSent: 50 },
      { type: "candidate-pair", nominated: false, state: "failed" },
      { type: "codec" },
    ],
    (mid) => (mid === "1" ? "ab12:video" : undefined),
  );
  expect(lines).toEqual([
    "in ab12:video video pk 10 lost 0 dec 9 640x360",
    "in mid7 audio pk 5 lost 1 conc 3",
    "out video pk 4 1280x720 lim none",
    "pair succeeded rtt 0.05 in 100B out 50B",
  ]);
});

test("formatReport titles each section", () => {
  expect(formatReport([["app", "1.0"], ["log", ["a", "b"]]])).toBe("=== app\n1.0\n\n=== log\na\nb");
});

test("formatReport cuts a long report and says so", () => {
  const text = formatReport([["a", "x".repeat(50)], ["b", "y".repeat(50)]], 20);
  expect(text).toBe(`=== a\n${"x".repeat(14)}\n\n=== cut: the report was 114 characters`);
});
