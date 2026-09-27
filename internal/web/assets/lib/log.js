// Timestamped console logging for the client.
//
// The server's slog lines already carry a clock (2026/09/26 18:09:04 ERROR ...), so
// giving the browser's lines one too is what lets the two be laid side by side —
// which is the whole point when a media problem could be either end.
//
// The methods are GETTERS returning a BOUND console method rather than wrapper
// functions, and that is the load-bearing detail. Devtools attributes a console line
// to whatever function called console, so a wrapper would point every line at this
// file instead of the code that logged it — costing more debuggability than the
// timestamps buy. A bound console.info is still console.info, so the source link
// stays honest. Binding happens on property access, immediately before the call, so
// the timestamp is current rather than frozen when this module was imported.

const pad = (n, width = 2) => String(n).padStart(width, "0");

// Local wall-clock time as HH:MM:SS.mmm. Local, not UTC, to match what the browser
// shows elsewhere; milliseconds because WebRTC negotiation happens inside a second.
export function stamp(d = new Date()) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export const log = {
  get debug() {
    return console.debug.bind(console, stamp());
  },
  get info() {
    return console.info.bind(console, stamp());
  },
  get warn() {
    return console.warn.bind(console, stamp());
  },
  get error() {
    return console.error.bind(console, stamp());
  },
};
