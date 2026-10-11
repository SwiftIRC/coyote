import { nextRoute, routeLabel } from "../src/core/audioRoutes";

test("cycles through available routes in a fixed order", () => {
  const available = ["SPEAKER_PHONE", "EARPIECE", "BLUETOOTH"];
  expect(nextRoute({ available, selected: "EARPIECE" })).toBe("SPEAKER_PHONE");
  expect(nextRoute({ available, selected: "SPEAKER_PHONE" })).toBe("BLUETOOTH");
  expect(nextRoute({ available, selected: "BLUETOOTH" })).toBe("EARPIECE");
  expect(nextRoute({ available, selected: "" })).toBe("EARPIECE");
});

test("nothing to switch to", () => {
  expect(nextRoute({ available: ["SPEAKER_PHONE"], selected: "SPEAKER_PHONE" })).toBeNull();
  expect(nextRoute({ available: [], selected: "" })).toBeNull();
});

test("labels", () => {
  expect(routeLabel("BLUETOOTH")).toBe("Bluetooth");
  expect(routeLabel("WIRED_HEADSET")).toBe("Headset");
  expect(routeLabel("SPEAKER_PHONE")).toBe("Speaker");
  expect(routeLabel("EARPIECE")).toBe("Phone");
  expect(routeLabel("???")).toBe("Audio");
});
