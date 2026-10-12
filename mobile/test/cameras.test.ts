import { cameraFacing, parseCameras } from "../src/core/cameras";

test("parseCameras: Android's numbered cameras get names by facing, numbered when several", () => {
  expect(parseCameras([
    { deviceId: "0", kind: "videoinput", label: "0", facing: "environment" },
    { deviceId: "1", kind: "videoinput", label: "1", facing: "front" },
    { deviceId: "2", kind: "videoinput", label: "2", facing: "environment" },
    { deviceId: "audio-1", kind: "audioinput", label: "Audio" },
  ])).toEqual([
    { id: "1", facing: "front", name: "Front camera" },
    { id: "0", facing: "back", name: "Back camera" },
    { id: "2", facing: "back", name: "Back camera 2" },
  ]);
});

test("parseCameras: iOS names kept; front, then back, then others, platform order within each", () => {
  expect(parseCameras([
    { deviceId: "B1", kind: "videoinput", label: "Back Camera", facing: "environment" },
    { deviceId: "X", kind: "videoinput", label: "USB Camera", facing: "unknown" },
    { deviceId: "B2", kind: "videoinput", label: "Back Ultra Wide Camera", facing: "environment" },
    { deviceId: "F", kind: "videoinput", label: "Front Camera", facing: "front" },
  ]).map((c) => [c.id, c.facing, c.name])).toEqual([
    ["F", "front", "Front Camera"], ["B1", "back", "Back Camera"], ["B2", "back", "Back Ultra Wide Camera"], ["X", "other", "USB Camera"],
  ]);
});

test("parseCameras survives garbage", () => {
  expect(parseCameras(null)).toEqual([]);
  expect(parseCameras([null, 3, { kind: "videoinput" }, { kind: "videoinput", deviceId: "" }, { kind: "videoinput", deviceId: "7", facing: "user" }]))
    .toEqual([{ id: "7", facing: "front", name: "Front camera" }]);
});

test("cameraFacing maps to the call's facing", () => {
  expect(cameraFacing("front")).toBe("user");
  expect(cameraFacing("back")).toBe("environment");
  expect(cameraFacing("other")).toBe("environment");
});
