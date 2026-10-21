import { AutoHide, CHROME_HIDE_MS, chromePinned } from "../src/core/chrome";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

const make = () => {
  const changes: boolean[] = [];
  const a = new AutoHide((v) => changes.push(v));
  return { a, changes };
};

test("starts visible and hides after a quiet spell", () => {
  const { a, changes } = make();
  expect(a.visible).toBe(true);
  jest.advanceTimersByTime(CHROME_HIDE_MS - 1);
  expect(a.visible).toBe(true);
  jest.advanceTimersByTime(1);
  expect(a.visible).toBe(false);
  expect(changes).toEqual([false]);
});

test("a touch shows it again and restarts the countdown", () => {
  const { a, changes } = make();
  jest.advanceTimersByTime(CHROME_HIDE_MS);
  a.poke();
  expect(a.visible).toBe(true);
  jest.advanceTimersByTime(CHROME_HIDE_MS - 1);
  a.poke(); // a touch while showing keeps it up
  jest.advanceTimersByTime(CHROME_HIDE_MS - 1);
  expect(a.visible).toBe(true);
  jest.advanceTimersByTime(1);
  expect(a.visible).toBe(false);
  expect(changes).toEqual([false, true, false]);
});

test("pinned shows it and keeps it up; unpinning starts a fresh countdown", () => {
  const { a, changes } = make();
  jest.advanceTimersByTime(CHROME_HIDE_MS);
  a.setPinned(true);
  expect(a.visible).toBe(true);
  jest.advanceTimersByTime(CHROME_HIDE_MS * 3);
  expect(a.visible).toBe(true);
  a.setPinned(false);
  jest.advanceTimersByTime(CHROME_HIDE_MS - 1);
  expect(a.visible).toBe(true);
  jest.advanceTimersByTime(1);
  expect(changes).toEqual([false, true, false]);
});

test("repeating the same pin state changes nothing", () => {
  const { a } = make();
  jest.advanceTimersByTime(CHROME_HIDE_MS - 1);
  a.setPinned(false);
  jest.advanceTimersByTime(1);
  expect(a.visible).toBe(false);
});

test("dispose stops the countdown", () => {
  const { a, changes } = make();
  a.dispose();
  jest.advanceTimersByTime(CHROME_HIDE_MS * 2);
  expect(changes).toEqual([]);
});

test("chromePinned: a sheet, a screen reader, not yet in the call, or alone", () => {
  const base = { phase: "in-call", people: 1, sheetOpen: false, screenReader: false };
  expect(chromePinned(base)).toBe(false);
  expect(chromePinned({ ...base, sheetOpen: true })).toBe(true);
  expect(chromePinned({ ...base, screenReader: true })).toBe(true);
  expect(chromePinned({ ...base, phase: "connecting" })).toBe(true);
  expect(chromePinned({ ...base, phase: "reconnecting" })).toBe(true);
  expect(chromePinned({ ...base, people: 0 })).toBe(true);
});
