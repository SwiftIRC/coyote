// The react-native-webrtc glue's camera constraints, with the library mocked.
export {}; // a module, so its helpers don't collide with other script-style tests

function load() {
  jest.resetModules();
  const getUserMedia = jest.fn(async (_c: unknown) => ({ getTracks: () => [{ id: "t1", kind: "video" }] }));
  jest.doMock("react-native-webrtc", () => ({
    mediaDevices: { getUserMedia, enumerateDevices: jest.fn(async () => []) },
    MediaStream: class {}, RTCIceCandidate: class {}, RTCPeerConnection: class {}, RTCRtpSender: class {},
  }));
  let mod: typeof import("../src/native/webrtc") | undefined;
  jest.isolateModules(() => {
    mod = require("../src/native/webrtc");
  });
  return { mod: mod!, getUserMedia };
}

// react-native-webrtc fills in facingMode "user" when it's missing, and both native
// sides fall back to that facing for an unknown deviceId: a picked camera that's gone
// must fall back to its own facing, not the front camera.
test("a camera picked by id also carries its facing", async () => {
  const t = load();
  await t.mod.media.getCamera({ facing: "environment", deviceId: "2" });
  expect(t.getUserMedia).toHaveBeenCalledWith(expect.objectContaining({
    video: expect.objectContaining({ deviceId: "2", facingMode: "environment" }),
  }));
});

test("a camera by facing has no deviceId", async () => {
  const t = load();
  await t.mod.media.getCamera({ facing: "user" });
  const video = (t.getUserMedia.mock.calls[0][0] as { video: Record<string, unknown> }).video;
  expect(video.facingMode).toBe("user");
  expect(video).not.toHaveProperty("deviceId");
});

// Switching keeps the capture size: Android's applyConstraints reads width, height and
// frameRate unconditionally, and both sides would otherwise reset them to defaults.
test("switchCamera re-points the live track with the full camera constraints", async () => {
  const t = load();
  const applyConstraints = jest.fn(async (_c: unknown) => {});
  const ok = await t.mod.media.switchCamera({ id: "t1", kind: "video", applyConstraints } as never, { facing: "environment", deviceId: "2" });
  expect(ok).toBe(true);
  expect(applyConstraints).toHaveBeenCalledWith({ width: 1280, height: 720, frameRate: 30, facingMode: "environment", deviceId: "2" });
  expect(t.getUserMedia).not.toHaveBeenCalled();
});

test("switchCamera by facing has no deviceId; a rejected switch is false", async () => {
  const t = load();
  const applyConstraints = jest.fn(async (_c: unknown) => {});
  await t.mod.media.switchCamera({ id: "t1", kind: "video", applyConstraints } as never, { facing: "user" });
  expect(applyConstraints.mock.calls[0][0]).not.toHaveProperty("deviceId");
  const failing = { id: "t2", kind: "video", applyConstraints: async () => { throw new Error("Error switching camera"); } };
  expect(await t.mod.media.switchCamera(failing as never, { facing: "user" })).toBe(false);
  expect(await t.mod.media.switchCamera({ id: "t3", kind: "video" } as never, { facing: "user" })).toBe(false);
});
