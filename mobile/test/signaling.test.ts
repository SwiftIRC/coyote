import { Signaling } from "../src/core/signaling";
import { FakeSocket, FakeTimers, silentLog } from "./fakes";

function make() {
  FakeSocket.all = [];
  const timers = new FakeTimers();
  const sig = new Signaling("wss://h/ws/r", {
    createSocket: (url) => new FakeSocket(url),
    random: () => 0,
    log: silentLog,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  return { sig, timers };
}

test("onOpen runs before queued frames flush, on every open", () => {
  const { sig, timers } = make();
  sig.onOpen(() => sig.send("join", { name: "a" }));
  sig.connect();
  sig.send("media-state", { mic: true, camera: false }); // queued pre-open
  FakeSocket.last().open();
  expect(FakeSocket.last().types()).toEqual(["join", "media-state"]);
  FakeSocket.last().drop();
  timers.advance(500);
  FakeSocket.last().open();
  expect(FakeSocket.all).toHaveLength(2);
  expect(FakeSocket.last().types()).toEqual(["join"]);
});

test("onClose fires for unexpected closes only", () => {
  const { sig } = make();
  let closes = 0;
  sig.onClose(() => closes++);
  sig.connect();
  FakeSocket.last().open();
  FakeSocket.last().drop();
  expect(closes).toBe(1);
  sig.reconnectNow();
  const s = FakeSocket.last();
  s.open();
  sig.stop();
  s.drop(1000);
  expect(closes).toBe(1);
});

test("frames queued while disconnected are dropped on an unexpected close", () => {
  const { sig, timers } = make();
  sig.onOpen(() => sig.send("join", {}));
  sig.connect();
  FakeSocket.last().open();
  FakeSocket.last().drop();
  sig.send("offer", { sdp: "stale" }); // from the dead session
  timers.advance(500);
  FakeSocket.last().open();
  expect(FakeSocket.last().types()).toEqual(["join"]);
});

test("dispatches by type and to '*', ignores malformed frames, off() removes", () => {
  const { sig } = make();
  const got: string[] = [];
  const h = (m: any) => got.push(`joined:${m.selfId}`);
  sig.on("joined", h).on("*", (m) => got.push(`*:${m.type}`));
  sig.connect();
  FakeSocket.last().open();
  FakeSocket.last().onmessage?.({ data: "{not json" });
  FakeSocket.last().receive({ type: "joined", selfId: "p1" });
  sig.off("joined", h);
  FakeSocket.last().receive({ type: "joined", selfId: "p2" });
  expect(got).toEqual(["joined:p1", "*:joined", "*:joined"]);
});

test("reconnect backoff grows, caps, and resets after open", () => {
  const { sig, timers } = make();
  sig.connect();
  FakeSocket.last().drop(); // attempt 0 -> 500ms
  timers.advance(499);
  expect(FakeSocket.all).toHaveLength(1);
  timers.advance(1);
  expect(FakeSocket.all).toHaveLength(2);
  FakeSocket.last().drop(); // attempt 1 -> 1000ms
  timers.advance(999);
  expect(FakeSocket.all).toHaveLength(2);
  timers.advance(1);
  expect(FakeSocket.all).toHaveLength(3);
  FakeSocket.last().open(); // resets
  FakeSocket.last().drop();
  timers.advance(500);
  expect(FakeSocket.all).toHaveLength(4);
});

test("stop() is permanent: closes, cancels pending reconnect, never reconnects", () => {
  const { sig, timers } = make();
  sig.connect();
  FakeSocket.last().open();
  FakeSocket.last().drop();
  expect(timers.pending()).toBe(1);
  sig.stop();
  expect(timers.pending()).toBe(0);
  timers.advance(60_000);
  sig.reconnectNow();
  sig.connect();
  expect(FakeSocket.all).toHaveLength(1);
  expect(sig.stopped).toBe(true);
});

test("stop() on an open socket closes it without reconnecting", () => {
  const { sig, timers } = make();
  sig.connect();
  const s = FakeSocket.last();
  s.open();
  sig.stop();
  expect(s.closed).toBe(true);
  s.drop(1000); // the close event arrives afterwards
  timers.advance(60_000);
  expect(FakeSocket.all).toHaveLength(1);
});

test("reconnectNow skips the backoff wait and resets the attempt counter", () => {
  const { sig, timers } = make();
  sig.connect();
  FakeSocket.last().drop();
  FakeSocket.last(); // still the first socket; a 500ms timer is pending
  sig.reconnectNow();
  expect(FakeSocket.all).toHaveLength(2);
  expect(timers.pending()).toBe(0);
});

test("reconnectNow on an open socket replaces it (media-failed recovery)", () => {
  const { sig } = make();
  sig.onOpen(() => sig.send("join", {}));
  sig.connect();
  const first = FakeSocket.last();
  first.open();
  sig.reconnectNow();
  expect(first.closed).toBe(true);
  first.drop(1000); // the old socket's late close must not schedule another reconnect
  expect(FakeSocket.all).toHaveLength(2);
  FakeSocket.last().open();
  expect(FakeSocket.last().types()).toEqual(["join"]);
  expect(sig.isOpen).toBe(true);
});
