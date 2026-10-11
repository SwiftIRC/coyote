import { nickFromToken } from "../src/core/token";

// Node global under Jest; the app tsconfig does not include @types/node.
declare const Buffer: { from(s: string, enc: "utf8"): { toString(enc: "base64"): string } };

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/[=]+$/, "");

test("reads the n claim without verifying", () => {
  expect(nickFromToken(`${b64url(JSON.stringify({ n: "Ryan", r: "x" }))}.sig`)).toBe("Ryan");
});

test("handles non-ASCII nicks", () => {
  expect(nickFromToken(`${b64url(JSON.stringify({ n: "Zoë🚀" }))}.sig`)).toBe("Zoë🚀");
});

test.each(["", "garbage", "!!!.x", `${b64url("not json")}.x`, `${b64url(JSON.stringify({ n: 5 }))}.x`])(
  "returns empty for %p", (t) => expect(nickFromToken(t)).toBe(""),
);
