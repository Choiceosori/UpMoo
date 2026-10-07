import { test } from "node:test";
import assert from "node:assert/strict";
import { Scheduler, activeEntry, normalizeSchedule } from "../src/scheduler.js";
import { Store } from "../src/store.js";
import { defaultPolicy } from "../src/policy.js";

const TZ = "Asia/Seoul";
// 2026-10-07 (수) 09:10 KST
const WED_0910 = new Date("2026-10-07T00:10:00Z");
const WED_1000 = new Date("2026-10-07T01:00:00Z");

const schedule = normalizeSchedule({
  enabled: true,
  autoRelease: true,
  entries: [{ id: "p1", label: "1교시", days: [1, 2, 3, 4, 5], start: "09:00", end: "09:45", preset: "lesson" }],
});

test("normalizeSchedule validates times", () => {
  assert.throws(() => normalizeSchedule({ entries: [{ days: [1], start: "10:00", end: "09:00" }] }));
  assert.throws(() => normalizeSchedule({ entries: [{ days: [], start: "09:00", end: "10:00" }] }));
});

test("activeEntry respects timezone, day and time window", () => {
  assert.equal(activeEntry(schedule, WED_0910, TZ)?.id, "p1");
  assert.equal(activeEntry(schedule, WED_1000, TZ), null);
  assert.equal(activeEntry({ ...schedule, enabled: false }, WED_0910, TZ), null);
  // 2026-10-10 (토)
  assert.equal(activeEntry(schedule, new Date("2026-10-10T00:10:00Z"), TZ), null);
});

test("Scheduler applies on period start and releases after", () => {
  const store = new Store(null);
  const cls = store.createClass({ name: "1-1", policy: defaultPolicy(), schedule });
  const pushed = [];
  const unlocked = [];
  const hub = { pushPolicy: (id) => pushed.push(id), unlockAll: (id) => unlocked.push(id) };
  const s = new Scheduler({ store, hub, timezone: TZ, intervalMs: 1000 });

  s.tick(WED_0910);
  assert.equal(store.getClass(cls.id).policy.appMode, "whitelist");
  assert.equal(pushed.length, 1);

  // 수업 중 교사 수동 변경은 유지 (같은 교시 tick은 재적용 안 함)
  store.updateClass(cls.id, { policy: { ...store.getClass(cls.id).policy, appMode: "off" } });
  s.tick(new Date("2026-10-07T00:20:00Z"));
  assert.equal(store.getClass(cls.id).policy.appMode, "off");

  s.tick(WED_1000);
  assert.equal(store.getClass(cls.id).policy.webMode, "off");
  assert.deepEqual(unlocked, [cls.id]);
  assert.equal(pushed.length, 2);
});
