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

// The newcomer race (server review item 2): a slow client's first offer is still
// unanswered when the server's 3 s newcomer fallback offers it the room. The server
// is impolite, so it ignores that client offer and never answers it. The client
// must not stay in have-local-offer waiting for that answer: it answers the
// server, re-offers its own media, and settles once the re-offer is answered.
test("newcomer race: an offer the server ignores in favour of its fallback still converges", async () => {
  const { sig, pc, peer, events } = make();
  await peer.start([{ track: new FakeTrack("audio"), kind: "mic" }]);
  await flush();
  expect(sig.ofType("offer")).toHaveLength(1); // offer 1: the server will ignore it
  expect(pc.signalingState).toBe("have-local-offer");

  sig.receive({ type: "offer", sdp: "newcomer-fallback" }); // no answer to offer 1, ever
  await flush();
  expect(sig.ofType("answer")).toEqual([{ type: "answer", sdp: "answer-to-newcomer-fallback" }]);
  const offers = sig.ofType("offer");
  expect(offers).toHaveLength(2); // offer 2 re-sends the mic
  expect(Object.values(offers[1].kinds)).toEqual(["mic"]);

  sig.receive({ type: "answer", sdp: "answer-to-offer-2" });
  await flush();
  expect(pc.signalingState).toBe("stable");
  expect(sig.ofType("offer")).toHaveLength(2); // settled: no further offers
  expect(events.errors).toEqual([]);
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
  expect(p.encodings[0]).toMatchObject({ scaleResolutionDownBy: 2, maxFramerate: 15, maxBitrate: 300_000 });
});

// Without a ceiling the encoder climbs to its default bitrate at any size, and a
// tier change is invisible (360p at 2.5 Mbps looks like 720p) and saves nothing.
test("a tier's bitrate ceiling is applied, and Auto removes it", async () => {
  const { sig, pc, peer } = make();
  await peer.start([{ track: new FakeTrack("video", 720), kind: "camera" }]);
  sig.receive({ type: "answer", sdp: "a1" });
  await flush();
  peer.setQuality("ultra", "auto");
  expect(pc.transceivers[0].sender.setParams.at(-1).encodings[0].maxBitrate).toBe(4_000_000);
  peer.setQuality("auto", "auto");
  expect(pc.transceivers[0].sender.setParams.at(-1).encodings[0]).not.toHaveProperty("maxBitrate");
});

// A screenshare keeps a safety ceiling on every tier, Auto and Ultra included.
test("a screenshare never exceeds its own bitrate ceiling", async () => {
  const { sig, pc, peer } = make();
  await peer.start([{ track: new FakeTrack("video", 1080), kind: "screen" }]);
  sig.receive({ type: "answer", sdp: "a1" });
  await flush();
  peer.setQuality("auto", "ultra");
  expect(pc.transceivers[0].sender.setParams.at(-1).encodings[0].maxBitrate).toBe(2_500_000);
  peer.setQuality("auto", "auto");
  expect(pc.transceivers[0].sender.setParams.at(-1).encodings[0].maxBitrate).toBe(2_500_000);
  peer.setQuality("auto", "low");
  expect(pc.transceivers[0].sender.setParams.at(-1).encodings[0].maxBitrate).toBe(300_000);
});

test("a camera source-height override replaces the track's height in the quality caps", async () => {
  const { sig, pc, peer } = make();
  peer.setQuality("low", "auto");
  await peer.start([{ track: new FakeTrack("video", 720), kind: "camera" }]);
  sig.receive({ type: "answer", sdp: "a1" });
  await flush();
  peer.setCameraSourceHeight(360);
  expect(pc.transceivers[0].sender.setParams.at(-1).encodings[0]).toMatchObject({ scaleResolutionDownBy: 1 });
  peer.setCameraSourceHeight(null);
  expect(pc.transceivers[0].sender.setParams.at(-1).encodings[0]).toMatchObject({ scaleResolutionDownBy: 2 });
});

test("close detaches every signaling handler and closes the connection", async () => {
  const { sig, pc, peer } = make();
  expect(sig.handlerCount()).toBe(4);
  peer.close();
  expect(sig.handlerCount()).toBe(0);
  expect(pc.closed).toBe(true);
});

// Debug mode: the overlay's lines and the report's offer/answer history.
test("debugStats and debugDump trace the connection and keep the offers and answers", async () => {
  const { sig, pc, peer } = make();
  await peer.start([{ track: new FakeTrack("audio"), kind: "mic" }]);
  sig.receive({ type: "answer", sdp: "server-answer" });
  await flush();
  pc.setConnection("connected");
  (pc as any).getStats = async () => new Map([["a", { type: "outbound-rtp", kind: "audio", packetsSent: 3 }]]);
  const lines = await peer.debugStats();
  expect(lines[0]).toBe("sig stable conn connected ice connected in 0");
  expect(lines).toContain("out audio pk 3");
  expect(lines.some((l) => l.endsWith(" local offer"))).toBe(true);
  expect(lines.some((l) => l.endsWith(" conn connected"))).toBe(true);
  const [[title, sdps], [statsTitle, raw]] = await peer.debugDump();
  expect(title).toBe("offers and answers");
  expect(sdps).toHaveLength(2);
  expect(sdps[0]).toContain("local offer (now have-local-offer)\noffer-1");
  expect(sdps[1]).toContain("remote answer (now stable)\nserver-answer");
  expect(statsTitle).toBe("raw stats");
  expect(raw).toContain('"packetsSent":3');
});
