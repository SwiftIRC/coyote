import { Backgrounds, BG_TEXT, labelFor, parseScenes, type EffectPort, type NativeEffect, type Scene } from "../src/core/backgrounds";
import type { TrackLike } from "../src/core/types";
import { FakeTrack, flush, silentLog } from "./fakes";

const SCENES: Scene[] = [{ id: "carina", label: "Carina", url: "https://h/v/1/img/bg/carina.webp" }];

function setup(opts: { scenes?: Scene[] | null; failScene?: boolean; defer?: boolean } = {}) {
  const calls: string[] = [];
  const notices: string[] = [];
  const pending: Array<{ effect: NativeEffect; resolve(): void; reject(e: unknown): void }> = [];
  let sceneFetches = 0;
  const port: EffectPort = {
    setEffect: (e) => {
      calls.push(`set ${e.kind === "blur" ? `blur ${e.radius}` : `scene ${e.url}`}`);
      if (opts.defer) return new Promise<void>((resolve, reject) => pending.push({ effect: e, resolve, reject }));
      if (e.kind === "scene" && opts.failScene) return Promise.reject(new Error("download failed"));
      return Promise.resolve();
    },
    attach: (t: TrackLike) => calls.push(`attach ${t.id}`),
    detach: (t: TrackLike) => calls.push(`detach ${t.id}`),
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

test("None detaches without configuring", async () => {
  const { bg, calls } = setup();
  const t = new FakeTrack("video");
  await bg.setTrack(t);
  expect(calls).toEqual([`detach ${t.id}`]);
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
  expect(calls.at(-1)).toBe(`detach ${t.id}`);
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
  expect(calls.at(-1)).toBe(`detach ${t.id}`);
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

test("a new track gets the current effect; no track means None", async () => {
  const { bg, calls } = setup();
  await bg.select("blur-strong");
  const a = new FakeTrack("video");
  await bg.setTrack(a);
  const b = new FakeTrack("video");
  await bg.setTrack(b);
  expect(calls).toEqual(["set blur 0.03", `attach ${a.id}`, "set blur 0.03", `attach ${b.id}`]);
  await bg.setTrack(null);
  expect(bg.getSnapshot().applied).toBe("none");
  await bg.setTrack(null);
  expect(calls.length).toBe(4);
});

test("tripping: detach, None, the notice, choice kept; choosing again re-applies", async () => {
  const { bg, calls, notices } = setup();
  const t = new FakeTrack("video");
  await bg.setTrack(t);
  await bg.select("blur");
  bg.onTripped("slow");
  expect(calls.at(-1)).toBe(`detach ${t.id}`);
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
