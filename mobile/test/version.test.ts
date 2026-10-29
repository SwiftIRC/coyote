import { readFileSync } from "fs";
import { join } from "path";
import { APP_BUILD, APP_VERSION } from "../src/version";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

test("src/version.ts matches the Android and iOS builds", () => {
  const gradle = read("android/app/build.gradle");
  expect(gradle).toContain(`versionCode ${APP_BUILD}\n`);
  expect(gradle).toContain(`versionName "${APP_VERSION}"`);
  const pbx = read("ios/Coyote.xcodeproj/project.pbxproj");
  const builds = [...pbx.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((m) => Number(m[1]));
  const versions = [...pbx.matchAll(/MARKETING_VERSION = ([\d.]+);/g)].map((m) => m[1]);
  expect(builds.length).toBeGreaterThan(0);
  expect(new Set(builds)).toEqual(new Set([APP_BUILD]));
  expect(new Set(versions)).toEqual(new Set([APP_VERSION]));
});
