import {
  NO_ROUTES, SWITCH_TIMEOUT_MS, androidInputs, fromInCallManager, outputForInput, outputLabel, parseRoutes, pendingOutcome,
  pickInput, pickOutput, selectedOutput, sortInputs, sortOutputs, toInCallManager, type Input, type Routes,
} from "../src/core/audioRoutes";

const buds = { id: "bt:AA", kind: "bluetooth" as const, name: "Galaxy Buds3 Pro" };
const car = { id: "bt:BB", kind: "bluetooth" as const, name: "Car" };
const phone = { id: "earpiece", kind: "earpiece" as const, name: "Phone" };
const speaker = { id: "speaker", kind: "speaker" as const, name: "Speaker" };
const routes: Routes = { outputs: [buds, speaker, car, phone], selected: "speaker", inputs: [], input: "" };

test("parseRoutes keeps well-formed outputs and drops the rest", () => {
  expect(parseRoutes({
    outputs: [buds, { id: "", kind: "speaker", name: "x" }, { id: "y", kind: "hdmi", name: "TV" }, { id: "z", kind: "wired" }, null, 3],
    selected: "bt:AA",
  })).toEqual({ outputs: [buds], selected: "bt:AA", inputs: [], input: "" });
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
    inputs: [],
    input: "",
  });
});

test("fromInCallManager survives garbage and never trusts inherited names", () => {
  expect(fromInCallManager({ availableAudioDeviceList: "{not json", selectedAudioDevice: "toString" })).toEqual(NO_ROUTES);
  expect(fromInCallManager({ availableAudioDeviceList: '["constructor","WIRED_HEADSET",7]', selectedAudioDevice: "" })).toEqual({
    outputs: [{ id: "wired", kind: "wired", name: "Headset" }], selected: "", inputs: [], input: "",
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
  expect(pickOutput(routes, "bt:AA", 100)).toEqual({ id: "bt:AA", name: "Galaxy Buds3 Pro", at: 100, target: "output" });
  expect(pickOutput(routes, "speaker", 100)).toBeNull(); // already selected
  expect(pickOutput(routes, "bt:ZZ", 100)).toBeNull(); // vanished while the sheet was open
});

test("pendingOutcome: done when selected, failed when gone or timed out, else wait", () => {
  const p = { id: "bt:AA", name: "Galaxy Buds3 Pro", at: 1000, target: "output" as const };
  expect(pendingOutcome(p, { ...routes, selected: "bt:AA" }, 1200)).toEqual({ kind: "done" });
  expect(pendingOutcome(p, { outputs: [speaker], selected: "speaker", inputs: [], input: "" }, 1200)).toEqual({ kind: "failed" });
  expect(pendingOutcome(p, routes, 1200)).toEqual({ kind: "wait", ms: SWITCH_TIMEOUT_MS - 200 });
  expect(pendingOutcome(p, routes, 1000 + SWITCH_TIMEOUT_MS)).toEqual({ kind: "failed" });
  expect(pendingOutcome({ ...p, at: 0 }, routes, 1200)).toEqual({ kind: "failed" }); // rejected select (Task 6)
});

const wired = { id: "wired", kind: "wired" as const, name: "Headset" };
const PHONE_MIC = { id: "builtin", kind: "builtin", name: "Phone microphone" };

test("parseRoutes keeps well-formed inputs; a payload without inputs has none", () => {
  const mic = { id: "m1", kind: "builtin", name: "iPhone Microphone" };
  expect(parseRoutes({
    outputs: [speaker], selected: "speaker",
    inputs: [mic, { id: "", kind: "usb", name: "x" }, { id: "m2", kind: "hdmi", name: "y" }, null], input: "m1",
  })).toEqual({ outputs: [speaker], selected: "speaker", inputs: [mic], input: "m1" });
  expect(parseRoutes({ outputs: [speaker], selected: "speaker" })).toEqual({ outputs: [speaker], selected: "speaker", inputs: [], input: "" });
});

test("androidInputs: phone mic always, headset mic with a wired output, one per Bluetooth device; follows the output", () => {
  const r = androidInputs({ outputs: [phone, speaker, wired, buds, car], selected: "bt:AA", inputs: [], input: "" });
  expect(r.inputs).toEqual([
    PHONE_MIC,
    { id: "wired", kind: "wired", name: "Headset microphone" },
    { id: "bt:AA", kind: "bluetooth", name: "Galaxy Buds3 Pro" },
    { id: "bt:BB", kind: "bluetooth", name: "Car" },
  ]);
  expect(r.input).toBe("bt:AA");
  expect(androidInputs({ ...r, selected: "wired" }).input).toBe("wired");
  expect(androidInputs({ ...r, selected: "speaker" }).input).toBe("builtin");
  expect(androidInputs({ ...r, selected: "earpiece" }).input).toBe("builtin");
  expect(androidInputs(NO_ROUTES)).toEqual({ ...NO_ROUTES, inputs: [PHONE_MIC], input: "" });
});

test("outputForInput: Bluetooth and headset mics select their output; the phone mic leaves a headset by the starting rule", () => {
  const r = androidInputs({ outputs: [phone, speaker, wired, buds], selected: "bt:AA", inputs: [], input: "" });
  expect(outputForInput(r, "bt:AA", false)).toBeNull();
  expect(outputForInput(r, "wired", false)).toBe("wired");
  expect(outputForInput(r, "builtin", false)).toBe("earpiece");
  expect(outputForInput(r, "builtin", true)).toBe("speaker");
  const noEarpiece = androidInputs({ outputs: [speaker, buds], selected: "bt:AA", inputs: [], input: "" });
  expect(outputForInput(noEarpiece, "builtin", false)).toBe("speaker");
  const onSpeaker = androidInputs({ ...r, selected: "speaker" });
  expect(outputForInput(onSpeaker, "builtin", false)).toBeNull();
  expect(outputForInput(onSpeaker, "bt:AA", false)).toBe("bt:AA");
  expect(outputForInput(onSpeaker, "bt:ZZ", false)).toBeNull();
});

test("sortInputs: built-in, wired, USB, then Bluetooth by name; input untouched", () => {
  const ins: Input[] = [
    { id: "b2", kind: "bluetooth", name: "Zeta" }, { id: "u", kind: "usb", name: "USB Mic" },
    { id: "b1", kind: "bluetooth", name: "AirPods" }, { id: "w", kind: "wired", name: "Headset Mic" },
    { id: "m", kind: "builtin", name: "iPhone Microphone" },
  ];
  expect(sortInputs(ins).map((i) => i.id)).toEqual(["m", "w", "u", "b1", "b2"]);
  expect(ins[0].id).toBe("b2");
});

test("pickInput and pendingOutcome follow the input for a mic switch", () => {
  const r = androidInputs({ outputs: [phone, speaker, buds], selected: "speaker", inputs: [], input: "" });
  expect(pickInput(r, "builtin", 10)).toBeNull();
  expect(pickInput(r, "nope", 10)).toBeNull();
  const p = pickInput(r, "bt:AA", 10)!;
  expect(p).toEqual({ id: "bt:AA", name: "Galaxy Buds3 Pro", at: 10, target: "input" });
  expect(pendingOutcome(p, r, 20)).toEqual({ kind: "wait", ms: SWITCH_TIMEOUT_MS - 10 });
  expect(pendingOutcome(p, androidInputs({ ...r, selected: "bt:AA" }), 20)).toEqual({ kind: "done" });
  expect(pendingOutcome(p, androidInputs({ ...r, outputs: [phone, speaker] }), 20)).toEqual({ kind: "failed" });
});
