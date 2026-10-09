// One RTCPeerConnection to the SFU, driven by perfect negotiation with this client
// as the POLITE peer. Port of internal/web/assets/net/peer.js — read its comments
// for the why behind each rule; the rules are kept exactly:
//  - no ICE servers (public-IP SFU);
//  - one sendonly transceiver per published kind, under its own MediaStream, with
//    {streamId: kind} sent alongside EVERY offer;
//  - an offer is deferred while one is in flight and flushed once stable;
//  - on glare, a bare setRemoteDescription(offer) is the rollback (never an explicit
//    {type:"rollback"}), then answer, then re-offer explicitly.
import { handleRemoteOffer, qualityTier, encodingCaps } from "../shared/web";
import { preferVp8 } from "./codecs";
import type {
  CodecLike, Frame, Kind, Logger, PeerConnectionLike, SenderLike, StreamLike, Timers, TrackEventLike, TrackLike,
} from "./types";

export type SignalingPort = {
  on(t: string, fn: (m: Frame) => void): unknown;
  off(t: string, fn: (m: Frame) => void): unknown;
  send(t: string, f?: Record<string, unknown>): void;
};

export interface PeerDeps extends Timers {
  createPeerConnection(): PeerConnectionLike;
  createStream(tracks: TrackLike[]): StreamLike;
  createCandidate(init: unknown): unknown;
  videoCodecs(): CodecLike[] | null;
  log: Logger;
}

export interface PeerEvents {
  remoteTrack(e: { participantId: string; kind: string; stream: StreamLike }): void;
  peerGone(e: { participantId?: string; kind?: string }): void;
  error(e: { error: unknown; phase: string }): void;
  mediaFailed(): void;
}

export class Peer {
  private pc: PeerConnectionLike;
  private makingOffer = false;
  private negotiationPending = false;
  private pendingCandidates: unknown[] = [];
  private senders = new Map<Kind, SenderLike>();
  private kindByStreamId = new Map<string, Kind>();
  private streamIdByKind = new Map<Kind, string>();
  private quality = { camera: "auto", screen: "auto" };
  private sigHandlers: Array<[string, (m: Frame) => void]>;

  constructor(private sig: SignalingPort, private deps: PeerDeps, private events: PeerEvents) {
    this.pc = deps.createPeerConnection();
    this.pc.addEventListener("icecandidate", (ev) => {
      if (ev.candidate) this.sig.send("candidate", { candidate: ev.candidate });
    });
    this.pc.addEventListener("negotiationneeded", () => {
      this.makeOffer().catch((err) => this.emitError(err, "negotiation"));
    });
    this.pc.addEventListener("track", (ev) => this.onTrack(ev));
    this.sigHandlers = [
      ["offer", (m) => {
        this.onRemoteOffer(m).catch((err) => this.emitError(err, "offer"));
      }],
      ["answer", (m) => {
        this.onRemoteAnswer(m).catch((err) => this.emitError(err, "answer"));
      }],
      ["candidate", (m) => {
        this.onRemoteCandidate(m).catch((err) => this.emitError(err, "candidate"));
      }],
      ["tracks", (m) => this.onTracks(m)],
    ];
    for (const [t, fn] of this.sigHandlers) sig.on(t, fn);
  }

  async start(local: Array<{ track: TrackLike; kind: Kind }>): Promise<void> {
    for (const { track, kind } of local) this.addLocal(track, kind);
    await this.makeOffer();
  }

  async publish(track: TrackLike, kind: Kind): Promise<void> {
    const existing = this.senders.get(kind);
    if (existing) {
      await existing.replaceTrack(track);
      this.applyQuality(kind);
      return;
    }
    this.addLocal(track, kind); // fires negotiationneeded -> makeOffer
  }

  async replaceTrack(kind: Kind, track: TrackLike | null): Promise<boolean> {
    const sender = this.senders.get(kind);
    if (!sender) return false;
    await sender.replaceTrack(track);
    this.applyQuality(kind);
    return true;
  }

  unpublish(kind: Kind): void {
    const sender = this.senders.get(kind);
    if (!sender) return;
    this.senders.delete(kind);
    const sid = this.streamIdByKind.get(kind);
    if (sid) {
      this.streamIdByKind.delete(kind);
      this.kindByStreamId.delete(sid);
    }
    this.pc.removeTrack(sender);
  }

  setQuality(camera: string, screen: string): void {
    this.quality = { camera: camera || "auto", screen: screen || "auto" };
    this.applyQuality("camera");
    this.applyQuality("screen");
  }

  close(): void {
    for (const [t, fn] of this.sigHandlers) this.sig.off(t, fn);
    this.sigHandlers = [];
    this.closeExtras();
    this.pc.close();
  }

  // --- outbound ---

  private addLocal(track: TrackLike, kind: Kind) {
    const stream = this.deps.createStream([track]);
    const transceiver = this.pc.addTransceiver(track, { direction: "sendonly", streams: [stream] });
    if (track.kind === "video" && transceiver.setCodecPreferences) {
      const codecs = this.deps.videoCodecs();
      if (codecs && codecs.length) {
        try {
          transceiver.setCodecPreferences(preferVp8(codecs));
        } catch (err) {
          this.deps.log.warn("[peer] setCodecPreferences failed", err);
        }
      }
    }
    const prev = this.streamIdByKind.get(kind);
    if (prev) this.kindByStreamId.delete(prev);
    this.streamIdByKind.set(kind, stream.id);
    this.kindByStreamId.set(stream.id, kind);
    this.senders.set(kind, transceiver.sender);
    this.applyQuality(kind);
  }

  private applyQuality(kind: Kind): void {
    if (kind !== "camera" && kind !== "screen") return;
    const sender = this.senders.get(kind);
    if (!sender || !sender.track) return;
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) return; // not negotiated yet
    const enc = params.encodings[0];
    const h = sender.track.getSettings?.().height || 0;
    const caps: { scaleResolutionDownBy: number; maxFramerate?: number } = encodingCaps(qualityTier(this.quality[kind]), h);
    enc.scaleResolutionDownBy = caps.scaleResolutionDownBy;
    if (caps.maxFramerate) enc.maxFramerate = caps.maxFramerate;
    else delete enc.maxFramerate;
    sender.setParameters(params).catch((err) => this.deps.log.warn(`[quality] ${kind}: setParameters rejected`, err));
  }

  private reapplyQuality() {
    this.applyQuality("camera");
    this.applyQuality("screen");
  }

  private async makeOffer(): Promise<void> {
    if (this.makingOffer || this.pc.signalingState !== "stable") {
      this.negotiationPending = true;
      return;
    }
    this.negotiationPending = false;
    try {
      this.makingOffer = true;
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      this.sig.send("offer", { sdp: this.pc.localDescription!.sdp, kinds: Object.fromEntries(this.kindByStreamId) });
    } finally {
      this.makingOffer = false;
    }
  }

  private flushPendingOffer() {
    if (this.negotiationPending) this.makeOffer().catch((err) => this.emitError(err, "negotiation"));
  }

  // --- inbound signaling ---

  private async onRemoteOffer(msg: Frame) {
    const { action } = handleRemoteOffer({ makingOffer: this.makingOffer, signalingState: this.pc.signalingState });
    await this.pc.setRemoteDescription({ type: "offer", sdp: msg.sdp }); // implicit rollback on glare
    await this.drainCandidates();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.sig.send("answer", { sdp: this.pc.localDescription!.sdp });
    this.reapplyQuality();
    if (action === "rollback-then-answer") this.negotiationPending = true;
    this.flushPendingOffer();
  }

  private async onRemoteAnswer(msg: Frame) {
    await this.pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
    await this.drainCandidates();
    this.reapplyQuality();
    this.flushPendingOffer();
  }

  private async onRemoteCandidate(msg: Frame) {
    if (!msg.candidate) return;
    if (!this.pc.remoteDescription) {
      this.pendingCandidates.push(msg.candidate);
      return;
    }
    await this.pc.addIceCandidate(this.deps.createCandidate(msg.candidate));
  }

  private async drainCandidates() {
    const pending = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const c of pending) {
      try {
        await this.pc.addIceCandidate(this.deps.createCandidate(c));
      } catch (err) {
        this.emitError(err, "candidate");
      }
    }
  }

  // --- inbound media (Task 7) ---

  private onTracks(_msg: Frame) {}
  private onTrack(_ev: TrackEventLike) {}
  private closeExtras() {}

  private emitError(error: unknown, phase: string) {
    this.events.error({ error, phase });
  }
}
