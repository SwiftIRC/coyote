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

test("screen and screen-audio have their own slots, kept across upsert, dropped on seed", () => {
  const r = new Roster();
  r.upsert(info("a", { ref: "ra" }));
  const scr = new FakeStream([]);
  const sa = new FakeStream([]);
  r.setStream("a", "screen", scr);
  r.setStream("a", "screen-audio", sa);
  expect(r.list()[0]).toMatchObject({ screen: scr, screenAudio: sa, video: null, audio: null });
  r.upsert(info("a", { ref: "ra", name: "New" }));
  expect(r.list()[0]).toMatchObject({ screen: scr, screenAudio: sa });
  r.setStream("a", "screen", null);
  expect(r.list()[0].screen).toBeNull();
  r.seed([info("a")]);
  expect(r.list()[0]).toMatchObject({ screen: null, screenAudio: null });
});

test("refOf and get look participants up by id", () => {
  const r = new Roster();
  r.upsert(info("a", { ref: "ra" }));
  expect(r.refOf("a")).toBe("ra");
  expect(r.refOf("nope")).toBe("");
  expect(r.get("a")?.name).toBe("A");
  expect(r.get("nope")).toBeUndefined();
});

test("an early screen stream is attached when its participant arrives", () => {
  const r = new Roster();
  const scr = new FakeStream([]);
  r.setStream("late", "screen", scr);
  r.upsert(info("late"));
  expect(r.list()[0].screen).toBe(scr);
});
