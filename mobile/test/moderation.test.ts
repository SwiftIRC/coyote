import { MOD_RESULT_TEXT, Moderation } from "../src/core/moderation";

function make(op = true, connected = true) {
  const sent: Array<{ type: string; fields: Record<string, unknown> }> = [];
  const mod = new Moderation((type, fields) => {
    if (!connected) return false;
    sent.push({ type, fields });
    return true;
  }, () => op);
  return { mod, sent };
}
const joined = (over = {}) => ({ type: "joined", quality: { camera: "low", screen: "" }, ...over });

test("seeds locked and quality from joined; empty tier is auto", () => {
  const { mod } = make();
  mod.seed(joined({ locked: true }), false, true);
  expect(mod.getSnapshot()).toEqual({ locked: true, quality: { camera: "low", screen: "auto" } });
  mod.seed(joined({ locked: false }), true, false);
  expect(mod.getSnapshot().locked).toBe(false); // the server's value wins over the peek
});

test("older server (no joined.locked): first join uses the peek, a rejoin keeps the current value", () => {
  const { mod } = make();
  mod.seed(joined(), true, true);
  expect(mod.getSnapshot().locked).toBe(true);
  mod.onLocked(false);
  mod.seed(joined(), true, false); // stale pre-call peek must not resurrect the lock
  expect(mod.getSnapshot().locked).toBe(false);
});

test("lock, unlock and quality broadcasts update the snapshot; identity changes only on change", () => {
  const { mod } = make();
  mod.seed(joined({ locked: false }), false, true);
  const s0 = mod.getSnapshot();
  expect(mod.getSnapshot()).toBe(s0);
  let calls = 0;
  const off = mod.subscribe(() => calls++);
  mod.onLocked(true);
  expect(mod.getSnapshot().locked).toBe(true);
  mod.onQuality({ type: "quality", camera: "high", screen: "" });
  expect(mod.getSnapshot().quality).toEqual({ camera: "high", screen: "auto" });
  expect(calls).toBe(2);
  off();
  mod.onLocked(false);
  expect(calls).toBe(2);
});

test("each action sends the exact frame", () => {
  const { mod, sent } = make();
  expect(mod.muteMic("p2")).toBe("sent");
  expect(mod.stopShare("p2")).toBe("sent");
  expect(mod.grantOp("p2")).toBe("sent");
  expect(mod.kick("p2")).toBe("sent");
  expect(mod.ban("p2")).toBe("sent");
  expect(mod.lock("  sesame ")).toBe("sent");
  expect(mod.unlock()).toBe("sent");
  expect(mod.setQuality("camera", "low")).toBe("sent");
  expect(mod.setQuality("screen", "auto")).toBe("sent");
  expect(sent).toEqual([
    { type: "mute-peer", fields: { id: "p2", kind: "mic" } },
    { type: "mute-peer", fields: { id: "p2", kind: "screen" } },
    { type: "grant-op", fields: { id: "p2" } },
    { type: "kick", fields: { id: "p2" } },
    { type: "ban", fields: { id: "p2" } },
    { type: "set-lock", fields: { password: "sesame" } },
    { type: "set-lock", fields: {} },
    { type: "set-quality", fields: { target: "camera", tier: "low" } },
    { type: "set-quality", fields: { target: "screen", tier: "auto" } },
  ]);
});

test("sending never changes state; only broadcasts do", () => {
  const { mod } = make();
  mod.seed(joined({ locked: false }), false, true);
  const s0 = mod.getSnapshot();
  mod.lock("x");
  mod.setQuality("camera", "high");
  expect(mod.getSnapshot()).toBe(s0);
});

test("refusals: not-op first, then invalid, then offline; nothing is sent", () => {
  const nonOp = make(false);
  expect(nonOp.mod.kick("p2")).toBe("not-op");
  expect(nonOp.mod.lock("")).toBe("not-op");
  expect(nonOp.sent).toEqual([]);
  const { mod, sent } = make();
  expect(mod.lock("   ")).toBe("invalid");
  expect(mod.setQuality("camera", "potato")).toBe("invalid");
  expect(mod.setQuality("mic" as never, "low")).toBe("invalid");
  expect(mod.kick("")).toBe("invalid");
  expect(sent).toEqual([]);
  const off = make(true, false);
  expect(off.mod.kick("p2")).toBe("offline");
  expect(off.mod.lock("x")).toBe("offline");
});

test("result notices", () => {
  expect(MOD_RESULT_TEXT.offline).toBe("Not connected — try again.");
  expect(MOD_RESULT_TEXT["not-op"]).toBe("Only ops can do that.");
  expect(MOD_RESULT_TEXT.sent).toBeUndefined();
});
