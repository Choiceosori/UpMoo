import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const MAX_EVENTS = 20_000;

function emptyData() {
  return { meta: {}, classes: {}, students: {}, events: [] };
}

/**
 * JSON 파일 기반 저장소.
 * MVP 범위에서는 단일 서버 프로세스 + 파일 저장으로 충분합니다.
 * 운영 규모가 커지면 동일한 메서드 시그니처로 PostgreSQL/Redis 구현으로 교체하세요.
 */
export class Store {
  constructor(file) {
    this.file = file;
    this.data = emptyData();
    this.saveTimer = null;
  }

  load() {
    if (this.file && fs.existsSync(this.file)) {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      this.data = { ...emptyData(), ...raw };
    }
    return this;
  }

  save() {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, 500);
  }

  flush() {
    if (!this.file) return;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }

  // ---------- meta ----------
  getMeta(key) {
    return this.data.meta[key];
  }

  setMeta(key, value) {
    this.data.meta[key] = value;
    this.save();
  }

  // ---------- classes ----------
  listClasses() {
    return Object.values(this.data.classes).sort((a, b) => a.createdAt - b.createdAt);
  }

  getClass(id) {
    return this.data.classes[id] ?? null;
  }

  findClassByPin(pin) {
    return Object.values(this.data.classes).find((c) => c.pin === String(pin)) ?? null;
  }

  newPin() {
    for (let i = 0; i < 1000; i++) {
      const pin = String(crypto.randomInt(100000, 1000000));
      if (!this.findClassByPin(pin)) return pin;
    }
    throw new Error("PIN을 생성할 수 없습니다");
  }

  createClass(fields) {
    const id = crypto.randomUUID();
    const cls = { id, pin: this.newPin(), createdAt: Date.now(), ...fields };
    this.data.classes[id] = cls;
    this.save();
    return cls;
  }

  updateClass(id, patch) {
    const cls = this.getClass(id);
    if (!cls) return null;
    Object.assign(cls, patch);
    this.save();
    return cls;
  }

  deleteClass(id) {
    delete this.data.classes[id];
    for (const s of Object.values(this.data.students)) {
      if (s.classId === id) delete this.data.students[s.id];
    }
    this.data.events = this.data.events.filter((e) => e.classId !== id);
    this.save();
  }

  // ---------- students ----------
  listStudents(classId) {
    return Object.values(this.data.students)
      .filter((s) => s.classId === classId)
      .sort((a, b) => (a.number || 9999) - (b.number || 9999) || a.name.localeCompare(b.name, "ko"));
  }

  getStudent(id) {
    return this.data.students[id] ?? null;
  }

  findStudentByDevice(classId, deviceId) {
    return (
      Object.values(this.data.students).find((s) => s.classId === classId && s.deviceId === deviceId) ?? null
    );
  }

  createStudent(fields) {
    const id = crypto.randomUUID();
    const s = {
      id,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      locked: false,
      violations: { app: 0, web: 0 },
      ...fields,
    };
    this.data.students[id] = s;
    this.save();
    return s;
  }

  updateStudent(id, patch) {
    const s = this.getStudent(id);
    if (!s) return null;
    Object.assign(s, patch);
    this.save();
    return s;
  }

  deleteStudent(id) {
    delete this.data.students[id];
    this.save();
  }

  // ---------- events (접속 기록 / 위반 기록) ----------
  addEvent(event) {
    this.data.events.push({ ts: Date.now(), ...event });
    if (this.data.events.length > MAX_EVENTS) {
      this.data.events.splice(0, this.data.events.length - MAX_EVENTS);
    }
    this.save();
  }

  listEvents(classId, { since = 0, limit = 500 } = {}) {
    const out = [];
    for (let i = this.data.events.length - 1; i >= 0 && out.length < limit; i--) {
      const e = this.data.events[i];
      if (e.classId === classId && e.ts >= since) out.push(e);
    }
    return out;
  }
}
