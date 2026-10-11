import { fetchScenes, fetchSoundboard, peekRoom, peekInvite, serverVersion, type Fetcher } from "../src/core/api";
import { parseRoomInput } from "../src/core/link";

function fetcher(routes: Record<string, { status: number; body?: unknown } | "throw">): Fetcher & { urls: string[] } {
  const urls: string[] = [];
  const f = (async (url: string) => {
    urls.push(url);
    const r = routes[url];
    if (!r || r === "throw") throw new Error("network");
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  }) as Fetcher & { urls: string[] };
  f.urls = urls;
  return f;
}

const link = parseRoomInput("https://vc.swiftirc.net/lounge#i=ab/c")!;

test("peekRoom", async () => {
  const f = fetcher({ "https://vc.swiftirc.net/api/rooms/lounge": { status: 200, body: { count: 3, locked: true } } });
  expect(await peekRoom(f, link)).toEqual({ count: 3, locked: true });
  expect(await peekRoom(fetcher({}), link)).toBeNull();
});

test("peekInvite: ok, invalid (404), unknown (other/network); id is URL-encoded", async () => {
  const url = "https://vc.swiftirc.net/api/invite/ab%2Fc";
  expect(await peekInvite(fetcher({ [url]: { status: 200, body: { name: "Ryan" } } }), link)).toEqual({ status: "ok", name: "Ryan" });
  expect(await peekInvite(fetcher({ [url]: { status: 404 } }), link)).toEqual({ status: "invalid" });
  expect(await peekInvite(fetcher({ [url]: { status: 500 } }), link)).toEqual({ status: "unknown" });
  expect(await peekInvite(fetcher({}), link)).toEqual({ status: "unknown" });
});

test("serverVersion", async () => {
  const f = fetcher({ "https://vc.swiftirc.net/api/version": { status: 200, body: { version: "abc123" } } });
  expect(await serverVersion(f, "https://vc.swiftirc.net")).toBe("abc123");
  expect(await serverVersion(fetcher({}), "https://vc.swiftirc.net")).toBe("");
});

test("fetchSoundboard returns the list, or null on failure or a bad body", async () => {
  const list = [{ id: "a", label: "🚀", src: "/s.mp3" }];
  expect(await fetchSoundboard(fetcher({ "https://h/api/soundboard": { status: 200, body: list } }), "https://h")).toEqual(list);
  expect(await fetchSoundboard(fetcher({ "https://h/api/soundboard": { status: 404 } }), "https://h")).toBeNull();
  expect(await fetchSoundboard(fetcher({ "https://h/api/soundboard": { status: 200, body: { not: "a list" } } }), "https://h")).toBeNull();
  expect(await fetchSoundboard(fetcher({ "https://h/api/soundboard": "throw" }), "https://h")).toBeNull();
});

test("fetchScenes: the list, or null when unreachable or malformed", async () => {
  const ok = fetcher({ "https://h/api/scenes": { status: 200, body: [{ id: "a", label: "A", src: "/a.webp" }] } });
  expect(await fetchScenes(ok, "https://h")).toEqual([{ id: "a", label: "A", src: "/a.webp" }]);
  expect(await fetchScenes(fetcher({ "https://h/api/scenes": { status: 404 } }), "https://h")).toBeNull();
  expect(await fetchScenes(fetcher({ "https://h/api/scenes": { status: 200, body: { no: 1 } } }), "https://h")).toBeNull();
  expect(await fetchScenes(fetcher({ "https://h/api/scenes": "throw" }), "https://h")).toBeNull();
});
