// Ported from internal/web/assets/ui/chat.js (DOM-bound there, so not importable).
// Keep the wording identical to the web client.

export function moderationText(m: { actor?: string; action?: string; target?: string; kind?: string }): string {
  const { actor, action, target, kind } = m;
  const who = actor || "someone";
  switch (action) {
    case "kick":
      return `${who} kicked ${target || "a participant"}`;
    case "ban":
      return `${who} banned ${target || "a participant"}`;
    case "mute":
      return kind ? `${who} muted ${target || "a participant"} (${kind})` : `${who} muted ${target || "a participant"}`;
    case "lock":
      return `${who} locked the room`;
    case "unlock":
      return `${who} unlocked the room`;
    case "op":
      return `${who} made ${target || "a participant"} an op`;
    case "quality": {
      const tier = !kind || kind === "auto" ? "Auto" : kind.charAt(0).toUpperCase() + kind.slice(1);
      return `${who} set ${target || "video"} quality to ${tier}`;
    }
    case "poll-open":
      return `${who} started a poll`;
    case "poll-close":
      return `${who} closed the poll`;
    default:
      return target ? `${who} ${action || "acted on"} ${target}` : `${who} ${action || "acted"}`;
  }
}

// Local HH:MM for a unix-seconds timestamp; a missing or zero ts uses nowMs.
export function hhmm(tsSeconds: number, nowMs: number): string {
  const d = Number.isFinite(tsSeconds) && tsSeconds > 0 ? new Date(tsSeconds * 1000) : new Date(nowMs);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
