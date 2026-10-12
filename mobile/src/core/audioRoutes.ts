// Audio outputs and microphones for the call's devices sheet. Android lists every
// output (each Bluetooth device by name on Android 9+); iOS reports only the current
// one, since choosing happens in Apple's route picker. Android's microphones follow
// the output (Telecom ties them together), so they are derived from it; iOS reports
// its own.
export type OutputKind = "earpiece" | "speaker" | "wired" | "bluetooth" | "car";

export interface Output {
  id: string;
  kind: OutputKind;
  name: string;
}

export type InputKind = "builtin" | "wired" | "bluetooth" | "usb";

export interface Input {
  id: string;
  kind: InputKind;
  name: string;
}

export interface Routes {
  outputs: Output[];
  selected: string; // an Output id; "" when unknown
  inputs: Input[];
  input: string; // an Input id; "" when unknown
}

export const NO_ROUTES: Routes = { outputs: [], selected: "", inputs: [], input: "" };

const KINDS: readonly string[] = ["earpiece", "speaker", "wired", "bluetooth", "car"];
const INPUT_KINDS: readonly string[] = ["builtin", "wired", "bluetooth", "usb"];

// A native CoyoteAudioRoutes payload, keeping only well-formed outputs and inputs.
export function parseRoutes(raw: unknown): Routes {
  const r = raw as { outputs?: unknown; selected?: unknown; inputs?: unknown; input?: unknown } | null | undefined;
  const outputs: Output[] = [];
  for (const o of wellFormed(r?.outputs, KINDS)) outputs.push({ id: o.id, kind: o.kind as OutputKind, name: o.name });
  const inputs: Input[] = [];
  for (const i of wellFormed(r?.inputs, INPUT_KINDS)) inputs.push({ id: i.id, kind: i.kind as InputKind, name: i.name });
  return {
    outputs,
    selected: typeof r?.selected === "string" ? r.selected : "",
    inputs,
    input: typeof r?.input === "string" ? r.input : "",
  };
}

function wellFormed(list: unknown, kinds: readonly string[]): Array<{ id: string; kind: string; name: string }> {
  const out: Array<{ id: string; kind: string; name: string }> = [];
  if (!Array.isArray(list)) return out;
  for (const o of list as Array<Record<string, unknown> | null>) {
    if (o && typeof o.id === "string" && o.id !== "" && typeof o.name === "string" && typeof o.kind === "string" && kinds.includes(o.kind)) {
      out.push({ id: o.id, kind: o.kind, name: o.name });
    }
  }
  return out;
}

export function selectedOutput(r: Routes): Output | null {
  return r.outputs.find((o) => o.id === r.selected) ?? null;
}

// Button text: the kind, since device names don't fit.
export function outputLabel(kind: OutputKind | undefined): string {
  switch (kind) {
    case "earpiece": return "Phone";
    case "speaker": return "Speaker";
    case "wired": return "Headset";
    case "bluetooth": return "Bluetooth";
    case "car": return "Car";
    default: return "Audio";
  }
}

const KIND_ORDER: OutputKind[] = ["earpiece", "speaker", "wired", "car", "bluetooth"];

export function sortOutputs(outputs: Output[]): Output[] {
  return [...outputs].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name));
}

const INPUT_ORDER: InputKind[] = ["builtin", "wired", "usb", "bluetooth"];

export function sortInputs(inputs: Input[]): Input[] {
  return [...inputs].sort((a, b) => INPUT_ORDER.indexOf(a.kind) - INPUT_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name));
}

const PHONE_MIC: Input = { id: "builtin", kind: "builtin", name: "Phone microphone" };

// Android: the mic each output brings — the built-in mic for earpiece and speaker,
// the headset's for wired, each Bluetooth device's own.
export function androidInputs(r: Routes): Routes {
  const inputs: Input[] = [PHONE_MIC];
  if (r.outputs.some((o) => o.kind === "wired")) inputs.push({ id: "wired", kind: "wired", name: "Headset microphone" });
  for (const o of r.outputs) if (o.kind === "bluetooth") inputs.push({ id: o.id, kind: "bluetooth", name: o.name });
  const sel = selectedOutput(r);
  const input = !sel ? "" : sel.kind === "bluetooth" ? sel.id : sel.kind === "wired" ? "wired" : "builtin";
  return { ...r, inputs, input };
}

// Android: the output to select for a mic pick, or null when nothing changes. The
// phone mic leaves a headset for the earpiece (audio-only) or the speaker (video).
export function outputForInput(r: Routes, inputId: string, video: boolean): string | null {
  if (inputId === r.input) return null;
  const first = (k: OutputKind) => r.outputs.find((o) => o.kind === k)?.id ?? null;
  if (inputId === "builtin") {
    const sel = selectedOutput(r);
    if (sel && (sel.kind === "earpiece" || sel.kind === "speaker")) return null;
    return (video ? null : first("earpiece")) ?? first("speaker");
  }
  if (inputId === "wired") return first("wired");
  return r.outputs.some((o) => o.kind === "bluetooth" && o.id === inputId) ? inputId : null;
}

// react-native-incall-manager (the Android fallback) names routes by type only.
const ICM_KINDS: Record<string, OutputKind> = {
  EARPIECE: "earpiece",
  SPEAKER_PHONE: "speaker",
  WIRED_HEADSET: "wired",
  BLUETOOTH: "bluetooth",
};

function icmKind(name: unknown): OutputKind | null {
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(ICM_KINDS, name) ? ICM_KINDS[name] : null;
}

// An incall-manager onAudioDeviceChanged event as Routes.
export function fromInCallManager(event: unknown): Routes {
  const e = event as { availableAudioDeviceList?: unknown; selectedAudioDevice?: unknown } | null | undefined;
  let names: unknown = [];
  try {
    names = JSON.parse(String(e?.availableAudioDeviceList ?? "[]"));
  } catch {
    names = [];
  }
  const outputs: Output[] = [];
  for (const n of Array.isArray(names) ? names : []) {
    const kind = icmKind(n);
    if (kind) outputs.push({ id: kind, kind, name: outputLabel(kind) });
  }
  return { outputs, selected: icmKind(e?.selectedAudioDevice) ?? "", inputs: [], input: "" };
}

export function toInCallManager(id: string): string | null {
  return Object.keys(ICM_KINDS).find((k) => ICM_KINDS[k] === id) ?? null;
}

// An output or microphone switch the user asked for and the system hasn't confirmed yet.
export const SWITCH_TIMEOUT_MS = 5000;

export interface Pending {
  id: string;
  name: string;
  at: number; // ms; 0 marks a switch the platform already rejected
  target: "output" | "input";
}

export type PendingOutcome = { kind: "done" } | { kind: "failed" } | { kind: "wait"; ms: number };

export function pendingOutcome(p: Pending, r: Routes, now: number): PendingOutcome {
  const current = p.target === "input" ? r.input : r.selected;
  const listed = p.target === "input" ? r.inputs.some((i) => i.id === p.id) : r.outputs.some((o) => o.id === p.id);
  if (current === p.id) return { kind: "done" };
  if (p.at === 0 || !listed) return { kind: "failed" };
  const ms = p.at + SWITCH_TIMEOUT_MS - now;
  return ms <= 0 ? { kind: "failed" } : { kind: "wait", ms };
}

// The pending switch for tapping `id`; null when there is nothing to do.
export function pickOutput(r: Routes, id: string, now: number): Pending | null {
  if (id === r.selected) return null;
  const o = r.outputs.find((x) => x.id === id);
  return o ? { id, name: o.name, at: now, target: "output" } : null;
}

export function pickInput(r: Routes, id: string, now: number): Pending | null {
  if (id === r.input) return null;
  const i = r.inputs.find((x) => x.id === id);
  return i ? { id, name: i.name, at: now, target: "input" } : null;
}
