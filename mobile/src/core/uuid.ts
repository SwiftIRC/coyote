// RFC 4122 version-4 UUID from an injected random source (Hermes has no
// crypto.randomUUID). Used for CallKit call ids and the per-call session nonce;
// the nonce only binds an invite to this call, it is not a credential.
export function uuidV4(random: () => number): string {
  const bytes = Array.from({ length: 16 }, () => Math.floor(random() * 256) & 0xff);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
