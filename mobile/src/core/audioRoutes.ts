// Audio outputs for the call's output picker. Android lists every output (each
// Bluetooth device by name on Android 9+); iOS reports only the current one, since
// choosing happens in Apple's route picker.
export type OutputKind = "earpiece" | "speaker" | "wired" | "bluetooth" | "car";

export interface Output {
  id: string;
  kind: OutputKind;
  name: string;
}

export interface Routes {
  outputs: Output[];
  selected: string; // an Output id; "" when unknown
}

export const NO_ROUTES: Routes = { outputs: [], selected: "" };

const KINDS: readonly string[] = ["earpiece", "speaker", "wired", "bluetooth", "car"];

// A native CoyoteAudioRoutes payload, keeping only well-formed outputs.
export function parseRoutes(raw: unknown): Routes {
  const r = raw as { outputs?: unknown; selected?: unknown } | null | undefined;
  const outputs: Output[] = [];
  if (r && Array.isArray(r.outputs)) {
    for (const o of r.outputs as Array<Record<string, unknown> | null>) {
      if (o && typeof o.id === "string" && o.id !== "" && typeof o.name === "string" && typeof o.kind === "string" && KINDS.includes(o.kind)) {
        outputs.push({ id: o.id, kind: o.kind as OutputKind, name: o.name });
      }
    }
  }
  return { outputs, selected: typeof r?.selected === "string" ? r.selected : "" };
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
  return { outputs, selected: icmKind(e?.selectedAudioDevice) ?? "" };
}

export function toInCallManager(id: string): string | null {
  return Object.keys(ICM_KINDS).find((k) => ICM_KINDS[k] === id) ?? null;
}

// A switch the user asked for and the system hasn't confirmed yet.
export const SWITCH_TIMEOUT_MS = 5000;

export interface Pending {
  id: string;
  name: string;
  at: number; // ms; 0 marks a switch the platform already rejected
}

export type PendingOutcome = { kind: "done" } | { kind: "failed" } | { kind: "wait"; ms: number };

export function pendingOutcome(p: Pending, r: Routes, now: number): PendingOutcome {
  if (r.selected === p.id) return { kind: "done" };
  if (p.at === 0 || !r.outputs.some((o) => o.id === p.id)) return { kind: "failed" };
  const ms = p.at + SWITCH_TIMEOUT_MS - now;
  return ms <= 0 ? { kind: "failed" } : { kind: "wait", ms };
}

// The pending switch for tapping `id`; null when there is nothing to do.
export function pickOutput(r: Routes, id: string, now: number): Pending | null {
  if (id === r.selected) return null;
  const o = r.outputs.find((x) => x.id === id);
  return o ? { id, name: o.name, at: now } : null;
}
