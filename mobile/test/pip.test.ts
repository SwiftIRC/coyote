import { PIP_OFF, pipOthers, pipParams, pipTile, runPipAction } from "../src/core/pip";
import type { Participant } from "../src/core/roster";
import type { StreamLike } from "../src/core/types";

const stream: StreamLike = { id: "s", getTracks: () => [], toURL: () => "s" };
const person = (id: string, extra: Partial<Participant> = {}): Participant => ({
  id, name: id, role: "", mic: true, camera: true, ref: id, gravatar: "",
  video: stream, audio: stream, screen: null, screenAudio: null, ...extra,
});

test("pipTile: the first sharer's screen wins over everyone before them", () => {
  const a = person("a");
  const b = person("b", { screen: stream });
  const c = person("c", { screen: stream });
  expect(pipTile([a, b, c])).toEqual({ kind: "screen", p: b });
});

test("pipTile: an audio-only share is not shown; the first person is", () => {
  const a = person("a");
  const b = person("b", { screenAudio: stream });
  expect(pipTile([a, b])).toEqual({ kind: "person", p: a });
});

test("pipTile: the first person, camera on or off", () => {
  const a = person("a", { camera: false, video: null });
  expect(pipTile([a, person("b")])).toEqual({ kind: "person", p: a });
});

test("pipTile: alone in the room shows yourself", () => {
  expect(pipTile([])).toEqual({ kind: "self" });
});

test("pipOthers counts everyone but the one shown", () => {
  const people = [person("a"), person("b", { screen: stream }), person("c")];
  expect(pipOthers(pipTile(people), people)).toBe(2);
  expect(pipOthers(pipTile([person("a")]), [person("a")])).toBe(0);
  expect(pipOthers({ kind: "self" }, [])).toBe(0);
});

test("pipParams: on while in-call or reconnecting, with the mic and the tile's aspect", () => {
  const people = [person("a")];
  expect(pipParams({ phase: "in-call", mic: true, participants: people })).toEqual({ enabled: true, micOn: true, aspect: "person" });
  expect(pipParams({ phase: "reconnecting", mic: false, participants: [person("b", { screen: stream })] }))
    .toEqual({ enabled: true, micOn: false, aspect: "screen" });
  expect(pipParams({ phase: "in-call", mic: true, participants: [] })).toEqual({ enabled: true, micOn: true, aspect: "person" });
});

test("pipParams: off before the call is up, after it ends, and without a call", () => {
  for (const phase of ["idle", "connecting", "ended"] as const) {
    expect(pipParams({ phase, mic: true, participants: [person("a")] })).toEqual(PIP_OFF);
  }
  expect(pipParams(null)).toEqual(PIP_OFF);
  expect(PIP_OFF.enabled).toBe(false);
});

test("runPipAction routes each button", () => {
  const h = { toggleMic: jest.fn(), hangup: jest.fn() };
  runPipAction("mic", h);
  expect(h.toggleMic).toHaveBeenCalledTimes(1);
  expect(h.hangup).not.toHaveBeenCalled();
  runPipAction("hangup", h);
  expect(h.hangup).toHaveBeenCalledTimes(1);
});
