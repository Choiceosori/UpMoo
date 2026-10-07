import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESETS, defaultPolicy, isUrlAllowed, normalizeDomain, normalizePolicy } from "../src/policy.js";

test("normalizeDomain strips scheme, www, path and port", () => {
  assert.equal(normalizeDomain("https://www.YouTube.com/watch?v=1"), "youtube.com");
  assert.equal(normalizeDomain("*.naver.com"), "naver.com");
  assert.equal(normalizeDomain("ebs.co.kr:8080/x"), "ebs.co.kr");
  assert.equal(normalizeDomain("not a domain"), null);
});

test("normalizePolicy drops invalid values and keeps base", () => {
  const p = normalizePolicy({
    appMode: "nope",
    allowedApps: ["com.android.chrome", "bad pkg", "com.android.chrome"],
    restrictions: { camera: true, unknown: true },
    volume: { level: 150 },
    kiosk: { enabled: true, packageName: "com.example.app" },
  });
  assert.equal(p.appMode, "off");
  assert.deepEqual(p.allowedApps, ["com.android.chrome"]);
  assert.equal(p.restrictions.camera, true);
  assert.equal(p.restrictions.unknown, undefined);
  assert.equal(p.volume.level, 100);
  assert.deepEqual(p.kiosk, { enabled: true, packageName: "com.example.app" });
});

test("normalizePolicy merges onto base", () => {
  const base = normalizePolicy({ webMode: "blacklist", blockedDomains: ["youtube.com"] });
  const p = normalizePolicy({ restrictions: { camera: true } }, base);
  assert.equal(p.webMode, "blacklist");
  assert.deepEqual(p.blockedDomains, ["youtube.com"]);
  assert.equal(p.restrictions.camera, true);
});

test("isUrlAllowed: blacklist, whitelist, keywords", () => {
  const black = normalizePolicy({ webMode: "blacklist", blockedDomains: ["youtube.com"], blockedKeywords: ["casino"] });
  assert.equal(isUrlAllowed(black, "https://m.youtube.com/watch"), false);
  assert.equal(isUrlAllowed(black, "notyoutube.com"), true);
  assert.equal(isUrlAllowed(black, "https://example.com/casino-games"), false);
  assert.equal(isUrlAllowed(black, "https://ebs.co.kr"), true);

  const white = normalizePolicy({ webMode: "whitelist", allowedDomains: ["ebs.co.kr"] });
  assert.equal(isUrlAllowed(white, "www.ebs.co.kr/main"), true);
  assert.equal(isUrlAllowed(white, "https://home.ebs.co.kr"), true);
  assert.equal(isUrlAllowed(white, "https://google.com"), false);

  assert.equal(isUrlAllowed(defaultPolicy(), "https://anything.com"), true);
});

test("presets are valid policies", () => {
  for (const { policy } of Object.values(PRESETS)) {
    assert.deepEqual(Object.keys(normalizePolicy(policy)).sort(), Object.keys(defaultPolicy()).sort());
  }
  assert.equal(PRESETS.exam.policy.kiosk.enabled, true);
});
