import { Peer } from "../src/core/peer";
import { FakePC, FakeSig, FakeStream, FakeTrack, FakeTimers, silentLog } from "./fakes";

function make(withRestart = true) {
  const sig = new FakeSig();
  const pc = new FakePC();
  if (!withRestart) (pc as any).restartIce = undefined;
  const timers = new FakeTimers();
  const ev = { remote: [] as any[], gone: [] as any[], failed: 0 };
  const peer = new Peer(sig, {
    createPeerConnection: () => pc, createStream: (t) => new FakeStream(t), createCandidate: (c) => c,
    videoCodecs: () => null, log: silentLog, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
  }, {
    remoteTrack: (e) => ev.remote.push(e), peerGone: (e) => ev.gone.push(e), error: () => {}, mediaFailed: () => ev.failed++,
  });
  return { peer, sig, pc, timers, ev };
}

const trackEvent = (mid: string, kind = "video") => {
  const track = new FakeTrack(kind);
  return { track, transceiver: { mid }, streams: [new FakeStream([track])] };
};

test("label first, then media: one remote-track with a per-track stream", () => {
  const { sig, pc, ev } = make();
  sig.receive({ type: "tracks", tracks: [{ mid: "3", participantId: "p1", kind: "camera" }] });
  const te = trackEvent("3");
  pc.emit("track", te);
  pc.emit("track", te); // duplicate must not re-emit
  expect(ev.remote).toHaveLength(1);
  expect(ev.remote[0]).toMatchObject({ participantId: "p1", kind: "camera" });
  expect(ev.remote[0].stream.getTracks()).toEqual([te.track]);
  expect(ev.remote[0].stream).not.toBe(te.streams[0]);
});

test("media first, then label", () => {
  const { sig, pc, ev } = make();
  pc.emit("track", trackEvent("4", "audio"));
  expect(ev.remote).toHaveLength(0);
  sig.receive({ type: "tracks", tracks: [{ mid: "4", participantId: "p2", kind: "mic" }] });
  expect(ev.remote).toEqual([expect.objectContaining({ participantId: "p2", kind: "mic" })]);
});

test("an empty tracks list is ignored entirely, labels included", () => {
  const { sig, pc, ev } = make();
  sig.receive({ type: "tracks", tracks: [{ mid: "1", participantId: "p1", kind: "camera" }] });
  sig.receive({ type: "tracks", tracks: [] });
  pc.emit("track", trackEvent("1"));
  expect(ev.remote).toHaveLength(1);
  expect(ev.gone).toHaveLength(0);
});

test("a non-empty list retires held mids it no longer names", () => {
  const { sig, pc, ev } = make();
  sig.receive({ type: "tracks", tracks: [
    { mid: "1", participantId: "p1", kind: "camera" }, { mid: "2", participantId: "p2", kind: "mic" }] });
  pc.emit("track", trackEvent("1"));
  pc.emit("track", trackEvent("2", "audio"));
  sig.receive({ type: "tracks", tracks: [{ mid: "2", participantId: "p2", kind: "mic" }] });
  expect(ev.gone).toEqual([{ participantId: "p1", kind: "camera" }]);
});

test("a remote track ending retires it once", () => {
  const { sig, pc, ev } = make();
  sig.receive({ type: "tracks", tracks: [{ mid: "1", participantId: "p1", kind: "camera" }] });
  const te = trackEvent("1");
  pc.emit("track", te);
  te.track.end();
  sig.receive({ type: "tracks", tracks: [{ mid: "9", participantId: "p9", kind: "mic" }] });
  expect(ev.gone).toHaveLength(1);
});

test("ICE failure: one restart, then media-failed if not connected within 6s", () => {
  const { pc, timers, ev } = make();
  pc.setConnection("failed");
  expect(pc.restarts).toBe(1);
  pc.setConnection("failed"); // sibling events during the grace window
  expect(pc.restarts).toBe(1);
  timers.advance(5999);
  expect(ev.failed).toBe(0);
  timers.advance(1);
  expect(ev.failed).toBe(1);
  pc.setConnection("failed");
  expect(ev.failed).toBe(1);
});

test("recovering within the grace window cancels media-failed", () => {
  const { pc, timers, ev } = make();
  pc.setConnection("failed");
  pc.setConnection("connected");
  timers.advance(10_000);
  expect(ev.failed).toBe(0);
});

test("no restartIce support: media-failed immediately", () => {
  const { pc, ev } = make(false);
  pc.setConnection("failed");
  expect(ev.failed).toBe(1);
});
