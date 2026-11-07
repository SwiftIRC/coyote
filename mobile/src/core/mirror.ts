// Whether YOUR OWN self-view is mirrored. View-only: the video sent to the call is
// never flipped. A front camera gets a selfie flip, a rear camera none, and the
// self-view's mirror button inverts that for the camera it was pressed on —
// switching camera returns to that camera's default.
import type { Facing } from "./call";

export function cameraKey(facing: Facing, cameraId: string | null): string {
  return `${facing}:${cameraId ?? ""}`;
}

export function selfMirrored(facing: Facing, cameraId: string | null, flippedFor: string | null): boolean {
  const byDefault = facing === "user";
  return flippedFor === cameraKey(facing, cameraId) ? !byDefault : byDefault;
}

// The new flippedFor after a press: flip the current camera, or undo its flip.
export function toggleFlip(facing: Facing, cameraId: string | null, flippedFor: string | null): string | null {
  const k = cameraKey(facing, cameraId);
  return flippedFor === k ? null : k;
}
