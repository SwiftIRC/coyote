import { sha256 } from "js-sha256";

// SHA-256 hex of the normalized email. Only the hash is ever sent; the raw email
// stays on the device. Matches gravatarHash in internal/web/assets/lib/avatar.js.
export function gravatarHash(email: string): string {
  const normalized = (email || "").trim().toLowerCase();
  return normalized ? sha256(normalized) : "";
}
