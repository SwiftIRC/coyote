import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// A camera or mic that disappears mid-call (unplugged, Bluetooth dropped) is
// handled as if the user had turned it off: the track is released, "camera-track"
// / "mic-track" announce null, and "device-lost" tells the UI to flip its button
// and tell the room. A plug/unplug anywhere re-enumerates and emits
// "devices-changed" so open menus can refresh right away.

class FakeTrack extends EventTarget {
  constructor(kind, deviceId = `${kind}-1`) {
    super();
    this.kind = kind;
    this.enabled = true;
    this.readyState = "live";
    this.stopped = false;
    this.deviceId = deviceId;
  }
  getSettings() {
    return { deviceId: this.deviceId };
  }
  stop() {
    this.stopped = true; // like the real thing, stop() does NOT fire "ended"
    this.readyState = "ended";
  }
  // What the browser does when the device goes away.
  unplug() {
    this.readyState = "ended";
    this.dispatchEvent(new Event("ended"));
  }
}
class FakeStream {
  constructor(tracks = []) {
    this.tracks = [...tracks];
  }
  getTracks() { return [...this.tracks]; }
  getVideoTracks() { return this.tracks.filter((t) => t.kind === "video"); }
  getAudioTracks() { return this.tracks.filter((t) => t.kind === "audio"); }
  addTrack(t) { this.tracks.push(t); }
  removeTrack(t) { this.tracks = this.tracks.filter((x) => x !== t); }
}
globalThis.MediaStream = FakeStream;

let grants = []; // queued getUserMedia results
let devices = []; // what enumerateDevices reports
const mediaDevices = new EventTarget();
mediaDevices.getUserMedia = async () => {
  const next = grants.shift();
  if (!next) throw Object.assign(new Error("no device"), { name: "NotFoundError" });
  return next;
};
mediaDevices.enumerateDevices = async () => devices.map((d) => ({ ...d }));
Object.defineProperty(globalThis, "navigator", { value: { mediaDevices }, configurable: true });

const { Media } = await import("../assets/net/media.js");

function record(media) {
  const events = [];
  for (const type of ["camera-track", "mic-track", "device-lost", "devices-changed"]) {
    media.addEventListener(type, (e) => events.push({ type, detail: e.detail }));
  }
  media.addEventListener("error", () => {});
  return events;
}

async function started() {
  const mic = new FakeTrack("audio");
  const cam = new FakeTrack("video");
  grants.push(new FakeStream([mic]), new FakeStream([cam]));
  const media = new Media();
  await media.start();
  return { media, mic, cam };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  grants = [];
  devices = [];
});

test("an unplugged camera turns the camera off and reports device-lost", async () => {
  const { media, cam } = await started();
  const events = record(media);
  cam.unplug();
  assert.equal(media.cameraTrack, null);
  assert.equal(cam.stopped, true);
  assert.deepEqual(events.map((e) => e.type), ["camera-track", "device-lost"]);
  assert.equal(events[0].detail.track, null);
  assert.deepEqual(events[1].detail, { kind: "camera" });
  media.stop();
});

test("an unplugged mic is removed and reports device-lost", async () => {
  const { media, mic } = await started();
  const events = record(media);
  mic.unplug();
  assert.equal(media.micTrack, null);
  assert.equal(mic.stopped, true);
  assert.deepEqual(events.map((e) => e.type), ["mic-track", "device-lost"]);
  assert.equal(events[0].detail.track, null);
  assert.deepEqual(events[1].detail, { kind: "mic" });
  media.stop();
});

test("an old track ending after a device switch does nothing", async () => {
  const { media, cam } = await started();
  const next = new FakeTrack("video", "video-2");
  grants.push(new FakeStream([next]));
  await media.useDevices({ cameraId: "video-2" });
  const events = record(media);
  cam.unplug(); // the replaced camera, already released
  assert.equal(media.cameraTrack, next);
  assert.deepEqual(events, []);
  media.stop();
});

test("an unplugged camera under a background effect stops the composite too", async () => {
  const { media, cam } = await started();
  const composite = new FakeTrack("video", "");
  let segStopped = false;
  // Park the raw track the way a committed effect does.
  media.stream.removeTrack(cam);
  media.stream.addTrack(composite);
  media._rawCameraTrack = cam;
  media._segmenter = { track: composite, stop() { segStopped = true; composite.stop(); } };
  media._bgEffect = "blur";
  const events = record(media);
  cam.unplug();
  assert.equal(media.cameraTrack, null);
  assert.equal(segStopped, true);
  assert.equal(cam.stopped, true);
  assert.deepEqual(events.map((e) => e.type), ["camera-track", "device-lost"]);
  media.stop();
});

test("enableMic re-opens a mic after one was lost, live", async () => {
  const { media, mic } = await started();
  mic.enabled = false; // muted before it went away
  mic.unplug();
  const events = record(media);
  const fresh = new FakeTrack("audio", "audio-2");
  grants.push(new FakeStream([fresh]));
  const t = await media.enableMic();
  assert.equal(t, fresh);
  assert.equal(media.micTrack, fresh);
  assert.equal(fresh.enabled, true);
  assert.deepEqual(events.map((e) => e.type), ["mic-track"]);
  assert.equal(events[0].detail.track, fresh);
  media.stop();
});

test("a mic lost with noise suppression on gets it back on enableMic", async () => {
  const { media, mic } = await started();
  const processed = new FakeTrack("audio", "");
  media._buildNoiseGraph = async () => processed;
  await media.setNoiseSuppression(true);
  mic.unplug();
  assert.equal(media.noiseSuppressionOn, false);
  assert.equal(media.micTrack, null);
  const again = new FakeTrack("audio", "");
  media._buildNoiseGraph = async () => again;
  grants.push(new FakeStream([new FakeTrack("audio", "audio-2")]));
  const t = await media.enableMic();
  assert.equal(media.noiseSuppressionOn, true);
  assert.equal(t, again);
  media.stop();
});

test("enableMic is a no-op with a live mic", async () => {
  const { media, mic } = await started();
  assert.equal(await media.enableMic(), mic);
  media.stop();
});

test("a device change re-enumerates and updates availability", async () => {
  const { media, cam } = await started();
  const events = record(media);
  devices = [{ kind: "audioinput", deviceId: "a1", label: "Mic" }];
  cam.unplug();
  mediaDevices.dispatchEvent(new Event("devicechange"));
  await tick();
  const changed = events.filter((e) => e.type === "devices-changed");
  assert.equal(changed.length, 1);
  assert.equal(changed[0].detail.cameras.length, 0);
  assert.equal(changed[0].detail.mics.length, 1);
  assert.equal(media.cameraAvailable, false);
  assert.equal(media.micAvailable, true);

  devices.push({ kind: "videoinput", deviceId: "v9", label: "USB camera" });
  mediaDevices.dispatchEvent(new Event("devicechange"));
  await tick();
  assert.equal(media.cameraAvailable, true);
  media.stop();
});

test("only the newest of overlapping device changes is reported", async () => {
  const { media } = await started();
  const events = record(media);
  devices = [{ kind: "videoinput", deviceId: "v1", label: "" }];
  mediaDevices.dispatchEvent(new Event("devicechange"));
  devices = [];
  mediaDevices.dispatchEvent(new Event("devicechange"));
  await tick();
  const changed = events.filter((e) => e.type === "devices-changed");
  assert.equal(changed.length, 1);
  assert.equal(changed[0].detail.cameras.length, 0);
  media.stop();
});

test("stop() stops listening for device changes", async () => {
  const { media } = await started();
  media.stop();
  const events = record(media);
  mediaDevices.dispatchEvent(new Event("devicechange"));
  await tick();
  assert.deepEqual(events, []);
});
