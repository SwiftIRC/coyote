import { mediaDevices, MediaStream, RTCIceCandidate, RTCPeerConnection, RTCRtpSender } from "react-native-webrtc";
import type { CameraChoice, MediaPort } from "../core/call";
import { parseCameras, type Camera } from "../core/cameras";
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

const CAMERA = { width: 1280, height: 720, frameRate: 30 };

function cameraConstraints(choice: CameraChoice) {
  return { ...CAMERA, facingMode: choice.facing, ...(choice.deviceId ? { deviceId: choice.deviceId } : {}) };
}

export const media: MediaPort = {
  getMic: () => firstTrack({ audio: true, video: false }),
  // deviceId wins over facingMode in react-native-webrtc on both platforms; for an
  // unknown id (a USB camera unplugged) it opens the facing instead, which the library
  // would otherwise default to the front camera.
  getCamera: (choice: CameraChoice) => firstTrack({ audio: false, video: cameraConstraints(choice) }),
  // applyConstraints switches the track's capturer to the other camera (Android's
  // CameraVideoCapturer.switchCamera, iOS restarts its capture session on the new
  // device). The full constraints go too: Android reads the size unconditionally.
  switchCamera: async (track: TrackLike, choice: CameraChoice) => {
    const t = track as TrackLike & { applyConstraints?(c: object): Promise<void> };
    if (!t.applyConstraints) return false;
    try {
      await t.applyConstraints(cameraConstraints(choice));
      return true;
    } catch {
      return false;
    }
  },
  createStream,
};

export async function listCameras(): Promise<Camera[]> {
  try {
    return parseCameras(await mediaDevices.enumerateDevices());
  } catch {
    return [];
  }
}
