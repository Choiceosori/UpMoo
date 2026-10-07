import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * 파일 기반 저장소.
 *   data/db.json            선생님·반·퀴즈·퀴즈 결과·메타
 *   data/lessons/<id>.json  수업 하나(쪽·필기·학생 활동) — 크기가 커서 따로 저장
 *   data/files/<name>       활동지 그림
 * dir 없이 만들면 메모리에서만 동작합니다(테스트용).
 */
export class Store {
  constructor(dir) {
    this.dir = dir || null;
    this.data = { meta: {}, teachers: {}, classes: {}, quizzes: {}, quizRuns: {} };
    this.lessons = new Map();
    this.memFiles = new Map();
    this.dirtyLessons = new Set();
    this.dirtyDb = false;
    this.timer = null;
  }

  get lessonsDir() {
    return path.join(this.dir, "lessons");
  }

  get filesDir() {
    return path.join(this.dir, "files");
  }

  load() {
    if (!this.dir) return this;
    fs.mkdirSync(this.lessonsDir, { recursive: true });
    fs.mkdirSync(this.filesDir, { recursive: true });
    const dbFile = path.join(this.dir, "db.json");
    if (fs.existsSync(dbFile)) Object.assign(this.data, JSON.parse(fs.readFileSync(dbFile, "utf8")));
    for (const f of fs.readdirSync(this.lessonsDir)) {
      if (!f.endsWith(".json")) continue;
      const lesson = JSON.parse(fs.readFileSync(path.join(this.lessonsDir, f), "utf8"));
      this.lessons.set(lesson.id, lesson);
    }
    return this;
  }

  schedule() {
    if (!this.dir || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 800);
  }

  flush() {
    if (!this.dir) return;
    clearTimeout(this.timer);
    this.timer = null;
    if (this.dirtyDb) {
      writeAtomic(path.join(this.dir, "db.json"), JSON.stringify(this.data));
      this.dirtyDb = false;
    }
    for (const id of this.dirtyLessons) {
      const lesson = this.lessons.get(id);
      const file = path.join(this.lessonsDir, `${id}.json`);
      if (lesson) writeAtomic(file, JSON.stringify(lesson));
      else fs.rmSync(file, { force: true });
    }
    this.dirtyLessons.clear();
  }

  touch() {
    this.dirtyDb = true;
    this.schedule();
  }

  touchLesson(id) {
    this.dirtyLessons.add(id);
    this.schedule();
  }

  meta(key, value) {
    if (value === undefined) return this.data.meta[key];
    this.data.meta[key] = value;
    this.touch();
    return value;
  }

  // ------------------------------------------------------------ teachers
  teacher(email) {
    return this.data.teachers[normEmail(email)] ?? null;
  }

  listTeachers() {
    return Object.values(this.data.teachers).sort((a, b) => a.createdAt - b.createdAt);
  }

  upsertTeacher(email, patch) {
    const key = normEmail(email);
    const t = (this.data.teachers[key] ??= { email: key, name: "", status: "pending", note: "", createdAt: Date.now() });
    Object.assign(t, patch);
    this.touch();
    return t;
  }

  deleteTeacher(email) {
    const key = normEmail(email);
    delete this.data.teachers[key];
    for (const c of Object.values(this.data.classes)) c.teachers = c.teachers.filter((e) => e !== key);
    this.touch();
  }

  // ------------------------------------------------------------ classes
  listClasses() {
    return Object.values(this.data.classes).sort((a, b) => a.name.localeCompare(b.name, "ko", { numeric: true }));
  }

  getClass(id) {
    return this.data.classes[id] ?? null;
  }

  createClass({ name, seats = 24 }) {
    const id = randomId(6);
    const cls = { id, name, seats, disabledSeats: [], teachers: [], groups: { n: 4, assign: {} }, createdAt: Date.now() };
    this.data.classes[id] = cls;
    this.touch();
    return cls;
  }

  updateClass(id, patch) {
    const cls = this.getClass(id);
    if (!cls) return null;
    Object.assign(cls, patch);
    this.touch();
    return cls;
  }

  deleteClass(id) {
    delete this.data.classes[id];
    for (const l of [...this.lessons.values()]) {
      if (l.classId === id) this.deleteLesson(l.id);
    }
    for (const r of Object.values(this.data.quizRuns)) if (r.classId === id) delete this.data.quizRuns[r.id];
    this.touch();
  }

  // ------------------------------------------------------------ lessons
  getLesson(id) {
    return this.lessons.get(id) ?? null;
  }

  listLessons(classId) {
    return [...this.lessons.values()].filter((l) => l.classId === classId).sort((a, b) => b.startedAt - a.startedAt);
  }

  currentLesson(classId) {
    return this.listLessons(classId)[0] ?? null;
  }

  activeByCode(code) {
    for (const l of this.lessons.values()) if (!l.endedAt && !l.closed && l.code === code) return l;
    return null;
  }

  newCode() {
    for (let i = 0; i < 500; i++) {
      const code = String(crypto.randomInt(1000, 10000));
      if (!this.activeByCode(code)) return code;
    }
    throw new Error("방 코드를 만들 수 없어요");
  }

  addLesson(lesson) {
    this.lessons.set(lesson.id, lesson);
    this.touchLesson(lesson.id);
    return lesson;
  }

  deleteLesson(id) {
    this.lessons.delete(id);
    this.dirtyLessons.add(id);
    this.schedule();
  }

  // ------------------------------------------------------------ quizzes
  listQuizzes() {
    return Object.values(this.data.quizzes).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getQuiz(id) {
    return this.data.quizzes[id] ?? null;
  }

  saveQuiz(quiz) {
    this.data.quizzes[quiz.id] = quiz;
    this.touch();
    return quiz;
  }

  deleteQuiz(id) {
    delete this.data.quizzes[id];
    this.touch();
  }

  getRun(id) {
    return this.data.quizRuns[id] ?? null;
  }

  listRuns(classId) {
    return Object.values(this.data.quizRuns)
      .filter((r) => r.classId === classId)
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  saveRun(run) {
    this.data.quizRuns[run.id] = run;
    this.touch();
    return run;
  }

  // ------------------------------------------------------------ files
  saveFile(buffer, ext) {
    const name = `${randomId(16)}.${ext}`;
    if (this.dir) fs.writeFileSync(path.join(this.filesDir, name), buffer);
    else this.memFiles.set(name, buffer);
    return name;
  }

  readFile(name) {
    if (!/^[a-z0-9]+\.(png|jpg|webp)$/.test(name)) return null;
    if (!this.dir) return this.memFiles.get(name) ?? null;
    const file = path.join(this.filesDir, name);
    return fs.existsSync(file) ? fs.readFileSync(file) : null;
  }

  usage() {
    if (!this.dir) return { files: 0, lessons: 0, db: 0 };
    const size = (dir) =>
      fs.existsSync(dir) ? fs.readdirSync(dir).reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0) : 0;
    const dbFile = path.join(this.dir, "db.json");
    return {
      files: size(this.filesDir),
      lessons: size(this.lessonsDir),
      db: fs.existsSync(dbFile) ? fs.statSync(dbFile).size : 0,
    };
  }
}

function writeAtomic(file, text) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

export function normEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

export function randomId(len = 10) {
  const alphabet = "abcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  for (const b of crypto.randomBytes(len)) out += alphabet[b % alphabet.length];
  return out;
}
