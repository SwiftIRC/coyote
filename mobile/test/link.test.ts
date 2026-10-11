import { parseRoomInput, wsUrl, isDefaultHost, DEFAULT_HOST } from "../src/core/link";

test("bare room name joins on the default host", () => {
  expect(parseRoomInput("  Lounge ")).toEqual({
    origin: "https://vc.swiftirc.net", host: DEFAULT_HOST, slug: "lounge", invite: "", token: "",
  });
});

test("full link with invite", () => {
  const l = parseRoomInput("https://vc.swiftirc.net/Chat/#i=abc123");
  expect(l).toEqual({ origin: "https://vc.swiftirc.net", host: "vc.swiftirc.net", slug: "chat", invite: "abc123", token: "" });
});

test("token link; invite wins when both present", () => {
  expect(parseRoomInput("https://vc.swiftirc.net/x#t=aa.bb")!.token).toBe("aa.bb");
  const both = parseRoomInput("https://vc.swiftirc.net/x#t=aa.bb&i=zz")!;
  expect(both.invite).toBe("zz");
  expect(both.token).toBe("");
});

test("query string is ignored; other hosts and http are allowed", () => {
  expect(parseRoomInput("https://vc.swiftirc.net/x?utm=1#i=q")!.invite).toBe("q");
  const other = parseRoomInput("http://localhost:8080/dev")!;
  expect(other.origin).toBe("http://localhost:8080");
  expect(wsUrl(other)).toBe("ws://localhost:8080/ws/dev");
  expect(isDefaultHost(other)).toBe(false);
  expect(wsUrl(parseRoomInput("abc")!)).toBe("wss://vc.swiftirc.net/ws/abc");
});

test.each([
  "", "   ", "https://vc.swiftirc.net/", "https://vc.swiftirc.net/api/rooms/x",
  "https://vc.swiftirc.net/ws/x", "https://vc.swiftirc.net/a/b", "bad_room!",
  "x".repeat(33), "ftp://vc.swiftirc.net/x", "https:///x",
])("not a room: %p", (input) => {
  expect(parseRoomInput(input)).toBeNull();
});

test.each([
  "https://vc.swiftirc.net@evil.com/room", "https://user:pass@evil.com/room", "https://@vc.swiftirc.net/room",
])("userinfo in the host is rejected: %p", (input) => {
  expect(parseRoomInput(input)).toBeNull();
});
