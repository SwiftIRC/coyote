import { joinErrorText, inCallErrorText } from "../src/core/errors";

test.each([
  ["bad-password", "Wrong password for this room."],
  ["banned", "You are banned from this room."],
  ["identified-only", "This room is for registered nicks only — join with an invite from !vc."],
  ["not-provisioned", "This room isn't active. Run !vc in its channel to open it."],
  ["token-invalid", "Your invite link is invalid."],
  ["token-expired", "Your invite link has expired — run !vc again for a fresh one."],
  ["protocol", "The server rejected the join request."],
  ["media", "The server could not set up media for this room."],
])("join error %s", (code, text) => {
  expect(joinErrorText(code, "dev message")).toBe(text);
});

test("unknown codes fall back to the server message, then a generic line", () => {
  expect(joinErrorText("weird", "server said")).toBe("server said");
  expect(joinErrorText("weird")).toBe("Something went wrong.");
});

test("in-call wording comes from the shared disposition", () => {
  expect(inCallErrorText("no-such-peer", "x")).toBe("They already left the call.");
  expect(inCallErrorText("other", "")).toBe("That action was refused.");
});
