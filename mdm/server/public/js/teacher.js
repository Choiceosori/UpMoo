// 우리반 수업도우미 — 선생님 화면
import {
  $,
  $$,
  Board,
  api as rawApi,
  fmtClock,
  fmtTime,
  h,
  icon,
  loadScript,
  memoEl,
  namesFor,
  pageAr,
  penBar,
  qrSvg,
  seatLabel,
  store,
  toast,
  uploadPages,
  wsUrl,
} from "./common.js";

const TOKEN_KEY = "woori.token";
const STATUS_LABEL = {
  here: "수업 화면",
  away: "앱 벗어남",
  link: "링크 보는 중",
  linkout: "링크로 나감",
  check: "링크 활동 · 확인 필요",
  empty: "안 들어옴",
  off: "연결 끊김",
};
const BOARD_LABEL = { blank: "흰 판", grid: "모눈", lines: "줄 공책" };

const S = {
  token: store.get(TOKEN_KEY),
  config: {},
  me: null,
  cls: null,
  lesson: null,
  seats: new Map(),
  runtime: null,
  quiz: null,
  frames: new Map(),
  view: "grid",
  filter: "all",
  size: store.get("woori.cardSize", "m"),
  names: {},
  ws: null,
  wsReady: false,
  cardBoards: new Map(),
  share: null,
  zoom: null,
  gzoom: null,
  liveSolo: null,
  quizzes: [],
};

// ====================================================================== 공용

async function api(method, path, body, opts = {}) {
  try {
    return await rawApi(method, path, body, { token: S.token, ...opts });
  } catch (err) {
    if (err.status === 401) logout();
    throw err;
  }
}

async function download(path, filename) {
  try {
    const res = await fetch(path, { headers: { authorization: `Bearer ${S.token}` } });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "내려받지 못했어요");
    const url = URL.createObjectURL(await res.blob());
    h("a", { href: url, download: filename }).click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (err) {
    toast(err.message, "warn");
  }
}

function fail(err) {
  toast(err.message || String(err), "warn");
}

function send(msg) {
  if (S.ws?.readyState === WebSocket.OPEN) S.ws.send(JSON.stringify(msg));
}

function seatName(seat) {
  return seatLabel(seat, S.names);
}

function upMsg(text) {
  $("#upMsg").textContent = text || "";
}

function showOnly(id) {
  for (const el of ["login", "home", "tapp"]) $(`#${el}`).hidden = el !== id;
}

function live() {
  return S.lesson && !S.lesson.endedAt ? S.lesson : null;
}

// ---------------------------------------------------------------- 모달
function openModal(id) {
  const m = $(`#${id}`);
  m.hidden = false;
  m.querySelector("input:not([type=hidden]):not([type=radio]):not([type=checkbox]), select, textarea")?.focus();
  return m;
}
function closeModal(id) {
  const m = typeof id === "string" ? $(`#${id}`) : id;
  if (!m || m.hidden) return;
  m.hidden = true;
  m.dispatchEvent(new Event("close"));
}
document.addEventListener("click", (e) => {
  const closer = e.target.closest("[data-close]");
  if (closer) closeModal(closer.closest(".modal"));
  else if (e.target.classList?.contains("modal") && !e.target.classList.contains("full")) closeModal(e.target);
});
document.addEventListener("keydown", (e) => {
  const open = $$(".modal:not([hidden])").at(-1);
  if (e.key === "Escape" && open) return closeModal(open);
  if (open || S.view !== "board" || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
  if (e.key === "ArrowLeft") movePage(-1);
  if (e.key === "ArrowRight") movePage(1);
});

// ====================================================================== 시작

async function boot() {
  S.config = await rawApi("GET", "/api/config").catch(() => ({}));
  for (const el of $$("[data-school]")) el.textContent = S.config.schoolName || "";
  for (const el of $$("[data-app-name]")) el.textContent = S.config.appName || "우리반 수업도우미";
  if (S.token) {
    try {
      S.me = await api("GET", "/api/me");
      return enter();
    } catch {
      /* 로그인으로 */
    }
  }
  showLogin();
}

function enter() {
  const want = new URLSearchParams(location.search).get("class");
  const mine = S.me.classes;
  if (want && mine.some((c) => c.id === want)) return openClass(want);
  if (mine.length === 1 && !S.me.admin) return openClass(mine[0].id);
  showHome();
}

function logout() {
  S.token = null;
  store.set(TOKEN_KEY, null);
  S.ws?.close();
  S.ws = null;
  stopShare();
  history.replaceState(null, "", "/teacher");
  showLogin();
}

// ====================================================================== 로그인

let pendingCredential = null;

function showLogin() {
  showOnly("login");
  $("#loginMsg").textContent = "";
  const cid = S.config.googleClientId;
  $("#gNone").hidden = !!cid;
  $("#gFirst").hidden = !cid;
  $("#keyBox").open = !cid;
  if (cid) {
    loadScript("https://accounts.google.com/gsi/client")
      .then(() => {
        window.google.accounts.id.initialize({ client_id: cid, callback: onGoogle });
        window.google.accounts.id.renderButton($("#gBtn"), { theme: "outline", size: "large", text: "signin_with", locale: "ko", width: 300 });
      })
      .catch(() => ($("#loginMsg").textContent = "구글 로그인을 불러오지 못했어요. 인터넷 연결을 확인해 주세요."));
  }
}

async function onGoogle({ credential }) {
  try {
    const res = await rawApi("POST", "/api/login/google", { credential });
    if (res.token) return loggedIn(res);
    pendingCredential = credential;
    $("#reqForm").hidden = false;
    $("#reqName").value = res.name || "";
    $("#reqLead").textContent =
      res.status === "pending"
        ? `${res.email} — 사용 신청을 이미 보냈어요. 관리자가 승인하면 들어올 수 있어요. 내용을 고쳐 다시 보낼 수도 있어요.`
        : res.status === "rejected"
          ? `${res.email} — 사용 신청이 거절됐어요. 관리자에게 문의해 주세요.`
          : `${res.email} — 처음 오셨네요. 사용 신청을 보내면 관리자가 확인하고 승인해요.`;
  } catch (err) {
    $("#loginMsg").textContent = err.message;
  }
}

$("#reqForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await rawApi("POST", "/api/request", { credential: pendingCredential, name: $("#reqName").value, note: $("#reqNote").value });
    $("#reqForm").hidden = true;
    $("#loginMsg").textContent = "";
    toast("사용 신청을 보냈어요. 관리자가 승인하면 다시 로그인해 주세요.", "ok");
  } catch (err) {
    $("#loginMsg").textContent = err.message;
  }
});

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    loggedIn(await rawApi("POST", "/api/login", { password: $("#key").value }));
  } catch (err) {
    $("#loginMsg").textContent = err.message;
  }
});

function loggedIn({ token, me }) {
  S.token = token;
  S.me = me;
  store.set(TOKEN_KEY, token);
  enter();
}

// ====================================================================== 반 고르기 · 관리

async function showHome() {
  showOnly("home");
  S.ws?.close();
  S.ws = null;
  stopShare();
  history.replaceState(null, "", "/teacher");
  try {
    S.me = await api("GET", "/api/me");
  } catch (err) {
    return fail(err);
  }
  $("#meName").textContent = S.me.name + (S.me.admin ? " (관리자)" : "");
  const list = $("#classList");
  list.replaceChildren(
    ...S.me.classes.map((c) =>
      h(
        "button",
        { class: "class-card", onclick: () => openClass(c.id) },
        h("b", {}, c.name),
        h("small", {}, `학생 ${c.seats}명`),
        c.lesson ? h("span", { class: "live-tag" }, `수업 중 · ${c.lesson.code} · ${c.lesson.online}명 접속`) : null,
      ),
    ),
  );
  $("#noClass").hidden = S.me.classes.length > 0;
  $("#noClass").textContent = S.me.admin ? "아래 '관리'에서 반을 만들어 주세요." : "맡은 반이 아직 없어요. 관리자에게 반 배정을 부탁해 주세요.";
  $("#adminBox").hidden = !S.me.admin;
  if (S.me.admin) renderAdmin();
}

async function renderAdmin() {
  let data;
  try {
    data = await api("GET", "/api/admin");
  } catch (err) {
    return fail(err);
  }
  const approved = data.teachers.filter((t) => t.status === "approved");
  const pending = data.teachers.filter((t) => t.status === "pending");
  $("#reqPill").hidden = pending.length === 0;
  $("#reqPill").textContent = `사용 신청 ${pending.length}건`;
  $("#reqPill").onclick = () => $("#adminRequests").scrollIntoView({ behavior: "smooth" });

  const req = $("#adminRequests");
  req.hidden = pending.length === 0;
  req.replaceChildren(
    h("h3", {}, `사용 신청 ${pending.length}건`),
    h("p", { class: "hint" }, "우리 학교 선생님인지 확인하고 맡을 반을 골라 승인해 주세요. 승인 전에는 아무것도 볼 수 없어요."),
    ...pending.map((t) => {
      const boxes = data.classes.map((c) => h("label", { class: "chip-check" }, h("input", { type: "checkbox", value: c.id }), c.name));
      return h(
        "div",
        { class: "row" },
        h("div", { class: "grow" }, h("b", {}, t.name || "(이름 없음)"), " ", h("small", {}, t.email), t.note ? h("div", { class: "hint", style: { margin: 0 } }, t.note) : null),
        h("div", { class: "chips" }, boxes),
        h(
          "button",
          {
            class: "btn primary small",
            onclick: async () => {
              const classIds = boxes.map((b) => b.querySelector("input")).filter((i) => i.checked).map((i) => i.value);
              await api("PATCH", `/api/admin/teachers/${encodeURIComponent(t.email)}`, { status: "approved", classIds }).catch(fail);
              renderAdmin();
            },
          },
          "승인",
        ),
        h("button", { class: "btn small", onclick: async () => (await api("PATCH", `/api/admin/teachers/${encodeURIComponent(t.email)}`, { status: "rejected" }).catch(fail), renderAdmin()) }, "거절"),
      );
    }),
  );

  $("#adminClasses").replaceChildren(
    ...data.classes.map((c) => {
      const boxes = approved.map((t) =>
        h("label", { class: "chip-check" }, h("input", { type: "checkbox", value: t.email, checked: c.teachers.includes(t.email) }), t.name || t.email.split("@")[0]),
      );
      const save = async () => {
        const teachers = boxes.map((b) => b.querySelector("input")).filter((i) => i.checked).map((i) => i.value);
        await api("PATCH", `/api/admin/classes/${c.id}`, { teachers }).catch(fail);
        toast(`${c.name} 담당 선생님을 저장했어요`, "ok");
      };
      boxes.forEach((b) => b.querySelector("input").addEventListener("change", save));
      return h(
        "div",
        { class: "row" },
        h("div", { class: "grow" }, h("b", {}, c.name), " ", h("small", { class: "hint" }, `${c.seats}명`)),
        h("button", {
          class: "btn ghost small",
          onclick: async () => {
            const name = prompt("반 이름", c.name);
            if (name) await api("PATCH", `/api/admin/classes/${c.id}`, { name }).catch(fail);
            renderAdmin();
            showHome();
          },
        }, "이름"),
        h("button", {
          class: "btn ghost small",
          onclick: async () => {
            if (!confirm(`${c.name}을(를) 지울까요? 이 반의 수업·필기·기록이 모두 지워져요.`)) return;
            await api("DELETE", `/api/admin/classes/${c.id}`).catch(fail);
            showHome();
          },
        }, icon("trash")),
        h("div", { class: "chips", style: { flexBasis: "100%" } }, boxes.length ? boxes : h("small", { class: "hint" }, "등록된 선생님이 없어요")),
      );
    }),
  );

  $("#adminTeachers").replaceChildren(
    ...approved.map((t) =>
      h(
        "div",
        { class: "row" },
        h("div", { class: "grow" }, h("b", {}, t.name || "-"), " ", h("small", {}, t.email), t.admin || data.adminEmails.includes(t.email) ? h("span", { class: "pill", style: { marginLeft: "6px", minHeight: "22px" } }, "관리자") : null),
        data.adminEmails.includes(t.email)
          ? null
          : h("button", { class: "btn ghost small", onclick: async () => (await api("PATCH", `/api/admin/teachers/${encodeURIComponent(t.email)}`, { admin: !t.admin }).catch(fail), renderAdmin()) }, t.admin ? "관리자 해제" : "관리자로"),
        data.adminEmails.includes(t.email)
          ? null
          : h("button", {
              class: "btn ghost small",
              onclick: async () => {
                if (!confirm(`${t.email} 계정의 로그인을 막을까요?`)) return;
                await api("DELETE", `/api/admin/teachers/${encodeURIComponent(t.email)}`).catch(fail);
                renderAdmin();
              },
            }, icon("trash")),
      ),
    ),
  );
}

$("#addClassForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("POST", "/api/admin/classes", { name: $("#newClassName").value, seats: Number($("#newClassSeats").value) });
    $("#newClassName").value = "";
    showHome();
  } catch (err) {
    fail(err);
  }
});
$("#addTeacherForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("POST", "/api/admin/teachers", { email: $("#newTeacherEmail").value, name: $("#newTeacherName").value });
    $("#newTeacherEmail").value = "";
    $("#newTeacherName").value = "";
    renderAdmin();
  } catch (err) {
    fail(err);
  }
});
$("#usageBtn").addEventListener("click", async () => {
  try {
    const u = await api("GET", "/api/admin/usage");
    const mb = (n) => `${(n / 1024 / 1024).toFixed(1)}MB`;
    $("#adminUsage").textContent = `활동지 그림 ${mb(u.files)} · 수업 기록 ${mb(u.lessons)} · 기본 정보 ${mb(u.db)} · 합계 ${mb(u.files + u.lessons + u.db)}`;
  } catch (err) {
    fail(err);
  }
});
$("#allStatsBtn").addEventListener("click", (e) => (e.preventDefault(), download("/api/admin/stats.csv", "모든 반 활용 기록.csv")));
$("#homeLogout").addEventListener("click", logout);

// ====================================================================== 수업 화면

function openClass(id) {
  showOnly("tapp");
  history.replaceState(null, "", `/teacher?class=${id}`);
  S.cls = { id, name: "" };
  S.lesson = null;
  S.seats.clear();
  S.frames.clear();
  S.names = namesFor(id);
  setView("grid");
  connect(id);
}

let retry = 1000;
function connect(classId) {
  S.ws?.close();
  const ws = new WebSocket(wsUrl());
  S.ws = ws;
  ws.onopen = () => ws.send(JSON.stringify({ type: "hello", role: "teacher", token: S.token, classId }));
  ws.onmessage = (ev) => onMessage(JSON.parse(ev.data));
  ws.onclose = (ev) => {
    if (S.ws !== ws) return;
    S.wsReady = false;
    setConn();
    if (ev.code === 4003) return logout();
    if (ev.code === 4004) return (toast("맡은 반이 아니에요", "warn"), showHome());
    setTimeout(() => S.ws === ws && connect(classId), retry);
    retry = Math.min(retry * 2, 10000);
  };
}

function setConn() {
  const dot = $("#conn");
  dot.className = `dot ${S.wsReady ? "on" : "off"}`;
  dot.title = S.wsReady ? "연결됨" : "연결이 끊겼어요. 다시 잇는 중…";
}

function onMessage(m) {
  switch (m.type) {
    case "state":
      retry = 1000;
      S.wsReady = true;
      setConn();
      S.cls = m.class;
      if (S.lesson?.id !== m.lesson?.id) S.frames.clear();
      S.lesson = m.lesson;
      S.runtime = m.runtime;
      S.quiz = m.quiz;
      S.seats = new Map(m.seats.map((s) => [s.seat, s]));
      renderAll();
      break;
    case "flags":
      Object.assign(S.lesson, { follow: m.follow, teacherPage: m.teacherPage, locked: m.locked, explore: m.explore, entryLocked: m.entryLocked });
      renderTop();
      renderDock();
      if (S.view === "board") renderBoardView();
      break;
    case "pages":
      S.lesson.pages = m.pages;
      S.lesson.teacherPage = m.teacherPage;
      renderDock();
      renderSetup();
      renderCards();
      if (S.view === "board") renderBoardView();
      if (!$("#pagesDlg").hidden) renderPagesList();
      break;
    case "title":
      S.lesson.title = m.title;
      renderTop();
      break;
    case "seat":
      S.seats.set(m.seat.seat, m.seat);
      updateCard(m.seat.seat);
      renderCounts();
      renderTop();
      renderSetup();
      if (S.zoom?.seat === m.seat.seat) renderZoom();
      break;
    case "ink":
      onInk(m);
      break;
    case "ink_set":
      onInkSet(m);
      break;
    case "link":
      S.lesson.link = m.link;
      renderTop();
      renderCards();
      renderLinkNow();
      break;
    case "runtime":
      S.runtime = m.runtime;
      renderTop();
      renderDock();
      renderCards();
      if (!$("#liveWall").hidden) renderLiveWall();
      break;
    case "frame":
      onFrame(m);
      break;
    case "entry_blocked":
      toast(`${seatName(m.seat)} 자리로 새 기기가 들어오려 했어요(입장 잠김)`, "warn");
      break;
    case "groups":
      S.cls.groups = m.groups;
      if (S.view === "group") renderGroups();
      break;
    case "group_state":
      S.lesson.group = m.group;
      S.cls.groups = m.groups;
      renderTop();
      if (S.view === "group") renderGroups();
      if (S.gzoom) renderGzoom();
      break;
    case "gink":
    case "gmemo":
    case "gmemo_del":
    case "gset":
      onGroupEdit(m);
      break;
    case "quiz_dash":
      S.quiz = m.run;
      renderTop();
      if (S.view === "quiz") renderQuizDash();
      break;
    case "error":
      toast(m.error, "warn");
      break;
  }
}

function renderAll() {
  $("#className").textContent = S.cls.name;
  document.title = `${S.cls.name} · ${S.config.appName || "우리반 수업도우미"}`;
  renderTop();
  renderSetup();
  renderCounts();
  renderCards();
  renderDock();
  if (S.view === "board") renderBoardView();
  if (S.view === "group") renderGroups();
  if (S.view === "quiz") renderQuizView();
  if (!$("#zoom").hidden) renderZoom();
}

// ---------------------------------------------------------------- 위쪽 띠
function renderTop() {
  const L = S.lesson;
  const on = !!live();
  $("#title").textContent = L?.title || "제목 없음";
  $("#code").textContent = on ? L.code : "-";
  $("#codeBtn").disabled = !on;
  const seats = [...S.seats.values()];
  const online = seats.filter((s) => s.status !== "empty" && s.status !== "off").length;
  $("#online").textContent = `${online} / ${seats.length || S.cls?.seats || 0}명`;
  for (const id of ["exToggle", "entryToggle", "liveBtn", "endBtn"]) $(`#${id}`).hidden = !on;
  $("#exToggle").setAttribute("aria-pressed", String(!!L?.explore));
  $("#entryToggle").setAttribute("aria-pressed", String(!!L?.entryLocked));
  $("#entryToggle").querySelector("span").textContent = L?.entryLocked ? "입장 잠김" : "입장 잠그기";
  const apps = seats.filter((s) => s.kind === "app" && s.status !== "empty" && s.status !== "off").length;
  $("#snapToggle").hidden = !on || (apps === 0 && !S.runtime?.snap);
  $("#snapToggle").setAttribute("aria-pressed", String(!!S.runtime?.snap));
  $("#snapToggle").querySelector("span").textContent = `학생 화면 보기 · ${apps}명`;
  $("#liveBtn").setAttribute("aria-pressed", String((S.runtime?.live?.length ?? 0) > 0));

  $("#modePill").hidden = !L?.group?.active;
  const rt = S.runtime;
  $("#sharePill").hidden = !on || (!rt?.share && rt?.present == null);
  $("#sharePill").textContent = rt?.present != null ? `● ${seatName(rt.present)} 화면을 모두에게 보여 주는 중` : S.share ? "● 화면 공유 중 · 끝내기" : "● 다른 기기에서 화면 공유 중";
  $("#linkPill").hidden = !L?.link;
  if (L?.link) $("#linkPill").replaceChildren(icon("link"), `링크: ${L.link.title}`);
  const q = S.quiz;
  $("#quizPill").hidden = !q;
  if (q) $("#quizPill").textContent = `퀴즈 · 제출 ${q.summary.submitted}/${q.rows.length}`;

  $("#endedBar").hidden = !(L && L.endedAt);
  if (L?.endedAt) {
    const mins = Math.max(1, Math.round((L.endedAt - L.startedAt) / 60000));
    const joined = Object.keys(L.seats ?? {}).length;
    $("#endedText").textContent = `수업이 끝났어요 · ${L.title || "제목 없음"}`;
    $("#endedSum").textContent = `${fmtClock(L.startedAt)}~${fmtClock(L.endedAt)} (${mins}분) · 참여 ${joined}명 · 활동지 ${L.pages.length}쪽 · 링크 ${L.counters.links}번 · 퀴즈 ${L.counters.quizzes}번`;
  }
  $("#noLesson").hidden = !!L;
}

$("#classChip").addEventListener("click", showHome);
$("#titleBtn").addEventListener("click", () => {
  if (!S.lesson) return;
  $("#titleIn").value = S.lesson.title || "";
  openModal("titleDlg");
});
$("#titleForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("PATCH", `/api/lessons/${S.lesson.id}`, { title: $("#titleIn").value });
    closeModal("titleDlg");
  } catch (err) {
    fail(err);
  }
});
$("#codeBtn").addEventListener("click", openQr);
$("#exToggle").addEventListener("click", () => send({ type: "set", explore: !S.lesson.explore }));
$("#entryToggle").addEventListener("click", () => send({ type: "set", entryLocked: !S.lesson.entryLocked }));
$("#snapToggle").addEventListener("click", () => send({ type: "snap", on: !S.runtime?.snap }));
$("#liveBtn").addEventListener("click", () => ((S.runtime?.live?.length ?? 0) > 0 ? openLiveWall() : openLivePick()));
$("#sharePill").addEventListener("click", stopBroadcast);
$("#linkPill").addEventListener("click", openLinkDlg);
$("#quizPill").addEventListener("click", () => setView("quiz"));
$("#endBtn").addEventListener("click", async () => {
  if (!confirm("수업을 끝낼까요? 학생 태블릿에 '수업이 끝났어요'가 뜨고, 이 방 코드로는 더 들어올 수 없어요.")) return;
  stopShare();
  try {
    await api("POST", `/api/lessons/${S.lesson.id}/end`);
  } catch (err) {
    fail(err);
  }
});
$("#newBtn").addEventListener("click", openNewLesson);
$("#endedNew").addEventListener("click", openNewLesson);
$("#noLessonNew").addEventListener("click", openNewLesson);
$("#endedStats").addEventListener("click", () => openHistory(S.lesson.id));

// ---------------------------------------------------------------- 보기 전환
for (const tab of $$(".side-nav [data-view]")) tab.addEventListener("click", () => setView(tab.dataset.view));

function setView(view) {
  S.view = view;
  for (const tab of $$(".side-nav [data-view]")) tab.setAttribute("aria-selected", String(tab.dataset.view === view));
  $("#gridView").hidden = view !== "grid";
  $("#boardView").hidden = view !== "board";
  $("#groupView").hidden = view !== "group";
  $("#quizView").hidden = view !== "quiz";
  $("#dock").hidden = view === "group" || view === "quiz";
  if (view === "board") renderBoardView();
  if (view === "group") renderGroups();
  if (view === "quiz") renderQuizView();
}

// ---------------------------------------------------------------- 수업 준비
function renderSetup() {
  const L = live();
  const steps = {
    pages: !!L?.pages.length,
    join: [...S.seats.values()].some((s) => s.status !== "empty"),
    names: Object.values(S.names).some(Boolean),
  };
  for (const li of $$("#setup li")) li.classList.toggle("done", steps[li.dataset.step]);
  $("#setup").hidden = !L || Object.values(steps).every(Boolean);
}
$("#setupUpload").addEventListener("click", () => $("#file").click());
$("#setupQr").addEventListener("click", openQr);
$("#setupNames").addEventListener("click", openSettings);

// ---------------------------------------------------------------- 학생 카드
function matchesFilter(s) {
  switch (S.filter) {
    case "here":
      return !["empty", "off"].includes(s.status);
    case "link":
      return ["link", "linkout", "check"].includes(s.status);
    case "away":
      return s.status === "away";
    case "empty":
      return s.status === "empty" || s.status === "off";
    default:
      return true;
  }
}

function renderCounts() {
  const seats = [...S.seats.values()];
  const n = {
    all: seats.length,
    here: seats.filter((s) => !["empty", "off"].includes(s.status)).length,
    link: seats.filter((s) => ["link", "linkout", "check"].includes(s.status)).length,
    away: seats.filter((s) => s.status === "away").length,
    empty: seats.filter((s) => s.status === "empty" || s.status === "off").length,
  };
  for (const [k, v] of Object.entries(n)) $(`[data-n="${k}"]`).textContent = v;
  $('.filter[data-filter="link"]').hidden = n.link === 0 && !S.lesson?.link;
}

for (const f of $$("#filters .filter")) {
  f.addEventListener("click", () => {
    S.filter = f.dataset.filter;
    for (const x of $$("#filters .filter")) x.setAttribute("aria-pressed", String(x === f));
    renderCards();
  });
}
for (const b of $$(".seg [data-size]")) {
  b.setAttribute("aria-pressed", String(b.dataset.size === S.size));
  b.addEventListener("click", () => {
    S.size = b.dataset.size;
    store.set("woori.cardSize", S.size);
    for (const x of $$(".seg [data-size]")) x.setAttribute("aria-pressed", String(x === b));
    $("#cards").dataset.size = S.size;
  });
}
$("#cards").dataset.size = S.size;

function renderCards() {
  const wrap = $("#cards");
  for (const b of S.cardBoards.values()) b.detach();
  S.cardBoards.clear();
  if (!S.lesson) return wrap.replaceChildren();
  wrap.replaceChildren(...[...S.seats.values()].filter(matchesFilter).map(cardEl));
}

function updateCard(seat) {
  const old = $(`#cards .card[data-seat="${seat}"]`);
  const s = S.seats.get(seat);
  if (!s) return;
  if (!matchesFilter(s)) {
    S.cardBoards.get(seat)?.detach();
    S.cardBoards.delete(seat);
    return old?.remove();
  }
  if (!old) return renderCards();
  S.cardBoards.get(seat)?.detach();
  old.replaceWith(cardEl(s));
}

function studentPage(s) {
  const pages = S.lesson?.pages ?? [];
  return pages.find((p) => p.id === s.page) ?? pages.find((p) => p.id === S.lesson.teacherPage) ?? pages[0] ?? null;
}

function cardStatusText(s) {
  if (s.status === "here" && s.tab) return `탭: ${s.tab}`;
  if (s.status === "here" && s.explore && S.lesson?.explore) return `찾아보기: ${s.explore.q || s.explore.title || s.explore.url}`;
  return STATUS_LABEL[s.status] ?? s.status;
}

function cardEl(s) {
  const page = studentPage(s);
  const idx = S.lesson.pages.indexOf(page);
  const frame = S.frames.get(s.seat);
  const linkOn = ["link", "linkout", "check"].includes(s.status);
  const card = h(
    "button",
    {
      class: "card",
      "data-seat": s.seat,
      "data-status": s.status,
      "data-link": linkOn ? "1" : "",
      "aria-label": `${seatName(s.seat)} ${STATUS_LABEL[s.status] ?? ""}`,
      onclick: () => openZoom(s.seat),
    },
    h(
      "div",
      { class: "card-h" },
      h("i", { class: "dot" }),
      h("b", { class: "num" }, s.seat),
      h("span", { class: "nm" }, S.names[s.seat] || ""),
      h("span", { class: "st", title: cardStatusText(s) }, cardStatusText(s)),
      s.awayCount ? h("span", { class: "away-n", title: "이번 수업에서 앱을 벗어난 횟수" }, `이탈 ${s.awayCount}`) : null,
      s.status === "empty" ? null : s.kind === "app" ? h("span", { class: "pg" }, `앱${s.tabs?.length ? ` · 탭 ${s.tabs.length}` : ""}`) : idx >= 0 ? h("span", { class: "pg" }, `${idx + 1}쪽`) : null,
    ),
  );
  const body = h(
    "div",
    { class: "card-body" },
    h("span", { class: "lk-cover" }, icon("link"), h("b", {}, S.lesson.link?.title || "링크"), h("span", {}, STATUS_LABEL[s.status] ?? "")),
  );
  card.append(body);
  if (frame && (S.runtime?.snap || S.runtime?.live?.includes(s.seat))) {
    body.append(h("img", { class: "snap-img", src: frame.url, alt: `${s.seat}번 화면` }));
  } else if (page && s.status !== "empty") {
    const board = new Board({ layers: 2 });
    board.setPage(page);
    board.attach(body);
    board.setStrokes(0, S.lesson.teacherInk?.[page.id]);
    board.setStrokes(1, S.lesson.seats?.[s.seat]?.ink?.[page.id]);
    S.cardBoards.set(s.seat, board);
  }
  return card;
}

function seatInk(seat) {
  S.lesson.seats ??= {};
  return (S.lesson.seats[seat] ??= { ink: {} }).ink;
}

function onInk(m) {
  if (!S.lesson) return;
  if (m.who === "teacher") {
    (S.lesson.teacherInk[m.pageId] ??= []).push(m.stroke);
    for (const [seat, b] of S.cardBoards) if (b.page?.id === m.pageId) b.addStroke(0, m.stroke);
    if (S.view === "board" && S.tBoard?.page?.id === m.pageId) S.tBoard.addStroke(0, m.stroke);
  } else {
    (seatInk(m.who)[m.pageId] ??= []).push(m.stroke);
    const b = S.cardBoards.get(m.who);
    if (b?.page?.id === m.pageId) b.addStroke(1, m.stroke);
    if (S.zoom?.seat === m.who && S.zoom.board?.page?.id === m.pageId) S.zoom.board.addStroke(1, m.stroke);
  }
}

function onInkSet(m) {
  if (!S.lesson) return;
  if (m.who === "teacher") {
    S.lesson.teacherInk[m.pageId] = m.strokes;
    for (const b of S.cardBoards.values()) if (b.page?.id === m.pageId) b.setStrokes(0, m.strokes);
    if (S.tBoard?.page?.id === m.pageId) S.tBoard.setStrokes(0, m.strokes);
  } else {
    seatInk(m.who)[m.pageId] = m.strokes;
    const b = S.cardBoards.get(m.who);
    if (b?.page?.id === m.pageId) b.setStrokes(1, m.strokes);
    if (S.zoom?.seat === m.who && S.zoom.board?.page?.id === m.pageId) S.zoom.board.setStrokes(1, m.strokes);
  }
}

function onFrame(m) {
  const prev = S.frames.get(m.seat);
  const times = [...(prev?.times ?? []), m.ts].filter((t) => m.ts - t < 3000);
  const url = `data:image/jpeg;base64,${m.data}`;
  S.frames.set(m.seat, { url, via: m.via, ts: m.ts, w: m.w, h: m.h, times });
  const img = $(`#cards .card[data-seat="${m.seat}"] .snap-img`);
  if (img) img.src = url;
  else if (S.runtime?.snap) updateCard(m.seat);
  const cell = $(`#liveGrid [data-seat="${m.seat}"]`);
  if (cell) updateLiveCell(cell, m.seat);
  if (S.zoom?.seat === m.seat && S.zoom.mode === "snap") renderZoom();
}

// ---------------------------------------------------------------- 수업 조종 바
function pageIndex() {
  return S.lesson ? S.lesson.pages.findIndex((p) => p.id === S.lesson.teacherPage) : -1;
}

function renderDock() {
  const L = live();
  const n = L?.pages.length ?? 0;
  const i = pageIndex();
  $("#tpage").textContent = n ? `${i + 1} / ${n}` : "- / -";
  $("#tprev").disabled = !L || i <= 0;
  $("#tnext").disabled = !L || i < 0 || i >= n - 1;
  for (const el of $$("#dock button, #dock label")) el.toggleAttribute("disabled", !L);
  $("#uploadBtn").style.opacity = L ? "" : "0.45";
  $("#file").disabled = !L;
  $("#followBtn").setAttribute("aria-pressed", String(!!L?.follow));
  $("#lockBtn").setAttribute("aria-pressed", String(!!L?.locked));
  $("#lockBtn").querySelector("span").textContent = L?.locked ? "멈춤 풀기" : "모두 멈춤";
  $("#shareBtn").setAttribute("aria-pressed", String(!!S.share));
  $("#shareBtn").querySelector("span").textContent = S.share ? "공유 끝내기" : "화면 공유";
  $("#linkBtn").setAttribute("aria-pressed", String(!!L?.link));
}

function movePage(d) {
  const L = live();
  if (!L) return;
  const next = L.pages[pageIndex() + d];
  if (!next) return;
  L.teacherPage = next.id;
  send({ type: "set", teacherPage: next.id });
  renderDock();
  if (S.view === "board") renderBoardView();
}
$("#tprev").addEventListener("click", () => movePage(-1));
$("#tnext").addEventListener("click", () => movePage(1));
$("#tpage").addEventListener("click", openPages);
$("#followBtn").addEventListener("click", () => send({ type: "set", follow: !S.lesson.follow }));
$("#lockBtn").addEventListener("click", () => send({ type: "set", locked: !S.lesson.locked }));
$("#shareBtn").addEventListener("click", () => (S.share ? stopBroadcast() : startShare()));
$("#boardBtn").addEventListener("click", () => openModal("boardDlg"));
$("#linkBtn").addEventListener("click", openLinkDlg);
$("#twaitBoard").addEventListener("click", () => openModal("boardDlg"));

$("#file").addEventListener("change", async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  if (files.length) await doUpload(files);
});

async function doUpload(files) {
  const L = live();
  if (!L) return;
  try {
    const n = await uploadPages(L.id, files, S.token, upMsg);
    upMsg("");
    toast(`활동지 ${n}쪽을 올렸어요`, "ok");
  } catch (err) {
    upMsg("");
    fail(err);
  }
}

$("#boardForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const board = new FormData(e.target).get("bk");
  try {
    await api("POST", `/api/lessons/${S.lesson.id}/pages`, { kind: "board", board, follow: $("#bkFollow").checked });
    closeModal("boardDlg");
    const last = S.lesson.pages.at(-1);
    if (last) {
      S.lesson.teacherPage = last.id;
      send({ type: "set", teacherPage: last.id });
    }
    setView("board");
  } catch (err) {
    fail(err);
  }
});

// ---------------------------------------------------------------- 내 판서
function renderBoardView() {
  const L = S.lesson;
  const page = L?.pages.find((p) => p.id === L.teacherPage);
  const stage = $("#tstage");
  $("#twait").hidden = !!page;
  if (!S.tBoard) {
    S.tBoard = new Board({
      layers: 1,
      editable: true,
      padding: 4,
      onStroke: (stroke) => {
        (S.lesson.teacherInk[S.tBoard.page.id] ??= []).push(stroke);
        send({ type: "ink", pageId: S.tBoard.page.id, stroke });
        for (const b of S.cardBoards.values()) if (b.page?.id === S.tBoard.page.id) b.addStroke(0, stroke);
      },
    });
    $("#tpenWrap").replaceChildren(
      penBar(S.tBoard, {
        onUndo: () => S.tBoard.page && send({ type: "ink_undo", pageId: S.tBoard.page.id }),
        onClear: () => S.tBoard.page && confirm("이 쪽의 판서를 모두 지울까요?") && send({ type: "ink_clear", pageId: S.tBoard.page.id }),
        clearLabel: "판서 지우기",
        hint: "여기에 쓰면 학생 화면에도 바로 보여요",
      }),
    );
  }
  const isLink = page?.kind === "link";
  $("#tlink").hidden = !isLink;
  stage.hidden = isLink;
  $("#tpenWrap").hidden = isLink || !page || !!L?.endedAt;
  if (isLink) {
    const lk = page.link;
    $("#tlinkTitle").textContent = lk.title;
    $("#tlinkHow").textContent = lk.how === "in" ? "앱 안에서 열기" : "새 창으로 열기";
    const opened = [...S.seats.values()].filter((s) => ["link", "linkout", "check"].includes(s.status)).length;
    $("#tlinkNote").textContent = `${L.follow ? "따라오기가 켜져 있어서 학생 화면에도 이 사이트가 열려요." : "따라오기를 켜면 학생 화면에도 이 사이트가 열려요."} 지금 링크를 연 학생 ${opened}명`;
    const frame = $("#tlinkFrame");
    if (frame.dataset.src !== lk.embed) {
      frame.dataset.src = lk.embed;
      frame.src = lk.how === "in" ? lk.embed : "about:blank";
    }
    S.tBoard.detach();
    return;
  }
  if (!page) return S.tBoard.detach();
  if (!S.tBoard.el.isConnected) S.tBoard.attach(stage);
  S.tBoard.editable = !L.endedAt;
  if (S.tBoard.page?.id !== page.id) S.tBoard.setPage(page);
  S.tBoard.setStrokes(0, L.teacherInk[page.id]);
}
$("#tlinkOpen").addEventListener("click", () => {
  const page = S.lesson.pages.find((p) => p.id === S.lesson.teacherPage);
  if (page?.link) window.open(page.link.url, "_blank", "noopener");
});

// ---------------------------------------------------------------- 새 수업
async function openNewLesson() {
  $("#newTitle").value = "";
  $("#newFile").value = "";
  $("#newBoard").value = "";
  const sel = $("#newFrom");
  sel.replaceChildren(h("option", { value: "" }, "불러오지 않기"));
  openModal("newLesson");
  try {
    const list = await api("GET", "/api/lessons");
    for (const l of list) sel.append(h("option", { value: l.id }, `${fmtTime(l.startedAt)} · ${l.className} · ${l.title} (${l.pages}쪽)`));
  } catch {
    /* 목록 없이도 시작 가능 */
  }
}

$("#newForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const files = [...$("#newFile").files];
  try {
    stopShare();
    const res = await api("POST", `/api/classes/${S.cls.id}/lessons`, {
      title: $("#newTitle").value,
      fromLessonId: $("#newFrom").value || null,
      board: $("#newBoard").value || null,
    });
    closeModal("newLesson");
    S.frames.clear();
    if (files.length) {
      const n = await uploadPages(res.id, files, S.token, upMsg);
      upMsg("");
      toast(`활동지 ${n}쪽을 올렸어요`, "ok");
    }
    if ($("#newQr").checked) setTimeout(openQr, 300);
  } catch (err) {
    upMsg("");
    fail(err);
  }
});

// ---------------------------------------------------------------- QR
async function openQr() {
  if (!live()) return;
  const url = `${location.origin}/?c=${S.lesson.code}`;
  $("#qrCode").textContent = S.lesson.code;
  $("#qrUrl").textContent = location.host;
  $("#qrImg").replaceChildren(await qrSvg(url));
  openModal("qr");
}
$("#qrClose").addEventListener("click", () => closeModal("qr"));

// ---------------------------------------------------------------- 링크 보내기
let linkCheckTimer = null;
let linkInfo = null;

function openLinkDlg() {
  if (!live()) return;
  $("#linkUrl").value = "";
  $("#linkName").value = "";
  $("#linkNote").textContent = "";
  $("#linkNote").className = "link-note";
  $("#linkLoginChk").checked = false;
  $('input[name="how"][value="in"]').checked = true;
  $("#linkPrev").hidden = true;
  $("#linkPrev").src = "about:blank";
  $("#linkPrevEmpty").hidden = false;
  linkInfo = null;
  renderLinkNow();
  const recent = S.cls.recentLinks ?? [];
  $("#linkRecentWrap").hidden = !recent.length;
  $("#linkRecent").replaceChildren(
    ...recent.map((l) =>
      h(
        "button",
        {
          type: "button",
          onclick: () => {
            $("#linkUrl").value = l.url;
            $("#linkName").value = l.title;
            $(`input[name="how"][value="${l.how}"]`).checked = true;
            $("#linkLoginChk").checked = !!l.login;
            checkLink(true);
          },
        },
        icon(l.how === "in" ? "link" : "external"),
        h("b", {}, l.title),
        h("small", {}, l.url),
      ),
    ),
  );
  openModal("linkDlg");
}

function renderLinkNow() {
  const lk = S.lesson?.link;
  $("#linkNow").hidden = !lk;
  if (!lk) return;
  $("#linkNowTitle").textContent = lk.title;
  const seats = [...S.seats.values()];
  const opened = seats.filter((s) => ["link", "linkout", "check"].includes(s.status)).length;
  $("#linkNowCount").textContent = `${lk.how === "in" ? "앱 안에서 열기" : "새 창으로 열기"} · 지금 링크 화면 ${opened}명 / 접속 ${seats.filter((s) => !["empty", "off"].includes(s.status)).length}명`;
}

$("#linkNowOpen").addEventListener("click", () => window.open(S.lesson.link.url, "_blank", "noopener"));
$("#linkNowBack").addEventListener("click", () => {
  send({ type: "link_back" });
  toast("학생 화면을 수업 화면으로 불렀어요", "ok");
});
$("#linkPaste").addEventListener("click", async () => {
  try {
    $("#linkUrl").value = (await navigator.clipboard.readText()).trim();
    checkLink(true);
  } catch {
    toast("붙여넣기를 허용하지 않았어요. 주소 칸에 직접 붙여 넣어 주세요.", "warn");
  }
});
$("#linkUrl").addEventListener("input", () => checkLink(false));

function checkLink(now) {
  clearTimeout(linkCheckTimer);
  const url = $("#linkUrl").value.trim();
  if (!url) return;
  $("#linkNote").textContent = "확인하는 중…";
  $("#linkNote").className = "link-note";
  linkCheckTimer = setTimeout(async () => {
    try {
      const info = await api("GET", `/api/link-check?url=${encodeURIComponent(url)}`);
      linkInfo = info;
      if (!$("#linkName").value) $("#linkName").value = info.title || "";
      if (info.login) $("#linkLoginChk").checked = true;
      if (info.how) $(`input[name="how"][value="${info.how}"]`).checked = true;
      const note = $("#linkNote");
      if (info.how === "in") {
        note.textContent = info.embed !== info.url ? "앱 안에서 열 수 있어요 (앱에 넣는 전용 주소로 바꿨어요)" : "앱 안에서 열 수 있어요";
        note.className = "link-note ok";
      } else if (info.how === "out") {
        note.textContent = "이 사이트는 앱 안에 넣지 못하게 막아 두었어요. '새 창으로 열기'로 보내요";
        note.className = "link-note bad";
      } else {
        note.textContent = "확인하지 못했어요. 미리 보기를 보고 골라 주세요";
      }
      const prev = $("#linkPrev");
      prev.hidden = false;
      prev.src = info.embed;
      $("#linkPrevEmpty").hidden = true;
    } catch (err) {
      $("#linkNote").textContent = err.message;
      $("#linkNote").className = "link-note bad";
    }
  }, now ? 0 : 700);
}

$("#linkForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = $("#linkUrl").value.trim();
  if (!url) return toast("주소를 넣어 주세요", "warn");
  const link = {
    url,
    title: $("#linkName").value.trim() || linkInfo?.title || "",
    how: new FormData($("#linkForm")).get("how"),
    login: $("#linkLoginChk").checked,
  };
  if (e.submitter?.value === "page") {
    try {
      await api("POST", `/api/lessons/${S.lesson.id}/pages`, { kind: "link", link });
      toast("수업 자료 끝에 링크 쪽을 넣었어요", "ok");
      closeModal("linkDlg");
    } catch (err) {
      fail(err);
    }
    return;
  }
  send({ type: "link_send", link });
  toast("학생에게 링크를 보냈어요", "ok");
  closeModal("linkDlg");
});
$("#linkDlg").addEventListener("close", () => ($("#linkPrev").src = "about:blank"));

// ---------------------------------------------------------------- 수업 자료(쪽 순서)
function openPages() {
  if (!live()) return;
  renderPagesList();
  openModal("pagesDlg");
}

function pageTitle(p, i) {
  if (p.kind === "image") return `${i + 1}쪽 · 활동지`;
  if (p.kind === "board") return `${i + 1}쪽 · 화이트보드(${BOARD_LABEL[p.board] ?? "흰 판"})`;
  return `${i + 1}쪽 · 링크`;
}

function renderPagesList() {
  const L = S.lesson;
  const list = $("#pagesList");
  const move = async (i, d) => {
    const order = L.pages.map((p) => p.id);
    [order[i], order[i + d]] = [order[i + d], order[i]];
    await api("PUT", `/api/lessons/${L.id}/pages`, { order }).catch(fail);
  };
  list.replaceChildren(
    ...L.pages.map((p, i) =>
      h(
        "li",
        { class: p.id === L.teacherPage ? "current" : "" },
        h(
          "span",
          { class: `thumb ${p.kind === "board" ? `page board-${p.board}` : ""}`, style: p.kind === "image" ? { backgroundImage: `url(${p.src})` } : {} },
          p.kind === "link" ? icon("link") : null,
        ),
        h("div", { class: "t" }, h("b", {}, pageTitle(p, i)), h("small", {}, p.kind === "link" ? `${p.link.title} · ${p.link.url}` : p.name || "")),
        h("button", { class: "btn small", onclick: () => ((L.teacherPage = p.id), send({ type: "set", teacherPage: p.id }), closeModal("pagesDlg"), setView("board")) }, "이 쪽으로"),
        h("button", { class: "icon-btn", "aria-label": "위로", disabled: i === 0, onclick: () => move(i, -1) }, icon("chev-u")),
        h("button", { class: "icon-btn", "aria-label": "아래로", disabled: i === L.pages.length - 1, onclick: () => move(i, 1) }, icon("chev-d")),
        h(
          "button",
          {
            class: "icon-btn",
            "aria-label": "지우기",
            onclick: async () => {
              if (confirm(`${pageTitle(p, i)}을(를) 지울까요? 그 쪽의 필기도 학생 화면에서 사라져요.`)) await api("DELETE", `/api/lessons/${L.id}/pages/${p.id}`).catch(fail);
            },
          },
          icon("trash"),
        ),
      ),
    ),
  );
  if (!L.pages.length) list.append(h("li", { class: "empty" }, "아직 자료가 없어요. 위에서 더해요."));
}
$("#pgUpload").addEventListener("click", () => $("#file").click());
$("#pgBoard").addEventListener("click", () => openModal("boardDlg"));
$("#pgLink").addEventListener("click", () => (closeModal("pagesDlg"), openLinkDlg()));
$("#pgImport").addEventListener("click", openImport);

async function openImport() {
  openModal("importDlg");
  const box = $("#importList");
  box.replaceChildren(h("p", { class: "hint" }, "불러오는 중…"));
  try {
    const list = (await api("GET", "/api/lessons")).filter((l) => l.id !== S.lesson.id);
    box.replaceChildren(
      ...list.map((l) =>
        h(
          "button",
          {
            onclick: async () => {
              try {
                const r = await api("POST", `/api/lessons/${S.lesson.id}/import`, { fromLessonId: l.id });
                toast(`가져왔어요. 지금 수업 자료 ${r.pages}쪽`, "ok");
                closeModal("importDlg");
              } catch (err) {
                fail(err);
              }
            },
          },
          icon("file"),
          h("div", {}, h("b", {}, l.title), h("small", {}, `${l.className} · ${fmtTime(l.startedAt)} · ${l.pages}쪽 (활동지 ${l.kinds.filter((k) => k === "image").length}, 화이트보드 ${l.kinds.filter((k) => k === "board").length}, 링크 ${l.kinds.filter((k) => k === "link").length})`)),
          h("span", { class: "btn small" }, "가져오기"),
        ),
      ),
    );
    if (!list.length) box.replaceChildren(h("p", { class: "empty" }, "가져올 지난 수업이 없어요."));
  } catch (err) {
    fail(err);
  }
}

// ---------------------------------------------------------------- 학생 크게 보기
function openZoom(seat) {
  S.zoom = { seat, pageId: null, mode: null, board: null };
  openModal("zoom");
  renderZoom();
}

function renderZoom() {
  const z = S.zoom;
  if (!z || !S.lesson) return;
  const s = S.seats.get(z.seat);
  if (!s) return;
  const L = S.lesson;
  const frame = S.frames.get(z.seat);
  const canSnap = !!frame;
  if (z.mode == null) z.mode = canSnap ? "snap" : "ink";
  if (z.mode === "snap" && !canSnap) z.mode = "ink";
  z.pageId ??= studentPage(s)?.id ?? null;

  $("#zoomName").textContent = seatName(z.seat);
  $("#zStatus").textContent = `${STATUS_LABEL[s.status] ?? ""}${s.awayCount ? ` · 이탈 ${s.awayCount}` : ""}${s.kind === "app" ? " · 앱" : ""}`;
  const online = !["empty", "off"].includes(s.status);
  $("#zWorksheet").hidden = !canSnap;
  $("#zWorksheet").textContent = z.mode === "snap" ? "활동지 필기 보기" : "화면 그림 보기";
  $("#zLive").hidden = !online || !!L.endedAt;
  $("#zCloseTabs").hidden = !(online && s.kind === "app");
  $("#zRelease").hidden = s.status === "empty" || !!L.endedAt;

  const idx = L.pages.findIndex((p) => p.id === z.pageId);
  $("#zPage").textContent = L.pages.length ? `${idx + 1} / ${L.pages.length}` : "-";
  $("#zPrevPage").disabled = z.mode === "snap" || idx <= 0;
  $("#zNextPage").disabled = z.mode === "snap" || idx >= L.pages.length - 1;

  const stage = $("#zStage");
  if (z.mode === "snap") {
    z.board?.detach();
    z.board = null;
    let img = stage.querySelector(".snap-big");
    if (!img) stage.replaceChildren((img = h("img", { class: "snap-big", alt: `${z.seat}번 화면` })));
    img.src = frame.url;
  } else {
    stage.querySelector(".snap-big")?.remove();
    const page = L.pages[idx];
    if (!z.board) {
      z.board = new Board({ layers: 2, padding: 4 });
      z.board.attach(stage);
    }
    if (page) {
      if (z.board.page?.id !== page.id) z.board.setPage(page);
      z.board.setStrokes(0, L.teacherInk?.[page.id]);
      z.board.setStrokes(1, L.seats?.[z.seat]?.ink?.[page.id]);
    }
  }

  const info = $("#zInfo");
  const tabs = s.tabs ?? [];
  const showInfo = tabs.length || s.explore || s.linkOpens;
  info.hidden = !showInfo;
  if (showInfo) {
    info.replaceChildren(
      h("b", {}, "이번 수업에서 연 곳"),
      s.linkOpens ? h("p", {}, `보낸 링크를 ${s.linkOpens}번 열었어요`) : null,
      tabs.length ? [h("h4", {}, `열린 앱 탭 ${tabs.length}개`), h("ul", {}, tabs.map((t) => h("li", {}, t.title || t.url, h("br"), h("small", {}, t.url))))] : null,
      s.explore ? [h("h4", {}, "마지막 찾아보기"), h("p", {}, s.explore.q ? `검색: ${s.explore.q}` : s.explore.url)] : null,
      h("p", { class: "hint" }, "수업이 끝난 뒤 '활용 기록'에서 학생별로 모두 볼 수 있어요."),
    );
  }
}

$("#zClose").addEventListener("click", () => closeModal("zoom"));
$("#zoom").addEventListener("close", () => {
  S.zoom?.board?.detach();
  S.zoom = null;
});
$("#zWorksheet").addEventListener("click", () => {
  S.zoom.mode = S.zoom.mode === "snap" ? "ink" : "snap";
  renderZoom();
});
$("#zPrevPage").addEventListener("click", () => zoomPage(-1));
$("#zNextPage").addEventListener("click", () => zoomPage(1));
function zoomPage(d) {
  const pages = S.lesson.pages;
  const i = pages.findIndex((p) => p.id === S.zoom.pageId);
  if (pages[i + d]) S.zoom.pageId = pages[i + d].id;
  renderZoom();
}
$("#zPrevSeat").addEventListener("click", () => zoomSeat(-1));
$("#zNextSeat").addEventListener("click", () => zoomSeat(1));
function zoomSeat(d) {
  const seats = [...S.seats.keys()];
  const i = seats.indexOf(S.zoom.seat);
  const next = seats[(i + d + seats.length) % seats.length];
  S.zoom.board?.detach();
  S.zoom = { seat: next, pageId: null, mode: null, board: null };
  renderZoom();
}
$("#zRelease").addEventListener("click", () => {
  if (!confirm(`${seatName(S.zoom.seat)} 자리를 비울까요? 학생은 번호를 다시 골라 들어와요.`)) return;
  send({ type: "release_seat", seat: S.zoom.seat });
});
$("#zCloseTabs").addEventListener("click", () => {
  send({ type: "close_tabs", seat: S.zoom.seat });
  toast("앱 탭을 모두 닫으라고 보냈어요", "ok");
});
$("#zLive").addEventListener("click", () => {
  const seats = [...new Set([...(S.runtime?.live ?? []), S.zoom.seat])].slice(-6);
  send({ type: "live", seats });
  closeModal("zoom");
  S.liveSolo = S.zoom?.seat ?? null;
  openLiveWall();
});

// ---------------------------------------------------------------- 실시간 화면
function openLivePick() {
  const box = $("#livePickList");
  const chosen = new Set(S.runtime?.live ?? []);
  const seats = [...S.seats.values()];
  const count = () => ($("#livePickN").textContent = `${box.querySelectorAll("input:checked").length} / 6명`);
  box.replaceChildren(
    ...seats.map((s) => {
      const on = !["empty", "off"].includes(s.status);
      const input = h("input", { type: "checkbox", value: s.seat, checked: chosen.has(s.seat), disabled: !on });
      input.addEventListener("change", () => {
        if (box.querySelectorAll("input:checked").length > 6) {
          input.checked = false;
          toast("한 번에 6명까지 볼 수 있어요", "warn");
        }
        count();
      });
      return h("label", { class: on ? "" : "off" }, input, seatName(s.seat), s.kind === "app" ? h("small", { class: "hint", style: { margin: 0 } }, "앱") : null);
    }),
  );
  count();
  openModal("livePick");
}
$("#livePickGo").addEventListener("click", () => {
  const seats = $$("#livePickList input:checked").map((i) => Number(i.value));
  if (!seats.length) return toast("볼 학생을 골라 주세요", "warn");
  send({ type: "live", seats });
  closeModal("livePick");
  S.liveSolo = null;
  openLiveWall();
});

function openLiveWall() {
  openModal("liveWall");
  renderLiveWall();
}

function renderLiveWall() {
  const seats = S.runtime?.live ?? [];
  const grid = $("#liveGrid");
  grid.style.setProperty("--cols", seats.length <= 1 ? 1 : seats.length <= 4 ? 2 : 3);
  grid.classList.toggle("solo", S.liveSolo != null && seats.includes(S.liveSolo));
  grid.replaceChildren(
    ...seats.map((seat) => {
      const cell = h("div", { class: `lv-cell ${S.liveSolo === seat ? "solo" : ""}`, "data-seat": seat });
      cell.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        S.liveSolo = S.liveSolo === seat ? null : seat;
        renderLiveWall();
      });
      updateLiveCell(cell, seat);
      return cell;
    }),
  );
  if (!seats.length) grid.replaceChildren(h("div", { class: "lv-cell" }, h("div", { class: "lv-wait" }, "실시간으로 보는 학생이 없어요. '학생 고르기'를 눌러요.")));
}

function updateLiveCell(cell, seat) {
  const f = S.frames.get(seat);
  const s = S.seats.get(seat);
  const presenting = S.runtime?.present === seat;
  const fps = f ? Math.round(f.times.length / 3) : 0;
  let img = cell.querySelector("img");
  if (f && !img) {
    cell.querySelector(".lv-wait")?.remove();
    cell.prepend((img = h("img", { alt: `${seat}번 화면` })));
  }
  if (img) img.src = f.url;
  if (!f && !cell.querySelector(".lv-wait")) {
    cell.prepend(h("div", { class: "lv-wait" }, s?.capture === "denied" ? "학생이 화면 공유를 취소했어요" : s?.kind === "app" ? "화면 녹화를 허용하는 중…" : "학생이 '화면 선택·공유'를 누르면 보여요"));
  }
  const head = h("div", { class: "lv-h" }, h("b", {}, seatName(seat)), h("small", {}, f ? (f.via === "video" ? "영상" : `그림 · 초당 ${fps}장`) : "기다리는 중"));
  const foot = h(
    "div",
    { class: "lv-f" },
    h("button", { class: `btn small ${presenting ? "danger" : ""}`, onclick: () => (presenting ? stopBroadcast() : presentSeat(seat)) }, presenting ? "보여 주기 끝내기" : "모두에게 보여 주기"),
  );
  cell.querySelector(".lv-h")?.remove();
  cell.querySelector(".lv-f")?.remove();
  cell.append(head, foot);
}

function presentSeat(seat) {
  stopShare();
  send({ type: "present", seat });
  toast(`${seatName(seat)} 화면을 반 모두에게 보여 줘요`, "ok");
}

$("#liveEdit").addEventListener("click", openLivePick);
$("#liveClose").addEventListener("click", () => {
  send({ type: "live", seats: [] });
  closeModal("liveWall");
});

// ---------------------------------------------------------------- 화면 공유
async function startShare() {
  if (!navigator.mediaDevices?.getDisplayMedia) return toast("이 브라우저는 화면 공유를 할 수 없어요. 컴퓨터의 크롬·엣지·웨일에서 해 주세요.", "warn");
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 8 }, audio: false });
  } catch {
    return;
  }
  const video = h("video", { muted: true, playsInline: true });
  video.srcObject = stream;
  await video.play();
  const canvas = h("canvas");
  const ctx = canvas.getContext("2d");
  const timer = setInterval(() => {
    if (!video.videoWidth || (S.ws?.bufferedAmount ?? 0) > 1_500_000) return;
    const scale = Math.min(1, 1280 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    send({ type: "share_frame", data: canvas.toDataURL("image/jpeg", 0.6).split(",")[1] });
  }, 300);
  stream.getVideoTracks()[0].addEventListener("ended", stopBroadcast);
  S.share = { stream, timer };
  send({ type: "share_start" });
  renderDock();
  renderTop();
}

function stopShare() {
  if (!S.share) return;
  clearInterval(S.share.timer);
  S.share.stream.getTracks().forEach((t) => t.stop());
  S.share = null;
}

function stopBroadcast() {
  stopShare();
  send({ type: "share_stop" });
  renderDock();
  renderTop();
}

// ====================================================================== 모둠

function groupMembers(g) {
  return Object.entries(S.cls.groups?.assign ?? {})
    .filter(([, v]) => String(v) === String(g))
    .map(([s]) => Number(s))
    .sort((a, b) => a - b);
}

function renderGroups() {
  const grp = S.lesson?.group;
  const n = S.cls.groups?.n ?? 4;
  const active = !!grp?.active;
  $("#gStatus").textContent = active ? `모둠 활동 중 · ${n}모둠` : "모둠 활동 전";
  $("#gStartBtn").hidden = active;
  $("#gStopBtn").hidden = !active;
  $("#gStartBtn").disabled = !live();
  $("#gSaveBtn").disabled = !active && !S.lesson?.groupHistory?.length;
  $("#gHelp").hidden = active;
  const grid = $("#gGrid");
  grid.replaceChildren();
  if (!active) return;
  for (let g = 1; g <= n; g++) {
    const members = groupMembers(g);
    const locked = grp.locks?.[g] === true;
    const body = h("div", { class: "card-body", style: { "--ar": `${grp.bg === "page" ? grp.ar : 1.6}` } });
    const card = h(
      "button",
      { class: `g-card ${locked ? "locked" : ""}`, onclick: () => openGzoom(g) },
      h("div", { class: "g-card-h" }, h("b", {}, `${g}모둠`), h("small", {}, members.map(seatName).join(", ") || "모둠원 없음"), locked ? h("span", { class: "pill live", style: { marginLeft: "auto" } }, "멈춤") : null),
      body,
    );
    grid.append(card);
    const board = new Board({ layers: 1 });
    board.setBackground(grp);
    board.attach(body);
    board.setStrokes(0, grp.ink?.[g]);
    for (const m of grp.memos?.[g] ?? []) board.extra.append(memoEl(m));
  }
}

function onGroupEdit(m) {
  const grp = S.lesson?.group;
  if (!grp) return;
  if (m.type === "gink") (grp.ink[m.g] ??= []).push(m.stroke);
  if (m.type === "gset") {
    grp.ink[m.g] = m.ink;
    grp.memos[m.g] = m.memos;
  }
  if (m.type === "gmemo") {
    const list = (grp.memos[m.g] ??= []);
    const i = list.findIndex((x) => x.id === m.memo.id);
    if (i >= 0) list[i] = m.memo;
    else list.push(m.memo);
  }
  if (m.type === "gmemo_del") grp.memos[m.g] = (grp.memos[m.g] ?? []).filter((x) => x.id !== m.id);
  if (S.view === "group") renderGroups();
  if (S.gzoom && String(S.gzoom.g) === String(m.g)) {
    if (m.type === "gink") S.gzoom.board.addStroke(0, m.stroke);
    else renderGzoom();
  }
}

$("#gSetBtn").addEventListener("click", openGroupSet);
function openGroupSet() {
  const seats = [...S.seats.keys()].length ? [...S.seats.keys()] : Array.from({ length: S.cls.seats }, (_, i) => i + 1).filter((n) => !S.cls.disabledSeats.includes(n));
  const n = S.cls.groups?.n ?? 4;
  $("#gN").replaceChildren(...Array.from({ length: 11 }, (_, i) => h("option", { value: i + 2, selected: i + 2 === n }, `${i + 2}모둠`)));
  const draw = (assign) => {
    const count = Number($("#gN").value);
    $("#gAssign").replaceChildren(
      ...seats.map((s) =>
        h(
          "div",
          { class: "seat-row" },
          h("b", { style: { width: "80px" } }, seatName(s)),
          h("select", { "data-seat": s, "aria-label": `${s}번 모둠` }, h("option", { value: "" }, "-"), Array.from({ length: count }, (_, i) => h("option", { value: i + 1, selected: Number(assign[s]) === i + 1 }, `${i + 1}모둠`))),
        ),
      ),
    );
  };
  draw(S.cls.groups?.assign ?? {});
  $("#gN").onchange = () => draw(current());
  const current = () => Object.fromEntries($$("#gAssign select").map((sel) => [sel.dataset.seat, sel.value]));
  $("#gOrder").onclick = () => {
    const count = Number($("#gN").value);
    const per = Math.ceil(seats.length / count);
    draw(Object.fromEntries(seats.map((s, i) => [s, Math.floor(i / per) + 1])));
  };
  $("#gShuffle").onclick = () => {
    const count = Number($("#gN").value);
    const arr = [...seats].sort(() => Math.random() - 0.5);
    draw(Object.fromEntries(arr.map((s, i) => [s, (i % count) + 1])));
  };
  openModal("gSet");
}
$("#gSetForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const assign = Object.fromEntries($$("#gAssign select").filter((s) => s.value).map((s) => [s.dataset.seat, Number(s.value)]));
  send({ type: "group_set", n: Number($("#gN").value), assign });
  closeModal("gSet");
  toast("모둠을 저장했어요", "ok");
});

$("#gStartBtn").addEventListener("click", () => {
  if (!Object.keys(S.cls.groups?.assign ?? {}).length) {
    toast("먼저 '모둠 나누기'로 모둠을 정해 주세요", "warn");
    return openGroupSet();
  }
  const pages = S.lesson.pages.filter((p) => p.kind === "image");
  $("#gStartPage").replaceChildren(...pages.map((p) => h("option", { value: p.id }, `${S.lesson.pages.indexOf(p) + 1}쪽`)));
  $('input[name="bg"][value="page"]').disabled = !pages.length;
  $("#gContWrap").hidden = !S.lesson.groupHistory?.length;
  openModal("gStart");
});
$("#gStartForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const bg = new FormData(e.target).get("bg");
  send({ type: "group_start", bg, pageId: $("#gStartPage").value, cont: $("#gCont").checked });
  closeModal("gStart");
});
$("#gStopBtn").addEventListener("click", () => confirm("모둠 활동을 끝낼까요? 모둠 판은 수업 기록에 남아요.") && send({ type: "group_stop" }));
$("#gSaveBtn").addEventListener("click", saveGroupImages);

async function saveGroupImages() {
  const grp = S.lesson.group?.active ? S.lesson.group : S.lesson.groupHistory?.at(-1);
  if (!grp) return;
  const n = S.cls.groups?.n ?? 4;
  for (let g = 1; g <= n; g++) {
    const blob = await renderGroupPng(grp, g);
    const url = URL.createObjectURL(blob);
    h("a", { href: url, download: `${S.cls.name} ${S.lesson.title || "수업"} ${g}모둠.png` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
}

async function renderGroupPng(grp, g) {
  const ar = grp.bg === "page" ? grp.ar : 1.6;
  const W = 1600;
  const H = Math.round(W / ar);
  const canvas = h("canvas", { width: W, height: H });
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  if (grp.bg === "page" && grp.src) {
    const img = new Image();
    img.src = grp.src;
    await img.decode().catch(() => {});
    ctx.drawImage(img, 0, 0, W, H);
  } else if (grp.bg === "grid") {
    ctx.strokeStyle = "#dfe7f1";
    for (let x = 0; x <= 32; x++) (ctx.beginPath(), ctx.moveTo((x * W) / 32, 0), ctx.lineTo((x * W) / 32, H), ctx.stroke());
    for (let y = 0; y <= 20; y++) (ctx.beginPath(), ctx.moveTo(0, (y * H) / 20), ctx.lineTo(W, (y * H) / 20), ctx.stroke());
  }
  const inkLayer = h("canvas", { width: W, height: H });
  const tmp = new Board();
  for (const s of grp.ink?.[g] ?? []) tmp.draw(inkLayer, s);
  ctx.drawImage(inkLayer, 0, 0);
  const colors = { yellow: "#fff3a8", pink: "#ffd3e1", blue: "#cfeaff", green: "#d6f5cf" };
  ctx.font = "26px sans-serif";
  for (const m of grp.memos?.[g] ?? []) {
    const x = m.x * W;
    const y = m.y * H;
    ctx.fillStyle = colors[m.color] ?? colors.yellow;
    ctx.fillRect(x, y, W * 0.22, H * 0.14);
    ctx.fillStyle = "#1b2430";
    const words = m.text.split("");
    let line = "";
    let ly = y + 34;
    for (const ch of words) {
      if (ctx.measureText(line + ch).width > W * 0.2) {
        ctx.fillText(line, x + 10, ly);
        line = "";
        ly += 30;
      }
      line += ch;
    }
    ctx.fillText(line, x + 10, ly);
  }
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

function openGzoom(g) {
  S.gzoom = { g: String(g), board: null };
  openModal("gzoom");
  renderGzoom();
}

function renderGzoom() {
  const z = S.gzoom;
  const grp = S.lesson?.group;
  if (!z || !grp?.active) return closeModal("gzoom");
  $("#gzName").textContent = `${z.g}모둠`;
  $("#gzMembers").textContent = groupMembers(z.g).map(seatName).join(", ");
  const locked = grp.locks?.[z.g] === true;
  $("#gzLock").setAttribute("aria-pressed", String(locked));
  $("#gzLock").textContent = locked ? "멈춤 풀기" : "이 모둠 멈춤";
  if (!z.board) {
    z.board = new Board({ layers: 1, editable: true, padding: 4, onStroke: (stroke) => send({ type: "gink", g: z.g, stroke }) });
    z.board.attach($("#gzStage"));
    $("#gzTools").replaceChildren(penBar(z.board, { onClear: () => confirm("이 모둠 판을 모두 지울까요?") && send({ type: "gink_clear", g: z.g }), clearLabel: "판 지우기" }));
  }
  z.board.setBackground(grp);
  z.board.setStrokes(0, grp.ink?.[z.g]);
  z.board.extra.replaceChildren(...(grp.memos?.[z.g] ?? []).map((m) => memoEl(m, { onDelete: (mm) => send({ type: "gmemo_del", g: z.g, id: mm.id }) })));
}
$("#gzClose").addEventListener("click", () => closeModal("gzoom"));
$("#gzoom").addEventListener("close", () => {
  S.gzoom?.board?.detach();
  S.gzoom = null;
});
$("#gzLock").addEventListener("click", () => send({ type: "group_lock", g: S.gzoom.g, locked: $("#gzLock").getAttribute("aria-pressed") !== "true" }));
$("#gzMemo").addEventListener("click", () => {
  const text = prompt("메모 내용");
  if (text) send({ type: "gmemo", g: S.gzoom.g, memo: { text, x: 0.05 + Math.random() * 0.6, y: 0.05 + Math.random() * 0.6, color: "pink" } });
});
for (const [id, d] of [["gzPrev", -1], ["gzNext", 1]]) {
  $(`#${id}`).addEventListener("click", () => {
    const n = S.cls.groups?.n ?? 4;
    const g = ((Number(S.gzoom.g) - 1 + d + n) % n) + 1;
    S.gzoom.board?.detach();
    $("#gzStage").replaceChildren();
    S.gzoom = { g: String(g), board: null };
    renderGzoom();
  });
}

// ====================================================================== 퀴즈

async function renderQuizView() {
  renderQuizDash();
  try {
    S.quizzes = await api("GET", "/api/quizzes");
  } catch (err) {
    return fail(err);
  }
  const L = live();
  $("#qList").replaceChildren(
    ...S.quizzes.map((q) =>
      h(
        "div",
        { class: "q-row" },
        icon("quiz"),
        h("div", {}, h("b", {}, q.title), h("small", {}, `${q.items.length}문제 · ${fmtTime(q.updatedAt)} 고침`)),
        h("button", { class: "btn", onclick: () => openQuizEdit(q) }, icon("edit"), "고치기"),
        h("button", {
          class: "btn ghost",
          "aria-label": "지우기",
          onclick: async () => {
            if (!confirm(`"${q.title}" 퀴즈를 지울까요? 모든 반에서 사라져요(지난 결과는 남아요).`)) return;
            await api("DELETE", `/api/quizzes/${q.id}`).catch(fail);
            renderQuizView();
          },
        }, icon("trash")),
        h("button", { class: "btn primary", disabled: !L || !!S.quiz, onclick: () => openQuizStart(q) }, icon("send"), "보내기"),
      ),
    ),
  );
  if (!S.quizzes.length) $("#qList").replaceChildren(h("p", { class: "empty" }, "아직 퀴즈가 없어요. '새 퀴즈 만들기'로 만들어요. 만든 퀴즈는 모든 반이 함께 써요."));
}

const TYPE_LABEL = { choice: "객관식", ox: "O·X", short: "단답형", essay: "서술형" };

function renderQuizDash() {
  const run = S.quiz;
  const box = $("#qDash");
  box.hidden = !run;
  if (!run) return;
  const sm = run.summary;
  const answerText = (item, a) => (a == null ? "-" : item.type === "choice" ? item.options[a] ?? "-" : String(a));
  box.replaceChildren(
    h(
      "div",
      { class: "pane-h" },
      h("h2", {}, `진행 중 · ${run.quiz.title}`),
      h("span", { class: "spacer" }),
      run.reveal === "later" && !run.revealed ? h("button", { class: "btn", onclick: () => send({ type: "quiz_reveal" }) }, icon("send"), "결과 보내기") : null,
      h("button", { class: "btn primary", onclick: () => confirm("퀴즈를 끝낼까요? 학생 화면에서 퀴즈가 닫혀요.") && send({ type: "quiz_end" }) }, icon("flag"), "퀴즈 끝내기"),
    ),
    h(
      "div",
      { class: "q-stats" },
      h("div", { class: "q-stat" }, h("small", {}, "제출"), h("b", {}, `${sm.submitted} / ${run.rows.length}`)),
      h("div", { class: "q-stat" }, h("small", {}, "평균"), h("b", {}, sm.avg == null ? "-" : `${sm.avg}점`)),
      h("div", { class: "q-stat" }, h("small", {}, "안 낸 학생"), h("b", { style: { fontSize: "14px" } }, run.rows.filter((r) => !r.submitted).map((r) => r.seat).join(", ") || "없음")),
    ),
    h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        {},
        h(
          "thead",
          {},
          h(
            "tr",
            {},
            h("th", {}, "번호"),
            run.quiz.items.map((it, i) => h("th", {}, `${i + 1}. ${TYPE_LABEL[it.type]}`, h("div", { class: "bar", title: "정답률" }, h("i", { style: { width: `${sm.perItem[i] ?? 0}%` } })), h("small", {}, sm.perItem[i] == null ? "" : `${sm.perItem[i]}%`))),
            h("th", { class: "num" }, "점수"),
          ),
        ),
        h(
          "tbody",
          {},
          run.rows.map((r) =>
            h(
              "tr",
              {},
              h("td", {}, seatName(r.seat)),
              run.quiz.items.map((it, i) => {
                if (!r.submitted) return h("td", { class: "hint" }, "-");
                const g = r.grade.items[i];
                const a = r.answers[i];
                const cell = h("td", {}, h("span", { class: g.correct === true ? "res-ok" : g.correct === false ? "res-bad" : "" }, g.correct === true ? "○ " : g.correct === false ? "✕ " : "", answerText(it, a)));
                if (it.type === "short" && g.correct === false && a) {
                  cell.append(" ", h("button", { class: "btn small", onclick: () => send({ type: "quiz_accept", runId: run.id, idx: i, answer: a }) }, "정답 인정"));
                }
                if (it.type === "essay") {
                  const input = h("input", { type: "number", min: 0, max: it.points, value: g.score ?? "", style: { width: "70px" }, "aria-label": "점수" });
                  input.addEventListener("change", () => send({ type: "quiz_score", runId: run.id, seat: r.seat, idx: i, score: Number(input.value) }));
                  cell.append(h("div", {}, input, ` / ${it.points}점`));
                }
                return cell;
              }),
              h("td", { class: "num" }, r.submitted ? `${r.grade.percent}점` : "-"),
            ),
          ),
        ),
      ),
    ),
  );
}

let editingQuiz = null;
$("#qNewBtn").addEventListener("click", () => openQuizEdit(null));

function openQuizEdit(quiz) {
  editingQuiz = quiz;
  $("#qEditTitle").textContent = quiz ? "퀴즈 고치기" : "퀴즈 만들기";
  $("#qTitle").value = quiz?.title ?? "";
  $("#qItems").replaceChildren(...(quiz?.items ?? []).map(quizItemEl));
  $("#qEditMsg").textContent = "";
  openModal("qEdit");
}

for (const b of $$("[data-add]")) b.addEventListener("click", () => $("#qItems").append(quizItemEl({ type: b.dataset.add })));

function quizItemEl(item) {
  const el = h("div", { class: "q-item", "data-type": item.type });
  const q = h("textarea", { "data-f": "q", placeholder: "문제", rows: 2 }, item.q ?? "");
  const points = h("input", { type: "number", min: 1, max: 100, value: item.points ?? 1, "data-f": "points", style: { width: "70px" }, "aria-label": "배점" });
  el.append(
    h("div", { class: "q-item-h" }, h("b", {}, TYPE_LABEL[item.type]), h("span", { class: "spacer" }), h("label", { class: "inline" }, "배점", points), h("button", { type: "button", class: "icon-btn", "aria-label": "문제 지우기", onclick: () => el.remove() }, icon("trash"))),
    q,
  );
  if (item.type === "choice") {
    const opts = h("div", { class: "opts" });
    const addOpt = (text = "", correct = false) => {
      const row = h("div", { class: "opt" }, h("input", { type: "radio", name: `ans-${Math.random()}`, checked: correct, "aria-label": "정답" }), h("input", { type: "text", value: text, placeholder: "보기" }), h("button", { type: "button", class: "icon-btn", onclick: () => row.remove() }, icon("x")));
      row.querySelector("input[type=radio]").name = `ans-${el.dataset.k ??= Math.random().toString(36).slice(2)}`;
      opts.append(row);
    };
    (item.options ?? ["", "", "", ""]).forEach((o, i) => addOpt(o, i === (item.answer ?? 0)));
    el.append(opts, h("button", { type: "button", class: "btn small", style: { marginTop: "6px" }, onclick: () => addOpt() }, icon("plus"), "보기 더하기"), h("p", { class: "hint" }, "정답 보기의 동그라미를 눌러요."));
  } else if (item.type === "ox") {
    const k = Math.random().toString(36).slice(2);
    el.append(h("div", { class: "opt" }, "정답:", h("label", { class: "inline" }, h("input", { type: "radio", name: `ox-${k}`, value: "O", checked: item.answer !== "X" }), "O"), h("label", { class: "inline" }, h("input", { type: "radio", name: `ox-${k}`, value: "X", checked: item.answer === "X" }), "X")));
  } else if (item.type === "short") {
    el.append(h("input", { type: "text", "data-f": "answer", value: (item.answer ?? []).join(", "), placeholder: "정답 (여러 개면 쉼표로: 1/2, 2/4)", style: { marginTop: "6px" } }));
  } else {
    el.append(h("input", { type: "text", "data-f": "answer", value: item.answer ?? "", placeholder: "채점 기준(선택, 학생에게는 결과와 함께 보여요)", style: { marginTop: "6px" } }));
  }
  return el;
}

$("#qEditForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const items = $$("#qItems .q-item").map((el) => {
    const type = el.dataset.type;
    const item = { type, q: el.querySelector('[data-f="q"]').value, points: Number(el.querySelector('[data-f="points"]').value) };
    if (type === "choice") {
      const rows = $$(".opt", el);
      item.options = rows.map((r) => r.querySelector("input[type=text]").value);
      item.answer = Math.max(0, rows.findIndex((r) => r.querySelector("input[type=radio]").checked));
    } else if (type === "ox") {
      item.answer = el.querySelector("input[type=radio]:checked")?.value ?? "O";
    } else {
      item.answer = el.querySelector('[data-f="answer"]').value;
    }
    return item;
  });
  try {
    const body = { title: $("#qTitle").value, items };
    if (editingQuiz) await api("PUT", `/api/quizzes/${editingQuiz.id}`, body);
    else await api("POST", "/api/quizzes", body);
    closeModal("qEdit");
    renderQuizView();
  } catch (err) {
    $("#qEditMsg").textContent = err.message;
  }
});

let startingQuiz = null;
function openQuizStart(q) {
  startingQuiz = q;
  $("#qStartName").textContent = `${q.title} · ${q.items.length}문제`;
  openModal("qStart");
}
$("#qStartForm").addEventListener("submit", (e) => {
  e.preventDefault();
  send({ type: "quiz_start", quizId: startingQuiz.id, reveal: new FormData(e.target).get("reveal") });
  closeModal("qStart");
});

$("#qRunsBtn").addEventListener("click", async () => {
  openModal("qRuns");
  $("#qRunDetail").replaceChildren();
  try {
    const runs = await api("GET", `/api/classes/${S.cls.id}/quiz-runs`);
    const table = $("#qRunsTable");
    const prevAvg = new Map();
    const rows = [...runs].reverse().map((r) => {
      const before = prevAvg.get(r.quizId);
      if (r.avg != null) prevAvg.set(r.quizId, r.avg);
      return { ...r, delta: before != null && r.avg != null ? r.avg - before : null };
    }).reverse();
    table.replaceChildren(
      h("thead", {}, h("tr", {}, ["보낸 때", "퀴즈", "수업", "제출", "평균", "변화"].map((t, i) => h("th", { class: i >= 3 ? "num" : "" }, t)))),
      h(
        "tbody",
        {},
        rows.map((r) =>
          h(
            "tr",
            { class: "click", onclick: () => showRunDetail(r.id) },
            h("td", {}, fmtTime(r.startedAt)),
            h("td", {}, r.title),
            h("td", {}, r.lessonTitle || "-"),
            h("td", { class: "num" }, r.submitted),
            h("td", { class: "num" }, r.avg == null ? "-" : `${r.avg}점`),
            h("td", { class: "num" }, r.delta == null ? "" : h("span", { class: r.delta >= 0 ? "res-ok" : "res-bad" }, `${r.delta >= 0 ? "▲" : "▼"}${Math.abs(r.delta)}%p`)),
          ),
        ),
      ),
    );
    if (!rows.length) table.replaceChildren(h("tbody", {}, h("tr", {}, h("td", { class: "empty" }, "아직 보낸 퀴즈가 없어요."))));
  } catch (err) {
    fail(err);
  }
});
$("#qScoresCsv").addEventListener("click", (e) => (e.preventDefault(), download(`/api/classes/${S.cls.id}/quiz-scores.csv`, `${S.cls.name} 학생별 퀴즈 점수.csv`)));

async function showRunDetail(id) {
  const run = await api("GET", `/api/quiz-runs/${id}`).catch(fail);
  if (!run) return;
  $("#qRunDetail").replaceChildren(
    h("h3", { style: { margin: "14px 0 6px" } }, `${run.quiz.title} · 문제별 정답률`),
    h("ol", {}, run.quiz.items.map((it, i) => h("li", {}, `${it.q} — ${run.summary.perItem[i] == null ? "-" : `${run.summary.perItem[i]}%`}`))),
    h("p", { class: "hint" }, run.rows.filter((r) => r.submitted).map((r) => `${seatName(r.seat)} ${r.grade.percent}점`).join(" · ")),
  );
}

// ====================================================================== 활용 기록 · 수업 돌아보기

$("#statsBtn").addEventListener("click", openStats);

async function openStats() {
  openModal("stats");
  const table = $("#statsTable");
  try {
    const rows = await api("GET", `/api/classes/${S.cls.id}/lessons`);
    const cols = [
      ["startedAt", "날짜"],
      ["title", "수업"],
      ["participants", "참여"],
      ["minutes", "시간(분)"],
      ["worksheetPages", "활동지"],
      ["studentInk", "학생 필기"],
      ["follow", "따라오기"],
      ["lock", "모두 멈춤"],
      ["away", "앱 벗어남"],
      ["share", "화면 공유"],
      ["links", "링크 보냄"],
      ["linkOpeners", "링크 연 학생"],
      ["groups", "모둠"],
      ["quizzes", "퀴즈"],
    ];
    table.replaceChildren(
      h("thead", {}, h("tr", {}, cols.map(([k, l]) => h("th", { class: k === "title" || k === "startedAt" ? "" : "num" }, l)))),
      h(
        "tbody",
        {},
        rows.map((r) =>
          h(
            "tr",
            { class: "click", onclick: () => openHistory(r.id) },
            cols.map(([k]) => h("td", { class: k === "title" || k === "startedAt" ? "" : "num" }, k === "startedAt" ? fmtTime(r[k]) : r[k] ?? (k === "minutes" ? "-" : 0))),
          ),
        ),
      ),
    );
    if (!rows.length) table.replaceChildren(h("tbody", {}, h("tr", {}, h("td", { class: "empty" }, "아직 수업 기록이 없어요."))));
  } catch (err) {
    fail(err);
  }
}
$("#csvBtn").addEventListener("click", (e) => (e.preventDefault(), download(`/api/classes/${S.cls.id}/stats.csv`, `${S.cls.name} 활용 기록.csv`)));

let hist = null;
async function openHistory(lessonId) {
  try {
    hist = await api("GET", `/api/lessons/${lessonId}/review`);
  } catch (err) {
    return fail(err);
  }
  closeModal("stats");
  const L = hist.lesson;
  $("#histTitle").textContent = `${L.title} · ${L.className}`;
  $("#histSub").textContent = `${fmtTime(L.startedAt)}${L.minutes ? ` · ${L.minutes}분` : ""} · 참여 ${L.participants}명`;
  setHistTab("table");
  openModal("hist");
}

for (const b of $$("[data-htab]")) b.addEventListener("click", () => setHistTab(b.dataset.htab));
function setHistTab(tab) {
  for (const b of $$("[data-htab]")) b.setAttribute("aria-selected", String(b.dataset.htab === tab));
  const body = $("#histBody");
  if (tab === "table") body.replaceChildren(histTable());
  if (tab === "work") body.replaceChildren(histWork());
  if (tab === "group") body.replaceChildren(histGroups());
}

function histTable() {
  const saveTimers = new Map();
  return h(
    "div",
    { class: "table-wrap", style: { maxHeight: "none" } },
    h(
      "table",
      {},
      h("thead", {}, h("tr", {}, ["번호", "들어온 시각", "필기(획)", "앱 벗어남", "링크 연 횟수", "찾아보기", "모둠 메모", ...hist.quizzes.map((q) => `퀴즈: ${q.title}`), "피드백"].map((t) => h("th", {}, t)))),
      h(
        "tbody",
        {},
        hist.seats.map((s) => {
          const fb = h("textarea", { rows: 1, placeholder: "피드백 쓰기", "aria-label": `${s.seat}번 피드백` }, s.feedback);
          fb.addEventListener("input", () => {
            clearTimeout(saveTimers.get(s.seat));
            saveTimers.set(
              s.seat,
              setTimeout(() => {
                s.feedback = fb.value;
                api("PUT", `/api/lessons/${hist.lesson.id}/feedback`, { seat: s.seat, text: fb.value }).catch(fail);
              }, 600),
            );
          });
          return h(
            "tr",
            {},
            h("td", {}, h("button", { class: "btn ghost small", onclick: () => histStudent(s) }, seatName(s.seat))),
            h("td", {}, s.joinedAt ? fmtClock(s.joinedAt) : "안 들어옴"),
            h("td", { class: "num" }, s.inkCount),
            h("td", { class: "num" }, s.awayCount),
            h("td", { class: "num" }, s.linkOpens),
            h("td", { title: s.explores.map((e) => e.q || e.url).join("\n") }, s.explores.length ? `${s.explores.length}곳` : "-"),
            h("td", { class: "num" }, s.memos),
            s.quiz.map((v) => h("td", { class: "num" }, v == null ? "-" : `${v}점`)),
            h("td", {}, fb),
          );
        }),
      ),
    ),
  );
}

function histStudent(s) {
  const L = hist.lesson;
  const pagesWithInk = L.pages.filter((p) => s.ink[p.id]?.length);
  const body = $("#histBody");
  const fb = h("textarea", { rows: 4 }, s.feedback);
  fb.addEventListener("change", () => {
    s.feedback = fb.value;
    api("PUT", `/api/lessons/${L.id}/feedback`, { seat: s.seat, text: fb.value }).then(() => toast("피드백을 저장했어요", "ok"), fail);
  });
  const grid = h("div", { class: "g-grid" });
  body.replaceChildren(
    h("div", { class: "pane-h" }, h("button", { class: "btn", onclick: () => setHistTab("table") }, icon("back"), "학생 활동 표로"), h("h2", {}, seatName(s.seat))),
    h("div", { class: "admin-grid" }, h("div", { class: "panel" }, h("h3", {}, "피드백"), fb), h(
      "div",
      { class: "panel" },
      h("h3", {}, "연 링크·찾아본 곳"),
      s.explores.length ? h("ul", {}, s.explores.map((e) => h("li", {}, `${fmtClock(e.ts)} `, e.q ? `검색: ${e.q}` : e.url))) : h("p", { class: "hint" }, "찾아본 곳이 없어요"),
      h("p", { class: "hint" }, `보낸 링크를 ${s.linkOpens}번 열었어요 · 앱 벗어남 ${s.awayCount}번`),
      s.tabs.length ? h("ul", {}, s.tabs.map((t) => h("li", {}, t.title || t.url))) : null,
    )),
    h("h3", { style: { margin: "16px 0 8px" } }, `필기한 쪽 ${pagesWithInk.length}개`),
    grid,
  );
  for (const p of pagesWithInk) {
    const cardBody = h("div", { class: "card-body", style: { aspectRatio: `${pageAr(p)}` } });
    grid.append(h("div", { class: "g-card" }, h("div", { class: "g-card-h" }, h("b", {}, `${L.pages.indexOf(p) + 1}쪽`)), cardBody));
    const b = new Board({ layers: 2 });
    b.setPage(p);
    b.attach(cardBody);
    b.setStrokes(0, L.teacherInk?.[p.id]);
    b.setStrokes(1, s.ink[p.id]);
  }
}

function histWork() {
  const L = hist.lesson;
  const wrap = h("div", { class: "grid", "data-size": "m" });
  for (const s of hist.seats) {
    const page = L.pages.find((p) => s.ink[p.id]?.length);
    if (!page) continue;
    const body = h("div", { class: "card-body" });
    wrap.append(h("button", { class: "card", "data-status": "here", onclick: () => histStudent(s) }, h("div", { class: "card-h" }, h("b", { class: "num" }, s.seat), h("span", { class: "nm" }, S.names[s.seat] || ""), h("span", { class: "st" }, `${L.pages.indexOf(page) + 1}쪽 외`)), body));
    const b = new Board({ layers: 2 });
    b.setPage(page);
    b.attach(body);
    b.setStrokes(0, L.teacherInk?.[page.id]);
    b.setStrokes(1, s.ink[page.id]);
  }
  if (!wrap.children.length) return h("p", { class: "empty" }, "학생 필기가 없어요.");
  return wrap;
}

function histGroups() {
  const out = h("div");
  if (!hist.groupHistory.length) return h("p", { class: "empty" }, "이 수업에는 모둠 활동이 없었어요.");
  hist.groupHistory.forEach((grp, k) => {
    const grid = h("div", { class: "g-grid" });
    out.append(h("h3", { style: { margin: "12px 0 8px" } }, `모둠 활동 ${k + 1} · ${fmtClock(grp.startedAt)}~${fmtClock(grp.endedAt)}`), grid);
    const groups = [...new Set(Object.values(grp.assign))].sort((a, b) => a - b);
    for (const g of groups) {
      const body = h("div", { class: "card-body", style: { aspectRatio: `${grp.bg === "page" ? grp.ar : 1.6}` } });
      const members = Object.entries(grp.assign).filter(([, v]) => v === g).map(([s]) => s);
      grid.append(h("div", { class: "g-card" }, h("div", { class: "g-card-h" }, h("b", {}, `${g}모둠`), h("small", {}, members.map((s) => seatName(s)).join(", "))), body));
      const b = new Board({ layers: 1 });
      b.setBackground(grp);
      b.attach(body);
      b.setStrokes(0, grp.ink?.[g]);
      for (const m of grp.memos?.[g] ?? []) b.extra.append(memoEl(m));
    }
  });
  return out;
}

$("#histClose").addEventListener("click", () => closeModal("hist"));
$("#histCsv").addEventListener("click", (e) => (e.preventDefault(), download(`/api/lessons/${hist.lesson.id}/review.csv`, `${hist.lesson.className} ${hist.lesson.title} 학생 활동.csv`)));
$("#histReuse").addEventListener("click", async () => {
  if (!confirm("이 수업 자료(활동지·화이트보드·링크 쪽)로 새 수업을 시작할까요? 지금 수업은 끝나요.")) return;
  try {
    stopShare();
    await api("POST", `/api/classes/${S.cls.id}/lessons`, { title: hist.lesson.title, fromLessonId: hist.lesson.id });
    closeModal("hist");
    setTimeout(openQr, 300);
  } catch (err) {
    fail(err);
  }
});

// ====================================================================== 반 설정 (번호·이름표)

$("#setBtn").addEventListener("click", openSettings);

function openSettings() {
  $("#seatsIn").value = S.cls.seats;
  drawNames();
  openModal("settings");
}

function drawNames() {
  const max = Math.min(40, Math.max(1, Number($("#seatsIn").value) || 1));
  const disabled = new Set(S.cls.disabledSeats ?? []);
  const prev = Object.fromEntries($$("#namesGrid .name-cell").map((c) => [c.dataset.seat, { name: c.querySelector("input[type=text]").value, on: c.querySelector("input[type=checkbox]").checked }]));
  const grid = $("#namesGrid");
  grid.replaceChildren(
    ...Array.from({ length: max }, (_, i) => {
      const seat = i + 1;
      const p = prev[seat];
      const on = p ? p.on : !disabled.has(seat);
      const chk = h("input", { type: "checkbox", checked: on, "aria-label": `${seat}번 사용` });
      const name = h("input", { type: "text", value: p ? p.name : S.names[seat] ?? "", maxlength: 20, placeholder: "이름", "aria-label": `${seat}번 이름` });
      const cell = h("div", { class: `name-cell ${on ? "" : "off"}`, "data-seat": seat }, chk, h("b", {}, seat), name);
      chk.addEventListener("change", () => (cell.classList.toggle("off", !chk.checked), summary()));
      name.addEventListener("paste", (e) => {
        const text = e.clipboardData.getData("text");
        if (!text.includes("\n")) return;
        e.preventDefault();
        const list = text.split(/\r?\n/).map((t) => t.split("\t").pop().trim()).filter(Boolean);
        const cells = $$("#namesGrid .name-cell").filter((c) => Number(c.dataset.seat) >= seat && c.querySelector("input[type=checkbox]").checked);
        cells.forEach((c, k) => list[k] != null && (c.querySelector("input[type=text]").value = list[k]));
      });
      return cell;
    }),
  );
  summary();
}

function summary() {
  const cells = $$("#namesGrid .name-cell");
  const off = cells.filter((c) => !c.querySelector("input[type=checkbox]").checked).map((c) => c.dataset.seat);
  $("#rosterSummary").textContent = `마지막 번호 ${cells.length}번 · 사용 ${cells.length - off.length}명${off.length ? ` (빈 번호: ${off.join(", ")})` : ""}`;
}

$("#seatsIn").addEventListener("input", drawNames);
for (const b of $$(".stepper [data-step]")) {
  b.addEventListener("click", () => {
    $("#seatsIn").value = Math.min(40, Math.max(1, Number($("#seatsIn").value) + Number(b.dataset.step)));
    drawNames();
  });
}

$("#setForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const cells = $$("#namesGrid .name-cell");
  const names = {};
  const disabledSeats = [];
  for (const c of cells) {
    const n = c.querySelector("input[type=text]").value.trim();
    if (n) names[c.dataset.seat] = n;
    if (!c.querySelector("input[type=checkbox]").checked) disabledSeats.push(Number(c.dataset.seat));
  }
  S.names = names;
  store.set(`woori.names.${S.cls.id}`, names);
  try {
    await api("PATCH", `/api/classes/${S.cls.id}`, { seats: cells.length, disabledSeats });
    closeModal("settings");
    toast("반 설정을 저장했어요", "ok");
  } catch (err) {
    fail(err);
  }
});
$("#logoutBtn").addEventListener("click", logout);

boot();
