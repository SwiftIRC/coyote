import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// "Change stream" swaps an active share to a new surface IN PLACE: Media emits
// "screen-change" (never screen-stop + screen-start, which would re-chime the room),
// and a cancelled picker leaves the running share untouched.

class FakeTrack extends EventTarget {
  constructor(kind) {
    super();
    this.kind = kind;
    this.stopped = false;
  }
  stop() {
    this.stopped = true; // like the real thing, stop() does NOT fire "ended"
  }
}
class FakeStream {
  constructor(tracks) {
    this.tracks = [...tracks];
  }
  getTracks() { return [...this.tracks]; }
  getVideoTracks() { return this.tracks.filter((t) => t.kind === "video"); }
  getAudioTracks() { return this.tracks.filter((t) => t.kind === "audio"); }
  removeTrack(t) { this.tracks = this.tracks.filter((x) => x !== t); }
}

let picks = []; // queued getDisplayMedia results: a FakeStream, or an Error to reject with
Object.defineProperty(globalThis, "navigator", {
  value: {
    mediaDevices: {
      getDisplayMedia: async () => {
        const next = picks.shift();
        if (next instanceof Error) throw next;
        return next;
      },
    },
  },
  configurable: true,
});
const { Media } = await import("../assets/net/media.js");

function record(media) {
  const events = [];
  for (const type of ["screen-start", "screen-stop", "screen-change"]) {
    media.addEventListener(type, (e) => events.push({ type, detail: e.detail }));
  }
  media.addEventListener("error", () => {}); // swallow (EventTarget doesn't throw, but keep quiet)
  return events;
}

beforeEach(() => {
  picks = [];
});

test("changeScreen swaps the stream and emits only screen-change", async () => {
  const media = new Media();
  const v1 = new FakeTrack("video");
  picks.push(new FakeStream([v1]));
  await media.startScreen();
  const events = record(media);

  const v2 = new FakeTrack("video");
  const a2 = new FakeTrack("audio");
  picks.push(new FakeStream([v2, a2]));
  await media.changeScreen();

  assert.deepEqual(events.map((e) => e.type), ["screen-change"]);
  assert.equal(events[0].detail.track, v2);
  assert.equal(events[0].detail.audioTrack, a2);
  assert.equal(media.screenTrack, v2);
  assert.ok(v1.stopped, "the old capture is released");
});

test("a cancelled picker leaves the running share untouched", async () => {
  const media = new Media();
  const v1 = new FakeTrack("video");
  picks.push(new FakeStream([v1]));
  await media.startScreen();
  const events = record(media);

  picks.push(new Error("NotAllowedError"));
  await assert.rejects(media.changeScreen());
  assert.deepEqual(events, []);
  assert.equal(media.screenTrack, v1);
  assert.equal(v1.stopped, false);
});

test("the replaced track ending later cannot stop the new share", async () => {
  const media = new Media();
  const v1 = new FakeTrack("video");
  picks.push(new FakeStream([v1]));
  await media.startScreen();
  picks.push(new FakeStream([new FakeTrack("video")]));
  await media.changeScreen();
  const events = record(media);

  v1.dispatchEvent(new Event("ended"));
  assert.deepEqual(events, []);
  assert.ok(media.screenStream);
});

test("the new track's browser 'Stop sharing' still ends the share", async () => {
  const media = new Media();
  picks.push(new FakeStream([new FakeTrack("video")]));
  await media.startScreen();
  const v2 = new FakeTrack("video");
  picks.push(new FakeStream([v2]));
  await media.changeScreen();
  const events = record(media);

  v2.dispatchEvent(new Event("ended"));
  assert.deepEqual(events.map((e) => e.type), ["screen-stop"]);
  assert.equal(media.screenStream, null);
});

test("an audio-only share stays audio-only across a change", async () => {
  const media = new Media();
  picks.push(new FakeStream([new FakeTrack("video"), new FakeTrack("audio")]));
  await media.startScreenAudioOnly();
  const events = record(media);

  const v2 = new FakeTrack("video");
  const a2 = new FakeTrack("audio");
  picks.push(new FakeStream([v2, a2]));
  await media.changeScreen();

  assert.deepEqual(events.map((e) => e.type), ["screen-change"]);
  assert.equal(events[0].detail.track, null);
  assert.equal(events[0].detail.audioTrack, a2);
  assert.ok(v2.stopped, "the picked surface's video is dropped");
});

test("changeScreen with no active share rejects", async () => {
  const media = new Media();
  await assert.rejects(media.changeScreen());
});
