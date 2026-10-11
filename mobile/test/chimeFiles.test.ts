/// <reference types="node" />
import * as fs from "fs";
import * as path from "path";

// The chimes are bundled copies of the web client's files; they must not drift.
const root = path.join(__dirname, "..", "..");
const names = ["door_open", "sounds_drop", "sounds_bloop"];

test.each(names)("%s.mp3 is byte-identical in the web assets, Android res/raw and the iOS bundle", (n) => {
  const web = fs.readFileSync(path.join(root, "internal", "web", "assets", `${n}.mp3`));
  const android = fs.readFileSync(path.join(root, "mobile", "android", "app", "src", "main", "res", "raw", `${n}.mp3`));
  const ios = fs.readFileSync(path.join(root, "mobile", "ios", "Coyote", "Sounds", `${n}.mp3`));
  expect(android.equals(web)).toBe(true);
  expect(ios.equals(web)).toBe(true);
});

test("the iOS project bundles the chimes and compiles the module", () => {
  const pbx = fs.readFileSync(path.join(root, "mobile", "ios", "Coyote.xcodeproj", "project.pbxproj"), "utf8");
  for (const n of names) expect(pbx).toContain(`${n}.mp3 in Resources`);
  expect(pbx).toContain("CoyoteSounds.swift in Sources");
  expect(pbx).toContain("CoyoteSounds.m in Sources");
});
