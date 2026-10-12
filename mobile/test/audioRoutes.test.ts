import {
  NO_ROUTES, SWITCH_TIMEOUT_MS, fromInCallManager, outputLabel, parseRoutes, pendingOutcome, pickOutput,
  selectedOutput, sortOutputs, toInCallManager, type Routes,
} from "../src/core/audioRoutes";

const buds = { id: "bt:AA", kind: "bluetooth" as const, name: "Galaxy Buds3 Pro" };
const car = { id: "bt:BB", kind: "bluetooth" as const, name: "Car" };
const phone = { id: "earpiece", kind: "earpiece" as const, name: "Phone" };
const speaker = { id: "speaker", kind: "speaker" as const, name: "Speaker" };
const routes: Routes = { outputs: [buds, speaker, car, phone], selected: "speaker" };

test("parseRoutes keeps well-formed outputs and drops the rest", () => {
  expect(parseRoutes({
    outputs: [buds, { id: "", kind: "speaker", name: "x" }, { id: "y", kind: "hdmi", name: "TV" }, { id: "z", kind: "wired" }, null, 3],
    selected: "bt:AA",
  })).toEqual({ outputs: [buds], selected: "bt:AA" });
  expect(parseRoutes(null)).toEqual(NO_ROUTES);
  expect(parseRoutes({ outputs: "nope", selected: 4 })).toEqual(NO_ROUTES);
});

test("selectedOutput finds the selected output, or null", () => {
  expect(selectedOutput(routes)).toBe(speaker);
  expect(selectedOutput({ ...routes, selected: "gone" })).toBeNull();
  expect(selectedOutput(NO_ROUTES)).toBeNull();
});

test("outputLabel names each kind for the button", () => {
  expect(outputLabel("earpiece")).toBe("Phone");
  expect(outputLabel("speaker")).toBe("Speaker");
  expect(outputLabel("wired")).toBe("Headset");
  expect(outputLabel("bluetooth")).toBe("Bluetooth");
  expect(outputLabel("car")).toBe("Car");
  expect(outputLabel(undefined)).toBe("Audio");
});

test("sortOutputs: built-in first, then wired, then Bluetooth by name; input untouched", () => {
  const wired = { id: "wired", kind: "wired" as const, name: "Headset" };
  const input = [buds, wired, speaker, car, phone];
  expect(sortOutputs(input).map((o) => o.id)).toEqual(["earpiece", "speaker", "wired", "bt:BB", "bt:AA"]);
  expect(input[0]).toBe(buds);
});

test("fromInCallManager maps the fallback's route types", () => {
  expect(fromInCallManager({ availableAudioDeviceList: '["SPEAKER_PHONE","EARPIECE","BLUETOOTH"]', selectedAudioDevice: "BLUETOOTH" })).toEqual({
    outputs: [
      { id: "speaker", kind: "speaker", name: "Speaker" },
      { id: "earpiece", kind: "earpiece", name: "Phone" },
      { id: "bluetooth", kind: "bluetooth", name: "Bluetooth" },
    ],
    selected: "bluetooth",
  });
});

test("fromInCallManager survives garbage and never trusts inherited names", () => {
  expect(fromInCallManager({ availableAudioDeviceList: "{not json", selectedAudioDevice: "toString" })).toEqual(NO_ROUTES);
  expect(fromInCallManager({ availableAudioDeviceList: '["constructor","WIRED_HEADSET",7]', selectedAudioDevice: "" })).toEqual({
    outputs: [{ id: "wired", kind: "wired", name: "Headset" }], selected: "",
  });
  expect(fromInCallManager(undefined)).toEqual(NO_ROUTES);
});

test("toInCallManager maps ids back to route types", () => {
  expect(toInCallManager("speaker")).toBe("SPEAKER_PHONE");
  expect(toInCallManager("earpiece")).toBe("EARPIECE");
  expect(toInCallManager("wired")).toBe("WIRED_HEADSET");
  expect(toInCallManager("bluetooth")).toBe("BLUETOOTH");
  expect(toInCallManager("bt:AA")).toBeNull();
  expect(toInCallManager("constructor")).toBeNull();
});

test("pickOutput: a pending switch for another listed output, else null", () => {
  expect(pickOutput(routes, "bt:AA", 100)).toEqual({ id: "bt:AA", name: "Galaxy Buds3 Pro", at: 100 });
  expect(pickOutput(routes, "speaker", 100)).toBeNull(); // already selected
  expect(pickOutput(routes, "bt:ZZ", 100)).toBeNull(); // vanished while the sheet was open
});

test("pendingOutcome: done when selected, failed when gone or timed out, else wait", () => {
  const p = { id: "bt:AA", name: "Galaxy Buds3 Pro", at: 1000 };
  expect(pendingOutcome(p, { ...routes, selected: "bt:AA" }, 1200)).toEqual({ kind: "done" });
  expect(pendingOutcome(p, { outputs: [speaker], selected: "speaker" }, 1200)).toEqual({ kind: "failed" });
  expect(pendingOutcome(p, routes, 1200)).toEqual({ kind: "wait", ms: SWITCH_TIMEOUT_MS - 200 });
  expect(pendingOutcome(p, routes, 1000 + SWITCH_TIMEOUT_MS)).toEqual({ kind: "failed" });
  expect(pendingOutcome({ ...p, at: 0 }, routes, 1200)).toEqual({ kind: "failed" }); // rejected select (Task 6)
});
