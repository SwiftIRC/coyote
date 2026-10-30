import { Platform, Share } from "react-native";
import { captureConsole, formatReport, Trail, type Section } from "../core/debug";
import { APP_BUILD, APP_VERSION } from "../version";

// Everything the app logs, newest 400 lines, kept in memory for debug reports.
const logTrail = new Trail(400);
// react-native-webrtc logs every getStats() call, and the debug overlay makes one a
// second; kept, they'd push everything else out of the log.
const NOISE = /^rn-webrtc:pc:DEBUG \d+ getStats\b/;

type CallReport = { summary: Section[]; detail: Section[] };
// The last call's report, written as it ended, for a report shared from Home.
let lastCall: CallReport | null = null;

// Called once at startup (index.js), before anything logs.
export function installDebugCapture(): void {
  captureConsole(console as unknown as Parameters<typeof captureConsole>[0], logTrail, NOISE);
}

// Called as a call ends (CallContext), while its peer's history is still at hand.
export function rememberEndedCall(call: { debugReport(): Promise<CallReport> }): void {
  call.debugReport()
    .then((r) => { lastCall = r; })
    .catch((e) => console.warn("saving the call's debug report failed", e));
}

function deviceLines(): string[] {
  const c = Platform.constants as Record<string, unknown>;
  const device = Platform.OS === "android"
    ? `Android ${c.Release ?? Platform.Version} (API ${Platform.Version}) ${c.Manufacturer ?? ""} ${c.Model ?? ""}`
    : `${c.systemName ?? "iOS"} ${c.osVersion ?? Platform.Version} ${c.interfaceIdiom ?? ""}`;
  return [`Coyote ${APP_VERSION} (build ${APP_BUILD})`, device.trim(), `report ${new Date().toISOString()}`];
}

const REPORT_MAX = 200_000; // characters; Android's share intent fails outright past ~1 MB

// Opens the share sheet with a report: the app and device, a call's summary (the
// live call's, or from Home the last one's), the recent log, then the call's bulky
// detail (cut first if the report is too long).
export function shareDebugReport(call: CallReport | null = lastCall): Promise<unknown> {
  call = call ?? { summary: [], detail: [] };
  const message = formatReport([["app", deviceLines()], ...call.summary, ["log", logTrail.lines()], ...call.detail], REPORT_MAX);
  return Share.share({ message, title: "Coyote debug report" });
}
