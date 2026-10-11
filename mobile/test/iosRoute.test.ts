import { iosInitialSpeaker, iosRoutes } from "../src/core/iosRoute";

test("selected route follows the speaker flag", () => {
  expect(iosRoutes(true)).toEqual({ available: ["EARPIECE", "SPEAKER_PHONE"], selected: "SPEAKER_PHONE" });
  expect(iosRoutes(false).selected).toBe("EARPIECE");
});

test("video calls start on the speaker, audio-only on the earpiece", () => {
  expect(iosInitialSpeaker(true)).toBe(true);
  expect(iosInitialSpeaker(false)).toBe(false);
});
