// The browser client's DOM-free modules, shared rather than copied so the two
// clients cannot drift on wire encoding, negotiation, backoff or error handling.
// Only import modules listed as pure in the Foundation spec; anything touching the
// DOM, storage or browser media APIs must not be added here.
export { encode, decode, parseInvite, parseToken } from "../../../internal/web/assets/lib/protocol.js";
export { backoffDelay } from "../../../internal/web/assets/lib/backoff.js";
export { handleRemoteOffer } from "../../../internal/web/assets/lib/negotiation.js";
export { serverErrorDisposition } from "../../../internal/web/assets/lib/serverError.js";
export { QUALITY_TIERS, qualityTier, encodingCaps } from "../../../internal/web/assets/lib/quality.js";
export { stacksNarrow } from "../../../internal/web/assets/lib/gridLayout.js";
// avatar.js also has DOM helpers, but only inside functions we never call.
export { avatarFor, gravatarUrl, IRC_AVATAR_COLORS } from "../../../internal/web/assets/lib/avatar.js";
export { linkSegments } from "../../../internal/web/assets/lib/linkify.js";
export { formatDuration } from "../../../internal/web/assets/lib/duration.js";
export { Presence } from "../../../internal/web/assets/lib/presence.js";
export { totalVotes, tallyPercents } from "../../../internal/web/assets/lib/poll.js";
export { normalizeBoard, boardButtonState } from "../../../internal/web/assets/lib/soundboard.js";
