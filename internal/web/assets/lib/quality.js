// Session video-quality tiers, set by an op and applied by every client to its own
// camera / screenshare senders (scaleResolutionDownBy + maxFramerate + maxBitrate).
// height 0 / fps 0 / bitrate 0 means "no cap" (Auto). The id is what travels on the
// wire; the numbers stay client-side.
//
// The bitrate is what makes a tier look like its label. Without it the encoder climbs
// to the browser default (2.5 Mbps in Chrome) at any size, and 360p at 2.5 Mbps upscales
// into a tile almost lossless — Low looked like Auto and saved nothing. Ultra's ceiling
// is above that default so 1080p is not starved by it.
export const QUALITY_TIERS = [
  { id: "auto", label: "Auto", height: 0, fps: 0, bitrate: 0 },
  { id: "ultra", label: "Ultra — 1080p·30", height: 1080, fps: 30, bitrate: 4_000_000 },
  { id: "fast", label: "Fast — 720p·60", height: 720, fps: 60, bitrate: 2_500_000 },
  { id: "high", label: "High — 720p·30", height: 720, fps: 30, bitrate: 1_500_000 },
  { id: "medium", label: "Medium — 480p·24", height: 480, fps: 24, bitrate: 600_000 },
  { id: "low", label: "Low — 360p·15", height: 360, fps: 15, bitrate: 300_000 },
];

// Look up a tier by id; an unknown/empty id (including the server's default "") is Auto.
export function qualityTier(id) {
  return QUALITY_TIERS.find((t) => t.id === id) || QUALITY_TIERS[0];
}

// The RTCRtpEncodingParameters a tier implies for a source of `sourceHeight`
// pixels: {scaleResolutionDownBy, maxFramerate, maxBitrate}. maxFramerate and
// maxBitrate are undefined when the tier imposes no limit, because the caller must
// DELETE the key rather than set 0 — a maxFramerate of 0 is a request for no frames.
//
// scaleResolutionDownBy is a divisor applied to the source, not a target height, so
// it can only be computed from what the camera is actually producing. Two rules
// follow, and both are load-bearing:
//
//   Never below 1. Browsers reject or ignore an upscale, and a 480p camera asked
//   for 1080p has nothing to give — the divisor is 1 and the picture stays 480p.
//
//   An unknown source height caps the FRAMERATE anyway. The published camera track
//   is a canvas capture whenever a background effect runs, and a canvas track need
//   not report dimensions; abandoning both caps because one input is missing is
//   what makes a tier change look like it did nothing at all.
export function encodingCaps(tier, sourceHeight) {
  const h = Number(sourceHeight);
  const caps = { scaleResolutionDownBy: 1 };
  if (tier && tier.height > 0 && Number.isFinite(h) && h > 0) {
    caps.scaleResolutionDownBy = Math.max(1, h / tier.height);
  }
  if (tier && tier.fps > 0) caps.maxFramerate = tier.fps;
  if (tier && tier.bitrate > 0) caps.maxBitrate = tier.bitrate;
  return caps;
}

// The camera capture a tier needs: {width, height, frameRate} to request from
// getUserMedia. encodingCaps can only scale DOWN from the source, and a bare
// `video: true` opens most cameras at 640x480 — which made every tier above Medium a
// cap nobody could reach. So the capture is sized for the tier: 720p for Auto and
// everything up to High, 1080p for Ultra, and the tier's framerate when it asks for
// more than 30 (Fast). The camera may still deliver less; these are preferences.
export function captureTarget(tier) {
  const height = tier && tier.height > 720 ? 1080 : 720;
  const frameRate = Math.max(30, (tier && tier.fps) || 0);
  return { width: Math.round((height * 16) / 9), height, frameRate };
}
