import { serverErrorDisposition } from "../shared/web";

// Join-reject wording, copied from ERROR_TEXT in internal/web/assets/ui/prejoin.js
// (that module is DOM code and cannot be imported). Keep the two in step.
const JOIN_ERROR_TEXT: Record<string, string> = {
  "bad-password": "Wrong password for this room.",
  banned: "You are banned from this room.",
  "identified-only": "This room is for registered nicks only — join with an invite from !vc.",
  "not-provisioned": "This room isn't active. Run !vc in its channel to open it.",
  "token-invalid": "Your invite link is invalid.",
  "token-expired": "Your invite link has expired — run !vc again for a fresh one.",
  protocol: "The server rejected the join request.",
  media: "The server could not set up media for this room.",
};

export function joinErrorText(code: string, message = ""): string {
  return JOIN_ERROR_TEXT[code] || serverErrorDisposition({ code, message, inCall: false }).text;
}

export function inCallErrorText(code: string, message = ""): string {
  return serverErrorDisposition({ code, message, inCall: true }).text;
}
