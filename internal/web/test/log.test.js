import { test } from "node:test";
import assert from "node:assert/strict";
import { stamp, log } from "../assets/lib/log.js";

// Records what reached each console method, so a call through `log` can be checked
// against the method it should have landed on.
function recordingConsole() {
  const seen = [];
  const rec = (name) => (...args) => seen.push([name, ...args]);
  return { seen, info: rec("info"), warn: rec("warn"), error: rec("error"), debug: rec("debug") };
}

function withConsole(fake, fn) {
  const real = globalThis.console;
  globalThis.console = fake;
  try {
    return fn();
  } finally {
    globalThis.console = real;
  }
}

const STAMP_RE = /^\d{2}:\d{2}:\d{2}\.\d{3}$/;

test("stamp formats a date as HH:MM:SS.mmm", () => {
  assert.equal(stamp(new Date(2026, 8, 26, 18, 9, 4, 812)), "18:09:04.812");
});

test("stamp zero-pads every field", () => {
  assert.equal(stamp(new Date(2026, 0, 1, 7, 5, 3, 40)), "07:05:03.040");
});

test("stamp pads milliseconds to three digits", () => {
  // .7 would sort and read wrongly against .70 and .700.
  assert.equal(stamp(new Date(2026, 0, 1, 0, 0, 0, 7)), "00:00:00.007");
});

test("stamp renders midnight as zeroes, not blanks", () => {
  assert.equal(stamp(new Date(2026, 0, 1, 0, 0, 0, 0)), "00:00:00.000");
});

test("stamp defaults to the current time", () => {
  assert.match(stamp(), STAMP_RE);
});

test("each log method forwards to the matching console method", () => {
  for (const level of ["info", "warn", "error", "debug"]) {
    const fake = recordingConsole();
    withConsole(fake, () => log[level]("[peer] hello", 42));
    assert.equal(fake.seen.length, 1, `${level} logged once`);
    const [name, first, ...rest] = fake.seen[0];
    assert.equal(name, level);
    assert.match(first, STAMP_RE, `${level} puts the stamp first`);
    assert.deepEqual(rest, ["[peer] hello", 42], `${level} passes the caller's args through`);
  }
});

test("the stamp is taken at access time, not frozen at module load", () => {
  // Each property access must mint a fresh binding; a single shared function would
  // carry whatever time the module happened to be imported at, forever.
  assert.notEqual(log.info, log.info);
});

test("a log method is a bound console method, not a wrapper", () => {
  // This is the reason for the getters: devtools attributes a log line to whatever
  // function called console, so a wrapper would point every line at log.js instead
  // of the code that logged it. Function.prototype.bind names the result
  // "bound <target>", which is how we can tell the two apart from here.
  assert.equal(log.info.name, "bound info");
});
