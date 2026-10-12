// The cameras the devices sheet lists, from react-native-webrtc's enumerateDevices.
// iOS names them ("Back Ultra Wide Camera"); Android only numbers them, so those get
// "Front camera" / "Back camera", numbered when a facing has several.
import type { Facing } from "./call";

export type CameraFacing = "front" | "back" | "other";

export interface Camera {
  id: string;
  facing: CameraFacing;
  name: string;
}

const ORDER: CameraFacing[] = ["front", "back", "other"];
const BASE: Record<CameraFacing, string> = { front: "Front camera", back: "Back camera", other: "Camera" };

function facingOf(f: unknown): CameraFacing {
  if (f === "front" || f === "user") return "front";
  if (f === "environment" || f === "back") return "back";
  return "other";
}

export function parseCameras(devices: unknown): Camera[] {
  const found: Array<{ id: string; facing: CameraFacing; label: string }> = [];
  for (const d of Array.isArray(devices) ? devices : []) {
    const r = d as Record<string, unknown> | null;
    if (!r || typeof r !== "object" || r.kind !== "videoinput" || typeof r.deviceId !== "string" || r.deviceId === "") continue;
    found.push({ id: r.deviceId, facing: facingOf(r.facing), label: typeof r.label === "string" ? r.label.trim() : "" });
  }
  found.sort((a, b) => ORDER.indexOf(a.facing) - ORDER.indexOf(b.facing)); // stable: platform order within a facing
  const counts: Partial<Record<CameraFacing, number>> = {};
  return found.map((c) => {
    if (c.label && !/^\d+$/.test(c.label)) return { id: c.id, facing: c.facing, name: c.label };
    const n = (counts[c.facing] = (counts[c.facing] ?? 0) + 1);
    return { id: c.id, facing: c.facing, name: n === 1 ? BASE[c.facing] : `${BASE[c.facing]} ${n}` };
  });
}

export function cameraFacing(f: CameraFacing): Facing {
  return f === "front" ? "user" : "environment";
}
