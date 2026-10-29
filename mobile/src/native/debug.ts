import { Platform, Share } from "react-native";
import { captureConsole, formatReport, Trail, type Section } from "../core/debug";
import { APP_BUILD, APP_VERSION } from "../version";

// Everything the app logs, newest 400 lines, kept in memory for debug reports.
const logTrail = new Trail(400);

// Called once at startup (index.js), before anything logs.
export function installDebugCapture(): void {
  captureConsole(console as unknown as Parameters<typeof captureConsole>[0], logTrail);
}

function deviceLines(): string[] {
  const c = Platform.constants as Record<string, unknown>;
  const device = Platform.OS === "android"
    ? `Android ${c.Release ?? Platform.Version} (API ${Platform.Version}) ${c.Manufacturer ?? ""} ${c.Model ?? ""}`
    : `${c.systemName ?? "iOS"} ${c.osVersion ?? Platform.Version} ${c.interfaceIdiom ?? ""}`;
  return [`Coyote ${APP_VERSION} (build ${APP_BUILD})`, device.trim(), `report ${new Date().toISOString()}`];
}

const REPORT_MAX = 200_000; // characters; Android's share intent fails outright past ~1 MB

// Opens the share sheet with a report: the app and device, a call's summary when
// there is one, the recent log, then the call's bulky detail (cut first if too long).
export function shareDebugReport(call: { summary: Section[]; detail: Section[] } = { summary: [], detail: [] }): Promise<unknown> {
  const message = formatReport([["app", deviceLines()], ...call.summary, ["log", logTrail.lines()], ...call.detail], REPORT_MAX);
  return Share.share({ message, title: "Coyote debug report" });
}
