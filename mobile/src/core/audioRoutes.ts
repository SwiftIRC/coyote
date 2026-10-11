// Android audio routes as react-native-incall-manager names them.
const ORDER = ["EARPIECE", "SPEAKER_PHONE", "BLUETOOTH", "WIRED_HEADSET"];

export interface AudioRoutes {
  available: string[];
  selected: string;
}

// The route after `selected` among those available, in a fixed order; null when
// there is nothing else to switch to.
export function nextRoute(r: AudioRoutes): string | null {
  const avail = ORDER.filter((x) => r.available.includes(x));
  if (avail.length === 0) return null;
  const i = avail.indexOf(r.selected);
  if (i === -1) return avail[0];
  if (avail.length === 1) return null;
  return avail[(i + 1) % avail.length];
}

export function routeLabel(route: string): string {
  switch (route) {
    case "BLUETOOTH": return "Bluetooth";
    case "WIRED_HEADSET": return "Headset";
    case "SPEAKER_PHONE": return "Speaker";
    case "EARPIECE": return "Phone";
    default: return "Audio";
  }
}
