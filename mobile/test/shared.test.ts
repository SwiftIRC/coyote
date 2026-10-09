import {
  encode, decode, parseInvite, parseToken, backoffDelay, handleRemoteOffer,
  serverErrorDisposition, qualityTier, encodingCaps, stacksNarrow, avatarFor, gravatarUrl,
} from "../src/shared/web";

test("the web client's pure modules load under Jest", () => {
  expect(decode(encode("join", { name: "a" }))).toEqual({ type: "join", name: "a" });
  expect(parseInvite("#i=abc")).toBe("abc");
  expect(parseToken("#t=x.y")).toBe("x.y");
  expect(backoffDelay(0)).toBe(500);
  expect(backoffDelay(10)).toBe(10000);
  expect(handleRemoteOffer({ makingOffer: true, signalingState: "stable" }).action).toBe("rollback-then-answer");
  expect(serverErrorDisposition({ code: "x", message: "m", inCall: false }).fatal).toBe(true);
  expect(encodingCaps(qualityTier("low"), 720).scaleResolutionDownBy).toBe(2);
  expect(stacksNarrow(400, 800, 3)).toBe(true);
  expect(avatarFor("bob").initial).toBe("B");
  expect(gravatarUrl("nope", 10)).toBe("");
});
