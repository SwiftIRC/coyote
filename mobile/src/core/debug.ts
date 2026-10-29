// Debug mode: a hidden overlay over calls plus a text report a tester can share,
// so problems on phones we can't plug in (iOS especially) come back with logs
// instead of a description. Seven taps on Home's server line turns it on or off.
// Everything here stays in memory on the device until the user shares a report.

export const TAPS_TO_TOGGLE = 7;
const TAP_GAP_MS = 1500; // a slower tap starts the count again

// Counts quick taps on the hidden toggle; `fire` when the seventh lands.
export function countTap(prev: { n: number; at: number }, now: number): { n: number; at: number; fire: boolean } {
  const n = now - prev.at <= TAP_GAP_MS ? prev.n + 1 : 1;
  return n >= TAPS_TO_TOGGLE ? { n: 0, at: 0, fire: true } : { n, at: now, fire: false };
}

// "12:34:56.789" (UTC), short enough for the overlay.
export function clock(ms: number): string {
  return new Date(ms).toISOString().slice(11, 23);
}

// A capped list of timestamped lines, newest last.
export class Trail {
  private items: string[] = [];
  constructor(private max: number, private now: () => number = Date.now) {}

  add(line: string): void {
    this.items.push(`${clock(this.now())} ${line}`);
    if (this.items.length > this.max) this.items.splice(0, this.items.length - this.max);
  }

  lines(): string[] {
    return [...this.items];
  }
}

const ARG_MAX = 500;

export function formatArg(a: unknown): string {
  if (typeof a === "string") return a;
  if (a instanceof Error) return `${a.name}: ${a.message}`;
  try {
    const s = JSON.stringify(a);
    if (s === undefined) return String(a);
    return s.length > ARG_MAX ? `${s.slice(0, ARG_MAX)}…` : s;
  } catch {
    return String(a);
  }
}

type ConsoleLike = Record<"log" | "info" | "warn" | "error", (...a: unknown[]) => void>;

// Copies every console line into `trail` as well as printing it, so a report holds
// what the app logged before debug mode was even turned on. Returns an undo.
export function captureConsole(c: ConsoleLike, trail: Trail): () => void {
  const levels = ["log", "info", "warn", "error"] as const;
  const original = levels.map((l) => c[l]);
  levels.forEach((level, i) => {
    const print = original[i];
    c[level] = (...a: unknown[]) => {
      trail.add(`${level === "log" || level === "info" ? "" : `${level.toUpperCase()} `}${a.map(formatArg).join(" ")}`);
      print.apply(c, a);
    };
  });
  return () => levels.forEach((l, i) => { c[l] = original[i]; });
}

// One line per stream from a getStats() report: what arrived, what was sent, and the
// active candidate pair. `label` names a mid ("ab12:video") when the SFU said whose it is.
export function statsLines(stats: Iterable<Record<string, any>>, label: (mid: string) => string | undefined): string[] {
  const out: string[] = [];
  for (const r of stats) {
    if (r.type === "inbound-rtp") {
      const tag = (r.mid != null && label(String(r.mid))) || `mid${r.mid ?? "?"}`;
      const extra = r.kind === "video"
        ? ` dec ${r.framesDecoded ?? "?"} ${r.frameWidth ?? "?"}x${r.frameHeight ?? "?"}`
        : ` conc ${r.concealedSamples ?? "?"}`;
      out.push(`in ${tag} ${r.kind} pk ${r.packetsReceived ?? "?"} lost ${r.packetsLost ?? "?"}${extra}`);
    } else if (r.type === "outbound-rtp") {
      const size = r.kind === "video" ? ` ${r.frameWidth ?? "?"}x${r.frameHeight ?? "?"} lim ${r.qualityLimitationReason ?? "-"}` : "";
      out.push(`out ${r.kind} pk ${r.packetsSent ?? "?"}${size}`);
    } else if (r.type === "candidate-pair" && r.nominated) {
      out.push(`pair ${r.state} rtt ${r.currentRoundTripTime ?? "?"} in ${r.bytesReceived ?? "?"}B out ${r.bytesSent ?? "?"}B`);
    }
  }
  return out;
}

export type Section = [title: string, body: string | string[]];

// The shareable report: titled sections separated by blank lines, cut at `max`
// characters (Android's share intent fails outright past ~1 MB), so put the
// sections that matter most first.
export function formatReport(sections: Section[], max = Infinity): string {
  const text = sections
    .map(([title, body]) => `=== ${title}\n${Array.isArray(body) ? body.join("\n") : body}`)
    .join("\n\n");
  return text.length > max ? `${text.slice(0, max)}\n\n=== cut: the report was ${text.length} characters` : text;
}
