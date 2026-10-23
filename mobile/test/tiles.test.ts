import { cameraFor, gridTiles, screenFor, viewedFor } from "../src/core/tiles";
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

test("your own share is the last tile, only while sharing", () => {
  const s = new FakeStream([]);
  expect(gridTiles([person("a", { screen: s }), person("b")], true).map((t) => t.key))
    .toEqual(["a", "a:screen", "b", "self:screen"]);
  expect(gridTiles([person("a")], true)[1].kind).toBe("own-screen");
  expect(gridTiles([person("a")]).map((t) => t.key)).toEqual(["a"]);
  expect(gridTiles([], true).map((t) => t.key)).toEqual(["self:screen"]);
});

test("cameraFor needs the camera on, a video stream and data saver off", () => {
  const v = new FakeStream([]);
  expect(cameraFor([person("a", { video: v })], "a", false)?.id).toBe("a");
  expect(cameraFor([person("a", { video: v, camera: false })], "a", false)).toBeNull();
  expect(cameraFor([person("a")], "a", false)).toBeNull();
  expect(cameraFor([person("a", { video: v })], "a", true)).toBeNull();
  expect(cameraFor([], "a", false)).toBeNull();
});

test("viewedFor shows the screen or the camera that was opened, until it goes", () => {
  const s = new FakeStream([]);
  const a = person("a", { video: s, screen: s });
  expect(viewedFor([a], { kind: "screen", id: "a" }, false)).toEqual({ kind: "screen", p: a });
  expect(viewedFor([a], { kind: "camera", id: "a" }, false)).toEqual({ kind: "camera", p: a });
  expect(viewedFor([person("a", { video: s })], { kind: "screen", id: "a" }, false)).toBeNull();
  expect(viewedFor([person("a", { screen: s })], { kind: "camera", id: "a" }, false)).toBeNull();
  expect(viewedFor([a], null, false)).toBeNull();
});
