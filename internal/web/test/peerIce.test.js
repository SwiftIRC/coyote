import { test } from "node:test";
import assert from "node:assert/strict";
import { Peer } from "../assets/net/peer.js";

// Records the configuration Peer builds its RTCPeerConnection with.
class MockPC {
  constructor(config) {
    MockPC.last = this;
    this.config = config;
    this.signalingState = "stable";
    this.connectionState = "new";
    this.iceConnectionState = "new";
  }
  getTransceivers() {
    return [];
  }
  getSenders() {
    return [];
  }
  async getStats() {
    return new Map();
  }
  close() {}
}

class MockSignaling {
  constructor() {
    this.sent = [];
  }
  on() {}
  off() {}
  send(type, fields) {
    this.sent.push({ type, ...fields });
  }
}

function install(t, opts) {
  const prev = globalThis.RTCPeerConnection;
  globalThis.RTCPeerConnection = MockPC;
  const signaling = new MockSignaling();
  const peer = opts === undefined ? new Peer(signaling) : new Peer(signaling, opts);
  t.after(() => {
    peer.close();
    globalThis.RTCPeerConnection = prev;
  });
  return { peer, signaling, pc: MockPC.last };
}

const relay = [{ urls: ["turns:turn.example.com:443?transport=tcp"], username: "1:abc", credential: "secret" }];

test("the joined frame's ICE servers reach RTCPeerConnection unchanged", (t) => {
  const { pc } = install(t, { iceServers: relay });
  assert.deepEqual(pc.config, { iceServers: relay });
});

test("no relay (older server, or none configured) means no ICE servers", (t) => {
  assert.deepEqual(install(t).pc.config, { iceServers: [] });
});

test("gathered candidates are trickled to the SFU; the end-of-gathering sentinel is not", (t) => {
  const { pc, signaling } = install(t, { iceServers: relay });
  pc.onicecandidate({ candidate: { type: "relay", candidate: "candidate:1 1 udp 1 203.0.113.7 50000 typ relay" } });
  pc.onicecandidate({ candidate: null });
  assert.equal(signaling.sent.filter((m) => m.type === "candidate").length, 1);
});

test("gathering that finds no candidates at all is flagged", (t) => {
  const { pc } = install(t);
  const warned = [];
  const orig = console.warn;
  console.warn = (...args) => warned.push(args.join(" "));
  try {
    pc.onicecandidate({ candidate: null });
  } finally {
    console.warn = orig;
  }
  assert.ok(warned.some((w) => w.includes("NO candidates")), `warnings: ${warned}`);
});
