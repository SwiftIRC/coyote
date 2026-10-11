import { gravatarHash } from "../src/core/gravatar";

// Same vector as internal/web/test/avatar.test.js, so both clients hash identically.
test("matches the web client's SHA-256 vector and normalizes case/space", () => {
  const want = "84059b07d4be67b806386c0aad8070a23f18836bbaae342275dc0a83414c32ee";
  expect(gravatarHash("MyEmailAddress@example.com")).toBe(want);
  expect(gravatarHash("  MYEMAILADDRESS@EXAMPLE.COM  ")).toBe(want);
});

test("blank input is empty", () => {
  expect(gravatarHash("")).toBe("");
  expect(gravatarHash("   ")).toBe("");
});
