import { mediaDevices, MediaStream, RTCIceCandidate, RTCPeerConnection, RTCRtpSender } from "react-native-webrtc";
import type { Facing, MediaPort } from "../core/call";
import type { CodecLike, PeerConnectionLike, StreamLike, TrackLike } from "../core/types";

// No ICE servers: the SFU advertises its public IP (spec, Global Constraints).
export function createPeerConnection(): PeerConnectionLike {
  return new RTCPeerConnection({ iceServers: [] }) as unknown as PeerConnectionLike;
}

export function createStream(tracks: TrackLike[]): StreamLike {
  return new MediaStream(tracks as any) as unknown as StreamLike;
}

export function createCandidate(init: unknown): unknown {
  return new RTCIceCandidate(init as any);
}

export function videoCodecs(): CodecLike[] | null {
  try {
    const caps = (RTCRtpSender as any).getCapabilities?.("video");
    return caps?.codecs ?? null;
  } catch {
    return null;
  }
}

async function firstTrack(constraints: object): Promise<TrackLike | null> {
  try {
    const stream = await mediaDevices.getUserMedia(constraints as any);
    return (stream.getTracks()[0] as unknown as TrackLike) || null;
  } catch {
    return null; // denied or no device: the call controller turns this into a notice
  }
}

export const media: MediaPort = {
  getMic: () => firstTrack({ audio: true, video: false }),
  getCamera: (facing: Facing) =>
    firstTrack({ audio: false, video: { facingMode: facing, width: 1280, height: 720, frameRate: 30 } }),
  createStream,
};
