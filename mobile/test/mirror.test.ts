import { selfMirrored, toggleFlip } from "../src/core/mirror";

describe("selfMirrored", () => {
  it("mirrors the front camera and not the rear by default", () => {
    expect(selfMirrored("user", null, null)).toBe(true);
    expect(selfMirrored("environment", null, null)).toBe(false);
  });

  it("a press flips the current camera and a second press undoes it", () => {
    const f = toggleFlip("environment", "back0", null);
    expect(selfMirrored("environment", "back0", f)).toBe(true);
    expect(toggleFlip("environment", "back0", f)).toBeNull();
  });

  it("switching camera returns to that camera's default", () => {
    const f = toggleFlip("environment", null, null);
    expect(selfMirrored("user", null, f)).toBe(true);
    expect(selfMirrored("environment", "usb1", f)).toBe(false);
    expect(selfMirrored("environment", null, f)).toBe(true); // flipping back keeps it per camera
  });
});
