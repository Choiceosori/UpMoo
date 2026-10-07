import fs from "node:fs";
import path from "node:path";
import { passwordMatches, RateLimiter } from "./auth.js";
import { PRESETS, defaultPolicy, normalizePolicy } from "./policy.js";
import { defaultSchedule, normalizeSchedule } from "./scheduler.js";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

const PAGES = { "/": "index.html", "/student": "student.html", "/join": "student.html" };

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req, limit = 256 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "요청 본문이 너무 큽니다");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "JSON 형식이 올바르지 않습니다");
  }
}

function classView(cls, hub) {
  const students = hub.store.listStudents(cls.id);
  return {
    id: cls.id,
    name: cls.name,
    pin: cls.pin,
    createdAt: cls.createdAt,
    policy: cls.policy ?? defaultPolicy(),
    schedule: cls.schedule ?? defaultSchedule(),
    activeEntryId: cls.scheduleState?.activeEntryId ?? null,
    studentCount: students.length,
    onlineCount: students.filter((s) => hub.students.has(s.id)).length,
  };
}

export function createHandler({ store, hub, auth, config }) {
  const loginLimiter = new RateLimiter(10, 60_000);

  function requireTeacher(req) {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (auth.verify(token)?.role !== "teacher") throw new HttpError(401, "로그인이 필요합니다");
  }

  function getClassOr404(id) {
    const cls = store.getClass(id);
    if (!cls) throw new HttpError(404, "수업을 찾을 수 없습니다");
    return cls;
  }

  async function api(req, res, url) {
    const parts = url.pathname.split("/").filter(Boolean).slice(1); // drop "api"
    const method = req.method;

    if (parts[0] === "health") return json(res, 200, { ok: true, time: Date.now() });

    if (parts[0] === "login" && method === "POST") {
      if (!loginLimiter.allow(req.socket.remoteAddress)) throw new HttpError(429, "잠시 후 다시 시도하세요");
      const body = await readJson(req);
      if (!passwordMatches(body.password, config.teacherPassword)) {
        throw new HttpError(401, "비밀번호가 올바르지 않습니다");
      }
      return json(res, 200, { token: auth.issueTeacher(config.teacherTokenTtlMs) });
    }

    // 학생 웹 에이전트가 PIN 확인용으로 호출 (인증 불필요, 수업명만 노출)
    if (parts[0] === "join" && parts[1] && method === "GET") {
      const cls = store.findClassByPin(parts[1]);
      if (!cls) throw new HttpError(404, "수업 코드가 올바르지 않습니다");
      return json(res, 200, { className: cls.name });
    }

    requireTeacher(req);

    if (parts[0] === "presets" && method === "GET") {
      return json(
        res,
        200,
        Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, { label: v.label, policy: v.policy }])),
      );
    }

    if (parts[0] !== "classes") throw new HttpError(404, "Not found");

    if (parts.length === 1) {
      if (method === "GET") return json(res, 200, store.listClasses().map((c) => classView(c, hub)));
      if (method === "POST") {
        const body = await readJson(req);
        const name = String(body.name ?? "").trim().slice(0, 50);
        if (!name) throw new HttpError(400, "수업 이름을 입력하세요");
        const cls = store.createClass({
          name,
          policy: normalizePolicy(defaultPolicy()),
          schedule: defaultSchedule(),
          scheduleState: { activeEntryId: null },
        });
        return json(res, 201, classView(cls, hub));
      }
    }

    const cls = getClassOr404(parts[1]);

    if (parts.length === 2) {
      if (method === "GET") return json(res, 200, classView(cls, hub));
      if (method === "PATCH") {
        const body = await readJson(req);
        const name = String(body.name ?? "").trim().slice(0, 50);
        if (name) store.updateClass(cls.id, { name });
        if (body.regeneratePin === true) store.updateClass(cls.id, { pin: store.newPin() });
        return json(res, 200, classView(store.getClass(cls.id), hub));
      }
      if (method === "DELETE") {
        hub.closeClass(cls.id);
        store.deleteClass(cls.id);
        return json(res, 200, { ok: true });
      }
    }

    switch (parts[2]) {
      case "policy": {
        if (method === "GET") return json(res, 200, cls.policy ?? defaultPolicy());
        if (method === "PUT") {
          const body = await readJson(req);
          const base = body.merge === true ? cls.policy ?? defaultPolicy() : defaultPolicy();
          const updated = hub.setPolicy(cls.id, normalizePolicy(body.policy, base));
          store.addEvent({ classId: cls.id, type: "policy", detail: "정책 변경" });
          return json(res, 200, updated.policy);
        }
        if (method === "POST" && parts[3] === "preset") {
          const body = await readJson(req);
          const preset = PRESETS[body.preset];
          if (!preset) throw new HttpError(400, "알 수 없는 프리셋입니다");
          const updated = hub.setPolicy(cls.id, preset.policy);
          store.addEvent({ classId: cls.id, type: "policy", detail: `프리셋: ${preset.label}` });
          return json(res, 200, updated.policy);
        }
        break;
      }
      case "schedule": {
        if (method === "GET") return json(res, 200, cls.schedule ?? defaultSchedule());
        if (method === "PUT") {
          const body = await readJson(req);
          let schedule;
          try {
            schedule = normalizeSchedule(body);
          } catch (err) {
            throw new HttpError(400, err.message);
          }
          // 다음 스케줄러 tick에서 현재 교시를 다시 판정하도록 상태 초기화
          store.updateClass(cls.id, { schedule, scheduleState: { activeEntryId: null } });
          hub.onScheduleChanged?.(cls.id);
          return json(res, 200, schedule);
        }
        break;
      }
      case "students": {
        if (method === "GET" && parts.length === 3) {
          return json(res, 200, store.listStudents(cls.id).map((s) => hub.studentView(s)));
        }
        if (method === "DELETE" && parts[3]) {
          const s = store.getStudent(parts[3]);
          if (!s || s.classId !== cls.id) throw new HttpError(404, "학생을 찾을 수 없습니다");
          hub.removeStudent(s.id);
          return json(res, 200, { ok: true });
        }
        break;
      }
      case "report": {
        if (method === "GET") {
          const since = Number(url.searchParams.get("since")) || 0;
          const events = store.listEvents(cls.id, { since, limit: 2000 });
          const students = store.listStudents(cls.id).map((s) => {
            const mine = events.filter((e) => e.studentId === s.id);
            return {
              ...hub.studentView(s),
              connects: mine.filter((e) => e.type === "connect").length,
              periodViolations: {
                app: mine.filter((e) => e.type === "violation" && e.kind === "app").length,
                web: mine.filter((e) => e.type === "violation" && e.kind === "web").length,
              },
            };
          });
          return json(res, 200, { class: classView(cls, hub), since, students, events: events.slice(0, 500) });
        }
        break;
      }
      case "reset-violations": {
        if (method === "POST") {
          for (const s of store.listStudents(cls.id)) {
            store.updateStudent(s.id, { violations: { app: 0, web: 0 } });
            hub.notifyStudent(s.id);
          }
          return json(res, 200, { ok: true });
        }
        break;
      }
    }
    throw new HttpError(404, "Not found");
  }

  function serveStatic(res, pathname) {
    // 정책 판정 로직(isUrlAllowed)을 웹 에이전트와 공유
    const resolved =
      pathname === "/policy.js"
        ? path.resolve(config.publicDir, "../src/policy.js")
        : path.resolve(config.publicDir, PAGES[pathname] ?? pathname.slice(1));
    const allowed = pathname === "/policy.js" || resolved.startsWith(config.publicDir + path.sep);
    if (!allowed || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(resolved)] ?? "application/octet-stream",
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
    });
    fs.createReadStream(resolved).pipe(res);
  }

  return async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
      if (url.pathname.startsWith("/api/")) return await api(req, res, url);
      if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "Method not allowed");
      return serveStatic(res, url.pathname);
    } catch (err) {
      if (err instanceof HttpError) return json(res, err.status, { error: err.message });
      console.error("[http]", err);
      return json(res, 500, { error: "서버 오류" });
    }
  };
}
