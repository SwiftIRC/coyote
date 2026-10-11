import { gridTiles, screenFor } from "../src/core/tiles";
import type { Participant } from "../src/core/roster";
import { FakeStream } from "./fakes";

const person = (id: string, over: Partial<Participant> = {}): Participant => ({
  id, name: id, role: "user", mic: true, camera: true, ref: "", gravatar: "",
  video: null, audio: null, screen: null, screenAudio: null, ...over,
});

test("a sharer gets a screen tile right after their own tile; audio-only shares count", () => {
  const s = new FakeStream([]);
  const tiles = gridTiles([person("a", { screen: s }), person("b"), person("c", { screenAudio: s })]);
  expect(tiles.map((t) => t.key)).toEqual(["a", "a:screen", "b", "c", "c:screen"]);
  expect(tiles[1].kind).toBe("screen");
});

test("screenFor returns the sharer only while they still share", () => {
  const s = new FakeStream([]);
  expect(screenFor([person("a", { screen: s })], "a")?.id).toBe("a");
  expect(screenFor([person("a")], "a")).toBeNull();
  expect(screenFor([], "a")).toBeNull();
});

test("your own share is the first tile, only while sharing", () => {
  expect(gridTiles([person("a")], true).map((t) => t.key)).toEqual(["self:screen", "a"]);
  expect(gridTiles([person("a")], true)[0].kind).toBe("own-screen");
  expect(gridTiles([person("a")]).map((t) => t.key)).toEqual(["a"]);
  expect(gridTiles([], true).map((t) => t.key)).toEqual(["self:screen"]);
});
