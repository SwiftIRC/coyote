import { preferVp8 } from "../src/core/codecs";

test("VP8 first, everything else kept in order", () => {
  const c = (m: string) => ({ mimeType: m, clockRate: 90000 });
  expect(preferVp8([c("video/H264"), c("video/rtx"), c("video/VP8"), c("video/VP9")]).map((x) => x.mimeType))
    .toEqual(["video/VP8", "video/H264", "video/rtx", "video/VP9"]);
  expect(preferVp8([c("video/vp8")])[0].mimeType).toBe("video/vp8");
});

test("no VP8 available returns the list unchanged", () => {
  const list = [{ mimeType: "video/H264", clockRate: 90000 }];
  expect(preferVp8(list)).toEqual(list);
});
