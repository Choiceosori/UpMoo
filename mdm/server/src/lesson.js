import { randomId } from "./store.js";

export const BOARD_TYPES = ["blank", "grid", "lines"];
export const MAX_STROKES_PER_PAGE = 3000;

// ====================================================================== lesson

export function createLesson({ cls, title, code, pages = [] }) {
  return {
    id: randomId(10),
    classId: cls.id,
    className: cls.name,
    title: title || "",
    code,
    startedAt: Date.now(),
    endedAt: null,
    pages,
    teacherPage: pages[0]?.id ?? null,
    follow: false,
    locked: false,
    explore: false,
    entryLocked: false,
    link: null,
    linksSent: [],
    teacherInk: {},
    seats: {},
    group: null,
    groupHistory: [],
    quizRuns: [],
    counters: { follow: 0, lock: 0, share: 0, links: 0, explore: 0, groups: 0, quizzes: 0 },
    summary: null,
  };
}

export function newPage(kind, extra = {}) {
  return { id: randomId(8), kind, ...extra };
}

/** 지난 수업 쪽을 복사합니다 (필기는 옮기지 않음). */
export function clonePages(pages) {
  return pages.map((p) => ({ ...structuredClone(p), id: randomId(8) }));
}

export function seatRecord(lesson, seat) {
  return (lesson.seats[seat] ??= {
    deviceId: null,
    kind: "web",
    joinedAt: null,
    status: "empty",
    awayCount: 0,
    linkOpens: 0,
    explores: [],
    tabs: [],
    page: null,
    ink: {},
    feedback: "",
    lastSeenAt: null,
  });
}

// ====================================================================== ink

/** 획 하나를 검증·정규화합니다. 좌표는 0~1 비율 (쪽 크기와 무관). */
export function cleanStroke(input) {
  if (!input || typeof input !== "object" || !Array.isArray(input.p)) return null;
  const p = [];
  for (const v of input.p.slice(0, 4000)) {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    p.push(Math.round(Math.min(1.2, Math.max(-0.2, n)) * 10000) / 10000);
  }
  if (p.length < 2 || p.length % 2) return null;
  const color = typeof input.c === "string" && /^#[0-9a-fA-F]{6}$/.test(input.c) ? input.c : "#1f2328";
  const width = Math.min(0.05, Math.max(0.0005, Number(input.w) || 0.003));
  return { id: typeof input.id === "string" ? input.id.slice(0, 20) : randomId(8), c: color, w: width, e: input.e === true, p };
}

export function addStroke(inkMap, pageId, stroke) {
  const list = (inkMap[pageId] ??= []);
  if (list.length >= MAX_STROKES_PER_PAGE) return false;
  list.push(stroke);
  return true;
}

// ====================================================================== links

/**
 * 주소를 정리하고, 앱 안에 넣는 전용 주소로 바꿀 수 있는 곳(유튜브·패들렛)은 바꿉니다.
 * @returns {{url:string, embed:string, title:string, how:"in"|"out"|null, login:boolean}|null}
 */
export function normalizeLink(raw) {
  let text = String(raw ?? "").trim();
  if (!text) return null;
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
  let u;
  try {
    u = new URL(text);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.replace(/^www\.|^m\./, "");
  const out = { url: u.toString(), embed: u.toString(), title: "", how: null, login: false };

  // 유튜브: watch?v= / youtu.be / shorts → embed (t= 시작 시각 유지)
  let vid = null;
  if (host === "youtube.com") vid = u.searchParams.get("v") || u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{6,})/)?.[1];
  if (host === "youtu.be") vid = u.pathname.slice(1).split("/")[0];
  if (vid) {
    const t = parseStart(u.searchParams.get("t") || u.searchParams.get("start"));
    out.embed = `https://www.youtube-nocookie.com/embed/${vid}${t ? `?start=${t}` : ""}`;
    out.title = "유튜브 영상";
    out.how = "in";
  }

  // 패들렛 보드 → embed
  if (host === "padlet.com" && !u.pathname.startsWith("/embed/")) {
    const slug = u.pathname.split("/").filter(Boolean).pop();
    const id = slug?.split("-").pop();
    if (id && /^[a-z0-9]{8,}$/i.test(id)) out.embed = `https://padlet.com/embed/${id}`;
    out.title = "패들렛";
    out.how = "in";
  }

  const known = [...KNOWN_SITES, ...loginSites].find((s) => host === s.host || host.endsWith(`.${s.host}`));
  if (known) {
    out.title ||= known.title;
    out.how ??= known.how;
    out.login = known.login === true;
  }
  return out;
}

function parseStart(t) {
  if (!t) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  return m ? Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0) : 0;
}

/**
 * 사용 안내의 "앱 안에서 열기 / 새 창으로 열기" 목록 (2026년 9월 확인 기준).
 * 로그인이 필요한 곳(경북AI배움터 등)은 MDM_LOGIN_SITES 환경변수에 도메인을 넣으면 '로그인이 필요해요'가 저절로 켜집니다.
 */
let loginSites = [];
export function setLoginSites(hosts) {
  loginSites = hosts.map((h) => ({ host: h.trim().toLowerCase(), title: "", how: "in", login: true })).filter((s) => s.host);
}

export const KNOWN_SITES = [
  { host: "padlet.com", title: "패들렛", how: "in" },
  { host: "kahoot.it", title: "카훗", how: "in" },
  { host: "menti.com", title: "멘티미터", how: "in" },
  { host: "wayground.com", title: "웨이그라운드", how: "in" },
  { host: "zep.us", title: "젭", how: "in" },
  { host: "playentry.org", title: "엔트리", how: "in" },
  { host: "miricanvas.com", title: "미리캔버스", how: "in" },
  { host: "wikipedia.org", title: "위키백과", how: "in" },
  { host: "classroom.google.com", title: "구글 클래스룸", how: "out" },
  { host: "canva.com", title: "캔바", how: "out" },
  { host: "scratch.mit.edu", title: "스크래치", how: "out" },
  { host: "allo.io", title: "알로", how: "out" },
  { host: "tooning.io", title: "투닝", how: "out" },
  { host: "thinkerbell.co.kr", title: "띵커벨", how: "out" },
  { host: "classcard.net", title: "클래스카드", how: "out" },
];

/** 응답 헤더로 앱 안(iframe)에 넣을 수 있는지 판단합니다. */
export function frameable(headers) {
  const xfo = (headers.get?.("x-frame-options") ?? headers["x-frame-options"] ?? "").toLowerCase();
  if (xfo.includes("deny") || xfo.includes("sameorigin")) return false;
  const csp = (headers.get?.("content-security-policy") ?? headers["content-security-policy"] ?? "").toLowerCase();
  const fa = csp.split(";").map((s) => s.trim()).find((s) => s.startsWith("frame-ancestors"));
  if (fa) {
    const v = fa.slice("frame-ancestors".length).trim();
    if (v === "'none'" || v === "'self'" || !v.includes("*")) return false;
  }
  return true;
}

// ====================================================================== seats

/** 학생 카드 상태: empty(안 들어옴) · off(연결 끊김) · here · away · link(보는 중) · linkout(링크로 나감) · check(확인 필요) */
export function seatStatus({ joined, online, visible, link }) {
  if (!joined) return "empty";
  if (!online) return "off";
  if (link === "out") return "linkout";
  if (link === "check") return "check";
  if (link === "in") return visible ? "link" : "check";
  return visible ? "here" : "away";
}

export function activeSeats(cls) {
  const disabled = new Set(cls.disabledSeats ?? []);
  const out = [];
  for (let n = 1; n <= cls.seats; n++) if (!disabled.has(n)) out.push(n);
  return out;
}

// ====================================================================== groups

export function orderGroups(seats, n) {
  const per = Math.ceil(seats.length / n);
  return Object.fromEntries(seats.map((s, i) => [s, Math.floor(i / per) + 1]));
}

export function shuffleGroups(seats, n, rand = Math.random) {
  const arr = [...seats];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return Object.fromEntries(arr.map((s, i) => [s, (i % n) + 1]));
}

// ====================================================================== quiz

export const QUIZ_TYPES = ["choice", "ox", "short", "essay"];

export function cleanQuiz(input, existing) {
  const title = String(input?.title ?? "").trim().slice(0, 80);
  if (!title) throw new Error("퀴즈 제목을 넣어 주세요");
  const items = [];
  for (const raw of Array.isArray(input.items) ? input.items.slice(0, 50) : []) {
    const type = QUIZ_TYPES.includes(raw?.type) ? raw.type : null;
    const q = String(raw?.q ?? "").trim().slice(0, 500);
    if (!type || !q) continue;
    const points = Math.min(100, Math.max(1, Math.round(Number(raw.points) || 1)));
    const item = { type, q, points };
    if (type === "choice") {
      item.options = (Array.isArray(raw.options) ? raw.options : []).map((o) => String(o ?? "").trim().slice(0, 200)).filter(Boolean).slice(0, 6);
      if (item.options.length < 2) throw new Error(`객관식 "${q.slice(0, 20)}"에 보기를 2개 이상 넣어 주세요`);
      item.answer = Math.min(item.options.length - 1, Math.max(0, Number(raw.answer) || 0));
    } else if (type === "ox") {
      item.answer = raw.answer === "X" ? "X" : "O";
    } else if (type === "short") {
      item.answer = String(raw.answer ?? "").split(/[,\n]/).map((a) => a.trim()).filter(Boolean).slice(0, 10);
      if (!item.answer.length) throw new Error(`단답형 "${q.slice(0, 20)}"에 정답을 넣어 주세요`);
    } else {
      item.answer = String(raw.answer ?? "").slice(0, 500); // 서술형: 채점 기준(선택)
    }
    items.push(item);
  }
  if (!items.length) throw new Error("문제를 하나 이상 넣어 주세요");
  return {
    id: existing?.id ?? randomId(8),
    title,
    items,
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  };
}

/** 학생에게 보낼 때는 정답을 뺍니다. */
export function publicQuiz(quiz) {
  return {
    title: quiz.title,
    items: quiz.items.map(({ type, q, points, options }) => ({ type, q, points, ...(options ? { options } : {}) })),
  };
}

export function normAnswer(s) {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

/** @returns {{earned:number,total:number,percent:number,items:Array<{correct:boolean|null,score:number|null}>}} */
export function gradeSubmission(run, seat) {
  const sub = run.answers[seat];
  let earned = 0;
  let total = 0;
  const items = run.quiz.items.map((item, i) => {
    total += item.points;
    const a = sub?.a?.[i];
    const manual = run.manual?.[seat]?.[i];
    let correct = null;
    let score = null;
    if (item.type === "choice") correct = Number(a) === item.answer;
    else if (item.type === "ox") correct = a === item.answer;
    else if (item.type === "short") {
      const accepted = [...item.answer, ...(run.accept?.[i] ?? [])].map(normAnswer);
      correct = a != null && accepted.includes(normAnswer(a));
    }
    if (manual != null) score = Math.min(item.points, Math.max(0, Number(manual)));
    else if (correct != null) score = correct ? item.points : 0;
    if (score != null) earned += score;
    return { correct, score };
  });
  return { earned, total, percent: total ? Math.round((earned / total) * 100) : 0, items };
}

export function runSummary(run) {
  const seats = Object.keys(run.answers).filter((s) => run.answers[s]?.submittedAt);
  const grades = seats.map((s) => gradeSubmission(run, s));
  const avg = grades.length ? Math.round(grades.reduce((n, g) => n + g.percent, 0) / grades.length) : null;
  const perItem = run.quiz.items.map((item, i) => {
    const scored = grades.map((g) => g.items[i]).filter((x) => x.score != null);
    return scored.length ? Math.round((scored.reduce((n, x) => n + x.score, 0) / (scored.length * item.points)) * 100) : null;
  });
  return { submitted: seats.length, avg, perItem };
}

// ====================================================================== stats

export function lessonStats(lesson) {
  const seats = Object.values(lesson.seats);
  const joined = seats.filter((s) => s.joinedAt);
  let studentInk = 0;
  for (const s of seats) for (const list of Object.values(s.ink)) studentInk += list.length;
  return {
    id: lesson.id,
    title: lesson.title || "제목 없음",
    startedAt: lesson.startedAt,
    endedAt: lesson.endedAt,
    minutes: lesson.endedAt ? Math.max(1, Math.round((lesson.endedAt - lesson.startedAt) / 60000)) : null,
    participants: joined.length,
    pages: lesson.pages.length,
    worksheetPages: lesson.pages.filter((p) => p.kind === "image").length,
    studentInk,
    follow: lesson.counters.follow,
    lock: lesson.counters.lock,
    away: seats.reduce((n, s) => n + s.awayCount, 0),
    share: lesson.counters.share,
    links: lesson.counters.links,
    linkOpeners: seats.filter((s) => s.linkOpens > 0).length,
    explore: lesson.counters.explore,
    groups: lesson.counters.groups,
    quizzes: lesson.counters.quizzes,
  };
}

export const STATS_COLUMNS = [
  ["startedAt", "날짜"],
  ["title", "수업 제목"],
  ["participants", "참여 학생"],
  ["minutes", "수업 시간(분)"],
  ["worksheetPages", "활동지 쪽수"],
  ["studentInk", "학생 필기(획)"],
  ["follow", "따라오기"],
  ["lock", "모두 멈춤"],
  ["away", "앱 벗어남 감지"],
  ["share", "화면 공유"],
  ["links", "링크 보냄"],
  ["linkOpeners", "링크 연 학생"],
  ["explore", "찾아보기"],
  ["groups", "모둠 활동"],
  ["quizzes", "퀴즈 보냄"],
];

export function csv(rows) {
  return "﻿" + rows.map((r) => r.map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
}

export function fmtDate(ts, timeZone = "Asia/Seoul") {
  if (!ts) return "";
  return new Intl.DateTimeFormat("sv-SE", { timeZone, dateStyle: "short", timeStyle: "short" }).format(new Date(ts));
}
