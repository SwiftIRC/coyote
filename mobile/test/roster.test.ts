import { Roster } from "../src/core/roster";
import { FakeStream } from "./fakes";

const info = (id: string, extra = {}) => ({ id, name: id.toUpperCase(), role: "user", mic: true, camera: true, ...extra });

test("seed replaces everyone and drops streams; list keeps join order", () => {
  const r = new Roster();
  r.seed([info("a"), info("b")]);
  r.setStream("a", "camera", new FakeStream([]));
  r.seed([info("b"), info("c")]);
  expect(r.list().map((p) => p.id)).toEqual(["b", "c"]);
  expect(r.list().every((p) => p.video === null && p.audio === null)).toBe(true);
});

test("upsert keeps streams; patch replaces the object; remove notifies", () => {
  const r = new Roster();
  let n = 0;
  const unsub = r.subscribe(() => n++);
  r.upsert(info("a", { gravatar: "g", ref: "r1" }));
  const s = new FakeStream([]);
  r.setStream("a", "mic", s);
  r.upsert(info("a", { name: "Renamed" }));
  const before = r.list()[0];
  expect(before).toMatchObject({ name: "Renamed", audio: s, gravatar: "", ref: "" });
  r.patch("a", { mic: false });
  expect(r.list()[0]).not.toBe(before);
  expect(r.list()[0].mic).toBe(false);
  r.remove("a");
  expect(r.list()).toEqual([]);
  unsub();
  r.upsert(info("z"));
  expect(n).toBe(5);
});

test("a stream that arrives before its participant is attached on upsert", () => {
  const r = new Roster();
  const s = new FakeStream([]);
  r.setStream("late", "camera", s);
  expect(r.list()).toEqual([]);
  r.upsert(info("late"));
  expect(r.list()[0].video).toBe(s);
});

test("patch and setStream(null) on unknown ids are no-ops", () => {
  const r = new Roster();
  r.patch("nobody", { mic: false });
  r.setStream("nobody", "camera", null);
  expect(r.list()).toEqual([]);
});
