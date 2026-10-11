import { DEFAULT_PREFS, mergePrefs } from "../src/core/prefs";

test("defaults when nothing is stored", () => {
  expect(mergePrefs(null, {})).toEqual(DEFAULT_PREFS);
  expect(DEFAULT_PREFS).toMatchObject({ dataSaver: false, hideSelf: false, mic: true, camera: true });
});

test("a patch keeps every field it doesn't mention", () => {
  const stored = { ...DEFAULT_PREFS, name: "Ryan", dataSaver: true, hideSelf: true };
  const out = mergePrefs(stored, { name: "R", mic: false, camera: false, email: "e" });
  expect(out).toEqual({ name: "R", email: "e", mic: false, camera: false, dataSaver: true, hideSelf: true, background: "none" });
  expect(mergePrefs(out, { dataSaver: false })).toMatchObject({ name: "R", dataSaver: false, hideSelf: true });
});

test("garbage in storage falls back field by field", () => {
  const out = mergePrefs({ name: 5, dataSaver: "yes", hideSelf: true, extra: 1 }, {});
  expect(out).toEqual({ ...DEFAULT_PREFS, hideSelf: true });
  expect(out).not.toHaveProperty("extra");
});

test("the background choice persists and defaults to none", () => {
  expect(DEFAULT_PREFS.background).toBe("none");
  expect(mergePrefs({ background: "carina" }, {}).background).toBe("carina");
  expect(mergePrefs({ background: 7 }, {}).background).toBe("none");
});
