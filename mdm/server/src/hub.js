import { WebSocketServer } from "ws";
import { defaultPolicy, normalizePolicy } from "./policy.js";

const HELLO_TIMEOUT_MS = 10_000;
const JPEG_DATA_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const TEACHER_COMMANDS = new Set(["lock", "unlock", "open_url", "message", "refresh_policy"]);
const REMOTE_ACTIONS = new Set(["tap", "long_press", "swipe", "back", "home", "recents"]);

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function str(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function unit(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null;
}

function validFrame(data) {
  return typeof data === "string" && data.length > 0 && JPEG_DATA_RE.test(data.slice(0, 64));
}

function safeHttpUrl(value) {
  try {
    const u = new URL(String(value));
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * 교사 단말 ↔ 학생 단말 실시간 중계.
 *
 * 연결 직후 첫 메시지는 반드시 hello:
 *   교사: { type:"hello", role:"teacher", token }
 *   학생: { type:"hello", role:"student", pin, name, number, deviceId, platform, token? }
 */
export class Hub {
  constructor({ store, auth, config }) {
    this.store = store;
    this.auth = auth;
    this.config = config;
    this.students = new Map(); // studentId -> conn
    this.teachers = new Set(); // conn
    this.broadcasts = new Map(); // classId -> { source: "teacher" | studentId }
  }

  attach(server) {
    this.wss = new WebSocketServer({ server, path: "/ws", maxPayload: this.config.maxMessageBytes });
    this.wss.on("connection", (ws, req) => this.onConnection(ws, req));
    this.pingTimer = setInterval(() => this.pingAll(), this.config.pingIntervalMs);
    this.pingTimer.unref?.();
  }

  close() {
    clearInterval(this.pingTimer);
    for (const client of this.wss?.clients ?? []) client.terminate();
    this.wss?.close();
  }

  pingAll() {
    for (const ws of this.wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }

  onConnection(ws, req) {
    ws.isAlive = true;
    ws.on("pong", () => (ws.isAlive = true));
    const conn = { ws, role: null, ip: req.socket.remoteAddress };
    const helloTimer = setTimeout(() => ws.close(4000, "hello timeout"), HELLO_TIMEOUT_MS);

    ws.on("message", (raw, isBinary) => {
      if (isBinary) return;
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return send(ws, { type: "error", error: "잘못된 메시지 형식" });
      }
      if (!msg || typeof msg.type !== "string") return;
      try {
        if (!conn.role) {
          if (msg.type !== "hello") return ws.close(4001, "hello required");
          clearTimeout(helloTimer);
          this.onHello(conn, msg);
        } else if (conn.role === "teacher") {
          this.onTeacherMessage(conn, msg);
        } else if (conn.role === "student") {
          this.onStudentMessage(conn, msg);
        }
      } catch (err) {
        console.error("[hub] message error", err);
        send(ws, { type: "error", error: "서버 처리 오류" });
      }
    });

    ws.on("close", () => {
      clearTimeout(helloTimer);
      if (conn.role === "teacher") this.onTeacherClose(conn);
      if (conn.role === "student") this.onStudentClose(conn);
    });
    ws.on("error", () => {});
  }

  onHello(conn, msg) {
    if (msg.role === "teacher") {
      const payload = this.auth.verify(msg.token);
      if (payload?.role !== "teacher") return conn.ws.close(4003, "unauthorized");
      conn.role = "teacher";
      conn.classId = null;
      conn.focus = null;
      this.teachers.add(conn);
      return send(conn.ws, { type: "welcome", role: "teacher" });
    }
    if (msg.role === "student") return this.onStudentHello(conn, msg);
    conn.ws.close(4001, "unknown role");
  }

  // ======================================================================
  // 학생 단말
  // ======================================================================

  onStudentHello(conn, msg) {
    let student = null;
    const payload = msg.token ? this.auth.verify(msg.token) : null;
    if (payload?.role === "student") student = this.store.getStudent(payload.studentId);

    if (!student) {
      const cls = this.store.findClassByPin(str(msg.pin, 12));
      if (!cls) return this.reject(conn, "수업 코드(PIN)가 올바르지 않습니다");
      const name = str(msg.name, 30);
      const deviceId = str(msg.deviceId, 100);
      if (!name || !deviceId) return this.reject(conn, "이름과 기기 ID가 필요합니다");
      const number = Number.parseInt(msg.number, 10);
      const fields = {
        name,
        number: Number.isFinite(number) && number > 0 && number < 1000 ? number : null,
        platform: str(msg.platform, 30) || "unknown",
      };
      student = this.store.findStudentByDevice(cls.id, deviceId);
      student = student
        ? this.store.updateStudent(student.id, fields)
        : this.store.createStudent({ ...fields, classId: cls.id, deviceId });
    }

    const cls = this.store.getClass(student.classId);
    if (!cls) return this.reject(conn, "삭제된 수업입니다");

    const prev = this.students.get(student.id);
    if (prev) {
      prev.replaced = true;
      prev.ws.close(4004, "replaced by new connection");
    }

    conn.role = "student";
    conn.studentId = student.id;
    conn.classId = cls.id;
    conn.live = { foregroundApp: "", battery: null, capabilities: {}, connectedAt: Date.now() };
    conn.capture = null;
    this.students.set(student.id, conn);
    this.store.updateStudent(student.id, { lastSeenAt: Date.now() });
    this.store.addEvent({ classId: cls.id, studentId: student.id, type: "connect", detail: student.name });

    send(conn.ws, {
      type: "welcome",
      role: "student",
      token: this.auth.issueStudent(cls.id, student.id),
      studentId: student.id,
      classId: cls.id,
      className: cls.name,
      studentName: student.name,
      policy: cls.policy ?? defaultPolicy(),
      locked: student.locked,
    });
    this.updateCapture(cls.id);
    const bc = this.broadcasts.get(cls.id);
    if (bc && bc.source !== student.id) send(conn.ws, { type: "broadcast_start", source: bc.source });
    this.notifyStudent(student.id);
  }

  reject(conn, error) {
    send(conn.ws, { type: "rejected", error });
    conn.ws.close(4003, "rejected");
  }

  onStudentMessage(conn, msg) {
    const student = this.store.getStudent(conn.studentId);
    if (!student) return conn.ws.close(4005, "removed");

    switch (msg.type) {
      case "heartbeat": {
        conn.live = {
          ...conn.live,
          foregroundApp: str(msg.foregroundApp, 200),
          foregroundLabel: str(msg.foregroundLabel, 100),
          battery: Number.isFinite(msg.battery) ? Math.round(msg.battery) : null,
          kioskActive: msg.kioskActive === true,
          capabilities: msg.capabilities && typeof msg.capabilities === "object" ? msg.capabilities : {},
        };
        this.store.updateStudent(student.id, { lastSeenAt: Date.now() });
        this.notifyStudent(student.id);
        break;
      }
      case "frame": {
        if (!validFrame(msg.data)) return;
        const frame = {
          type: "frame",
          studentId: student.id,
          data: msg.data,
          w: Number(msg.w) || null,
          h: Number(msg.h) || null,
          ts: Date.now(),
        };
        conn.live.lastFrameAt = frame.ts;
        for (const t of this.teachersOf(conn.classId)) send(t.ws, frame);
        if (this.broadcasts.get(conn.classId)?.source === student.id) {
          this.sendToClass(conn.classId, { type: "broadcast_frame", data: msg.data }, student.id);
        }
        break;
      }
      case "violation": {
        const kind = msg.kind === "web" ? "web" : "app";
        const target = str(msg.target, 300);
        const violations = { ...student.violations, [kind]: (student.violations?.[kind] ?? 0) + 1 };
        this.store.updateStudent(student.id, { violations });
        this.store.addEvent({
          classId: conn.classId,
          studentId: student.id,
          type: "violation",
          kind,
          detail: target,
        });
        for (const t of this.teachersOf(conn.classId)) {
          send(t.ws, { type: "violation", studentId: student.id, kind, target, ts: Date.now() });
        }
        this.notifyStudent(student.id);
        break;
      }
      default:
        break;
    }
  }

  onStudentClose(conn) {
    if (this.students.get(conn.studentId) !== conn) return;
    this.students.delete(conn.studentId);
    if (this.broadcasts.get(conn.classId)?.source === conn.studentId) this.stopBroadcast(conn.classId);
    if (!conn.replaced && this.store.getStudent(conn.studentId)) {
      this.store.updateStudent(conn.studentId, { lastSeenAt: Date.now() });
      this.store.addEvent({ classId: conn.classId, studentId: conn.studentId, type: "disconnect" });
      this.notifyStudent(conn.studentId);
    }
  }

  // ======================================================================
  // 교사 단말
  // ======================================================================

  onTeacherMessage(conn, msg) {
    switch (msg.type) {
      case "subscribe": {
        const cls = this.store.getClass(msg.classId);
        if (!cls) return send(conn.ws, { type: "error", error: "수업을 찾을 수 없습니다" });
        const prevClass = conn.classId;
        conn.classId = cls.id;
        conn.focus = null;
        send(conn.ws, this.classState(cls.id));
        if (prevClass && prevClass !== cls.id) this.updateCapture(prevClass);
        this.updateCapture(cls.id);
        break;
      }
      case "focus": {
        // 특정 학생 화면 확대 보기 → 해당 학생만 고화질/고빈도 캡처
        conn.focus = this.isStudentOf(msg.studentId, conn.classId) ? msg.studentId : null;
        this.updateCapture(conn.classId);
        break;
      }
      case "command":
        this.onTeacherCommand(conn, msg);
        break;
      case "broadcast_start": {
        if (!conn.classId) return;
        const source = msg.source === "teacher" ? "teacher" : msg.source;
        if (source !== "teacher" && !this.students.has(source)) {
          return send(conn.ws, { type: "error", error: "발표 학생이 오프라인입니다" });
        }
        if (source !== "teacher" && !this.isStudentOf(source, conn.classId)) return;
        this.broadcasts.set(conn.classId, { source });
        this.sendToClass(conn.classId, { type: "broadcast_start", source }, source);
        this.updateCapture(conn.classId);
        this.notifyTeachers(conn.classId, { type: "broadcast_state", source });
        break;
      }
      case "broadcast_frame": {
        if (!conn.classId || this.broadcasts.get(conn.classId)?.source !== "teacher") return;
        if (!validFrame(msg.data)) return;
        this.sendToClass(conn.classId, { type: "broadcast_frame", data: msg.data });
        break;
      }
      case "broadcast_stop":
        if (conn.classId) this.stopBroadcast(conn.classId);
        break;
      case "remote_input": {
        // 원격 제어: 좌표는 0~1 정규화 값 (학생 기기 해상도와 무관)
        if (!this.isStudentOf(msg.studentId, conn.classId)) return;
        const action = REMOTE_ACTIONS.has(msg.action) ? msg.action : null;
        if (!action) return;
        const input = { type: "remote_input", action };
        if (action === "tap" || action === "long_press" || action === "swipe") {
          input.x = unit(msg.x);
          input.y = unit(msg.y);
          if (input.x == null || input.y == null) return;
        }
        if (action === "swipe") {
          input.x2 = unit(msg.x2);
          input.y2 = unit(msg.y2);
          if (input.x2 == null || input.y2 == null) return;
          input.durationMs = Math.min(3000, Math.max(50, Number(msg.durationMs) || 300));
        }
        this.sendToStudent(msg.studentId, input);
        break;
      }
      default:
        break;
    }
  }

  onTeacherCommand(conn, msg) {
    const classId = conn.classId;
    if (!classId || !TEACHER_COMMANDS.has(msg.cmd)) return;
    const targets =
      msg.targets === "all" || !Array.isArray(msg.targets)
        ? this.store.listStudents(classId).map((s) => s.id)
        : msg.targets.filter((id) => this.isStudentOf(id, classId));
    const args = msg.args && typeof msg.args === "object" ? msg.args : {};

    let payload;
    switch (msg.cmd) {
      case "lock":
      case "unlock": {
        const locked = msg.cmd === "lock";
        const text = str(args.text, 100) || "선생님을 보세요";
        for (const id of targets) {
          this.store.updateStudent(id, { locked });
          this.sendToStudent(id, { type: "lock", locked, text });
          this.notifyStudent(id);
        }
        break;
      }
      case "open_url": {
        const url = safeHttpUrl(args.url);
        if (!url) return send(conn.ws, { type: "error", error: "http(s) URL만 열 수 있습니다" });
        payload = { type: "open_url", url };
        break;
      }
      case "message": {
        const text = str(args.text, 200);
        if (!text) return;
        payload = { type: "message", text };
        break;
      }
      case "refresh_policy":
        payload = { type: "policy", policy: this.store.getClass(classId)?.policy ?? defaultPolicy() };
        break;
    }
    if (payload) for (const id of targets) this.sendToStudent(id, payload);
    this.store.addEvent({
      classId,
      type: "command",
      detail: `${msg.cmd} → ${msg.targets === "all" ? "전체" : `${targets.length}명`}`,
    });
  }

  onTeacherClose(conn) {
    this.teachers.delete(conn);
    if (conn.classId) {
      if (this.broadcasts.get(conn.classId)?.source === "teacher" && this.teachersOf(conn.classId).length === 0) {
        this.stopBroadcast(conn.classId);
      }
      this.updateCapture(conn.classId);
    }
  }

  // ======================================================================
  // 공용 API (REST 라우터/스케줄러에서 호출)
  // ======================================================================

  pushPolicy(classId) {
    const cls = this.store.getClass(classId);
    if (!cls) return;
    this.sendToClass(classId, { type: "policy", policy: cls.policy ?? defaultPolicy() });
    this.notifyTeachers(classId, { type: "class_policy", policy: cls.policy ?? defaultPolicy() });
  }

  setPolicy(classId, policy) {
    const cls = this.store.updateClass(classId, { policy: normalizePolicy(policy) });
    if (cls) this.pushPolicy(classId);
    return cls;
  }

  unlockAll(classId) {
    for (const s of this.store.listStudents(classId)) {
      if (!s.locked) continue;
      this.store.updateStudent(s.id, { locked: false });
      this.sendToStudent(s.id, { type: "lock", locked: false });
      this.notifyStudent(s.id);
    }
  }

  removeStudent(studentId) {
    const conn = this.students.get(studentId);
    const student = this.store.getStudent(studentId);
    this.store.deleteStudent(studentId);
    if (conn) {
      send(conn.ws, { type: "removed" });
      conn.ws.close(4005, "removed");
    }
    if (student) this.notifyTeachers(student.classId, { type: "student_removed", studentId });
  }

  closeClass(classId) {
    for (const conn of [...this.students.values()]) {
      if (conn.classId === classId) {
        send(conn.ws, { type: "removed" });
        conn.ws.close(4005, "class deleted");
      }
    }
    this.broadcasts.delete(classId);
  }

  // ======================================================================
  // 내부 도우미
  // ======================================================================

  isStudentOf(studentId, classId) {
    return !!classId && this.store.getStudent(studentId)?.classId === classId;
  }

  teachersOf(classId) {
    return [...this.teachers].filter((t) => t.classId === classId);
  }

  sendToStudent(studentId, msg) {
    const conn = this.students.get(studentId);
    if (conn) send(conn.ws, msg);
  }

  sendToClass(classId, msg, exceptStudentId = null) {
    const data = JSON.stringify(msg);
    for (const conn of this.students.values()) {
      if (conn.classId === classId && conn.studentId !== exceptStudentId && conn.ws.readyState === conn.ws.OPEN) {
        conn.ws.send(data);
      }
    }
  }

  notifyTeachers(classId, msg) {
    for (const t of this.teachersOf(classId)) send(t.ws, msg);
  }

  notifyStudent(studentId) {
    const s = this.store.getStudent(studentId);
    if (s) this.notifyTeachers(s.classId, { type: "student_update", student: this.studentView(s) });
  }

  stopBroadcast(classId) {
    if (!this.broadcasts.has(classId)) return;
    this.broadcasts.delete(classId);
    this.sendToClass(classId, { type: "broadcast_stop" });
    this.updateCapture(classId);
    this.notifyTeachers(classId, { type: "broadcast_state", source: null });
  }

  studentView(s) {
    const conn = this.students.get(s.id);
    return {
      id: s.id,
      name: s.name,
      number: s.number,
      platform: s.platform,
      online: !!conn,
      locked: s.locked,
      violations: s.violations,
      lastSeenAt: s.lastSeenAt,
      live: conn ? conn.live : null,
    };
  }

  classState(classId) {
    const cls = this.store.getClass(classId);
    return {
      type: "class_state",
      classId,
      class: { id: cls.id, name: cls.name, pin: cls.pin, policy: cls.policy ?? defaultPolicy() },
      students: this.store.listStudents(classId).map((s) => this.studentView(s)),
      broadcast: this.broadcasts.get(classId)?.source ?? null,
    };
  }

  /**
   * 네트워크 부하 관리: 아무도 보고 있지 않으면 캡처 중지, 그리드 보기는 저빈도/저해상도,
   * 확대 보기·발표 중인 학생만 고빈도/고해상도로 전송하도록 각 단말에 지시합니다.
   */
  updateCapture(classId) {
    if (!classId) return;
    const watchers = this.teachersOf(classId);
    const focused = new Set(watchers.map((t) => t.focus).filter(Boolean));
    const presenter = this.broadcasts.get(classId)?.source;
    const { grid, focus } = this.config.capture;

    for (const conn of this.students.values()) {
      if (conn.classId !== classId) continue;
      let capture;
      if (focused.has(conn.studentId) || presenter === conn.studentId) capture = { enabled: true, ...focus };
      else if (watchers.length > 0) capture = { enabled: true, ...grid };
      else capture = { enabled: false, intervalMs: 0, maxWidth: 0, quality: 0 };
      if (JSON.stringify(capture) !== JSON.stringify(conn.capture)) {
        conn.capture = capture;
        send(conn.ws, { type: "capture_config", ...capture });
      }
    }
  }
}
