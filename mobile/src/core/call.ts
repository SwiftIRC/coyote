// The call controller: one room session from join to end. Owns the signaling
// socket, the media Peer (rebuilt on every server-side rejoin), local tracks, the
// roster and the system-call integration (CallKit / ConnectionService), and exposes
// one immutable CallState snapshot for the UI. Port of the join/rejoin/removal flow
// in internal/web/assets/app.js, plus the mobile lifecycle rules from the spec.
import { ChatLog } from "./chat";
import { Chimes, type ChimeName } from "./chimes";
import { inCallErrorText, joinErrorText } from "./errors";
import { wsUrl, type RoomLink } from "./link";
import type { Peer, PeerEvents } from "./peer";
import { RoomClock } from "./roomClock";
import { Roster, type Participant, type PeerInfo } from "./roster";
import type { Signaling } from "./signaling";
import type { Frame, Kind, Logger, StreamLike, Timers, TrackLike } from "./types";

export type Facing = "user" | "environment";
export type PeerLike = Pick<Peer, "start" | "publish" | "replaceTrack" | "setQuality" | "close">;
export type SignalingLike = Pick<Signaling, "onOpen" | "onClose" | "on" | "off" | "connect" | "send" | "stop" | "reconnectNow" | "isOpen">;

export interface MediaPort {
  getMic(): Promise<TrackLike | null>; // null: denied or unavailable
  getCamera(facing: Facing): Promise<TrackLike | null>;
  createStream(tracks: TrackLike[]): StreamLike;
}

export interface SystemCallPort {
  start(callId: string, room: string, video: boolean): void;
  connected(callId: string): void;
  end(callId: string): void;
  setMuted(callId: string, muted: boolean): void;
}

export interface CallDeps {
  createSignaling(url: string): SignalingLike;
  createPeer(sig: SignalingLike, events: PeerEvents): PeerLike;
  media: MediaPort;
  system: SystemCallPort;
  uuid(): string;
  log: Logger;
  timers: Timers;
  now(): number; // ms, wall clock
  playChime(n: ChimeName): void;
}

export interface JoinRequest {
  link: RoomLink;
  name: string;
  password: string;
  gravatar: string;
  mic: boolean;
  camera: boolean;
}

export type Phase = "idle" | "connecting" | "in-call" | "reconnecting" | "ended";
export type Banner = "" | "reconnecting" | "media-lost";

export interface CallState {
  phase: Phase;
  banner: Banner;
  slug: string;
  selfId: string;
  role: string;
  name: string;
  mic: boolean;
  camera: boolean;
  facing: Facing;
  localStream: StreamLike | null;
  participants: Participant[];
}

export type CallOutcome =
  | { kind: "left" }
  | { kind: "rejected"; code: string; text: string }
  | { kind: "removed"; reason: "kicked" | "banned"; by: string };

export interface CallEvents {
  change(state: CallState): void;
  end(outcome: CallOutcome): void;
  notice(text: string): void;
  selfRenamed?(name: string): void;
}

export const NAME_MAX = 24;

export class Call {
  private sig: SignalingLike | null = null;
  private peer: PeerLike | null = null;
  private roster = new Roster();
  readonly clock = new RoomClock();
  readonly chat: ChatLog;
  private chimes: Chimes;
  private pendingRename: string | null = null;
  private req: JoinRequest | null = null;
  private session = "";
  private callId = "";
  private micTrack: TrackLike | null = null;
  private camTrack: TrackLike | null = null;
  private joinedOnce = false;
  // Set once join() has finished acquiring devices. Until then media toggles only
  // amend the request (join reads it after acquisition) instead of racing it.
  private ready = false;
  // Bumped on every set call for that device; an acquisition that finds the counter
  // moved on while it awaited was superseded, so it stops its track and does nothing.
  private micGen = 0;
  private camGen = 0;
  // True from each socket open (join sent) until that socket's `joined`: an `error`
  // in this window is a refused join and is fatal, even on a reconnect.
  private awaitingJoined = false;
  // "Restore the camera on the next foreground". Set only by backgrounding; any other
  // explicit camera-off, or a finished restore attempt (even a denied one), clears it.
  private cameraBeforeBackground = false;
  private backgrounding = false;
  private restores = 0; // foreground restores in flight
  private cameraOns = 0; // setCamera(true) acquisitions in flight (user or restore)
  private micBeforeHold: boolean | null = null;
  private quality = { camera: "auto", screen: "auto" };
  private state: CallState = {
    phase: "idle", banner: "", slug: "", selfId: "", role: "", name: "", mic: false, camera: false,
    facing: "user", localStream: null, participants: [],
  };

  constructor(private deps: CallDeps, private events: CallEvents) {
    this.roster.subscribe(() => this.update({ participants: this.roster.list() }));
    this.chat = new ChatLog((type, fields) => this.trySend(type, fields), () => deps.now());
    this.chimes = new Chimes((n) => deps.playChime(n), deps.timers);
  }

  getState(): CallState {
    return this.state;
  }

  async join(req: JoinRequest): Promise<void> {
    if (this.state.phase !== "idle") throw new Error("Call.join may only be called once");
    this.req = req;
    this.session = this.deps.uuid(); // binds a #i= invite to this call, across reconnects
    this.callId = this.deps.uuid();
    this.update({ phase: "connecting", slug: req.link.slug, name: req.name });
    this.deps.system.start(this.callId, req.link.slug, req.camera);

    this.micTrack = await this.deps.media.getMic();
    if (!this.micTrack && this.req.mic) this.events.notice("Microphone unavailable — joining muted.");
    if (this.isLive() && this.req.camera) { // the request may have been amended meanwhile
      this.camTrack = await this.deps.media.getCamera("user");
      if (!this.camTrack) this.events.notice("Camera unavailable — joining with it off.");
    }
    if (!this.isLive()) {
      this.releaseTracks(); // left while devices were being acquired
      return;
    }
    this.ready = true;
    const want = this.req;
    if (this.camTrack && !want.camera) {
      this.camTrack.stop(); // turned off while it was being acquired
      this.camTrack = null;
    }
    const mic = !!this.micTrack && want.mic;
    if (this.micTrack) this.micTrack.enabled = mic;
    this.update({ mic, camera: !!this.camTrack });
    this.refreshLocalStream();
    if (!mic) this.deps.system.setMuted(this.callId, true);

    const sig = this.deps.createSignaling(wsUrl(req.link));
    this.sig = sig;
    sig.onOpen(() => {
      this.awaitingJoined = true;
      sig.send("join", this.joinFrame());
    });
    sig.onClose(() => {
      if (this.state.phase === "in-call") this.update({ phase: "reconnecting", banner: "reconnecting" });
    });
    sig.on("joined", (m) => this.onJoined(m));
    sig.on("error", (m) => this.onServerError(m));
    sig.on("kicked", (m) => this.finish({ kind: "removed", reason: "kicked", by: m.by || "" }));
    sig.on("banned", (m) => this.finish({ kind: "removed", reason: "banned", by: m.by || "" }));
    sig.on("server-restarting", () => this.update({ banner: "reconnecting" }));
    sig.on("peer-joined", (m) => {
      this.roster.upsert(m as unknown as PeerInfo);
      this.chimes.joined(String(m.ref || ""));
    });
    sig.on("peer-left", (m) => {
      const ref = this.roster.refOf(m.id);
      this.roster.remove(m.id);
      this.chimes.left(ref);
    });
    sig.on("chat", (m) => this.chat.onChat(m));
    sig.on("moderation", (m) => this.chat.onModeration(m));
    sig.on("peer-media-state", (m) => this.roster.patch(m.id, { mic: !!m.mic, camera: !!m.camera }));
    sig.on("peer-renamed", (m) => this.onRenamed(m));
    sig.on("role", (m) => this.onRole(m));
    sig.on("muted", (m) => {
      this.onForceMuted(m.kind).catch((err) => this.deps.log.warn("[call] force-mute failed", err));
    });
    sig.on("quality", (m) => this.onQuality(m));
    sig.connect();
  }

  leave(): void {
    this.finish({ kind: "left" });
  }

  rename(name: string): "sent" | "empty" | "unchanged" | "offline" {
    // Mirror the server's sanitizeName so its echo matches pendingRename.
    const clean = [...name].filter((c) => !/\p{Cc}/u.test(c)).join("").trim().split(/\s+/).join(" ");
    const n = [...clean].slice(0, NAME_MAX).join("").trim();
    if (!n) return "empty";
    if (n === this.state.name) return "unchanged";
    if (!this.trySend("rename", { name: n })) return "offline";
    this.pendingRename = n;
    return "sent";
  }

  async setMic(on: boolean, fromSystem = false): Promise<void> {
    if (!this.isLive()) return;
    if (!this.ready) {
      if (this.req) this.req = { ...this.req, mic: on };
      return;
    }
    const gen = ++this.micGen;
    if (on === this.state.mic) return; // equal: e.g. CallKit echoing our setMuted
    if (on && !this.micTrack) {
      const t = await this.deps.media.getMic();
      if (gen !== this.micGen || !this.isLive() || this.micTrack) {
        t?.stop(); // superseded (or a track appeared) while acquiring
        return;
      }
      if (!t) {
        this.events.notice("Microphone unavailable.");
        if (fromSystem) this.deps.system.setMuted(this.callId, true);
        return;
      }
      this.micTrack = t;
      if (this.peer) await this.peer.publish(t, "mic");
    }
    if (this.micTrack) this.micTrack.enabled = on;
    this.update({ mic: on });
    if (!fromSystem) this.deps.system.setMuted(this.callId, !on);
    this.sendMediaState();
  }

  async setCamera(on: boolean): Promise<void> {
    if (!this.isLive()) return;
    if (!on && !this.backgrounding) this.cameraBeforeBackground = false; // explicit off wins
    if (!this.ready) {
      if (this.req) this.req = { ...this.req, camera: on };
      return;
    }
    const gen = ++this.camGen;
    if (on === this.state.camera) return;
    if (!on) {
      const old = this.camTrack;
      this.camTrack = null;
      this.update({ camera: false });
      this.refreshLocalStream();
      if (this.peer) await this.peer.replaceTrack("camera", null);
      old?.stop();
      this.sendMediaState();
      return;
    }
    let t: TrackLike | null;
    this.cameraOns++;
    try {
      t = await this.deps.media.getCamera(this.state.facing);
    } finally {
      this.cameraOns--;
    }
    if (gen !== this.camGen || !this.isLive()) {
      t?.stop();
      return;
    }
    if (!t) {
      this.events.notice("Camera unavailable.");
      return;
    }
    this.camTrack = t;
    this.update({ camera: true });
    this.refreshLocalStream();
    if (this.peer && !(await this.peer.replaceTrack("camera", t))) await this.peer.publish(t, "camera");
    this.sendMediaState();
  }

  async flipCamera(): Promise<void> {
    if (!this.isLive() || !this.ready) return;
    const facing: Facing = this.state.facing === "user" ? "environment" : "user";
    if (!this.state.camera) {
      this.update({ facing });
      return;
    }
    const gen = ++this.camGen;
    const t = await this.deps.media.getCamera(facing);
    if (gen !== this.camGen || !this.isLive() || !this.state.camera) {
      t?.stop(); // camera turned off, or the call ended, while switching
      return;
    }
    if (!t) {
      this.events.notice("Could not switch camera.");
      return;
    }
    const old = this.camTrack;
    this.camTrack = t;
    this.update({ facing });
    this.refreshLocalStream();
    if (this.peer) await this.peer.replaceTrack("camera", t);
    old?.stop();
  }

  // Camera off in the background on both platforms (spec); on return, restore it if
  // it was on, and reconnect at once if the socket died while we were away.
  async onAppState(s: "active" | "background" | "inactive"): Promise<void> {
    if (!this.isLive()) return;
    if (s === "background") {
      if (!this.ready) {
        // Still acquiring devices: amend the request so join() leaves the camera off.
        if (this.req?.camera) {
          this.cameraBeforeBackground = true;
          this.req = { ...this.req, camera: false };
        }
        return;
      }
      // A camera-on still acquiring (the user's or a restore) counts: backgrounding
      // cancels it but keeps the intent.
      const pending = this.cameraOns > 0 || this.restores > 0;
      this.camGen++; // supersedes any camera acquisition in flight
      if (this.state.camera || pending) {
        this.cameraBeforeBackground = true;
        this.backgrounding = true;
        try {
          await this.setCamera(false);
        } finally {
          this.backgrounding = false;
        }
      }
      return;
    }
    if (s === "active") {
      if (this.sig && !this.sig.isOpen) this.sig.reconnectNow();
      if (this.cameraBeforeBackground) {
        this.cameraBeforeBackground = false; // a background during the restore sets it again
        this.restores++;
        try {
          await this.setCamera(true);
        } finally {
          this.restores--;
        }
      }
    }
  }

  onNetworkChange(connected: boolean): void {
    if (connected && this.isLive() && this.sig && !this.sig.isOpen) this.sig.reconnectNow();
  }

  async onSystemMute(muted: boolean): Promise<void> {
    await this.setMic(!muted, true);
  }

  onSystemEnd(): void {
    this.leave();
  }

  async onHold(held: boolean): Promise<void> {
    if (held) {
      if (this.micBeforeHold === null) this.micBeforeHold = this.ready ? this.state.mic : !!this.req?.mic;
      await this.setMic(false, true);
      return;
    }
    const restore = this.micBeforeHold;
    this.micBeforeHold = null;
    if (restore) await this.setMic(true, true);
  }

  // --- server frames ---

  private onJoined(m: Frame) {
    this.awaitingJoined = false;
    const first = !this.joinedOnce;
    this.joinedOnce = true;
    if (m.quality) this.quality = { camera: m.quality.camera || "auto", screen: m.quality.screen || "auto" };
    // Reset before the server's chat replay, which follows this frame.
    this.chat.clear();
    this.clock.anchor(m.roomAge, this.deps.now());
    this.chimes.seed(m.peers || []);
    this.roster.seed((m.peers || []) as PeerInfo[]);
    this.update({ phase: "in-call", banner: "", selfId: m.selfId, role: m.role || "" });
    if (first) this.deps.system.connected(this.callId);
    this.rebuildPeer();
  }

  private onServerError(m: Frame) {
    if (this.awaitingJoined || !this.joinedOnce) {
      this.finish({ kind: "rejected", code: m.code || "error", text: joinErrorText(m.code || "", m.message || "") });
      return;
    }
    const text = inCallErrorText(m.code || "", m.message || "");
    this.events.notice(text);
    this.chat.notice(text);
  }

  private onRenamed(m: Frame) {
    if (m.id === this.state.selfId) {
      if (this.req) this.req = { ...this.req, name: m.name }; // the next join must carry it
      this.update({ name: m.name });
      if (this.pendingRename !== null && m.name === this.pendingRename) this.events.selfRenamed?.(m.name);
      this.pendingRename = null;
      return;
    }
    this.roster.patch(m.id, { name: m.name });
  }

  private onRole(m: Frame) {
    if (m.id === this.state.selfId) this.update({ role: m.role });
    else this.roster.patch(m.id, { role: m.role });
  }

  private async onForceMuted(kind: string) {
    if (kind === "mic") await this.setMic(false);
    else if (kind === "camera") await this.setCamera(false);
  }

  private onQuality(m: Frame) {
    this.quality = { camera: m.camera || "auto", screen: m.screen || "auto" };
    this.peer?.setQuality(this.quality.camera, this.quality.screen);
  }

  // --- media ---

  // The server builds a fresh SFU peer on every join, so ours is rebuilt to match
  // and republishes whatever we currently send.
  private rebuildPeer() {
    this.peer?.close();
    const peer = this.deps.createPeer(this.sig!, {
      remoteTrack: (e) => {
        if (e.kind === "camera" || e.kind === "mic" || e.kind === "screen" || e.kind === "screen-audio") {
          this.roster.setStream(e.participantId, e.kind, e.stream);
        }
        if (e.kind === "screen" || e.kind === "screen-audio") this.chimes.shareStarted(this.roster.refOf(e.participantId));
      },
      peerGone: (e) => {
        if (!e.participantId) return;
        if (e.kind === "camera" || e.kind === "mic" || e.kind === "screen" || e.kind === "screen-audio") {
          this.roster.setStream(e.participantId, e.kind, null);
        }
        const p = this.roster.get(e.participantId);
        if (p && !p.screen && !p.screenAudio) this.chimes.shareStopped(p.ref);
      },
      error: (e) => this.deps.log.warn(`[call] peer ${e.phase} failed`, e.error),
      mediaFailed: () => {
        this.update({ banner: "media-lost" });
        this.sig?.reconnectNow();
      },
    });
    this.peer = peer;
    peer.setQuality(this.quality.camera, this.quality.screen);
    const local: Array<{ track: TrackLike; kind: Kind }> = [];
    if (this.micTrack) local.push({ track: this.micTrack, kind: "mic" });
    if (this.camTrack) local.push({ track: this.camTrack, kind: "camera" });
    peer.start(local).catch((err) => this.deps.log.warn("[call] peer start failed", err));
  }

  private sendMediaState() {
    if (this.state.phase === "in-call") this.sig?.send("media-state", { mic: this.state.mic, camera: this.state.camera });
  }

  // Sends only when the server can receive it; Signaling drops frames sent while
  // reconnecting, so callers must be told rather than lose the user's input.
  private trySend(type: string, fields: Record<string, unknown>): boolean {
    if (this.state.phase !== "in-call" || !this.sig?.isOpen) return false;
    this.sig.send(type, fields);
    return true;
  }

  private joinFrame() {
    const r = this.req!;
    return {
      name: r.name, password: r.password, gravatar: r.gravatar, token: r.link.token, invite: r.link.invite,
      session: this.session, mic: this.state.mic, camera: this.state.camera,
    };
  }

  private refreshLocalStream() {
    this.update({ localStream: this.camTrack ? this.deps.media.createStream([this.camTrack]) : null });
  }

  private releaseTracks() {
    this.micTrack?.stop();
    this.camTrack?.stop();
    this.micTrack = null;
    this.camTrack = null;
    this.update({ localStream: null });
  }

  private isLive(): boolean {
    return this.state.phase !== "idle" && this.state.phase !== "ended";
  }

  private finish(outcome: CallOutcome) {
    if (this.state.phase === "ended") return;
    this.sig?.stop();
    this.peer?.close();
    this.peer = null;
    this.releaseTracks();
    this.chimes.dispose();
    if (this.callId) this.deps.system.end(this.callId);
    this.update({ phase: "ended", banner: "" });
    this.events.end(outcome);
  }

  private update(patch: Partial<CallState>) {
    this.state = { ...this.state, ...patch };
    this.events.change(this.state);
  }
}
