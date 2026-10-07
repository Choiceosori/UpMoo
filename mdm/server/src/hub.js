import { WebSocketServer } from "ws";
import {
  activeSeats,
  addStroke,
  cleanStroke,
  gradeSubmission,
  normalizeLink,
  publicQuiz,
  runSummary,
  seatRecord,
  seatStatus,
} from "./lesson.js";
import { randomId } from "./store.js";

const HELLO_TIMEOUT_MS = 10_000;
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(typeof msg === "string" ? msg : JSON.stringify(msg));
}

function str(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function validFrame(data) {
  return typeof data === "string" && data.length > 16 && B64_RE.test(data.slice(0, 64));
}

/**
 * 선생님 화면 ↔ 학생 태블릿 실시간 중계.
 * 연결 직후 첫 메시지는 hello:
 *   선생님: { type:"hello", role:"teacher", token, classId }
 *   학생:   { type:"hello", role:"student", code, seat, deviceId, kind:"web"|"app" }
 */
export class Hub {
  constructor({ store, auth, config }) {
    this.store = store;
    this.auth = auth;
    this.config = config;
    this.teachers = new Set();
    this.students = new Map(); // `${lessonId}:${seat}` -> conn
    this.runtime = new Map(); // lessonId -> { snap, live:[], present, share }
  }

  attach(server) {
    this.wss = new WebSocketServer({ server, path: "/ws", maxPayload: this.config.maxMessageBytes });
    this.wss.on("connection", (ws, req) => this.onConnection(ws, req));
    this.pingTimer = setInterval(() => {
      for (const ws of this.wss.clients) {
        if (ws.isAlive === false) ws.terminate();
        else {
          ws.isAlive = false;
          ws.ping();
        }
      }
    }, this.config.pingIntervalMs);
    this.pingTimer.unref?.();
  }

  close() {
    clearInterval(this.pingTimer);
    for (const c of this.wss?.clients ?? []) c.terminate();
    this.wss?.close();
  }

  // ==================================================================== auth

  /** 토큰 → 선생님 세션 (승인 취소된 선생님은 거부) */
  session(token) {
    const p = this.auth.verify(token);
    if (p?.role !== "teacher") return null;
    if (p.email) {
      const t = this.store.teacher(p.email);
      const isAdmin = this.config.adminEmails.includes(p.email);
      if (!isAdmin && t?.status !== "approved") return null;
      return { email: p.email, admin: isAdmin || t?.admin === true };
    }
    return p.admin ? { email: null, admin: true } : null;
  }

  canAccess(session, cls) {
    return !!session && !!cls && (session.admin || cls.teachers.includes(session.email));
  }

  // ==================================================================== connection

  onConnection(ws) {
    ws.isAlive = true;
    ws.on("pong", () => (ws.isAlive = true));
    const conn = { ws, role: null };
    const timer = setTimeout(() => ws.close(4000, "hello timeout"), HELLO_TIMEOUT_MS);

    ws.on("message", (raw, isBinary) => {
      if (isBinary) return;
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg.type !== "string") return;
      try {
        if (!conn.role) {
          if (msg.type !== "hello") return ws.close(4001, "hello required");
          clearTimeout(timer);
          if (msg.role === "teacher") this.teacherHello(conn, msg);
          else if (msg.role === "student") this.studentHello(conn, msg);
          else ws.close(4001, "unknown role");
        } else if (conn.role === "teacher") this.onTeacher(conn, msg);
        else this.onStudent(conn, msg);
      } catch (err) {
        console.error("[hub]", err);
        send(ws, { type: "error", error: "서버에서 처리하지 못했어요" });
      }
    });

    ws.on("close", () => {
      clearTimeout(timer);
      if (conn.role === "teacher") {
        this.teachers.delete(conn);
        if (conn.lessonId) this.updateCapture(conn.lessonId);
      }
      if (conn.role === "student") this.studentGone(conn);
    });
    ws.on("error", () => {});
  }

  // ==================================================================== teacher

  teacherHello(conn, msg) {
    const session = this.session(msg.token);
    const cls = this.store.getClass(msg.classId);
    if (!session) return conn.ws.close(4003, "unauthorized");
    if (!this.canAccess(session, cls)) return conn.ws.close(4004, "no access");
    conn.role = "teacher";
    conn.session = session;
    conn.classId = cls.id;
    conn.lessonId = this.store.currentLesson(cls.id)?.id ?? null;
    this.teachers.add(conn);
    send(conn.ws, this.teacherState(cls.id));
    if (conn.lessonId) this.updateCapture(conn.lessonId);
  }

  /** 반의 현재 수업이 바뀌면(새 수업) 선생님 연결을 새 수업에 붙입니다. */
  refreshTeachers(classId) {
    const lessonId = this.store.currentLesson(classId)?.id ?? null;
    const state = JSON.stringify(this.teacherState(classId));
    for (const t of this.teachers) {
      if (t.classId !== classId) continue;
      t.lessonId = lessonId;
      send(t.ws, state);
    }
  }

  onTeacher(conn, msg) {
    const lesson = conn.lessonId ? this.store.getLesson(conn.lessonId) : null;
    const cls = this.store.getClass(conn.classId);
    if (!cls) return;
    if (!lesson || lesson.endedAt || lesson.closed) {
      if (msg.type === "group_set") this.groupSet(cls, msg);
      return;
    }
    const rt = this.rt(lesson.id);

    switch (msg.type) {
      case "set": {
        const patch = {};
        for (const k of ["follow", "locked", "explore", "entryLocked"]) {
          if (typeof msg[k] === "boolean" && msg[k] !== lesson[k]) {
            patch[k] = msg[k];
            if (msg[k] && lesson.counters[k === "locked" ? "lock" : k] != null) {
              lesson.counters[k === "locked" ? "lock" : k] += 1;
            }
          }
        }
        if (typeof msg.teacherPage === "string" && lesson.pages.some((p) => p.id === msg.teacherPage)) {
          patch.teacherPage = msg.teacherPage;
        }
        Object.assign(lesson, patch);
        this.store.touchLesson(lesson.id);
        this.broadcastFlags(lesson);
        break;
      }
      case "ink": {
        const stroke = cleanStroke(msg.stroke);
        if (!stroke || !this.hasPage(lesson, msg.pageId)) return;
        if (!addStroke(lesson.teacherInk, msg.pageId, stroke)) return;
        this.store.touchLesson(lesson.id);
        const out = JSON.stringify({ type: "ink", who: "teacher", pageId: msg.pageId, stroke });
        this.toStudents(lesson.id, out);
        this.toTeachers(lesson.id, out, conn);
        break;
      }
      case "ink_undo":
      case "ink_clear": {
        if (!this.hasPage(lesson, msg.pageId)) return;
        const list = lesson.teacherInk[msg.pageId] ?? [];
        if (msg.type === "ink_undo") list.pop();
        else list.length = 0;
        lesson.teacherInk[msg.pageId] = list;
        this.store.touchLesson(lesson.id);
        const out = JSON.stringify({ type: "ink_set", who: "teacher", pageId: msg.pageId, strokes: list });
        this.toStudents(lesson.id, out);
        this.toTeachers(lesson.id, out);
        break;
      }
      case "link_send": {
        const n = normalizeLink(msg.link?.url);
        if (!n) return send(conn.ws, { type: "error", error: "주소가 올바르지 않아요" });
        lesson.link = {
          id: randomId(6),
          url: n.url,
          embed: msg.link.how === "out" ? n.url : n.embed,
          title: str(msg.link.title, 60) || n.title || new URL(n.url).hostname,
          how: msg.link.how === "out" ? "out" : "in",
          login: msg.link.login === true,
          sentAt: Date.now(),
        };
        lesson.counters.links += 1;
        lesson.linksSent.push({ ...lesson.link });
        this.rememberLink(cls, lesson.link);
        this.store.touchLesson(lesson.id);
        this.toStudents(lesson.id, { type: "link", link: lesson.link });
        this.toTeachers(lesson.id, { type: "link", link: lesson.link });
        break;
      }
      case "link_back": {
        lesson.link = null;
        this.store.touchLesson(lesson.id);
        this.toStudents(lesson.id, { type: "link", link: null, back: true });
        this.toTeachers(lesson.id, { type: "link", link: null });
        break;
      }
      case "release_seat": {
        const seat = Number(msg.seat);
        const rec = lesson.seats[seat];
        if (!rec) return;
        rec.deviceId = null;
        const s = this.students.get(this.key(lesson.id, seat));
        if (s) {
          s.released = true;
          send(s.ws, { type: "released" });
          s.ws.close(4005, "released");
          this.students.delete(this.key(lesson.id, seat));
        }
        this.store.touchLesson(lesson.id);
        this.notifySeat(lesson, seat);
        break;
      }
      case "close_tabs":
        this.toSeat(lesson.id, Number(msg.seat), { type: "close_tabs" });
        break;
      case "share_start":
        rt.share = "teacher";
        rt.present = null;
        lesson.counters.share += 1;
        this.store.touchLesson(lesson.id);
        this.toStudents(lesson.id, { type: "share", from: "teacher" });
        this.toTeachers(lesson.id, { type: "runtime", runtime: rt });
        this.updateCapture(lesson.id);
        break;
      case "share_frame":
        if (rt.share === "teacher" && validFrame(msg.data)) {
          this.toStudents(lesson.id, JSON.stringify({ type: "share_frame", data: msg.data }));
        }
        break;
      case "share_stop":
        this.stopShare(lesson);
        break;
      case "snap":
        rt.snap = msg.on === true;
        this.toTeachers(lesson.id, { type: "runtime", runtime: rt });
        this.updateCapture(lesson.id);
        break;
      case "live": {
        const seats = (Array.isArray(msg.seats) ? msg.seats : []).map(Number).filter((n) => this.students.has(this.key(lesson.id, n)));
        rt.live = [...new Set(seats)].slice(0, this.config.liveMaxSeats);
        this.toTeachers(lesson.id, { type: "runtime", runtime: rt });
        this.updateCapture(lesson.id);
        break;
      }
      case "present": {
        const seat = msg.seat == null ? null : Number(msg.seat);
        if (seat == null) return this.stopShare(lesson);
        if (!this.students.has(this.key(lesson.id, seat))) return send(conn.ws, { type: "error", error: `${seat}번이 연결되어 있지 않아요` });
        rt.share = null;
        rt.present = seat;
        rt.presentSentAt = 0;
        lesson.counters.share += 1;
        this.store.touchLesson(lesson.id);
        this.toStudents(lesson.id, { type: "share", from: seat }, seat);
        this.toTeachers(lesson.id, { type: "runtime", runtime: rt });
        this.updateCapture(lesson.id);
        break;
      }
      case "group_set":
        this.groupSet(cls, msg);
        break;
      case "group_start":
        this.groupStart(lesson, cls, msg);
        break;
      case "group_stop":
        this.groupStop(lesson, cls);
        break;
      case "group_lock": {
        if (!lesson.group?.active) return;
        lesson.group.locks[msg.g] = msg.locked === true;
        this.store.touchLesson(lesson.id);
        this.pushGroups(lesson, cls);
        break;
      }
      case "gink":
      case "gmemo":
      case "gmemo_del":
      case "gink_clear":
        this.groupEdit(lesson, cls, String(msg.g), msg, null);
        break;
      case "quiz_start":
        this.quizStart(lesson, msg);
        break;
      case "quiz_reveal":
      case "quiz_end":
        this.quizFlow(lesson, msg.type);
        break;
      case "quiz_accept":
      case "quiz_score":
        this.quizMark(lesson, msg);
        break;
      default:
        break;
    }
  }

  rememberLink(cls, link) {
    const recent = (cls.recentLinks ?? []).filter((l) => l.url !== link.url);
    recent.unshift({ url: link.url, title: link.title, how: link.how, login: link.login });
    cls.recentLinks = recent.slice(0, 12);
    this.store.touch();
  }

  stopShare(lesson) {
    const rt = this.rt(lesson.id);
    if (!rt.share && rt.present == null) return;
    rt.share = null;
    rt.present = null;
    this.toStudents(lesson.id, { type: "share", from: null });
    this.toTeachers(lesson.id, { type: "runtime", runtime: rt });
    this.updateCapture(lesson.id);
  }

  // ==================================================================== student

  studentHello(conn, msg) {
    const reject = (reason, error) => {
      send(conn.ws, { type: "rejected", reason, error });
      conn.ws.close(4003, reason);
    };
    const lesson = this.store.activeByCode(str(String(msg.code ?? ""), 8));
    if (!lesson) return reject("code", "방 코드가 맞지 않거나 수업이 끝났어요");
    const cls = this.store.getClass(lesson.classId);
    const seat = Number.parseInt(msg.seat, 10);
    if (!cls || !activeSeats(cls).includes(seat)) return reject("seat", "없는 번호예요");
    const deviceId = str(msg.deviceId, 64);
    if (!deviceId) return reject("device", "기기 정보를 읽지 못했어요");

    const rec = seatRecord(lesson, seat);
    if (rec.deviceId && rec.deviceId !== deviceId) return reject("taken", "이미 다른 기기가 이 번호로 들어와 있어요. 선생님께 말씀드려요.");
    if (lesson.entryLocked && rec.deviceId !== deviceId) {
      this.toTeachers(lesson.id, { type: "entry_blocked", seat });
      return reject("locked", "선생님이 입장을 잠갔어요");
    }

    // 같은 기기가 다른 번호에 앉아 있었다면 그 자리를 비웁니다.
    for (const [n, other] of Object.entries(lesson.seats)) {
      if (Number(n) !== seat && other.deviceId === deviceId) {
        other.deviceId = null;
        const old = this.students.get(this.key(lesson.id, n));
        if (old) {
          old.released = true;
          old.ws.close(4005, "moved");
        }
        this.notifySeat(lesson, Number(n));
      }
    }

    const prev = this.students.get(this.key(lesson.id, seat));
    if (prev) {
      prev.replaced = true;
      prev.ws.close(4006, "replaced");
    }

    rec.deviceId = deviceId;
    rec.kind = msg.kind === "app" ? "app" : "web";
    rec.joinedAt ??= Date.now();
    rec.lastSeenAt = Date.now();
    Object.assign(conn, {
      role: "student",
      lessonId: lesson.id,
      seat,
      kind: rec.kind,
      visible: true,
      link: "none",
      tab: "",
      capture: null,
      lastPresent: 0,
    });
    this.students.set(this.key(lesson.id, seat), conn);
    this.store.touchLesson(lesson.id);

    send(conn.ws, this.studentState(lesson, cls, seat));
    this.updateCapture(lesson.id);
    this.notifySeat(lesson, seat);
  }

  onStudent(conn, msg) {
    const lesson = this.store.getLesson(conn.lessonId);
    if (!lesson || lesson.endedAt || lesson.closed) return;
    const rec = seatRecord(lesson, conn.seat);
    const rt = this.rt(lesson.id);

    switch (msg.type) {
      case "status": {
        const wasAway = !conn.visible && conn.link === "none";
        conn.visible = msg.visible !== false;
        conn.link = ["none", "in", "out", "check"].includes(msg.link) ? msg.link : "none";
        conn.tab = str(msg.tab, 80);
        if (typeof msg.page === "string") rec.page = msg.page;
        if (Array.isArray(msg.tabs)) {
          rec.tabs = msg.tabs.slice(0, 10).map((t) => ({ title: str(t?.title, 80), url: str(t?.url, 500) }));
        }
        const nowAway = !conn.visible && conn.link === "none";
        if (nowAway && !wasAway) rec.awayCount += 1;
        rec.lastSeenAt = Date.now();
        this.store.touchLesson(lesson.id);
        this.notifySeat(lesson, conn.seat);
        break;
      }
      case "ink": {
        const stroke = cleanStroke(msg.stroke);
        if (!stroke || !this.hasPage(lesson, msg.pageId)) return;
        if (!addStroke(rec.ink, msg.pageId, stroke)) return;
        this.store.touchLesson(lesson.id);
        this.toTeachers(lesson.id, { type: "ink", who: conn.seat, pageId: msg.pageId, stroke });
        break;
      }
      case "ink_undo":
      case "ink_clear": {
        if (!this.hasPage(lesson, msg.pageId)) return;
        const list = rec.ink[msg.pageId] ?? [];
        if (msg.type === "ink_undo") list.pop();
        else list.length = 0;
        rec.ink[msg.pageId] = list;
        this.store.touchLesson(lesson.id);
        this.toTeachers(lesson.id, { type: "ink_set", who: conn.seat, pageId: msg.pageId, strokes: list });
        break;
      }
      case "gink":
      case "gmemo":
      case "gmemo_del": {
        const cls = this.store.getClass(lesson.classId);
        const g = String(cls?.groups?.assign?.[conn.seat] ?? "");
        if (g) this.groupEdit(lesson, cls, g, msg, conn.seat);
        break;
      }
      case "link_open":
        rec.linkOpens += 1;
        this.store.touchLesson(lesson.id);
        this.notifySeat(lesson, conn.seat);
        break;
      case "explore": {
        if (!lesson.explore) return;
        const entry = { ts: Date.now(), q: str(msg.q, 100), url: str(msg.url, 500), title: str(msg.title, 80) };
        if (!entry.q && !entry.url) return;
        rec.explores.push(entry);
        if (rec.explores.length > 100) rec.explores.shift();
        this.store.touchLesson(lesson.id);
        this.notifySeat(lesson, conn.seat);
        break;
      }
      case "frame": {
        if (!validFrame(msg.data)) return;
        const frame = JSON.stringify({
          type: "frame",
          seat: conn.seat,
          data: msg.data,
          w: Number(msg.w) || null,
          h: Number(msg.h) || null,
          via: msg.via === "video" ? "video" : "image",
          ts: Date.now(),
        });
        this.toTeachers(lesson.id, frame);
        if (rt.present === conn.seat) {
          const now = Date.now();
          if (now - (rt.presentSentAt ?? 0) >= this.config.presentIntervalMs) {
            rt.presentSentAt = now;
            this.toStudents(lesson.id, JSON.stringify({ type: "share_frame", data: msg.data, from: conn.seat }), conn.seat);
          }
        }
        break;
      }
      case "capture_state":
        conn.captureState = str(msg.state, 30);
        this.notifySeat(lesson, conn.seat);
        break;
      case "quiz_submit":
        this.quizSubmit(lesson, conn, msg);
        break;
      default:
        break;
    }
  }

  studentGone(conn) {
    const key = this.key(conn.lessonId, conn.seat);
    if (this.students.get(key) !== conn) return;
    this.students.delete(key);
    const lesson = this.store.getLesson(conn.lessonId);
    if (!lesson) return;
    const rt = this.rt(lesson.id);
    if (rt.present === conn.seat) this.stopShare(lesson);
    if (rt.live.includes(conn.seat)) {
      rt.live = rt.live.filter((s) => s !== conn.seat);
      this.toTeachers(lesson.id, { type: "runtime", runtime: rt });
    }
    const rec = lesson.seats[conn.seat];
    if (rec) rec.lastSeenAt = Date.now();
    this.store.touchLesson(lesson.id);
    if (!conn.replaced && !conn.released) this.notifySeat(lesson, conn.seat);
  }

  // ==================================================================== groups

  groupSet(cls, msg) {
    const n = Math.min(12, Math.max(2, Number(msg.n) || 4));
    const assign = {};
    for (const s of activeSeats(cls)) {
      const g = Number(msg.assign?.[s]);
      if (g >= 1 && g <= n) assign[s] = g;
    }
    cls.groups = { n, assign };
    this.store.touch();
    const lesson = this.store.currentLesson(cls.id);
    if (lesson?.group?.active) this.pushGroups(lesson, cls);
    this.toClassTeachers(cls.id, { type: "groups", groups: cls.groups });
  }

  groupStart(lesson, cls, msg) {
    const bg = ["blank", "grid", "page"].includes(msg.bg) ? msg.bg : "blank";
    const page = bg === "page" ? lesson.pages.find((p) => p.id === msg.pageId && p.kind === "image") : null;
    const last = msg.cont ? lesson.groupHistory.at(-1) : null;
    lesson.group = {
      active: true,
      bg: page ? "page" : bg === "page" ? "blank" : bg,
      src: page?.src ?? null,
      ar: page?.ar ?? 1.6,
      ink: last ? structuredClone(last.ink) : {},
      memos: last ? structuredClone(last.memos) : {},
      locks: {},
      startedAt: Date.now(),
    };
    lesson.counters.groups += 1;
    this.store.touchLesson(lesson.id);
    this.pushGroups(lesson, cls);
  }

  groupStop(lesson, cls) {
    if (!lesson.group?.active) return;
    const { bg, src, ar, ink, memos, startedAt } = lesson.group;
    lesson.groupHistory.push({ bg, src, ar, ink, memos, startedAt, endedAt: Date.now(), assign: { ...cls.groups.assign } });
    lesson.group = null;
    this.store.touchLesson(lesson.id);
    this.pushGroups(lesson, cls);
  }

  groupView(lesson, cls, g) {
    const grp = lesson.group;
    if (!grp?.active || !g) return null;
    const members = Object.entries(cls.groups.assign).filter(([, v]) => String(v) === String(g)).map(([s]) => Number(s));
    return { g: String(g), bg: grp.bg, src: grp.src, ar: grp.ar, ink: grp.ink[g] ?? [], memos: grp.memos[g] ?? [], locked: grp.locks[g] === true, members };
  }

  pushGroups(lesson, cls) {
    for (const conn of this.studentsOf(lesson.id)) {
      send(conn.ws, { type: "group", group: this.groupView(lesson, cls, String(cls.groups.assign[conn.seat] ?? "")) });
    }
    this.toTeachers(lesson.id, { type: "group_state", group: lesson.group, groups: cls.groups });
  }

  groupEdit(lesson, cls, g, msg, bySeat) {
    const grp = lesson.group;
    if (!grp?.active || !g) return;
    if (bySeat != null && grp.locks[g]) return;
    let out;
    if (msg.type === "gink") {
      const stroke = cleanStroke(msg.stroke);
      if (!stroke || !addStroke(grp.ink, g, stroke)) return;
      out = { type: "gink", g, stroke };
    } else if (msg.type === "gink_clear") {
      grp.ink[g] = [];
      out = { type: "gset", g, ink: [], memos: grp.memos[g] ?? [] };
    } else if (msg.type === "gmemo") {
      const m = msg.memo ?? {};
      const memo = {
        id: str(m.id, 20) || randomId(6),
        x: Math.min(0.95, Math.max(0, Number(m.x) || 0)),
        y: Math.min(0.95, Math.max(0, Number(m.y) || 0)),
        text: str(m.text, 200),
        color: ["yellow", "pink", "blue", "green"].includes(m.color) ? m.color : "yellow",
        by: bySeat ?? "T",
      };
      const list = (grp.memos[g] ??= []);
      const i = list.findIndex((x) => x.id === memo.id);
      if (i >= 0) list[i] = memo;
      else if (list.length < 100) list.push(memo);
      out = { type: "gmemo", g, memo };
    } else {
      grp.memos[g] = (grp.memos[g] ?? []).filter((x) => x.id !== msg.id);
      out = { type: "gmemo_del", g, id: str(msg.id, 20) };
    }
    this.store.touchLesson(lesson.id);
    const data = JSON.stringify(out);
    for (const conn of this.studentsOf(lesson.id)) {
      if (String(cls.groups.assign[conn.seat] ?? "") === g) send(conn.ws, data);
    }
    this.toTeachers(lesson.id, data);
  }

  // ==================================================================== quiz

  quizStart(lesson, msg) {
    const quiz = this.store.getQuiz(msg.quizId);
    if (!quiz) return;
    this.quizFlow(lesson, "quiz_end");
    const run = {
      id: randomId(10),
      lessonId: lesson.id,
      classId: lesson.classId,
      lessonTitle: lesson.title,
      quizId: quiz.id,
      quiz: structuredClone(quiz),
      reveal: msg.reveal === "later" ? "later" : "instant",
      revealed: false,
      startedAt: Date.now(),
      endedAt: null,
      answers: {},
      accept: {},
      manual: {},
    };
    this.store.saveRun(run);
    lesson.quizRunId = run.id;
    lesson.quizRuns.push(run.id);
    lesson.counters.quizzes += 1;
    this.store.touchLesson(lesson.id);
    for (const conn of this.studentsOf(lesson.id)) send(conn.ws, { type: "quiz", quiz: this.quizForSeat(run, conn.seat) });
    this.pushQuizDash(lesson, run);
  }

  quizFlow(lesson, type) {
    const run = lesson.quizRunId ? this.store.getRun(lesson.quizRunId) : null;
    if (!run) return;
    if (type === "quiz_reveal") run.revealed = true;
    if (type === "quiz_end") {
      run.endedAt = Date.now();
      lesson.quizRunId = null;
      this.store.touchLesson(lesson.id);
    }
    this.store.saveRun(run);
    for (const conn of this.studentsOf(lesson.id)) {
      send(conn.ws, { type: "quiz", quiz: type === "quiz_end" ? null : this.quizForSeat(run, conn.seat) });
    }
    this.pushQuizDash(lesson, type === "quiz_end" ? null : run);
  }

  quizSubmit(lesson, conn, msg) {
    const run = lesson.quizRunId ? this.store.getRun(lesson.quizRunId) : null;
    if (!run || run.endedAt || run.answers[conn.seat]?.submittedAt) return;
    const a = run.quiz.items.map((item, i) => {
      const v = Array.isArray(msg.answers) ? msg.answers[i] : null;
      if (item.type === "choice") return Number.isInteger(v) ? v : null;
      if (item.type === "ox") return v === "O" || v === "X" ? v : null;
      return str(v, item.type === "essay" ? 2000 : 200) || null;
    });
    run.answers[conn.seat] = { a, submittedAt: Date.now() };
    this.store.saveRun(run);
    send(conn.ws, { type: "quiz", quiz: this.quizForSeat(run, conn.seat) });
    this.pushQuizDash(lesson, run);
  }

  quizMark(lesson, msg) {
    const run = this.store.getRun(msg.runId);
    if (!run || run.lessonId !== lesson.id) return;
    const i = Number(msg.idx);
    if (!run.quiz.items[i]) return;
    if (msg.type === "quiz_accept") {
      const ans = str(msg.answer, 200);
      if (!ans) return;
      (run.accept[i] ??= []).push(ans);
    } else {
      const seat = String(Number(msg.seat));
      (run.manual[seat] ??= {})[i] = Math.max(0, Number(msg.score) || 0);
    }
    this.store.saveRun(run);
    this.pushQuizDash(lesson, run);
    for (const conn of this.studentsOf(lesson.id)) {
      if (run.answers[conn.seat]?.submittedAt) send(conn.ws, { type: "quiz", quiz: this.quizForSeat(run, conn.seat) });
    }
  }

  quizForSeat(run, seat) {
    if (!run || run.endedAt) return null;
    const sub = run.answers[seat];
    const out = { runId: run.id, ...publicQuiz(run.quiz), submitted: !!sub?.submittedAt, answers: sub?.a ?? null };
    if (sub?.submittedAt && (run.reveal === "instant" || run.revealed)) {
      out.result = gradeSubmission(run, seat);
      out.correct = run.quiz.items.map((it) => (it.type === "choice" || it.type === "ox" ? it.answer : it.type === "short" ? it.answer.join(", ") : it.answer || null));
    }
    return out;
  }

  pushQuizDash(lesson, run) {
    this.toTeachers(lesson.id, { type: "quiz_dash", run: run ? this.quizDash(run) : null });
  }

  quizDash(run) {
    const cls = this.store.getClass(run.classId);
    const seats = cls ? activeSeats(cls) : [];
    return {
      id: run.id,
      quiz: run.quiz,
      reveal: run.reveal,
      revealed: run.revealed,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      summary: runSummary(run),
      accept: run.accept,
      rows: seats.map((s) => ({
        seat: s,
        submitted: !!run.answers[s]?.submittedAt,
        answers: run.answers[s]?.a ?? null,
        grade: run.answers[s]?.submittedAt ? gradeSubmission(run, s) : null,
      })),
    };
  }

  // ==================================================================== state views

  studentState(lesson, cls, seat) {
    const rt = this.rt(lesson.id);
    const run = lesson.quizRunId ? this.store.getRun(lesson.quizRunId) : null;
    return {
      type: "welcome",
      seat,
      className: cls.name,
      lesson: {
        id: lesson.id,
        title: lesson.title,
        pages: lesson.pages,
        teacherPage: lesson.teacherPage,
        follow: lesson.follow,
        locked: lesson.locked,
        explore: lesson.explore,
        link: lesson.link,
        teacherInk: lesson.teacherInk,
      },
      myInk: lesson.seats[seat]?.ink ?? {},
      group: this.groupView(lesson, cls, String(cls.groups?.assign?.[seat] ?? "")),
      quiz: this.quizForSeat(run, seat),
      share: rt.share ? "teacher" : rt.present != null && rt.present !== seat ? rt.present : null,
    };
  }

  seatView(lesson, seat) {
    const rec = lesson.seats[seat];
    const conn = this.students.get(this.key(lesson.id, seat));
    const joined = !!rec?.deviceId;
    return {
      seat,
      status: seatStatus({ joined, online: !!conn, visible: conn?.visible, link: conn?.link }),
      kind: rec?.kind ?? null,
      awayCount: rec?.awayCount ?? 0,
      page: rec?.page ?? null,
      tab: conn?.tab ?? "",
      tabs: rec?.tabs ?? [],
      linkOpens: rec?.linkOpens ?? 0,
      explore: rec?.explores?.at(-1) ?? null,
      capture: conn?.captureState ?? null,
    };
  }

  teacherState(classId) {
    const cls = this.store.getClass(classId);
    const lesson = this.store.currentLesson(classId);
    const run = lesson?.quizRunId ? this.store.getRun(lesson.quizRunId) : null;
    return {
      type: "state",
      class: { id: cls.id, name: cls.name, seats: cls.seats, disabledSeats: cls.disabledSeats, groups: cls.groups, recentLinks: cls.recentLinks ?? [] },
      lesson: lesson
        ? {
            ...lesson,
            seats: Object.fromEntries(Object.entries(lesson.seats).map(([n, r]) => [n, { ink: r.ink }])),
          }
        : null,
      seats: lesson ? activeSeats(cls).map((s) => this.seatView(lesson, s)) : [],
      runtime: lesson ? this.rt(lesson.id) : null,
      quiz: run ? this.quizDash(run) : null,
    };
  }

  broadcastFlags(lesson) {
    const { follow, teacherPage, locked, explore, entryLocked } = lesson;
    const out = JSON.stringify({ type: "flags", follow, teacherPage, locked, explore, entryLocked });
    this.toStudents(lesson.id, out);
    this.toTeachers(lesson.id, out);
  }

  /** REST에서 쪽을 바꾼 뒤 호출 */
  pagesChanged(lesson) {
    const out = JSON.stringify({ type: "pages", pages: lesson.pages, teacherPage: lesson.teacherPage });
    this.toStudents(lesson.id, out);
    this.toTeachers(lesson.id, out);
  }

  titleChanged(lesson) {
    const out = JSON.stringify({ type: "title", title: lesson.title });
    this.toStudents(lesson.id, out);
    this.toTeachers(lesson.id, out);
  }

  endLesson(lesson) {
    const rt = this.rt(lesson.id);
    rt.share = null;
    rt.present = null;
    rt.live = [];
    rt.snap = false;
    for (const conn of this.studentsOf(lesson.id)) {
      send(conn.ws, { type: "ended" });
      conn.released = true;
      conn.ws.close(4007, "ended");
    }
    this.refreshTeachers(lesson.classId);
  }

  notifySeat(lesson, seat) {
    this.toTeachers(lesson.id, { type: "seat", seat: this.seatView(lesson, seat) });
  }

  // ==================================================================== capture (학생 화면 보기 · 실시간 화면)

  updateCapture(lessonId) {
    const rt = this.rt(lessonId);
    const watching = [...this.teachers].some((t) => t.lessonId === lessonId);
    const n = rt.live.length;
    const liveMs = Math.round(1000 / Math.max(3, 9 - n)); // 1명 ≈ 8장/초, 6명 ≈ 3장/초
    for (const conn of this.studentsOf(lessonId)) {
      let cap;
      if (rt.present === conn.seat) cap = { mode: "live", intervalMs: Math.min(liveMs, 250), maxWidth: this.config.liveMaxWidth };
      else if (watching && rt.live.includes(conn.seat)) cap = { mode: "live", intervalMs: liveMs, maxWidth: this.config.liveMaxWidth };
      else if (watching && rt.snap) cap = { mode: "snap", intervalMs: this.config.snapIntervalMs, maxWidth: this.config.snapMaxWidth };
      else cap = { mode: "off" };
      const sig = JSON.stringify(cap);
      if (sig !== conn.capture) {
        conn.capture = sig;
        send(conn.ws, { type: "capture", ...cap });
      }
    }
  }

  // ==================================================================== helpers

  rt(lessonId) {
    let r = this.runtime.get(lessonId);
    if (!r) {
      r = { snap: false, live: [], present: null, share: null };
      this.runtime.set(lessonId, r);
    }
    return r;
  }

  key(lessonId, seat) {
    return `${lessonId}:${Number(seat)}`;
  }

  hasPage(lesson, pageId) {
    return typeof pageId === "string" && lesson.pages.some((p) => p.id === pageId);
  }

  studentsOf(lessonId) {
    return [...this.students.values()].filter((c) => c.lessonId === lessonId);
  }

  toStudents(lessonId, msg, exceptSeat = null) {
    const data = typeof msg === "string" ? msg : JSON.stringify(msg);
    for (const c of this.studentsOf(lessonId)) if (c.seat !== exceptSeat) send(c.ws, data);
  }

  toSeat(lessonId, seat, msg) {
    const c = this.students.get(this.key(lessonId, seat));
    if (c) send(c.ws, msg);
  }

  toTeachers(lessonId, msg, except = null) {
    const data = typeof msg === "string" ? msg : JSON.stringify(msg);
    for (const t of this.teachers) if (t.lessonId === lessonId && t !== except) send(t.ws, data);
  }

  toClassTeachers(classId, msg) {
    const data = JSON.stringify(msg);
    for (const t of this.teachers) if (t.classId === classId) send(t.ws, data);
  }
}
