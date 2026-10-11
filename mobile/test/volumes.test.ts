import { Volumes } from "../src/core/volumes";

test("defaults to 100%, clamps to 0–200%, rounds to 5% steps, notifies on change only", () => {
  const v = new Volumes();
  let n = 0;
  v.subscribe(() => n++);
  expect(v.get("a")).toBe(1);
  v.set("a", 1.53);
  expect(v.get("a")).toBe(1.55);
  v.set("a", 9);
  expect(v.get("a")).toBe(2);
  v.set("a", -1);
  expect(v.get("a")).toBe(0);
  v.set("a", 0);
  expect(n).toBe(3);
  expect(v.getSnapshot()).toEqual({ a: 0 });
});
