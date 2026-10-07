import crypto from "node:crypto";
import { PRESETS, defaultPolicy, normalizePolicy } from "./policy.js";

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function defaultSchedule() {
  return { enabled: false, autoRelease: true, entries: [] };
}

function toMinutes(hhmm) {
  const m = TIME_RE.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * 교시별 정책 예약.
 * entry = { id, label, days:[1..5], start:"09:00", end:"09:45", preset?: "lesson", policy?: {...} }
 */
export function normalizeSchedule(input) {
  const s = input && typeof input === "object" ? input : {};
  const entries = [];
  for (const raw of Array.isArray(s.entries) ? s.entries.slice(0, 50) : []) {
    if (!raw || typeof raw !== "object") continue;
    const start = toMinutes(raw.start);
    const end = toMinutes(raw.end);
    if (start == null || end == null || end <= start) {
      throw new Error(`시간표 항목 "${raw.label ?? ""}"의 시작/종료 시간이 올바르지 않습니다 (HH:MM, 시작 < 종료)`);
    }
    const days = [...new Set((Array.isArray(raw.days) ? raw.days : []).map(Number))].filter(
      (d) => Number.isInteger(d) && d >= 0 && d <= 6,
    );
    if (days.length === 0) throw new Error(`시간표 항목 "${raw.label ?? ""}"에 요일이 없습니다`);
    const preset = typeof raw.preset === "string" && PRESETS[raw.preset] ? raw.preset : null;
    entries.push({
      id: typeof raw.id === "string" && raw.id ? raw.id.slice(0, 64) : crypto.randomUUID(),
      label: String(raw.label ?? "").slice(0, 40),
      days: days.sort(),
      start: raw.start,
      end: raw.end,
      preset,
      policy: preset ? null : normalizePolicy(raw.policy),
    });
  }
  return {
    enabled: s.enabled === true,
    autoRelease: s.autoRelease !== false,
    entries,
  };
}

export function localTime(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { day: WEEKDAYS[get("weekday")], minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

export function activeEntry(schedule, date, timeZone) {
  if (!schedule?.enabled) return null;
  const { day, minutes } = localTime(date, timeZone);
  return (
    schedule.entries.find(
      (e) => e.days.includes(day) && minutes >= toMinutes(e.start) && minutes < toMinutes(e.end),
    ) ?? null
  );
}

export function entryPolicy(entry) {
  return entry.preset ? normalizePolicy(PRESETS[entry.preset].policy) : normalizePolicy(entry.policy);
}

/**
 * 교시 경계에서만(edge-triggered) 정책을 적용합니다.
 * 수업 중 교사가 수동으로 바꾼 정책은 다음 교시 경계까지 유지됩니다.
 */
export class Scheduler {
  constructor({ store, hub, timezone, intervalMs }) {
    this.store = store;
    this.hub = hub;
    this.timezone = timezone;
    this.intervalMs = intervalMs;
    this.timer = null;
  }

  start() {
    this.tick();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
  }

  tick(now = new Date()) {
    for (const cls of this.store.listClasses()) {
      const schedule = cls.schedule ?? defaultSchedule();
      const entry = activeEntry(schedule, now, this.timezone);
      const prevId = cls.scheduleState?.activeEntryId ?? null;
      const nextId = entry?.id ?? null;
      if (prevId === nextId) continue;

      if (entry) {
        this.store.updateClass(cls.id, { policy: entryPolicy(entry), scheduleState: { activeEntryId: nextId } });
        this.store.addEvent({ classId: cls.id, type: "schedule", detail: `${entry.label || "예약"} 정책 적용` });
      } else {
        const patch = { scheduleState: { activeEntryId: null } };
        if (schedule.enabled && schedule.autoRelease) {
          patch.policy = normalizePolicy(defaultPolicy());
          this.store.addEvent({ classId: cls.id, type: "schedule", detail: "수업 종료 — 제한 자동 해제" });
        }
        this.store.updateClass(cls.id, patch);
        if (patch.policy && schedule.autoRelease) this.hub.unlockAll(cls.id);
      }
      this.hub.pushPolicy(cls.id);
    }
  }
}
