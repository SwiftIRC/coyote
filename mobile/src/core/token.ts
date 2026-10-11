// nickFromToken reads the display name from a #t= token WITHOUT verifying it
// (prefill/lock convenience only; the server verifies on join). Port of
// nickFromToken in internal/web/assets/ui/prejoin.js, without atob/TextDecoder.
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function base64urlToBytes(s: string): number[] | null {
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of s) {
    const v = B64.indexOf(ch);
    if (v < 0) return null;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return out;
}

function utf8Decode(bytes: number[]): string {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i++];
    let cp: number;
    if (b < 0x80) cp = b;
    else if (b >= 0xf0) cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    else if (b >= 0xe0) cp = ((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    else cp = ((b & 0x1f) << 6) | (bytes[i++] & 0x3f);
    out += String.fromCodePoint(cp);
  }
  return out;
}

export function nickFromToken(token: string): string {
  const seg = (token || "").split(".")[0];
  if (!seg) return "";
  const bytes = base64urlToBytes(seg);
  if (!bytes) return "";
  try {
    const claims = JSON.parse(utf8Decode(bytes));
    return typeof claims?.n === "string" ? claims.n : "";
  } catch {
    return "";
  }
}
