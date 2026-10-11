import { Peer } from "../src/core/peer";
import { FakePC, FakeSig, FakeStream, FakeTrack, FakeTimers, flush, silentLog } from "./fakes";

const VP8 = { mimeType: "video/VP8", clockRate: 90000 };
const H264 = { mimeType: "video/H264", clockRate: 90000 };

function make() {
  const sig = new FakeSig();
  const pc = new FakePC();
  const timers = new FakeTimers();
  const events = { remote: [] as any[], gone: [] as any[], errors: [] as any[], failed: 0 };
  const peer = new Peer(sig, {
    createPeerConnection: () => pc,
    createStream: (t) => new FakeStream(t),
    createCandidate: (c) => ({ wrapped: c }),
    videoCodecs: () => [H264, VP8],
    log: silentLog,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  }, {
    remoteTrack: (e) => events.remote.push(e),
    peerGone: (e) => events.gone.push(e),
    error: (e) => events.errors.push(e),
    mediaFailed: () => events.failed++,
  });
  return { sig, pc, timers, events, peer };
}

// With no microphone and no camera (both denied or absent) the offer would have no
// m-lines and so no ICE credentials; the SFU rejects it ("no ice-ufrag") and the
// call never connects. One receive-only m-line makes it answerable.
test("start with nothing to publish offers one receive-only audio transceiver", async () => {
  const { sig, pc, peer } = make();
  await peer.start([]);
  await flush();
  expect(pc.transceivers.map((t) => [t.kind, t.direction])).toEqual([["audio", "recvonly"]]);
  const offers = sig.ofType("offer");
  expect(offers).toHaveLength(1);
  expect(offers[0].kinds).toEqual({});
});

test("start publishes sendonly transceivers and one offer carrying the kinds map", async () => {
  const { sig, pc, peer } = make();
  const mic = new FakeTrack("audio");
  const cam = new FakeTrack("video");
  await peer.start([{ track: mic, kind: "mic" }, { track: cam, kind: "camera" }]);
  pc.emit("negotiationneeded"); // browsers fire this too; must collapse into the same offer
  await flush();
  const offers = sig.ofType("offer");
  expect(offers).toHaveLength(1);
  const kinds = offers[0].kinds as Record<string, string>;
  const [micT, camT] = pc.transceivers;
  expect(kinds[micT.streams[0].id]).toBe("mic");
  expect(kinds[camT.streams[0].id]).toBe("camera");
  expect(camT.codecPrefs?.[0].mimeType).toBe("video/VP8");
  expect(micT.codecPrefs).toBeNull();
});

test("an offer needed while one is in flight is sent after the answer", async () => {
  const { sig, pc, peer } = make();
  await peer.start([{ track: new FakeTrack("audio"), kind: "mic" }]);
  await peer.publish(new FakeTrack("video"), "camera");
  pc.emit("negotiationneeded");
  await flush();
  expect(sig.ofType("offer")).toHaveLength(1);
  sig.receive({ type: "answer", sdp: "a1" });
  await flush();
  const offers = sig.ofType("offer");
  expect(offers).toHaveLength(2);
  expect(Object.values(offers[1].kinds)).toEqual(["mic", "camera"]);
});

test("glare: the polite client applies the server offer directly, answers, then re-offers", async () => {
  const { sig, pc, peer } = make();
  await peer.start([{ track: new FakeTrack("audio"), kind: "mic" }]);
  expect(pc.signalingState).toBe("have-local-offer");
  sig.receive({ type: "offer", sdp: "server-1" });
  await flush();
  expect(pc.srdCalls.map((d) => d.type)).toEqual(["offer"]); // never {type:"rollback"}
  expect(sig.ofType("answer")).toEqual([{ type: "answer", sdp: "answer-to-server-1" }]);
  expect(sig.ofType("offer")).toHaveLength(2); // our rolled-back offer, re-sent once stable
});

test("a server offer with no glare is answered and does not trigger a re-offer", async () => {
  const { sig, pc, peer } = make();
  await peer.start([]);
  sig.receive({ type: "answer", sdp: "a1" });
  await flush();
  sig.receive({ type: "offer", sdp: "server-2" });
  await flush();
  expect(sig.ofType("answer")).toHaveLength(1);
  expect(sig.ofType("offer")).toHaveLength(1);
  expect(pc.signalingState).toBe("stable");
});

test("local candidates trickle; the null end-of-candidates is not sent", async () => {
  const { sig, pc, peer } = make();
  await peer.start([]);
  pc.emit("icecandidate", { candidate: { candidate: "c1" } });
  pc.emit("icecandidate", { candidate: null });
  expect(sig.ofType("candidate")).toEqual([{ type: "candidate", candidate: { candidate: "c1" } }]);
});

test("remote candidates before a remote description are buffered, then drained", async () => {
  const { sig, pc, peer } = make();
  await peer.start([]);
  sig.receive({ type: "candidate", candidate: { candidate: "r1" } });
  await flush();
  expect(pc.candidates).toEqual([]);
  sig.receive({ type: "answer", sdp: "a1" });
  await flush();
  expect(pc.candidates).toEqual([{ wrapped: { candidate: "r1" } }]);
  sig.receive({ type: "candidate", candidate: { candidate: "r2" } });
  await flush();
  expect(pc.candidates).toHaveLength(2);
});

test("publishing an already-published kind swaps the track instead of adding an m-line", async () => {
  const { pc, peer } = make();
  await peer.start([{ track: new FakeTrack("video"), kind: "camera" }]);
  const next = new FakeTrack("video");
  await peer.publish(next, "camera");
  expect(pc.transceivers).toHaveLength(1);
  expect(pc.transceivers[0].sender.track).toBe(next);
});

test("replaceTrack swaps without renegotiation and reports whether a sender existed", async () => {
  const { sig, pc, peer } = make();
  await peer.start([{ track: new FakeTrack("video"), kind: "camera" }]);
  expect(await peer.replaceTrack("camera", null)).toBe(true);
  expect(pc.transceivers[0].sender.track).toBeNull();
  expect(await peer.replaceTrack("mic", new FakeTrack("audio"))).toBe(false);
  expect(sig.ofType("offer")).toHaveLength(1);
});

test("quality caps are applied once the sender has an encoding", async () => {
  const { sig, pc, peer } = make();
  peer.setQuality("low", "auto");
  await peer.start([{ track: new FakeTrack("video", 720), kind: "camera" }]);
  expect(pc.transceivers[0].sender.setParams).toHaveLength(0); // no encodings before negotiation
  sig.receive({ type: "answer", sdp: "a1" });
  await flush();
  const p = pc.transceivers[0].sender.setParams.at(-1);
  expect(p.encodings[0]).toMatchObject({ scaleResolutionDownBy: 2, maxFramerate: 15 });
});

test("close detaches every signaling handler and closes the connection", async () => {
  const { sig, pc, peer } = make();
  expect(sig.handlerCount()).toBe(4);
  peer.close();
  expect(sig.handlerCount()).toBe(0);
  expect(pc.closed).toBe(true);
});
