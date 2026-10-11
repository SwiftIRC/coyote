import { captureCancelled, ScreenShare, SHARE_TEXT, type ShareHost } from "../src/core/screenShare";
import type { TrackLike } from "../src/core/types";
import { FakeTrack, flush, silentLog } from "./fakes";

function setup(opts: { canShare?: boolean; publishFails?: boolean } = {}) {
  const calls: string[] = [];
  const notices: string[] = [];
  const waits: Array<{ resolve(t: TrackLike): void; reject(e: unknown): void }> = [];
  const host: ShareHost = {
    publish: async (t) => {
      calls.push(`publish ${t.id}`);
      if (opts.publishFails) throw new Error("nope");
    },
    unpublish: () => calls.push("unpublish"),
    notice: (t) => notices.push(t),
    canShare: () => opts.canShare ?? true,
  };
  const share = new ScreenShare({ start: () => new Promise((resolve, reject) => waits.push({ resolve, reject })) }, host, silentLog);
  const statuses: string[] = [];
  share.subscribe(() => statuses.push(share.getSnapshot().status));
  return { share, calls, notices, waits, statuses };
}

async function sharing() {
  const t = setup();
  const track = new FakeTrack("video");
  const p = t.share.start();
  t.waits[0].resolve(track);
  await p;
  return { ...t, track };
}

test("start: idle → starting → sharing, and the track is published", async () => {
  const { share, calls, statuses, track } = await sharing();
  expect(statuses).toEqual(["starting", "sharing"]);
  expect(share.getSnapshot()).toEqual({ status: "sharing" });
  expect(calls).toEqual([`publish ${track.id}`]);
  expect(share.liveTrack()).toBe(track);
});

test("a cancelled capture returns to idle without a notice", async () => {
  const { share, waits, notices, statuses } = setup();
  const p = share.start();
  waits[0].reject(captureCancelled());
  await p;
  expect(statuses).toEqual(["starting", "idle"]);
  expect(notices).toEqual([]);
});

test("a failed capture returns to idle with the failure notice", async () => {
  const { share, waits, notices } = setup();
  const p = share.start();
  waits[0].reject(new Error("boom"));
  await p;
  expect(share.getSnapshot().status).toBe("idle");
  expect(notices).toEqual([SHARE_TEXT.failed]);
});

test("start while not idle does nothing", async () => {
  const { share, waits } = setup();
  const p = share.start();
  await share.start();
  expect(waits.length).toBe(1);
  waits[0].resolve(new FakeTrack("video"));
  await p;
  await share.start();
  expect(waits.length).toBe(1);
});

test("start is refused when the host cannot share (not in call)", async () => {
  const { share, waits, statuses } = setup({ canShare: false });
  await share.start();
  expect(waits.length).toBe(0);
  expect(statuses).toEqual([]);
});

test("stop(user): unpublishes, stops and releases the track, back to idle, no notice", async () => {
  const { share, calls, notices, track } = await sharing();
  share.stop("user");
  expect(calls.at(-1)).toBe("unpublish");
  expect(track.stopped).toBe(true);
  expect(track.released).toBe(true);
  expect(share.getSnapshot().status).toBe("idle");
  expect(share.liveTrack()).toBeNull();
  expect(notices).toEqual([]);
});

test("the system ending the track stops the share", async () => {
  const { share, calls, track } = await sharing();
  track.end();
  expect(share.getSnapshot().status).toBe("idle");
  expect(calls.at(-1)).toBe("unpublish");
});

test("stop(op) shows the op notice; stop(leave) does not", async () => {
  const a = await sharing();
  a.share.stop("op");
  expect(a.notices).toEqual([SHARE_TEXT.op]);
  const b = await sharing();
  b.share.stop("leave");
  expect(b.notices).toEqual([]);
});

test("stop when idle is silent", () => {
  const { share, calls, notices, statuses } = setup();
  share.stop("op");
  expect(calls).toEqual([]);
  expect(notices).toEqual([]);
  expect(statuses).toEqual([]);
});

test("a capture that resolves after stop is released", async () => {
  const { share, waits, calls } = setup();
  const p = share.start();
  share.stop("leave");
  expect(share.getSnapshot().status).toBe("idle");
  const late = new FakeTrack("video");
  waits[0].resolve(late);
  await p;
  expect(late.stopped).toBe(true);
  expect(late.released).toBe(true);
  expect(calls).toEqual([]);
  expect(share.getSnapshot().status).toBe("idle");
});

test("a stale ended event from an old track does not stop a newer share", async () => {
  const { share, waits, track } = await sharing();
  share.stop("user");
  const p = share.start();
  const next = new FakeTrack("video");
  waits[1].resolve(next);
  await p;
  track.end();
  expect(share.getSnapshot().status).toBe("sharing");
  expect(share.liveTrack()).toBe(next);
});

test("a publish failure stops the share and shows the failure notice", async () => {
  const { share, waits, notices, calls } = setup({ publishFails: true });
  const track = new FakeTrack("video");
  const p = share.start();
  waits[0].resolve(track);
  await p;
  await flush();
  expect(share.getSnapshot().status).toBe("idle");
  expect(track.stopped).toBe(true);
  expect(track.released).toBe(true);
  expect(calls.at(-1)).toBe("unpublish");
  expect(notices).toEqual([SHARE_TEXT.failed]);
});
