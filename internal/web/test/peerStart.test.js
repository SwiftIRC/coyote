import { test } from "node:test";
import assert from "node:assert/strict";
import { Peer } from "../assets/net/peer.js";

// RTCPeerConnection stub that records transceivers and offers, so a test can see
// what start() asked to negotiate.
class MockPC {
  constructor() {
    this.signalingState = "stable";
    this.connectionState = "new";
    this.iceConnectionState = "new";
    this.transceivers = [];
    this.localDescription = null;
  }
  addTransceiver(trackOrKind, init) {
    const t = { trackOrKind, init, sender: { track: null, getParameters: () => ({ encodings: [] }), setParameters: async () => {} } };
    this.transceivers.push(t);
    return t;
  }
  getTransceivers() {
    return this.transceivers;
  }
  getSenders() {
    return this.transceivers.map((t) => t.sender);
  }
  async createOffer() {
    return { type: "offer", sdp: `offer with ${this.transceivers.length} m-line(s)` };
  }
  async setLocalDescription(d) {
    this.localDescription = d;
  }
  async getStats() {
    return new Map();
  }
  close() {}
}

class MockStream {
  constructor(tracks) {
    this.id = `stream-${Math.random()}`;
    this.tracks = tracks;
  }
}

class MockSignaling {
  constructor() {
    this.handlers = new Map();
    this.sent = [];
  }
  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }
  off(type, fn) {
    const fns = this.handlers.get(type) || [];
    const i = fns.indexOf(fn);
    if (i >= 0) fns.splice(i, 1);
  }
  send(type, fields) {
    this.sent.push({ type, ...fields });
  }
}

function install(t) {
  const prev = { pc: globalThis.RTCPeerConnection, ms: globalThis.MediaStream };
  globalThis.RTCPeerConnection = MockPC;
  globalThis.MediaStream = MockStream;
  const signaling = new MockSignaling();
  const peer = new Peer(signaling);
  t.after(() => {
    peer.close();
    globalThis.RTCPeerConnection = prev.pc;
    globalThis.MediaStream = prev.ms;
  });
  return { peer, signaling };
}

// A client with no camera or microphone has nothing to publish. An offer with no
// m-lines carries no ICE credentials, which the SFU rejects ("SetRemoteDescription
// called with no ice-ufrag") — the call never connects and the client waits in
// have-local-offer forever. It must still offer something the SFU can answer.
test("start() with no local tracks offers a receive-only audio m-line", async (t) => {
  const { peer, signaling } = install(t);
  await peer.start([]);
  assert.equal(peer.pc.transceivers.length, 1);
  assert.equal(peer.pc.transceivers[0].trackOrKind, "audio");
  assert.equal(peer.pc.transceivers[0].init.direction, "recvonly");
  assert.equal(signaling.sent.filter((f) => f.type === "offer").length, 1);
  assert.deepEqual(signaling.sent.find((f) => f.type === "offer").kinds, {});
});

test("start() with local tracks adds no receive-only m-line", async (t) => {
  const { peer } = install(t);
  await peer.start([{ track: { kind: "audio", id: "mic" }, kind: "mic" }]);
  assert.equal(peer.pc.transceivers.length, 1);
  assert.equal(peer.pc.transceivers[0].init.direction, "sendonly");
});
