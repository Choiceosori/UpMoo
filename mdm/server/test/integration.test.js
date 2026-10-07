import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { loadConfig } from "../src/config.js";
import { createServer } from "../src/index.js";

let app;
let base;
let token;

function connect() {
  const ws = new WebSocket(base.replace("http", "ws") + "/ws");
  const queue = [];
  const waiters = [];
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    const i = waiters.findIndex((w) => w.pred(msg));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
    else queue.push(msg);
  });
  ws.next = (type, pred = () => true) =>
    new Promise((resolve, reject) => {
      const match = (m) => m.type === type && pred(m);
      const i = queue.findIndex(match);
      if (i >= 0) return resolve(queue.splice(i, 1)[0]);
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), 3000);
      waiters.push({ pred: match, resolve: (m) => (clearTimeout(timer), resolve(m)) });
    });
  ws.sendJson = (m) => ws.send(JSON.stringify(m));
  return new Promise((resolve) => ws.on("open", () => resolve(ws)));
}

async function api(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

before(async () => {
  const config = { ...loadConfig({}), port: 0, host: "127.0.0.1", dataFile: "", teacherPassword: "pw" };
  app = createServer(config);
  const { port } = await app.listen();
  base = `http://127.0.0.1:${port}`;
});

after(async () => app.close());

test("login is required and checks password", async () => {
  assert.equal((await api("GET", "/api/classes")).status, 401);
  assert.equal((await api("POST", "/api/login", { password: "bad" })).status, 401);
  const res = await api("POST", "/api/login", { password: "pw" });
  assert.equal(res.status, 200);
  token = res.body.token;
});

test("full classroom flow: join, monitor, lock, policy, violation, remote, broadcast", async () => {
  const { body: cls } = await api("POST", "/api/classes", { name: "2학년 3반" });
  assert.match(cls.pin, /^\d{6}$/);

  const teacher = await connect();
  teacher.sendJson({ type: "hello", role: "teacher", token });
  await teacher.next("welcome");
  teacher.sendJson({ type: "subscribe", classId: cls.id });
  const state = await teacher.next("class_state");
  assert.equal(state.students.length, 0);

  // 잘못된 PIN 거부
  const bad = await connect();
  bad.sendJson({ type: "hello", role: "student", pin: "000000", name: "x", deviceId: "d0" });
  assert.equal((await bad.next("rejected")).type, "rejected");

  const student = await connect();
  student.sendJson({ type: "hello", role: "student", pin: cls.pin, name: "김학생", number: 7, deviceId: "dev-1", platform: "android" });
  const welcome = await student.next("welcome");
  assert.equal(welcome.className, "2학년 3반");
  assert.ok(welcome.token);
  // 교사가 보고 있으므로 그리드 캡처 지시
  const cap = await student.next("capture_config");
  assert.equal(cap.enabled, true);
  assert.equal(cap.intervalMs, app.config.capture.grid.intervalMs);
  const upd = await teacher.next("student_update", (m) => m.student.online);
  const sid = upd.student.id;

  // 화면 프레임 → 교사에게 전달
  student.sendJson({ type: "frame", data: "/9j/4AAQSkZJRg==", w: 320, h: 200 });
  const frame = await teacher.next("frame");
  assert.equal(frame.studentId, sid);

  // 확대 보기 → 고빈도 캡처
  teacher.sendJson({ type: "focus", studentId: sid });
  assert.equal((await student.next("capture_config")).intervalMs, app.config.capture.focus.intervalMs);

  // 전체 잠금
  teacher.sendJson({ type: "command", cmd: "lock", targets: "all" });
  const lock = await student.next("lock");
  assert.equal(lock.locked, true);
  assert.equal(lock.text, "선생님을 보세요");

  // URL 열기: http(s)만 허용
  teacher.sendJson({ type: "command", cmd: "open_url", targets: [sid], args: { url: "javascript:alert(1)" } });
  assert.match((await teacher.next("error")).error, /URL/);
  teacher.sendJson({ type: "command", cmd: "open_url", targets: [sid], args: { url: "https://ebs.co.kr" } });
  assert.equal((await student.next("open_url")).url, "https://ebs.co.kr/");

  // 정책 프리셋 → 학생에게 푸시
  const preset = await api("POST", `/api/classes/${cls.id}/policy/preset`, { preset: "focus" });
  assert.equal(preset.status, 200);
  assert.equal((await student.next("policy")).policy.appMode, "blacklist");

  // 위반 보고 → 교사 경고 + 카운트
  student.sendJson({ type: "violation", kind: "app", target: "com.google.android.youtube" });
  const v = await teacher.next("violation");
  assert.equal(v.target, "com.google.android.youtube");

  // 원격 제어 좌표 전달
  teacher.sendJson({ type: "remote_input", studentId: sid, action: "tap", x: 0.5, y: 1.4 });
  const input = await student.next("remote_input");
  assert.deepEqual([input.action, input.x, input.y], ["tap", 0.5, 1]);

  // 교사 화면 전송
  teacher.sendJson({ type: "broadcast_start", source: "teacher" });
  assert.equal((await student.next("broadcast_start")).source, "teacher");
  teacher.sendJson({ type: "broadcast_frame", data: "/9j/AAAA" });
  assert.equal((await student.next("broadcast_frame")).data, "/9j/AAAA");
  teacher.sendJson({ type: "broadcast_stop" });
  await student.next("broadcast_stop");

  // 재접속(토큰) 시 잠금 상태 유지 + 같은 학생으로 인식
  student.close();
  await teacher.next("student_update", (m) => !m.student.online);
  const again = await connect();
  again.sendJson({ type: "hello", role: "student", token: welcome.token });
  const w2 = await again.next("welcome");
  assert.equal(w2.studentId, sid);
  assert.equal(w2.locked, true);
  assert.equal(w2.policy.appMode, "blacklist");

  const report = await api("GET", `/api/classes/${cls.id}/report`);
  assert.equal(report.body.students[0].violations.app, 1);
  assert.equal(report.body.students[0].connects, 2);

  // 학생 제거
  assert.equal((await api("DELETE", `/api/classes/${cls.id}/students/${sid}`)).status, 200);
  await again.next("removed");

  teacher.close();
  bad.close();
});

test("schedule validation errors return 400", async () => {
  const { body: cls } = await api("POST", "/api/classes", { name: "x" });
  const res = await api("PUT", `/api/classes/${cls.id}/schedule`, {
    enabled: true,
    entries: [{ label: "1교시", days: [1], start: "10:00", end: "09:00" }],
  });
  assert.equal(res.status, 400);
});
