import dns from "node:dns/promises";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { passwordMatches, RateLimiter, verifyGoogleIdToken } from "./auth.js";
import {
  BOARD_TYPES,
  STATS_COLUMNS,
  activeSeats,
  cleanQuiz,
  clonePages,
  createLesson,
  csv,
  fmtDate,
  frameable,
  gradeSubmission,
  lessonStats,
  newPage,
  normalizeLink,
  runSummary,
} from "./lesson.js";
import { normEmail } from "./store.js";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".apk": "application/vnd.android.package-archive",
  ".txt": "text/plain; charset=utf-8",
};

const PAGES = {
  "/": "student.html",
  "/s": "student.html",
  "/join": "student.html",
  "/teacher": "teacher.html",
  "/guide": "guide.html",
  "/app": "app.html",
  "/privacy": "privacy.html",
};

const IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function download(res, filename, text) {
  res.writeHead(200, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "cache-control": "no-store",
  });
  res.end(text);
}

async function readBody(req, limit) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "파일이 너무 커요");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const buf = await readBody(req, 512 * 1024);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    throw new HttpError(400, "요청 형식이 올바르지 않아요");
  }
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:");
}

/** 링크 미리 확인: 앱 안(iframe)에 넣을 수 있는지와 제목을 알아냅니다. 내부망 주소는 확인하지 않습니다. */
async function inspectLink(url) {
  const u = new URL(url);
  const addrs = await dns.lookup(u.hostname, { all: true }).catch(() => []);
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) return { reachable: false };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": "Mozilla/5.0 (Linux; Android 14) WooriClass/1.0", accept: "text/html" },
    });
    let title = "";
    if ((res.headers.get("content-type") ?? "").includes("text/html") && res.body) {
      const reader = res.body.getReader();
      let html = "";
      while (html.length < 65536) {
        const { value, done } = await reader.read();
        if (done) break;
        html += Buffer.from(value).toString("utf8");
        const m = /<title[^>]*>([^<]{1,120})<\/title>/i.exec(html);
        if (m) {
          title = m[1].replace(/\s+/g, " ").trim();
          break;
        }
      }
      reader.cancel().catch(() => {});
    }
    return { reachable: res.ok, frameable: frameable(res.headers), title };
  } catch {
    return { reachable: false };
  } finally {
    clearTimeout(timer);
  }
}

export function createHandler({ store, hub, auth, config }) {
  const loginLimiter = new RateLimiter(20, 60_000);

  // ------------------------------------------------------------ auth helpers
  function sessionOf(req) {
    const h = req.headers.authorization ?? "";
    return hub.session(h.startsWith("Bearer ") ? h.slice(7) : null);
  }

  function requireSession(req) {
    const s = sessionOf(req);
    if (!s) throw new HttpError(401, "다시 로그인해 주세요");
    return s;
  }

  function requireAdmin(req) {
    const s = requireSession(req);
    if (!s.admin) throw new HttpError(403, "관리자만 할 수 있어요");
    return s;
  }

  function classFor(session, id) {
    const cls = store.getClass(id);
    if (!cls) throw new HttpError(404, "반을 찾을 수 없어요");
    if (!hub.canAccess(session, cls)) throw new HttpError(403, "맡은 반이 아니에요");
    return cls;
  }

  function lessonFor(session, id) {
    const lesson = store.getLesson(id);
    if (!lesson) throw new HttpError(404, "수업을 찾을 수 없어요");
    classFor(session, lesson.classId);
    return lesson;
  }

  function liveLesson(session, id) {
    const lesson = lessonFor(session, id);
    if (lesson.endedAt || lesson.closed) throw new HttpError(409, "끝난 수업이에요");
    return lesson;
  }

  function myClasses(session) {
    return store.listClasses().filter((c) => hub.canAccess(session, c));
  }

  function meView(session) {
    const t = session.email ? store.teacher(session.email) : null;
    return {
      email: session.email,
      name: t?.name || (session.email ? session.email.split("@")[0] : "관리자"),
      admin: session.admin,
      classes: myClasses(session).map((c) => classSummary(c)),
    };
  }

  function classSummary(c) {
    const lesson = store.currentLesson(c.id);
    const active = lesson && !lesson.endedAt && !lesson.closed;
    const online = active ? hub.studentsOf(lesson.id).length : 0;
    return {
      id: c.id,
      name: c.name,
      seats: activeSeats(c).length,
      teachers: c.teachers,
      lesson: active ? { title: lesson.title, code: lesson.code, online } : null,
    };
  }

  function issue(session) {
    return auth.issueTeacher(session, config.teacherTokenTtlMs);
  }

  // ------------------------------------------------------------ lesson helpers
  function startLesson(cls, { title, fromLessonId, board }, session) {
    const prev = store.currentLesson(cls.id);
    if (prev && !prev.endedAt && !prev.closed) {
      prev.closed = true;
      store.touchLesson(prev.id);
      hub.endLesson(prev);
    }
    let pages = [];
    if (fromLessonId) {
      const from = lessonFor(session, fromLessonId);
      pages = clonePages(from.pages);
    }
    if (BOARD_TYPES.includes(board)) pages.unshift(newPage("board", { board }));
    const lesson = createLesson({ cls, title: String(title ?? "").trim().slice(0, 60), code: store.newCode(), pages });
    store.addLesson(lesson);
    hub.refreshTeachers(cls.id);
    return lesson;
  }

  function insertPage(lesson, page) {
    lesson.pages.push(page);
    if (!lesson.teacherPage) lesson.teacherPage = page.id;
    store.touchLesson(lesson.id);
    hub.pagesChanged(lesson);
    return page;
  }

  function reviewOf(lesson) {
    const cls = store.getClass(lesson.classId);
    const runs = lesson.quizRuns.map((id) => store.getRun(id)).filter(Boolean);
    const seats = (cls ? activeSeats(cls) : Object.keys(lesson.seats).map(Number)).map((seat) => {
      const r = lesson.seats[seat] ?? {};
      const inkCount = Object.values(r.ink ?? {}).reduce((n, l) => n + l.length, 0);
      let memos = 0;
      for (const g of lesson.groupHistory) for (const m of Object.values(g.memos)) memos += m.filter((x) => x.by === seat).length;
      return {
        seat,
        joinedAt: r.joinedAt ?? null,
        inkCount,
        awayCount: r.awayCount ?? 0,
        linkOpens: r.linkOpens ?? 0,
        explores: r.explores ?? [],
        tabs: r.tabs ?? [],
        memos,
        feedback: r.feedback ?? "",
        ink: r.ink ?? {},
        quiz: runs.map((run) => (run.answers[seat]?.submittedAt ? gradeSubmission(run, seat).percent : null)),
      };
    });
    return {
      lesson: { ...lessonStats(lesson), className: lesson.className, classId: lesson.classId, pages: lesson.pages, teacherInk: lesson.teacherInk },
      quizzes: runs.map((r) => ({ id: r.id, title: r.quiz.title })),
      groupHistory: lesson.groupHistory,
      seats,
    };
  }

  // ------------------------------------------------------------ router
  async function api(req, res, url) {
    const parts = url.pathname.split("/").filter(Boolean).slice(1);
    const m = req.method;
    const [a, b, c, d] = parts;

    // ---------- 공개
    if (a === "health") return json(res, 200, { ok: true });
    if (a === "config" && m === "GET") {
      return json(res, 200, { schoolName: config.schoolName, appName: config.appName, googleClientId: config.googleClientId });
    }
    if (a === "join" && b && m === "GET") {
      const lesson = store.activeByCode(b);
      if (!lesson) throw new HttpError(404, "방 코드가 맞지 않거나 수업이 끝났어요");
      const cls = store.getClass(lesson.classId);
      const taken = Object.entries(lesson.seats).filter(([, r]) => r.deviceId).map(([n]) => Number(n));
      return json(res, 200, { className: cls.name, title: lesson.title, seats: activeSeats(cls), taken, entryLocked: lesson.entryLocked });
    }
    if (a === "login" && m === "POST") {
      if (!loginLimiter.allow(req.socket.remoteAddress)) throw new HttpError(429, "잠시 뒤에 다시 해 주세요");
      const body = await readJson(req);
      if (b === "google") {
        const g = await verifyGoogleIdToken(body.credential, config.googleClientId);
        if (!g) throw new HttpError(401, "구글 로그인을 확인하지 못했어요");
        const isAdmin = config.adminEmails.includes(g.email);
        const t = store.teacher(g.email);
        if (isAdmin && !t) store.upsertTeacher(g.email, { name: g.name, status: "approved", admin: true });
        if (isAdmin || t?.status === "approved") {
          const session = { email: g.email, admin: isAdmin || t?.admin === true };
          return json(res, 200, { token: issue(session), me: meView(session) });
        }
        return json(res, 200, { need: "request", email: g.email, name: t?.name || g.name, status: t?.status ?? null });
      }
      if (!passwordMatches(body.password, config.adminPassword)) throw new HttpError(401, "비밀번호가 맞지 않아요");
      const session = { email: null, admin: true };
      return json(res, 200, { token: issue(session), me: meView(session) });
    }
    if (a === "request" && m === "POST") {
      const body = await readJson(req);
      const g = await verifyGoogleIdToken(body.credential, config.googleClientId);
      if (!g) throw new HttpError(401, "구글 로그인을 확인하지 못했어요");
      const name = String(body.name ?? "").trim().slice(0, 30);
      if (!name) throw new HttpError(400, "이름을 넣어 주세요");
      const t = store.teacher(g.email);
      if (t?.status === "approved") throw new HttpError(409, "이미 승인됐어요. 다시 로그인해 주세요");
      store.upsertTeacher(g.email, { name, note: String(body.note ?? "").trim().slice(0, 60), status: "pending", requestedAt: Date.now() });
      return json(res, 200, { ok: true });
    }

    // ---------- 로그인 필요
    const session = requireSession(req);

    if (a === "me" && m === "GET") return json(res, 200, meView(session));

    // ---------- 관리자
    if (a === "admin") {
      requireAdmin(req);
      if (b === undefined && m === "GET") {
        return json(res, 200, {
          classes: store.listClasses().map((cl) => classSummary(cl)),
          teachers: store.listTeachers(),
          adminEmails: config.adminEmails,
        });
      }
      if (b === "classes") {
        if (!c && m === "POST") {
          const body = await readJson(req);
          const name = String(body.name ?? "").trim().slice(0, 30);
          if (!name) throw new HttpError(400, "반 이름을 넣어 주세요");
          const seats = Math.min(40, Math.max(1, Number(body.seats) || 24));
          return json(res, 201, classSummary(store.createClass({ name, seats })));
        }
        const cls = store.getClass(c);
        if (!cls) throw new HttpError(404, "반을 찾을 수 없어요");
        if (m === "PATCH") {
          const body = await readJson(req);
          if (body.name) cls.name = String(body.name).trim().slice(0, 30);
          if (Array.isArray(body.teachers)) cls.teachers = [...new Set(body.teachers.map(normEmail).filter(Boolean))];
          store.touch();
          return json(res, 200, classSummary(cls));
        }
        if (m === "DELETE") {
          const lesson = store.currentLesson(cls.id);
          if (lesson) hub.endLesson(lesson);
          store.deleteClass(cls.id);
          return json(res, 200, { ok: true });
        }
      }
      if (b === "teachers") {
        if (!c && m === "POST") {
          const body = await readJson(req);
          const email = normEmail(body.email);
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, "이메일 형식이 맞지 않아요");
          return json(res, 201, store.upsertTeacher(email, { name: String(body.name ?? "").slice(0, 30), status: "approved" }));
        }
        const email = decodeURIComponent(c ?? "");
        if (!store.teacher(email)) throw new HttpError(404, "선생님을 찾을 수 없어요");
        if (m === "PATCH") {
          const body = await readJson(req);
          const patch = {};
          if (["approved", "rejected", "pending"].includes(body.status)) patch.status = body.status;
          if (typeof body.admin === "boolean") patch.admin = body.admin;
          if (typeof body.name === "string") patch.name = body.name.slice(0, 30);
          const t = store.upsertTeacher(email, patch);
          if (Array.isArray(body.classIds)) {
            for (const cl of store.listClasses()) {
              const has = cl.teachers.includes(t.email);
              const want = body.classIds.includes(cl.id);
              if (want && !has) cl.teachers.push(t.email);
              if (!want && has) cl.teachers = cl.teachers.filter((e) => e !== t.email);
            }
            store.touch();
          }
          return json(res, 200, t);
        }
        if (m === "DELETE") {
          store.deleteTeacher(email);
          return json(res, 200, { ok: true });
        }
      }
      if (b === "usage" && m === "GET") return json(res, 200, store.usage());
      if (b === "stats.csv" && m === "GET") {
        const rows = [["반", ...STATS_COLUMNS.map(([, l]) => l)]];
        for (const cl of store.listClasses()) {
          for (const l of store.listLessons(cl.id)) {
            const st = lessonStats(l);
            rows.push([cl.name, ...STATS_COLUMNS.map(([k]) => (k === "startedAt" ? fmtDate(st[k], config.timezone) : st[k]))]);
          }
        }
        return download(res, "모든 반 활용 기록.csv", csv(rows));
      }
      throw new HttpError(404, "Not found");
    }

    // ---------- 반
    if (a === "classes" && b) {
      const cls = classFor(session, b);
      if (!c && m === "PATCH") {
        const body = await readJson(req);
        if (body.seats != null) cls.seats = Math.min(40, Math.max(1, Math.round(Number(body.seats)) || cls.seats));
        if (Array.isArray(body.disabledSeats)) {
          cls.disabledSeats = [...new Set(body.disabledSeats.map(Number))].filter((n) => n >= 1 && n <= cls.seats);
        }
        store.touch();
        hub.refreshTeachers(cls.id);
        return json(res, 200, { ok: true });
      }
      if (c === "lessons") {
        if (m === "POST") {
          const lesson = startLesson(cls, await readJson(req), session);
          return json(res, 201, { id: lesson.id, code: lesson.code });
        }
        if (m === "GET") return json(res, 200, store.listLessons(cls.id).map(lessonStats));
      }
      if (c === "stats.csv" && m === "GET") {
        const rows = [STATS_COLUMNS.map(([, l]) => l)];
        for (const l of store.listLessons(cls.id)) {
          const st = lessonStats(l);
          rows.push(STATS_COLUMNS.map(([k]) => (k === "startedAt" ? fmtDate(st[k], config.timezone) : st[k])));
        }
        return download(res, `${cls.name} 활용 기록.csv`, csv(rows));
      }
      if (c === "quiz-runs" && m === "GET") {
        return json(
          res,
          200,
          store.listRuns(cls.id).map((r) => ({ id: r.id, title: r.quiz.title, quizId: r.quizId, lessonTitle: r.lessonTitle, startedAt: r.startedAt, ...runSummary(r) })),
        );
      }
      if (c === "quiz-scores.csv" && m === "GET") {
        const runs = store.listRuns(cls.id).reverse();
        const rows = [["번호", ...runs.map((r) => `${fmtDate(r.startedAt, config.timezone)} ${r.quiz.title}`)]];
        for (const s of activeSeats(cls)) {
          rows.push([s, ...runs.map((r) => (r.answers[s]?.submittedAt ? gradeSubmission(r, s).percent : ""))]);
        }
        return download(res, `${cls.name} 학생별 퀴즈 점수.csv`, csv(rows));
      }
      throw new HttpError(404, "Not found");
    }

    // ---------- 다른 반 포함, 내가 맡은 반들의 지난 수업 (자료 가져오기)
    if (a === "lessons" && !b && m === "GET") {
      const out = [];
      for (const cl of myClasses(session)) {
        for (const l of store.listLessons(cl.id)) {
          if (l.pages.length) out.push({ id: l.id, title: l.title || "제목 없음", className: cl.name, startedAt: l.startedAt, pages: l.pages.length, kinds: l.pages.map((p) => p.kind) });
        }
      }
      return json(res, 200, out.sort((x, y) => y.startedAt - x.startedAt).slice(0, 200));
    }

    // ---------- 수업
    if (a === "lessons" && b) {
      if (!c && m === "PATCH") {
        const lesson = lessonFor(session, b);
        const body = await readJson(req);
        lesson.title = String(body.title ?? "").trim().slice(0, 60);
        store.touchLesson(lesson.id);
        hub.titleChanged(lesson);
        return json(res, 200, { ok: true });
      }
      if (c === "end" && m === "POST") {
        const lesson = liveLesson(session, b);
        lesson.endedAt = Date.now();
        if (lesson.group?.active) hub.groupStop(lesson, store.getClass(lesson.classId));
        if (lesson.quizRunId) hub.quizFlow(lesson, "quiz_end");
        lesson.link = null;
        lesson.locked = false;
        store.touchLesson(lesson.id);
        hub.endLesson(lesson);
        return json(res, 200, lessonStats(lesson));
      }
      if (c === "pages") {
        const lesson = liveLesson(session, b);
        if (d === "image" && m === "POST") {
          const ext = IMAGE_TYPES[(req.headers["content-type"] ?? "").split(";")[0]];
          if (!ext) throw new HttpError(415, "PDF는 화면에서 그림으로 바꿔 올려요. 그림 파일만 받아요");
          const buf = await readBody(req, config.maxUploadBytes);
          const w = Number(url.searchParams.get("w")) || 0;
          const h = Number(url.searchParams.get("h")) || 0;
          const page = newPage("image", {
            src: `/files/${store.saveFile(buf, ext)}`,
            ar: w > 0 && h > 0 ? Math.round((w / h) * 1000) / 1000 : 0.707,
            name: String(url.searchParams.get("name") ?? "").slice(0, 80),
          });
          return json(res, 201, insertPage(lesson, page));
        }
        if (!d && m === "POST") {
          const body = await readJson(req);
          if (body.kind === "board") {
            const page = insertPage(lesson, newPage("board", { board: BOARD_TYPES.includes(body.board) ? body.board : "blank" }));
            if (body.follow) {
              lesson.teacherPage = page.id;
              lesson.follow = true;
              lesson.counters.follow += 1;
              hub.broadcastFlags(lesson);
            }
            return json(res, 201, page);
          }
          if (body.kind === "link") {
            const n = normalizeLink(body.link?.url);
            if (!n) throw new HttpError(400, "주소가 올바르지 않아요");
            const how = body.link.how === "out" ? "out" : "in";
            const page = newPage("link", {
              link: { url: n.url, embed: how === "out" ? n.url : n.embed, title: String(body.link.title ?? "").slice(0, 60) || n.title || new URL(n.url).hostname, how, login: body.link.login === true },
            });
            return json(res, 201, insertPage(lesson, page));
          }
          throw new HttpError(400, "알 수 없는 쪽이에요");
        }
        if (!d && m === "PUT") {
          const body = await readJson(req);
          const byId = new Map(lesson.pages.map((p) => [p.id, p]));
          const order = (Array.isArray(body.order) ? body.order : []).filter((id) => byId.has(id));
          if (order.length !== lesson.pages.length) throw new HttpError(400, "쪽 목록이 맞지 않아요");
          lesson.pages = order.map((id) => byId.get(id));
          store.touchLesson(lesson.id);
          hub.pagesChanged(lesson);
          return json(res, 200, { ok: true });
        }
        if (d && m === "DELETE") {
          lesson.pages = lesson.pages.filter((p) => p.id !== d);
          if (lesson.teacherPage === d) lesson.teacherPage = lesson.pages[0]?.id ?? null;
          store.touchLesson(lesson.id);
          hub.pagesChanged(lesson);
          return json(res, 200, { ok: true });
        }
      }
      if (c === "import" && m === "POST") {
        const lesson = liveLesson(session, b);
        const body = await readJson(req);
        const from = lessonFor(session, body.fromLessonId);
        for (const p of clonePages(from.pages)) lesson.pages.push(p);
        lesson.teacherPage ??= lesson.pages[0]?.id ?? null;
        store.touchLesson(lesson.id);
        hub.pagesChanged(lesson);
        return json(res, 200, { ok: true, pages: lesson.pages.length });
      }
      if (c === "review" && m === "GET") return json(res, 200, reviewOf(lessonFor(session, b)));
      if (c === "feedback" && m === "PUT") {
        const lesson = lessonFor(session, b);
        const body = await readJson(req);
        const seat = Number(body.seat);
        if (!lesson.seats[seat]) lesson.seats[seat] = { ink: {}, explores: [], tabs: [], awayCount: 0, linkOpens: 0 };
        lesson.seats[seat].feedback = String(body.text ?? "").slice(0, 1000);
        store.touchLesson(lesson.id);
        return json(res, 200, { ok: true });
      }
      if (c === "review.csv" && m === "GET") {
        const lesson = lessonFor(session, b);
        const r = reviewOf(lesson);
        const rows = [["번호", "들어온 시각", "필기(획)", "앱 벗어남", "링크 연 횟수", "찾아보기", "모둠 메모", ...r.quizzes.map((q) => `퀴즈: ${q.title}`), "피드백"]];
        for (const s of r.seats) {
          rows.push([
            s.seat,
            fmtDate(s.joinedAt, config.timezone),
            s.inkCount,
            s.awayCount,
            s.linkOpens,
            s.explores.map((e) => e.q || e.url).join(" / "),
            s.memos,
            ...s.quiz.map((v) => (v == null ? "" : v)),
            s.feedback,
          ]);
        }
        return download(res, `${lesson.className} ${lesson.title || "수업"} 학생 활동.csv`, csv(rows));
      }
      throw new HttpError(404, "Not found");
    }

    // ---------- 링크 미리 확인
    if (a === "link-check" && m === "GET") {
      const n = normalizeLink(url.searchParams.get("url"));
      if (!n) throw new HttpError(400, "주소가 올바르지 않아요");
      const info = await inspectLink(n.embed);
      const how = n.how ?? (info.reachable === false ? null : info.frameable === false ? "out" : "in");
      return json(res, 200, { ...n, how, title: n.title || info.title || "", frameable: info.frameable ?? null, reachable: info.reachable });
    }

    // ---------- 퀴즈 (모든 반이 함께 씀)
    if (a === "quizzes") {
      if (!b && m === "GET") return json(res, 200, store.listQuizzes());
      if (!b && m === "POST") {
        try {
          return json(res, 201, store.saveQuiz({ ...cleanQuiz(await readJson(req)), author: session.email }));
        } catch (err) {
          throw err instanceof HttpError ? err : new HttpError(400, err.message);
        }
      }
      const quiz = store.getQuiz(b);
      if (!quiz) throw new HttpError(404, "퀴즈를 찾을 수 없어요");
      if (m === "PUT") {
        try {
          return json(res, 200, store.saveQuiz({ ...cleanQuiz(await readJson(req), quiz), author: quiz.author }));
        } catch (err) {
          throw err instanceof HttpError ? err : new HttpError(400, err.message);
        }
      }
      if (m === "DELETE") {
        store.deleteQuiz(quiz.id);
        return json(res, 200, { ok: true });
      }
    }
    if (a === "quiz-runs" && b && m === "GET") {
      const run = store.getRun(b);
      if (!run) throw new HttpError(404, "결과를 찾을 수 없어요");
      classFor(session, run.classId);
      return json(res, 200, hub.quizDash(run));
    }

    throw new HttpError(404, "Not found");
  }

  function serveFile(res, name) {
    const buf = store.readFile(name);
    if (!buf) return json(res, 404, { error: "Not found" });
    res.writeHead(200, { "content-type": MIME[path.extname(name)] ?? "application/octet-stream", "cache-control": "public, max-age=31536000, immutable" });
    res.end(buf);
  }

  function serveStatic(res, pathname) {
    const rel = PAGES[pathname] ?? pathname.slice(1);
    const resolved = path.resolve(config.publicDir, rel);
    if (!resolved.startsWith(config.publicDir + path.sep) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(resolved)] ?? "application/octet-stream",
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
    });
    fs.createReadStream(resolved).pipe(res);
  }

  return async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
      if (url.pathname.startsWith("/api/")) return await api(req, res, url);
      if (url.pathname.startsWith("/files/")) return serveFile(res, url.pathname.slice(7));
      if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "Method not allowed");
      return serveStatic(res, url.pathname);
    } catch (err) {
      if (err instanceof HttpError) return json(res, err.status, { error: err.message });
      console.error("[http]", err);
      return json(res, 500, { error: "서버 오류가 났어요" });
    }
  };
}
