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
    const i = waiters.findIndex((w) => w.match(msg));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
    else queue.push(msg);
  });
  ws.next = (type, pred = () => true) =>
    new Promise((resolve, reject) => {
      const match = (m) => m.type === type && pred(m);
      const i = queue.findIndex(match);
      if (i >= 0) return resolve(queue.splice(i, 1)[0]);
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), 3000);
      waiters.push({ match, resolve: (m) => (clearTimeout(timer), resolve(m)) });
    });
  ws.sendJson = (m) => ws.send(JSON.stringify(m));
  ws.closed = new Promise((resolve) => ws.on("close", (code) => resolve(code)));
  return new Promise((resolve) => ws.on("open", () => resolve(ws)));
}

async function api(method, path, body, headers = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body instanceof Uint8Array ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body == null ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch {}
  return { status: res.status, body: parsed };
}

async function student(code, seat, deviceId, kind = "web") {
  const ws = await connect();
  ws.sendJson({ type: "hello", role: "student", code, seat, deviceId, kind });
  return ws;
}

before(async () => {
  const config = { ...loadConfig({}), port: 0, host: "127.0.0.1", dataDir: "", adminPassword: "pw" };
  app = createServer(config);
  const { port } = await app.listen();
  base = `http://127.0.0.1:${port}`;
});

after(async () => app.close());

test("admin login, classes, teacher approval", async () => {
  assert.equal((await api("GET", "/api/me")).status, 401);
  assert.equal((await api("POST", "/api/login", { password: "nope" })).status, 401);
  token = (await api("POST", "/api/login", { password: "pw" })).body.token;
  assert.ok(token);

  const cls = (await api("POST", "/api/admin/classes", { name: "박선택반", seats: 24 })).body;
  assert.equal(cls.seats, 24);
  const t = await api("POST", "/api/admin/teachers", { email: "Kim@School.kr", name: "김선생" });
  assert.equal(t.body.email, "kim@school.kr");
  await api("PATCH", `/api/admin/teachers/${encodeURIComponent("kim@school.kr")}`, { classIds: [cls.id] });
  const admin = (await api("GET", "/api/admin")).body;
  assert.deepEqual(admin.classes[0].teachers, ["kim@school.kr"]);

  // 선생님 토큰은 맡은 반만 볼 수 있음
  const teacherToken = app.auth.issueTeacher({ email: "kim@school.kr" }, 60_000);
  const me = await fetch(`${base}/api/me`, { headers: { authorization: `Bearer ${teacherToken}` } }).then((r) => r.json());
  assert.equal(me.classes.length, 1);
  await api("PATCH", `/api/admin/teachers/${encodeURIComponent("kim@school.kr")}`, { status: "rejected" });
  const denied = await fetch(`${base}/api/me`, { headers: { authorization: `Bearer ${teacherToken}` } });
  assert.equal(denied.status, 401);
});

test("full lesson: join, ink, follow, lock, link, entry lock, release, share, quiz, groups, end", async () => {
  const cls = (await api("POST", "/api/admin/classes", { name: "3-2", seats: 5 })).body;
  await api("PATCH", `/api/classes/${cls.id}`, { disabledSeats: [5] });

  const teacher = await connect();
  teacher.sendJson({ type: "hello", role: "teacher", token, classId: cls.id });
  assert.equal((await teacher.next("state")).lesson, null);

  const started = await api("POST", `/api/classes/${cls.id}/lessons`, { title: "3교시 수학", board: "grid" });
  assert.match(started.body.code, /^\d{4}$/);
  const code = started.body.code;
  const lessonId = started.body.id;
  const state = await teacher.next("state", (m) => m.lesson);
  assert.equal(state.lesson.pages[0].kind, "board");
  assert.equal(state.seats.length, 4); // 5번 사용 안 함
  const pageId = state.lesson.pages[0].id;

  // 활동지 그림 올리기
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  const up = await api("POST", `/api/lessons/${lessonId}/pages/image?w=800&h=1131&name=a.pdf`, png, { "content-type": "image/png" });
  assert.equal(up.status, 201);
  assert.equal((await fetch(base + up.body.src)).status, 200);
  await teacher.next("pages");

  // 학생 입장 화면 정보
  const join = (await api("GET", `/api/join/${code}`)).body;
  assert.deepEqual(join.seats, [1, 2, 3, 4]);
  assert.equal((await api("GET", "/api/join/0000")).status, 404);

  const s1 = await student(code, 1, "dev-1");
  const w1 = await s1.next("welcome");
  assert.equal(w1.className, "3-2");
  assert.equal(w1.lesson.pages.length, 2);
  assert.equal((await teacher.next("seat", (m) => m.seat.seat === 1)).seat.status, "here");

  // 같은 번호, 다른 기기 → 거부
  const dup = await student(code, 1, "dev-x");
  assert.equal((await dup.next("rejected")).reason, "taken");
  // 없는 번호 → 거부
  const bad = await student(code, 5, "dev-5");
  assert.equal((await bad.next("rejected")).reason, "seat");

  // 선생님 판서 → 학생, 학생 필기 → 선생님
  teacher.sendJson({ type: "ink", pageId, stroke: { p: [0.1, 0.1, 0.2, 0.2], c: "#e5484d" } });
  assert.equal((await s1.next("ink")).who, "teacher");
  s1.sendJson({ type: "ink", pageId, stroke: { p: [0.3, 0.3, 0.4, 0.4] } });
  assert.equal((await teacher.next("ink", (m) => m.who === 1)).pageId, pageId);
  s1.sendJson({ type: "ink_undo", pageId });
  assert.deepEqual((await teacher.next("ink_set", (m) => m.who === 1)).strokes, []);

  // 따라오기 + 모두 멈춤
  teacher.sendJson({ type: "set", follow: true, locked: true, teacherPage: up.body.id });
  const flags = await s1.next("flags");
  assert.deepEqual([flags.follow, flags.locked, flags.teacherPage], [true, true, up.body.id]);

  // 앱 벗어남 감지
  s1.sendJson({ type: "status", visible: false, link: "none" });
  const away = await teacher.next("seat", (m) => m.seat.status === "away");
  assert.equal(away.seat.awayCount, 1);
  s1.sendJson({ type: "status", visible: true, link: "none" });
  await teacher.next("seat", (m) => m.seat.status === "here");

  // 링크 보내기 / 모두 돌아오기
  teacher.sendJson({ type: "link_send", link: { url: "https://youtu.be/dQw4w9WgXcQ", how: "in" } });
  const link = await s1.next("link");
  assert.equal(link.link.embed, "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  s1.sendJson({ type: "link_open" });
  s1.sendJson({ type: "status", visible: true, link: "in" });
  await teacher.next("seat", (m) => m.seat.status === "link");
  teacher.sendJson({ type: "link_back" });
  assert.equal((await s1.next("link")).back, true);

  // 입장 잠그기: 새 기기는 거부, 들어온 기기는 다시 들어옴
  teacher.sendJson({ type: "set", entryLocked: true });
  await teacher.next("flags", (m) => m.entryLocked);
  const late = await student(code, 2, "dev-2");
  assert.equal((await late.next("rejected")).reason, "locked");
  assert.equal((await teacher.next("entry_blocked")).seat, 2);
  s1.close();
  await teacher.next("seat", (m) => m.seat.seat === 1 && m.seat.status === "off");
  const s1b = await student(code, 1, "dev-1", "app");
  assert.equal((await s1b.next("welcome")).seat, 1);
  teacher.sendJson({ type: "set", entryLocked: false });
  await teacher.next("flags", (m) => !m.entryLocked);
  const s2 = await student(code, 2, "dev-2");
  await s2.next("welcome");

  // 학생 화면 보기(앱) → 캡처 지시, 프레임은 선생님에게
  teacher.sendJson({ type: "snap", on: true });
  assert.equal((await s1b.next("capture", (m) => m.mode === "snap")).intervalMs, 4000);
  s1b.sendJson({ type: "frame", data: "/9j/4AAQSkZJRgABAQAAAQABAAD", w: 360, h: 240 });
  assert.equal((await teacher.next("frame")).seat, 1);

  // 모두에게 보여 주기(발표): 1번 화면이 2번에게
  teacher.sendJson({ type: "present", seat: 1 });
  assert.equal((await s2.next("share")).from, 1);
  assert.equal((await s1b.next("capture", (m) => m.mode === "live")).mode, "live");
  s1b.sendJson({ type: "frame", data: "/9j/4AAQSkZJRgABAQAAAQABAAE", w: 960, h: 600 });
  assert.equal((await s2.next("share_frame")).from, 1);
  teacher.sendJson({ type: "present", seat: null });
  assert.equal((await s2.next("share")).from, null);

  // 자리 비우기
  teacher.sendJson({ type: "release_seat", seat: 2 });
  await s2.next("released");
  const again = await student(code, 2, "dev-3");
  await again.next("welcome");

  // 퀴즈
  const quiz = (await api("POST", "/api/quizzes", {
    title: "확인 퀴즈",
    items: [
      { type: "ox", q: "1/2 = 2/4", answer: "O" },
      { type: "short", q: "1/2+1/4?", answer: "3/4" },
    ],
  })).body;
  teacher.sendJson({ type: "quiz_start", quizId: quiz.id, reveal: "instant" });
  const q = await s1b.next("quiz", (m) => m.quiz);
  assert.equal(q.quiz.items[0].answer, undefined, "정답은 학생에게 가지 않음");
  s1b.sendJson({ type: "quiz_submit", answers: ["O", "0.75"] });
  const result = await s1b.next("quiz", (m) => m.quiz?.result);
  assert.equal(result.quiz.result.percent, 50);
  const dash = await teacher.next("quiz_dash", (m) => m.run?.summary.submitted === 1);
  teacher.sendJson({ type: "quiz_accept", runId: dash.run.id, idx: 1, answer: "0.75" });
  assert.equal((await s1b.next("quiz", (m) => m.quiz?.result?.percent === 100)).quiz.result.percent, 100);
  teacher.sendJson({ type: "quiz_end" });
  assert.equal((await s1b.next("quiz", (m) => m.quiz === null)).quiz, null);

  // 모둠
  teacher.sendJson({ type: "group_set", n: 2, assign: { 1: 1, 2: 1, 3: 2, 4: 2 } });
  await teacher.next("groups");
  teacher.sendJson({ type: "group_start", bg: "grid" });
  const grp = await s1b.next("group", (m) => m.group);
  assert.deepEqual(grp.group.members, [1, 2]);
  s1b.sendJson({ type: "gink", stroke: { p: [0.1, 0.1, 0.5, 0.5] } });
  assert.equal((await again.next("gink")).g, "1");
  s1b.sendJson({ type: "gmemo", memo: { text: "우리 생각", x: 0.2, y: 0.2 } });
  assert.equal((await teacher.next("gmemo")).memo.by, 1);
  teacher.sendJson({ type: "group_lock", g: "1", locked: true });
  assert.equal((await s1b.next("group", (m) => m.group?.locked)).group.locked, true);
  teacher.sendJson({ type: "group_stop" });
  assert.equal((await s1b.next("group", (m) => m.group === null)).group, null);

  // 수업 끝내기
  const ended = await api("POST", `/api/lessons/${lessonId}/end`);
  assert.equal(ended.body.participants, 2); // 1번·2번 자리 (2번은 기기가 바뀌어도 한 자리)
  await s1b.next("ended");
  assert.equal((await api("GET", `/api/join/${code}`)).status, 404);

  // 활용 기록 · 돌아보기 · 피드백 · CSV
  const lessons = (await api("GET", `/api/classes/${cls.id}/lessons`)).body;
  assert.equal(lessons[0].title, "3교시 수학");
  assert.equal(lessons[0].links, 1);
  assert.equal(lessons[0].quizzes, 1);
  assert.equal(lessons[0].away, 1);
  await api("PUT", `/api/lessons/${lessonId}/feedback`, { seat: 1, text: "분수 덧셈을 잘했어요" });
  const review = (await api("GET", `/api/lessons/${lessonId}/review`)).body;
  const r1 = review.seats.find((s) => s.seat === 1);
  assert.equal(r1.feedback, "분수 덧셈을 잘했어요");
  assert.equal(r1.linkOpens, 1);
  assert.equal(r1.memos, 1);
  assert.deepEqual(r1.quiz, [100]);
  const reviewCsv = await api("GET", `/api/lessons/${lessonId}/review.csv`);
  assert.match(reviewCsv.body, /분수 덧셈을 잘했어요/);
  const statsCsv = await api("GET", `/api/classes/${cls.id}/stats.csv`);
  assert.match(statsCsv.body, /3교시 수학/);

  // 지난 수업 자료로 새 수업 (필기는 옮기지 않음)
  const next = (await api("POST", `/api/classes/${cls.id}/lessons`, { title: "다음 시간", fromLessonId: lessonId })).body;
  const st2 = await teacher.next("state", (m) => m.lesson?.id === next.id);
  assert.equal(st2.lesson.pages.length, 2);
  assert.deepEqual(st2.lesson.teacherInk, {});

  for (const ws of [teacher, dup, bad, late, again]) ws.close();
});
