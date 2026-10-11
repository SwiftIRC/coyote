import { Backgrounds, BG_TEXT, labelFor, parseScenes, type EffectPort, type NativeEffect, type Scene } from "../src/core/backgrounds";
import type { TrackLike } from "../src/core/types";
import { FakeTrack, flush, silentLog } from "./fakes";

const SCENES: Scene[] = [{ id: "carina", label: "Carina", url: "https://h/v/1/img/bg/carina.webp" }];

function setup(opts: { scenes?: Scene[] | null; failScene?: boolean; failOnce?: boolean; defer?: boolean } = {}) {
  const calls: string[] = [];
  const notices: string[] = [];
  const pending: Array<{ effect: NativeEffect; resolve(): void; reject(e: unknown): void }> = [];
  let sceneFetches = 0;
  const port: EffectPort = {
    setEffect: (e) => {
      calls.push(`set ${e.kind === "blur" ? `blur ${e.radius}` : `scene ${e.url}`}`);
      if (opts.defer) return new Promise<void>((resolve, reject) => pending.push({ effect: e, resolve, reject }));
      if (e.kind === "scene" && opts.failScene) return Promise.reject(new Error("download failed"));
      if (opts.failOnce) {
        opts.failOnce = false;
        return Promise.reject(new Error("native failed"));
      }
      return Promise.resolve();
    },
    attach: (t: TrackLike) => calls.push(`attach ${t.id}`),
    detach: (t: TrackLike) => calls.push(`detach ${t.id}`),
    clear: () => calls.push("clear"),
  };
  const bg = new Backgrounds(port, async () => {
    sceneFetches++;
    return opts.scenes === undefined ? SCENES : opts.scenes;
  }, (t) => notices.push(t), silentLog);
  return { bg, calls, notices, pending, fetches: () => sceneFetches };
}

test("parseScenes keeps well-formed entries and makes src absolute", () => {
  const list = [
    { id: "carina", label: "Carina", src: "/v/1/img/bg/carina.webp" },
    { id: "full", label: "", src: "https://cdn/x.webp" },
    { id: "", label: "x", src: "/a.webp" },
    { id: "nosrc", label: "x" },
    { id: "blur", label: "clash", src: "/b.webp" },
    { id: "rel", label: "r", src: "img/r.webp" },
    "junk",
  ];
  expect(parseScenes(list, "https://h")).toEqual([
    { id: "carina", label: "Carina", url: "https://h/v/1/img/bg/carina.webp" },
    { id: "full", label: "full", url: "https://cdn/x.webp" },
  ]);
  expect(parseScenes(null, "https://h")).toEqual([]);
});

test("labelFor: built-ins, scenes, and the bare id otherwise", () => {
  expect(labelFor("blur-strong", [])).toBe("Blur+");
  expect(labelFor("carina", SCENES)).toBe("Carina");
  expect(labelFor("pillars", SCENES)).toBe("pillars");
});

test("without a track a choice is remembered but nothing is applied", async () => {
  const { bg, calls } = setup();
  await bg.select("blur");
  expect(calls).toEqual([]);
  expect(bg.getSnapshot()).toMatchObject({ selected: "blur", applied: "none", busy: false });
});

test("a track gets the chosen blur: configure, then attach", async () => {
  const { bg, calls } = setup();
  await bg.select("blur");
  const t = new FakeTrack("video");
  await bg.setTrack(t);
  expect(calls).toEqual(["set blur 0.012", `attach ${t.id}`]);
  expect(bg.getSnapshot()).toMatchObject({ applied: "blur", busy: false });
});

test("None detaches and frees the native effect without configuring", async () => {
  const { bg, calls } = setup();
  const t = new FakeTrack("video");
  await bg.setTrack(t);
  expect(calls).toEqual([`detach ${t.id}`, "clear"]);
  expect(bg.getSnapshot().applied).toBe("none");
});

test("a scene is resolved from the server's list", async () => {
  const { bg, calls } = setup();
  const t = new FakeTrack("video");
  await bg.setTrack(t);
  await bg.select("carina");
  expect(calls.slice(-2)).toEqual([`set scene ${SCENES[0].url}`, `attach ${t.id}`]);
  expect(bg.getSnapshot()).toMatchObject({ applied: "carina", scenesState: "ready", scenes: SCENES });
});

test("an unknown scene id falls back to None silently and stays selected", async () => {
  const { bg, calls, notices } = setup();
  const t = new FakeTrack("video");
  await bg.setTrack(t);
  await bg.select("gone");
  expect(calls.slice(-2)).toEqual([`detach ${t.id}`, "clear"]);
  expect(bg.getSnapshot()).toMatchObject({ selected: "gone", applied: "none" });
  expect(notices).toEqual([]);
});

test("no scene list (older server or offline): built-ins still work, a scene choice is None", async () => {
  const { bg, calls } = setup({ scenes: null });
  const t = new FakeTrack("video");
  await bg.setTrack(t);
  await bg.select("carina");
  expect(bg.getSnapshot()).toMatchObject({ applied: "none", scenesState: "unavailable", selected: "carina" });
  await bg.select("blur");
  expect(calls.slice(-2)).toEqual(["set blur 0.012", `attach ${t.id}`]);
});

test("an unavailable scene list is fetched again next time", async () => {
  const { bg, fetches } = setup({ scenes: null });
  await bg.loadScenes();
  await bg.loadScenes();
  expect(fetches()).toBe(2);
});

test("a ready scene list is fetched once; concurrent loads share one fetch", async () => {
  const { bg, fetches } = setup();
  await Promise.all([bg.loadScenes(), bg.loadScenes()]);
  await bg.loadScenes();
  expect(fetches()).toBe(1);
});

test("resetScenes forgets the list (a different server)", async () => {
  const { bg, fetches } = setup();
  await bg.loadScenes();
  bg.resetScenes();
  expect(bg.getSnapshot()).toMatchObject({ scenes: [], scenesState: "idle" });
  await bg.loadScenes();
  expect(fetches()).toBe(2);
});

test("a scene that fails to load: None, the load notice, not busy", async () => {
  const { bg, calls, notices } = setup({ failScene: true });
  const t = new FakeTrack("video");
  await bg.setTrack(t);
  await bg.select("carina");
  expect(calls.slice(-2)).toEqual([`detach ${t.id}`, "clear"]);
  expect(notices).toEqual([BG_TEXT.load]);
  expect(bg.getSnapshot()).toMatchObject({ selected: "carina", applied: "none", busy: false });
});

test("busy while the native effect is being configured", async () => {
  const { bg, pending } = setup({ defer: true });
  const t = new FakeTrack("video");
  await bg.setTrack(t);
  const p = bg.select("blur");
  await flush();
  expect(bg.getSnapshot().busy).toBe(true);
  pending[0].resolve();
  await p;
  expect(bg.getSnapshot()).toMatchObject({ busy: false, applied: "blur" });
});

test("the last choice wins over a slower earlier one", async () => {
  const { bg, calls, pending } = setup({ defer: true });
  const t = new FakeTrack("video");
  await bg.setTrack(t);
  const first = bg.select("carina");
  await flush();
  const second = bg.select("blur");
  await flush();
  pending[1].resolve();
  await second;
  pending[0].resolve();
  await first;
  expect(calls.filter((c) => c.startsWith("attach"))).toEqual([`attach ${t.id}`]);
  expect(bg.getSnapshot()).toMatchObject({ selected: "blur", applied: "blur", busy: false });
});

test("a new track gets the current effect at once, without reconfiguring; no track means None", async () => {
  const { bg, calls } = setup();
  await bg.select("blur-strong");
  const a = new FakeTrack("video");
  await bg.setTrack(a);
  const b = new FakeTrack("video");
  const p = bg.setTrack(b);
  // Attached before setTrack's promise settles: no raw frames go out on b.
  expect(calls).toEqual(["set blur 0.03", `attach ${a.id}`, `attach ${b.id}`]);
  expect(bg.getSnapshot()).toMatchObject({ applied: "blur-strong", busy: false });
  await p;
  await bg.setTrack(null);
  expect(bg.getSnapshot().applied).toBe("none");
  await bg.setTrack(null);
  expect(calls.length).toBe(3);
  const c = new FakeTrack("video");
  bg.setTrack(c); // camera back on: still configured
  expect(calls.at(-1)).toBe(`attach ${c.id}`);
});

test("a configured scene is attached to a new track at once as well", async () => {
  const { bg, calls } = setup();
  const a = new FakeTrack("video");
  await bg.setTrack(a);
  await bg.select("carina");
  const b = new FakeTrack("video");
  bg.setTrack(b);
  expect(calls.at(-1)).toBe(`attach ${b.id}`);
  expect(calls.filter((c) => c.startsWith("set"))).toEqual([`set scene ${SCENES[0].url}`]);
});

test("a different effect is configured again", async () => {
  const { bg, calls } = setup();
  const t = new FakeTrack("video");
  await bg.setTrack(t);
  await bg.select("blur");
  await bg.select("blur-strong");
  await bg.select("blur");
  expect(calls.filter((c) => c.startsWith("set"))).toEqual(["set blur 0.012", "set blur 0.03", "set blur 0.012"]);
});

test("None forgets the configuration: the next effect is configured again", async () => {
  const { bg, calls } = setup();
  const t = new FakeTrack("video");
  await bg.setTrack(t);
  await bg.select("blur");
  await bg.select("none");
  await bg.select("blur");
  expect(calls.filter((c) => c.startsWith("set"))).toEqual(["set blur 0.012", "set blur 0.012"]);
});

test("after a failed configure the next apply configures again", async () => {
  const { bg, calls, notices } = setup({ failOnce: true });
  await bg.select("blur");
  const a = new FakeTrack("video");
  await bg.setTrack(a);
  expect(notices).toEqual([BG_TEXT.load]);
  const b = new FakeTrack("video");
  await bg.setTrack(b);
  expect(calls.filter((c) => c.startsWith("set"))).toEqual(["set blur 0.012", "set blur 0.012"]);
  expect(calls.at(-1)).toBe(`attach ${b.id}`);
  expect(bg.getSnapshot()).toMatchObject({ applied: "blur", busy: false });
});

test("switching back to the configured effect while another configures still waits for it", async () => {
  const { bg, calls, pending } = setup({ defer: true });
  const t = new FakeTrack("video");
  await bg.setTrack(t);
  const first = bg.select("blur");
  pending[0].resolve();
  await first;
  const second = bg.select("blur-strong");
  const third = bg.select("blur"); // native may end up on either: configure again
  expect(calls.filter((c) => c.startsWith("set"))).toEqual(["set blur 0.012", "set blur 0.03", "set blur 0.012"]);
  pending[1].resolve();
  pending[2].resolve();
  await Promise.all([second, third]);
  expect(bg.getSnapshot()).toMatchObject({ applied: "blur", busy: false });
});

test("tripping: detach, None, the notice, choice kept; choosing again re-applies", async () => {
  const { bg, calls, notices } = setup();
  const t = new FakeTrack("video");
  await bg.setTrack(t);
  await bg.select("blur");
  bg.onTripped("slow");
  expect(calls.slice(-2)).toEqual([`detach ${t.id}`, "clear"]);
  expect(notices).toEqual([BG_TEXT.slow]);
  expect(bg.getSnapshot()).toMatchObject({ selected: "blur", applied: "none" });
  bg.onTripped("failed"); // already off: nothing more
  expect(notices).toEqual([BG_TEXT.slow]);
  await bg.select("blur");
  expect(calls.slice(-2)).toEqual(["set blur 0.012", `attach ${t.id}`]);
});

test("a trip while configuring cancels that apply", async () => {
  const { bg, calls, notices, pending } = setup({ defer: true });
  const t = new FakeTrack("video");
  await bg.setTrack(t);
  const p = bg.select("blur");
  await flush();
  bg.onTripped("failed");
  pending[0].resolve();
  await p;
  expect(calls.filter((c) => c.startsWith("attach"))).toEqual([]);
  expect(notices).toEqual([BG_TEXT.failed]);
  expect(bg.getSnapshot()).toMatchObject({ applied: "none", busy: false });
});

test("a trip sticks for the call: a new track stays plain until the user chooses again", async () => {
  const { bg, calls, notices } = setup();
  const a = new FakeTrack("video");
  await bg.setTrack(a);
  await bg.select("blur");
  bg.onTripped("slow");
  const b = new FakeTrack("video");
  await bg.setTrack(b);
  expect(calls.filter((c) => c.startsWith("set"))).toEqual(["set blur 0.012"]);
  expect(calls.filter((c) => c.startsWith("attach"))).toEqual([`attach ${a.id}`]);
  expect(bg.getSnapshot()).toMatchObject({ selected: "blur", applied: "none", busy: false });
  bg.onTripped("slow"); // a late trip from the old track
  expect(notices).toEqual([BG_TEXT.slow]);
  await bg.select("blur");
  expect(calls.slice(-2)).toEqual(["set blur 0.012", `attach ${b.id}`]);
  expect(bg.getSnapshot().applied).toBe("blur");
});

test("another store reconfiguring the shared native processor voids the memo", async () => {
  // PreJoin's preview and the call each have a store over the one native engine.
  const { bg: preview, calls } = setup();
  await preview.select("blur");
  await preview.setTrack(new FakeTrack("video"));
  await preview.setTrack(null); // joining: the preview track is released
  const other = setup();
  await other.bg.select("carina");
  await other.bg.setTrack(new FakeTrack("video"));
  const t = new FakeTrack("video");
  await preview.setTrack(t); // back on PreJoin
  expect(calls.filter((c) => c.startsWith("set"))).toEqual(["set blur 0.012", "set blur 0.012"]);
  expect(calls.at(-1)).toBe(`attach ${t.id}`);
});

test("a trip arriving after camera off voids the memo: the next track configures again", async () => {
  const { bg, calls, notices } = setup();
  const a = new FakeTrack("video");
  await bg.setTrack(a);
  await bg.select("blur");
  await bg.setTrack(null); // camera off keeps the memo
  bg.onTripped("slow"); // from a's last frames: the native engine is now tripped
  expect(notices).toEqual([]); // nothing was showing: no notice, and not sticky
  const c = new FakeTrack("video");
  await bg.setTrack(c);
  expect(calls.slice(-2)).toEqual(["set blur 0.012", `attach ${c.id}`]);
  expect(bg.getSnapshot()).toMatchObject({ applied: "blur", busy: false });
});
