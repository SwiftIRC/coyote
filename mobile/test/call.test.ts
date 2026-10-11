import { Call, type CallOutcome, type CallState, type JoinRequest } from "../src/core/call";
import type { PeerEvents } from "../src/core/peer";
import { parseRoomInput } from "../src/core/link";
import { Signaling } from "../src/core/signaling";
import type { Kind, TrackLike } from "../src/core/types";
import { FakeSocket, FakeStream, FakeTimers, FakeTrack, flush, silentLog } from "./fakes";

class FakePeer {
  started: Array<{ track: TrackLike; kind: Kind }> | null = null;
  closed = false;
  quality: string[] = [];
  published: Array<[Kind, TrackLike]> = [];
  replaced: Array<[Kind, TrackLike | null]> = [];
  private senders = new Set<Kind>();
  constructor(public events: PeerEvents) {}
  async start(local: Array<{ track: TrackLike; kind: Kind }>) {
    this.started = local;
    for (const l of local) this.senders.add(l.kind);
  }
  async publish(t: TrackLike, k: Kind) {
    this.published.push([k, t]);
    this.senders.add(k);
  }
  async replaceTrack(k: Kind, t: TrackLike | null) {
    if (!this.senders.has(k)) return false;
    this.replaced.push([k, t]);
    return true;
  }
  setQuality(c: string, s: string) {
    this.quality = [c, s];
  }
  close() {
    this.closed = true;
  }
}

function setup(opts: { micDenied?: boolean; camDenied?: boolean } = {}) {
  FakeSocket.all = [];
  const timers = new FakeTimers();
  const peers: FakePeer[] = [];
  const system: string[] = [];
  const notices: string[] = [];
  const chimes: string[] = [];
  const renames: string[] = [];
  const ends: CallOutcome[] = [];
  const states: CallState[] = [];
  const mics: FakeTrack[] = [];
  const cams: FakeTrack[] = [];
  const ctl = { deferMic: false, deferCam: false, micWaits: [] as Array<() => void>, camWaits: [] as Array<() => void> };
  let ids = 0;
  const call = new Call({
    createSignaling: (url) => new Signaling(url, {
      createSocket: (u) => new FakeSocket(u), random: () => 0, log: silentLog,
      setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
    }),
    createPeer: (_sig, events) => {
      const p = new FakePeer(events);
      peers.push(p);
      return p;
    },
    media: {
      getMic: () => {
        if (opts.micDenied) return Promise.resolve(null);
        const t = new FakeTrack("audio");
        mics.push(t);
        return ctl.deferMic ? new Promise<FakeTrack>((r) => ctl.micWaits.push(() => r(t))) : Promise.resolve(t);
      },
      getCamera: () => {
        if (opts.camDenied) return Promise.resolve(null);
        const t = new FakeTrack("video");
        cams.push(t);
        return ctl.deferCam ? new Promise<FakeTrack>((r) => ctl.camWaits.push(() => r(t))) : Promise.resolve(t);
      },
      createStream: (t) => new FakeStream(t),
    },
    system: {
      start: (id, room, video) => system.push(`start ${id} ${room} ${video}`),
      connected: (id) => system.push(`connected ${id}`),
      end: (id) => system.push(`end ${id}`),
      setMuted: (id, m) => system.push(`muted ${id} ${m}`),
    },
    uuid: () => `u${++ids}`,
    log: silentLog,
    timers,
    now: () => timers.now,
    playChime: (n) => chimes.push(n),
  }, {
    change: (s) => states.push(s),
    end: (o) => ends.push(o),
    notice: (t) => notices.push(t),
    selfRenamed: (n) => renames.push(n),
  });
  return { call, timers, peers, system, notices, ends, states, mics, cams, ctl, chimes, renames };
}

const req = (over: Partial<JoinRequest> = {}): JoinRequest => ({
  link: parseRoomInput("https://vc.swiftirc.net/lounge#i=inv1")!,
  name: "Ryan", password: "pw", gravatar: "g", mic: true, camera: true, ...over,
});
const joined = (over = {}) => ({
  type: "joined", selfId: "me", role: "user", quality: { camera: "low", screen: "auto" },
  peers: [{ id: "p1", name: "Alice", role: "op", mic: true, camera: false }], ...over,
});
const sock = () => FakeSocket.last();
const framesOf = (type: string) => FakeSocket.all.flatMap((s) => s.sent).filter((f) => f.type === type);

async function inCall(over: Partial<JoinRequest> = {}) {
  const t = setup();
  await t.call.join(req(over));
  sock().open();
  sock().receive(joined());
  await flush();
  return t;
}

test("join: system call first, join frame first on the socket, then in-call with a started peer", async () => {
  const { call, system, peers, mics, cams } = setup();
  await call.join(req());
  expect(system).toEqual(["start u2 lounge true"]);
  expect(sock().url).toBe("wss://vc.swiftirc.net/ws/lounge");
  sock().open();
  expect(sock().sent[0]).toEqual({
    type: "join", name: "Ryan", password: "pw", gravatar: "g", token: "", invite: "inv1", session: "u1", mic: true, camera: true,
  });
  sock().receive(joined());
  await flush();
  const s = call.getState();
  expect(s).toMatchObject({ phase: "in-call", banner: "", selfId: "me", role: "user", mic: true, camera: true });
  expect(s.participants.map((p) => p.name)).toEqual(["Alice"]);
  expect(s.localStream?.getTracks()).toEqual([cams[0]]);
  expect(system).toContain("connected u2");
  expect(peers[0].started).toEqual([{ track: mics[0], kind: "mic" }, { track: cams[0], kind: "camera" }]);
  expect(peers[0].quality).toEqual(["low", "auto"]);
});

test("reconnect: banner, same session, current media state, rebuilt peer, connected reported once", async () => {
  const { call, timers, peers, system } = await inCall();
  sock().drop();
  expect(call.getState()).toMatchObject({ phase: "reconnecting", banner: "reconnecting" });
  await call.setMic(false); // toggled while disconnected
  timers.advance(500);
  sock().open();
  expect(sock().sent[0]).toMatchObject({ type: "join", session: "u1", mic: false, camera: true });
  sock().receive(joined({ peers: [] }));
  await flush();
  expect(peers).toHaveLength(2);
  expect(peers[0].closed).toBe(true);
  expect(peers[1].started?.map((l) => l.kind)).toEqual(["mic", "camera"]);
  expect(call.getState()).toMatchObject({ phase: "in-call", banner: "", participants: [] });
  expect(system.filter((x) => x.startsWith("connected"))).toHaveLength(1);
});

test("an error before joined ends the call as rejected and never reconnects", async () => {
  const { call, timers, ends, system, mics } = setup();
  await call.join(req());
  sock().open();
  sock().receive({ type: "error", code: "bad-password", message: "x" });
  expect(ends).toEqual([{ kind: "rejected", code: "bad-password", text: "Wrong password for this room." }]);
  expect(call.getState().phase).toBe("ended");
  expect(system.at(-1)).toBe("end u2");
  expect(mics[0].stopped).toBe(true);
  timers.advance(60_000);
  expect(FakeSocket.all).toHaveLength(1);
});

test("an error in a call is a notice; the call continues", async () => {
  const { call, notices, ends } = await inCall();
  sock().receive({ type: "error", code: "no-such-peer", message: "x" });
  expect(notices).toEqual(["They already left the call."]);
  expect(ends).toEqual([]);
  expect(call.getState().phase).toBe("in-call");
});

test("an error after a reconnect but before re-joined is fatal (no reconnect loop)", async () => {
  const { call, timers, ends } = await inCall();
  sock().drop();
  timers.advance(500);
  sock().open();
  sock().receive({ type: "error", code: "banned", message: "x" });
  expect(ends).toEqual([{ kind: "rejected", code: "banned", text: "You are banned from this room." }]);
  timers.advance(60_000);
  expect(FakeSocket.all).toHaveLength(2);
  expect(call.getState().phase).toBe("ended");
});

test("kicked: removed, devices released, system call ended, never rejoins", async () => {
  const { call, timers, ends, system, peers, mics, cams } = await inCall();
  sock().receive({ type: "kicked", by: "Alice" });
  expect(ends).toEqual([{ kind: "removed", reason: "kicked", by: "Alice" }]);
  expect(sock().closed).toBe(true);
  expect(peers[0].closed).toBe(true);
  expect(mics[0].stopped && cams[0].stopped).toBe(true);
  expect(system.at(-1)).toBe("end u2");
  timers.advance(60_000);
  expect(FakeSocket.all).toHaveLength(1);
  expect(call.getState().phase).toBe("ended");
});

test("banned frame behaves like kicked", async () => {
  const { ends } = await inCall();
  sock().receive({ type: "banned", by: "Op" });
  expect(ends).toEqual([{ kind: "removed", reason: "banned", by: "Op" }]);
});

test("leave stops everything and reports left", async () => {
  const { call, ends, system } = await inCall();
  call.leave();
  call.leave();
  expect(ends).toEqual([{ kind: "left" }]);
  expect(system.filter((x) => x.startsWith("end"))).toHaveLength(1);
});

test("leave during device acquisition does not connect", async () => {
  const { call, ends } = setup();
  const p = call.join(req());
  call.leave();
  await p;
  expect(FakeSocket.all).toHaveLength(0);
  expect(ends).toEqual([{ kind: "left" }]);
});

test("mic toggle: track, media-state, system mute; the system's echo is a no-op", async () => {
  const { call, system, mics } = await inCall();
  await call.setMic(false);
  expect(mics[0].enabled).toBe(false);
  expect(framesOf("media-state")).toEqual([{ type: "media-state", mic: false, camera: true }]);
  expect(system.at(-1)).toBe("muted u2 true");
  const before = system.length;
  await call.onSystemMute(true); // CallKit reporting back our own setMuted
  expect(framesOf("media-state")).toHaveLength(1);
  expect(system).toHaveLength(before);
});

test("a mute from the system UI applies without calling back into it", async () => {
  const { call, system } = await inCall();
  const before = system.length;
  await call.onSystemMute(true);
  expect(call.getState().mic).toBe(false);
  expect(framesOf("media-state")).toEqual([{ type: "media-state", mic: false, camera: true }]);
  expect(system).toHaveLength(before);
});

test("hold mutes; unhold restores the previous mic state", async () => {
  const { call } = await inCall();
  await call.onHold(true);
  expect(call.getState().mic).toBe(false);
  await call.onHold(false);
  expect(call.getState().mic).toBe(true);
  await call.setMic(false);
  await call.onHold(true);
  await call.onHold(false);
  expect(call.getState().mic).toBe(false);
});

test("background turns the camera off; foreground restores it and reconnects a dead socket", async () => {
  const { call, peers, cams } = await inCall();
  await call.onAppState("background");
  expect(call.getState().camera).toBe(false);
  expect(cams[0].stopped).toBe(true);
  expect(peers[0].replaced.at(-1)).toEqual(["camera", null]);
  expect(framesOf("media-state").at(-1)).toMatchObject({ camera: false });
  sock().drop(); // died silently while backgrounded
  await call.onAppState("active");
  expect(FakeSocket.all).toHaveLength(2); // immediate, no backoff wait
  expect(call.getState().camera).toBe(true);
  expect(peers[0].replaced.at(-1)).toEqual(["camera", cams[1]]);
});

test("a camera the user turned off stays off after foregrounding", async () => {
  const { call, cams } = await inCall();
  await call.setCamera(false);
  await call.onAppState("background");
  await call.onAppState("active");
  expect(call.getState().camera).toBe(false);
  expect(cams).toHaveLength(1);
});

test("network regained reconnects immediately only when the socket is down", async () => {
  const { call } = await inCall();
  call.onNetworkChange(true);
  expect(FakeSocket.all).toHaveLength(1);
  sock().drop();
  call.onNetworkChange(true);
  expect(FakeSocket.all).toHaveLength(2);
});

test("permission denied: joins with devices off, later toggles retry and notice", async () => {
  const t = setup({ micDenied: true, camDenied: true });
  await t.call.join(req());
  sock().open();
  expect(sock().sent[0]).toMatchObject({ mic: false, camera: false });
  sock().receive(joined());
  await flush();
  expect(t.peers[0].started).toEqual([]);
  t.notices.length = 0;
  await t.call.setMic(true);
  await t.call.setCamera(true);
  expect(t.call.getState()).toMatchObject({ mic: false, camera: false });
  expect(t.notices).toEqual(["Microphone unavailable.", "Camera unavailable."]);
});

test("turning the camera on with no camera sender publishes it", async () => {
  const { call, peers, cams } = await inCall({ camera: false });
  await call.setCamera(true);
  expect(peers[0].published).toEqual([["camera", cams[0]]]);
  expect(framesOf("media-state").at(-1)).toMatchObject({ camera: true });
});

test("flip swaps the camera track in place", async () => {
  const { call, peers, cams } = await inCall();
  await call.flipCamera();
  expect(call.getState().facing).toBe("environment");
  expect(peers[0].replaced.at(-1)).toEqual(["camera", cams[1]]);
  expect(cams[0].stopped).toBe(true);
});

test("remote camera and mic streams land in the roster; screenshares are ignored", async () => {
  const { call, peers } = await inCall();
  const v = new FakeStream([]);
  peers[0].events.remoteTrack({ participantId: "p1", kind: "camera", stream: v });
  peers[0].events.remoteTrack({ participantId: "p1", kind: "screen", stream: new FakeStream([]) });
  expect(call.getState().participants[0].video).toBe(v);
  peers[0].events.peerGone({ participantId: "p1", kind: "camera" });
  expect(call.getState().participants[0].video).toBeNull();
});

test("roster frames: join, media state, rename, role, leave", async () => {
  const { call } = await inCall();
  sock().receive({ type: "peer-joined", id: "p2", name: "Bob", role: "guest", mic: false, camera: true });
  sock().receive({ type: "peer-media-state", id: "p2", mic: true, camera: false });
  sock().receive({ type: "peer-renamed", id: "p2", name: "Robert" });
  sock().receive({ type: "role", id: "p2", role: "op" });
  expect(call.getState().participants[1]).toMatchObject({ name: "Robert", role: "op", mic: true, camera: false });
  sock().receive({ type: "peer-left", id: "p2" });
  expect(call.getState().participants.map((p) => p.id)).toEqual(["p1"]);
});

test("self rename and role are kept for the next join", async () => {
  const { call, timers } = await inCall();
  sock().receive({ type: "peer-renamed", id: "me", name: "NewNick" });
  sock().receive({ type: "role", id: "me", role: "op" });
  expect(call.getState().role).toBe("op");
  sock().drop();
  timers.advance(500);
  sock().open();
  expect(sock().sent[0]).toMatchObject({ type: "join", name: "NewNick" });
});

test("media failure shows the banner and replaces the socket for a full rejoin", async () => {
  const { call, peers } = await inCall();
  peers[0].events.mediaFailed();
  expect(call.getState().banner).toBe("media-lost");
  expect(FakeSocket.all).toHaveLength(2);
  expect(FakeSocket.all[0].closed).toBe(true);
});

test("server-restarting shows the banner without stopping", async () => {
  const { call } = await inCall();
  sock().receive({ type: "server-restarting" });
  expect(call.getState().banner).toBe("reconnecting");
  expect(sock().closed).toBe(false);
});

test("op force-mute and quality frames apply", async () => {
  const { call, peers } = await inCall();
  sock().receive({ type: "muted", kind: "mic" });
  expect(call.getState().mic).toBe(false);
  sock().receive({ type: "muted", kind: "camera" });
  await flush();
  expect(call.getState().camera).toBe(false);
  sock().receive({ type: "quality", camera: "high", screen: "low" });
  expect(peers[0].quality).toEqual(["high", "low"]);
});

test("flip then camera off during acquisition: the new track is stopped, not assigned", async () => {
  const { call, peers, cams, ctl } = await inCall();
  ctl.deferCam = true;
  const flip = call.flipCamera();
  await call.setCamera(false);
  ctl.camWaits[0]();
  await flip;
  expect(cams[1].stopped).toBe(true);
  expect(call.getState().camera).toBe(false);
  expect(peers[0].replaced).toEqual([["camera", null]]);
});

test("flip then leave during acquisition: the new track is stopped", async () => {
  const { call, cams, ctl } = await inCall();
  ctl.deferCam = true;
  const flip = call.flipCamera();
  call.leave();
  ctl.camWaits[0]();
  await flip;
  expect(cams[1].stopped).toBe(true);
});

test("flip then kick during acquisition: the new track is stopped", async () => {
  const { call, cams, ctl } = await inCall();
  ctl.deferCam = true;
  const flip = call.flipCamera();
  sock().receive({ type: "kicked", by: "Alice" });
  ctl.camWaits[0]();
  await flip;
  expect(cams[1].stopped).toBe(true);
  expect(call.getState().phase).toBe("ended");
});

test("background during a pending camera restore keeps it off and restores next foreground", async () => {
  const { call, cams, ctl, peers } = await inCall();
  await call.onAppState("background");
  ctl.deferCam = true;
  const restore = call.onAppState("active");
  await call.onAppState("background");
  ctl.camWaits[0]();
  await restore;
  expect(cams[1].stopped).toBe(true);
  expect(call.getState().camera).toBe(false);
  ctl.deferCam = false;
  await call.onAppState("active");
  expect(call.getState().camera).toBe(true);
  expect(cams[2].stopped).toBe(false);
  expect(peers[0].replaced.at(-1)).toEqual(["camera", cams[2]]);
});

test("double setMic(true) with no track leaves exactly one live mic", async () => {
  const { call, mics, ctl } = await inCall({ mic: false });
  mics.forEach((m) => m.stop());
  mics.length = 0;
  await call.setMic(false); // already off: no-op
  (call as unknown as { micTrack: null }).micTrack = null;
  ctl.deferMic = true;
  const a = call.setMic(true);
  const b = call.setMic(true);
  ctl.micWaits.forEach((f) => f());
  await Promise.all([a, b]);
  expect(mics.filter((m) => !m.stopped)).toHaveLength(1);
  expect(call.getState().mic).toBe(true);
});

test("setCamera(true) resolving after leave stops the track and emits no change", async () => {
  const { call, cams, ctl, states } = await inCall({ camera: false });
  ctl.deferCam = true;
  const p = call.setCamera(true);
  call.leave();
  const n = states.length;
  ctl.camWaits[0]();
  await p;
  expect(cams[0].stopped).toBe(true);
  expect(states).toHaveLength(n);
});

test("a hold arriving during a pending mic acquisition keeps the mic off", async () => {
  const { call, mics, ctl } = await inCall({ mic: false });
  (call as unknown as { micTrack: null }).micTrack = null;
  mics[0].stop();
  ctl.deferMic = true;
  const p = call.setMic(true);
  await call.onHold(true);
  ctl.micWaits[0]();
  await p;
  expect(call.getState().mic).toBe(false);
  expect(mics[1].stopped).toBe(true);
});

test("system mute and hold during join's device acquisition are applied after it", async () => {
  const t = setup();
  t.ctl.deferMic = true;
  const p = t.call.join(req());
  await t.call.onSystemMute(true);
  await t.call.onHold(true);
  t.ctl.micWaits[0]();
  await flush();
  await p;
  expect(t.call.getState().mic).toBe(false);
  expect(t.mics[0].enabled).toBe(false);
  sock().open();
  expect(sock().sent[0]).toMatchObject({ type: "join", mic: false });
});

test("user camera-off during a pending foreground restore stays off across another cycle", async () => {
  const { call, cams, ctl } = await inCall();
  await call.onAppState("background");
  ctl.deferCam = true;
  const restore = call.onAppState("active");
  await call.setCamera(false);
  ctl.camWaits[0]();
  await restore;
  expect(cams[1].stopped).toBe(true);
  ctl.deferCam = false;
  await call.onAppState("background");
  await call.onAppState("active");
  expect(call.getState().camera).toBe(false);
  expect(cams).toHaveLength(2);
});

test("op force-mute of the camera during a pending restore stays off across another cycle", async () => {
  const { call, cams, ctl } = await inCall();
  await call.onAppState("background");
  ctl.deferCam = true;
  const restore = call.onAppState("active");
  sock().receive({ type: "muted", kind: "camera" });
  ctl.camWaits[0]();
  await restore;
  await flush();
  ctl.deferCam = false;
  await call.onAppState("background");
  await call.onAppState("active");
  expect(call.getState().camera).toBe(false);
  expect(cams[1].stopped).toBe(true);
  expect(cams).toHaveLength(2);
});

test("a denied foreground restore notices once, not on every foreground", async () => {
  const { call, notices, cams } = await inCall();
  await call.onAppState("background");
  cams.length = 0;
  (call as unknown as { deps: { media: { getCamera: () => Promise<null> } } }).deps.media.getCamera = async () => null;
  notices.length = 0;
  await call.onAppState("active");
  await call.onAppState("background");
  await call.onAppState("active");
  expect(notices).toEqual(["Camera unavailable."]);
  expect(call.getState().camera).toBe(false);
});

test("a camera turned on during join's acquisition is started even if join began with it off", async () => {
  const t = setup();
  t.ctl.deferMic = true;
  const p = t.call.join(req({ camera: false }));
  await t.call.setCamera(true);
  t.ctl.micWaits[0]();
  await p;
  expect(t.call.getState().camera).toBe(true);
  expect(t.cams).toHaveLength(1);
});

test("the amended mic value decides the muted-join notice", async () => {
  const t = setup({ micDenied: true });
  const p = t.call.join(req({ mic: true }));
  await t.call.setMic(false);
  await p;
  expect(t.notices).not.toContain("Microphone unavailable — joining muted.");
});

test("backgrounding during join's acquisition keeps the camera off and restores it on foreground", async () => {
  const t = setup();
  t.ctl.deferMic = true;
  const p = t.call.join(req());
  await t.call.onAppState("background");
  t.ctl.micWaits[0]();
  await p;
  expect(t.call.getState().camera).toBe(false);
  expect(t.cams).toHaveLength(0);
  await t.call.onAppState("active");
  expect(t.call.getState().camera).toBe(true);
});

test("backgrounding during a user camera-on acquisition keeps it off and restores it on foreground", async () => {
  const { call, cams, ctl, peers } = await inCall({ camera: false });
  ctl.deferCam = true;
  const on = call.setCamera(true);
  await call.onAppState("background");
  ctl.camWaits[0]();
  await on;
  expect(cams[0].stopped).toBe(true);
  expect(call.getState().camera).toBe(false);
  ctl.deferCam = false;
  await call.onAppState("active");
  expect(call.getState().camera).toBe(true);
  expect(cams[1].stopped).toBe(false);
  expect(peers[0].published.at(-1)).toEqual(["camera", cams[1]]);
});

test("chat: frames reach the log; send goes out only while in-call and connected", async () => {
  const { call } = await inCall();
  sock().receive({ type: "chat", from: "Alice", text: "hi", ts: 5 });
  sock().receive({ type: "moderation", actor: "Alice", action: "lock" });
  expect(call.chat.getSnapshot().entries.map((e) => (e.kind === "poll" ? "" : e.text))).toEqual(["hi", "Alice locked the room"]);
  expect(call.chat.send("hello")).toBe("sent");
  expect(framesOf("chat")).toEqual([{ type: "chat", text: "hello" }]);
  sock().drop();
  expect(call.chat.send("lost?")).toBe("offline");
  expect(framesOf("chat")).toHaveLength(1);
});

test("rejoin clears chat before the server's replay, re-anchors the clock, stays silent", async () => {
  const { call, timers, chimes } = await inCall();
  sock().receive({ type: "chat", from: "Alice", text: "old", ts: 1 });
  sock().drop();
  timers.advance(500);
  sock().open();
  timers.now = 50_000;
  sock().receive(joined({ roomAge: 30, peers: [{ id: "p9", name: "Alice", role: "op", mic: true, camera: false, ref: "r1" }] }));
  sock().receive({ type: "chat", from: "Alice", text: "old", ts: 1 }); // replay
  await flush();
  expect(call.chat.getSnapshot().entries.map((e) => (e.kind === "poll" ? "" : e.text))).toEqual(["old"]);
  expect(call.clock.elapsed(50_000)).toBe(30);
  expect(chimes).toEqual([]);
});

test("a rejoin's chat replay does not re-count read history as unread", async () => {
  const { call, timers } = await inCall();
  sock().receive({ type: "chat", from: "Alice", text: "old", ts: 1 });
  call.chat.setOpen(true);
  call.chat.setOpen(false);
  sock().drop();
  timers.advance(500);
  sock().open();
  sock().receive(joined());
  sock().receive({ type: "chat", from: "Alice", text: "old", ts: 1 });
  await flush();
  expect(call.chat.getSnapshot().unread).toBe(0);
});

test("in-call server errors also land in chat as notices", async () => {
  const { call, notices } = await inCall();
  sock().receive({ type: "error", code: "rate", message: "Slow down" });
  expect(notices).toHaveLength(1);
  expect(call.chat.getSnapshot().entries.map((e) => (e.kind === "poll" ? "" : e.text))).toEqual([notices[0]]);
});

test("chimes: arrivals and departures by ref, not on the initial roster", async () => {
  const { timers, chimes } = await inCall();
  expect(chimes).toEqual([]);
  sock().receive({ type: "peer-joined", id: "p2", name: "Bob", role: "user", mic: true, camera: true, ref: "rb" });
  sock().receive({ type: "peer-left", id: "p2" });
  timers.advance(6000);
  expect(chimes).toEqual(["join", "drop"]);
});

test("screen tracks go to the roster's screen slots and bloop once", async () => {
  const { call, peers, chimes } = await inCall();
  sock().receive({ type: "peer-joined", id: "p2", name: "Bob", role: "user", mic: true, camera: true, ref: "rb" });
  const scr = new FakeStream([]);
  const sa = new FakeStream([]);
  peers[0].events.remoteTrack({ participantId: "p2", kind: "screen", stream: scr });
  peers[0].events.remoteTrack({ participantId: "p2", kind: "screen-audio", stream: sa });
  const bob = call.getState().participants.find((p) => p.id === "p2")!;
  expect(bob).toMatchObject({ screen: scr, screenAudio: sa });
  expect(chimes.filter((c) => c === "bloop")).toHaveLength(1);
  peers[0].events.peerGone({ participantId: "p2", kind: "screen" });
  peers[0].events.peerGone({ participantId: "p2", kind: "screen-audio" });
  expect(call.getState().participants.find((p) => p.id === "p2")).toMatchObject({ screen: null, screenAudio: null });
});

test("a screenshare survives a reconnect: one bloop, slot refilled", async () => {
  const { call, peers, chimes, timers } = await inCall();
  sock().receive({ type: "peer-joined", id: "p2", name: "Bob", role: "user", mic: true, camera: true, ref: "rb" });
  peers[0].events.remoteTrack({ participantId: "p2", kind: "screen", stream: new FakeStream([]) });
  expect(chimes.filter((c) => c === "bloop")).toHaveLength(1);
  sock().drop();
  timers.advance(500);
  sock().open();
  sock().receive(joined({ peers: [{ id: "p3", name: "Bob", role: "user", mic: true, camera: true, ref: "rb" }] }));
  await flush();
  const scr = new FakeStream([]);
  peers[peers.length - 1].events.remoteTrack({ participantId: "p3", kind: "screen", stream: scr });
  expect(call.getState().participants.find((p) => p.id === "p3")).toMatchObject({ screen: scr });
  expect(chimes.filter((c) => c === "bloop")).toHaveLength(1);
});

test("rename: validates, sends, updates state and saves only on our own confirmed echo", async () => {
  const { call, renames } = await inCall();
  expect(call.getState().name).toBe("Ryan");
  expect(call.rename("   ")).toBe("empty");
  expect(call.rename("Ryan")).toBe("unchanged");
  expect(call.rename("  " + "x".repeat(30) + "  ")).toBe("sent");
  expect(framesOf("rename")).toEqual([{ type: "rename", name: "x".repeat(24) }]);
  expect(call.getState().name).toBe("Ryan"); // not until the server confirms
  sock().receive({ type: "peer-renamed", id: "me", name: "x".repeat(24) });
  expect(call.getState().name).toBe("x".repeat(24));
  expect(renames).toEqual(["x".repeat(24)]);
  sock().receive({ type: "peer-renamed", id: "me", name: "ServerSide" }); // not our request
  expect(call.getState().name).toBe("ServerSide");
  expect(renames).toHaveLength(1);
  expect(call.rename("a \t  b\u0007c")).toBe("sent");
  expect(framesOf("rename").pop()).toEqual({ type: "rename", name: "a bc" });
  sock().receive({ type: "peer-renamed", id: "me", name: "a bc" });
  expect(renames).toEqual(["x".repeat(24), "a bc"]);
  sock().drop();
  expect(call.rename("Offline")).toBe("offline");
});

test("rename echo for another participant only patches the roster", async () => {
  const { call, renames } = await inCall();
  sock().receive({ type: "peer-renamed", id: "p1", name: "Alicia" });
  expect(call.getState().participants[0].name).toBe("Alicia");
  expect(renames).toEqual([]);
});
