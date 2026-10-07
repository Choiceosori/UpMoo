// 우리반 수업 — 학생 화면 (웹 브라우저 · '우리반 수업' 앱 안의 화면이 함께 씀)
import { $, $$, Board, api, h, icon, memoEl, penBar, store, toast, wsUrl } from "./common.js";

/**
 * 안드로이드 앱(WebView) 다리. 앱에서 열리면 window.WooriApp 이 있어요.
 *   WooriApp.setCapture(mode, intervalMs, maxWidth)  화면 그림/실시간 보내기
 *   WooriApp.openTab(url, title) / WooriApp.closeTabs()  앱 안의 탭
 *   WooriApp.setPinned(bool)  수업 중 앱 고정
 * 앱 → 화면: window.wooriApp.onFrame(b64, w, h, via) / onTabs(json) / onCaptureState(state)
 */
const APP = typeof window.WooriApp !== "undefined" ? window.WooriApp : null;

const SAVE_KEY = "woori.student";
const deviceId = store.get("woori.device") ?? crypto.randomUUID();
store.set("woori.device", deviceId);

const S = {
  code: "",
  seat: null,
  ws: null,
  retry: 1000,
  stopped: false,
  connected: false,
  className: "",
  lesson: null,
  myInk: {},
  page: null,
  group: null,
  quiz: null,
  quizDone: null,
  share: null,
  mode: null,
  board: null,
  outOpened: false,
  windows: [],
  explore: { open: false, tabs: [], cur: 0 },
  capture: { mode: "off" },
  stream: null,
  captureTimer: null,
  appTabs: [],
  countedLinks: new Set(),
};

// ====================================================================== 들어오기

function showJoin(msg = "") {
  $("#join").hidden = false;
  $("#sapp").hidden = true;
  $("#joinMsg").textContent = msg;
  S.code ? showSeats() : showCode();
}

function showCode() {
  $("#stepCode").hidden = false;
  $("#stepSeat").hidden = true;
  drawCode();
}

function drawCode() {
  $$("#codeBoxes span").forEach((el, i) => {
    el.textContent = S.code[i] ?? "";
    el.classList.toggle("cur", i === S.code.length);
  });
}

$("#keypad").append(
  ...["1", "2", "3", "4", "5", "6", "7", "8", "9", "지움", "0", "←"].map((k) =>
    h(
      "button",
      {
        type: "button",
        "aria-label": k === "←" ? "한 칸 지우기" : k === "지움" ? "모두 지우기" : k,
        onclick: () => {
          if (k === "←") S.code = S.code.slice(0, -1);
          else if (k === "지움") S.code = "";
          else if (S.code.length < 4) S.code += k;
          drawCode();
          if (S.code.length === 4) showSeats();
        },
      },
      k,
    ),
  ),
);

let pickedSeat = null;
async function showSeats() {
  $("#joinMsg").textContent = "";
  let info;
  try {
    info = await api("GET", `/api/join/${S.code}`);
  } catch (err) {
    S.code = "";
    showCode();
    $("#joinMsg").textContent = err.message;
    return;
  }
  $("#stepCode").hidden = true;
  $("#stepSeat").hidden = false;
  $("#seatLead").replaceChildren(h("b", {}, info.className), info.title ? ` · ${info.title}` : "", h("br"), "내 번호를 눌러요");
  const saved = store.get(SAVE_KEY);
  const mine = saved?.code === S.code ? saved.seat : null;
  pickedSeat = null;
  $("#seatGo").disabled = true;
  $("#seatGrid").replaceChildren(
    ...info.seats.map((n) => {
      const b = h("button", { type: "button", disabled: info.taken.includes(n) && n !== mine }, n);
      b.addEventListener("click", () => {
        pickedSeat = n;
        $$("#seatGrid button").forEach((x) => x.classList.toggle("sel", x === b));
        $("#seatGo").disabled = false;
        $("#seatGo").textContent = `${n}번, 네 들어갈래요`;
      });
      return b;
    }),
  );
  if (info.entryLocked) $("#joinMsg").textContent = "선생님이 입장을 잠갔어요. 전에 들어왔던 태블릿만 들어올 수 있어요.";
}

$("#seatBack").addEventListener("click", () => {
  S.code = "";
  showCode();
});
$("#seatGo").addEventListener("click", () => {
  if (!pickedSeat) return;
  S.seat = pickedSeat;
  store.set(SAVE_KEY, { code: S.code, seat: S.seat });
  connect();
});

// ====================================================================== 연결

function connect() {
  S.stopped = false;
  const ws = new WebSocket(wsUrl());
  S.ws = ws;
  ws.onopen = () => ws.send(JSON.stringify({ type: "hello", role: "student", code: S.code, seat: S.seat, deviceId, kind: APP ? "app" : "web" }));
  ws.onmessage = (e) => onMessage(JSON.parse(e.data));
  ws.onclose = () => {
    if (S.ws !== ws) return;
    S.connected = false;
    setConn();
    if (S.stopped) return;
    setTimeout(() => S.ws === ws && !S.stopped && connect(), S.retry);
    S.retry = Math.min(S.retry * 2, 10000);
  };
}

function send(msg) {
  if (S.connected && S.ws?.readyState === WebSocket.OPEN) S.ws.send(JSON.stringify(msg));
}

function setConn() {
  const dot = $("#sConn");
  if (!dot) return;
  dot.className = `dot ${S.connected ? "on" : "off"}`;
  dot.title = S.connected ? "연결됨" : "다시 연결하는 중…";
}

function stop(msg, { keepCode = false } = {}) {
  S.stopped = true;
  S.ws?.close();
  stopCapture();
  APP?.setPinned?.(false);
  APP?.closeTabs?.();
  if (!keepCode) S.code = "";
  store.set(SAVE_KEY, null);
  showJoin(msg);
}

function onMessage(m) {
  switch (m.type) {
    case "welcome":
      S.connected = true;
      S.retry = 1000;
      S.seat = m.seat;
      S.className = m.className;
      S.lesson = m.lesson;
      S.myInk = m.myInk ?? {};
      S.group = m.group;
      S.quiz = m.quiz;
      S.share = m.share != null ? { from: m.share, frame: null } : null;
      if (!S.page || !S.lesson.pages.some((p) => p.id === S.page)) S.page = S.lesson.teacherPage ?? S.lesson.pages[0]?.id ?? null;
      $("#join").hidden = true;
      $("#sapp").hidden = false;
      APP?.setPinned?.(true);
      setConn();
      render(true);
      sendStatus();
      break;
    case "rejected":
      if (m.reason === "taken") return stop(m.error, { keepCode: true });
      if (m.reason === "seat") return stop(m.error, { keepCode: true });
      return stop(m.error);
    case "released":
      return stop("선생님이 자리를 비웠어요. 번호를 다시 골라요.", { keepCode: true });
    case "ended":
      S.stopped = true;
      stopCapture();
      APP?.setPinned?.(false);
      APP?.closeTabs?.();
      store.set(SAVE_KEY, null);
      showEnded();
      break;
    case "flags": {
      const wasLocked = S.lesson.locked;
      Object.assign(S.lesson, { follow: m.follow, teacherPage: m.teacherPage, locked: m.locked, explore: m.explore });
      if (m.follow) S.page = m.teacherPage;
      if (!m.explore) S.explore.open = false;
      if (m.locked && !wasLocked) notifyCall("선생님을 봐 주세요");
      render();
      break;
    }
    case "pages":
      S.lesson.pages = m.pages;
      S.lesson.teacherPage = m.teacherPage;
      if (S.lesson.follow || !S.lesson.pages.some((p) => p.id === S.page)) S.page = m.teacherPage ?? m.pages[0]?.id ?? null;
      render(true);
      break;
    case "title":
      S.lesson.title = m.title;
      renderTop();
      break;
    case "ink":
      (S.lesson.teacherInk[m.pageId] ??= []).push(m.stroke);
      if (S.board && S.mode?.startsWith("page") && S.board.page?.id === m.pageId) S.board.addStroke(0, m.stroke);
      break;
    case "ink_set":
      S.lesson.teacherInk[m.pageId] = m.strokes;
      if (S.board && S.mode?.startsWith("page") && S.board.page?.id === m.pageId) S.board.setStrokes(0, m.strokes);
      break;
    case "link":
      S.lesson.link = m.link;
      S.outOpened = false;
      if (m.back) {
        closeWindows();
        APP?.closeTabs?.();
        notifyCall("수업 화면으로 돌아와요");
      }
      render();
      break;
    case "close_tabs":
      APP?.closeTabs?.();
      closeWindows();
      break;
    case "share":
      S.share = m.from != null ? { from: m.from, frame: null } : null;
      renderCovers();
      break;
    case "share_frame":
      if (S.share) {
        S.share.frame = m.data;
        const img = $("#shareImg");
        if (img) img.src = `data:image/jpeg;base64,${m.data}`;
      }
      break;
    case "capture":
      setCapture(m);
      break;
    case "group":
      S.group = m.group;
      render(true);
      break;
    case "gink":
      if (S.group && m.g === S.group.g) {
        S.group.ink.push(m.stroke);
        if (S.mode === "group") S.board?.addStroke(0, m.stroke);
      }
      break;
    case "gset":
      if (S.group && m.g === S.group.g) {
        S.group.ink = m.ink;
        S.group.memos = m.memos;
        if (S.mode === "group") render(true);
      }
      break;
    case "gmemo":
    case "gmemo_del":
      if (S.group && m.g === S.group.g) {
        if (m.type === "gmemo") {
          const i = S.group.memos.findIndex((x) => x.id === m.memo.id);
          if (i >= 0) S.group.memos[i] = m.memo;
          else S.group.memos.push(m.memo);
        } else S.group.memos = S.group.memos.filter((x) => x.id !== m.id);
        if (S.mode === "group") drawMemos();
      }
      break;
    case "quiz":
      S.quiz = m.quiz;
      render(S.mode === "quiz" || !!m.quiz);
      break;
    case "error":
      toast(m.error, "warn");
      break;
  }
}

// ====================================================================== 상태 보고 (앱 벗어남 감지)

function linkState() {
  const lk = currentLink();
  if (!lk) return S.outOpened ? "out" : "none";
  if (lk.how === "out") return S.outOpened ? "out" : "none";
  return "in";
}

function currentLink() {
  if (S.mode === "link") return S.lesson.link;
  if (S.mode?.startsWith("pagelink")) return S.lesson.pages.find((p) => p.id === S.page)?.link ?? null;
  return null;
}

function isVisible() {
  if (document.visibilityState !== "visible") return false;
  if (APP) return true;
  return document.hasFocus() || document.activeElement?.tagName === "IFRAME";
}

let statusTimer = null;
function sendStatus() {
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    const cur = S.appTabs.find((t) => t.current);
    send({ type: "status", visible: isVisible(), link: linkState(), page: S.page, tab: cur?.title ?? "", tabs: S.appTabs });
  }, 60);
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && S.outOpened && !currentLink()) S.outOpened = false;
  sendStatus();
});
window.addEventListener("focus", sendStatus);
window.addEventListener("blur", sendStatus);
setInterval(() => S.connected && sendStatus(), 20000);

// ====================================================================== 화면 그리기

function renderTop() {
  $("#sSeat").textContent = S.seat;
  $("#sTitle").textContent = S.lesson?.title || "수업 중";
  $("#sClass").textContent = S.className;
  $("#exBtn").hidden = !S.lesson?.explore;
  $("#exBtn").setAttribute("aria-pressed", String(S.explore.open));
  $("#bellBtn").hidden = APP || !("Notification" in window) || Notification.permission !== "default";
}

function wantedMode() {
  if (S.quiz && S.quizDone !== S.quiz.runId) return "quiz";
  if (S.group) return "group";
  if (S.lesson.link) return "link";
  if (S.explore.open && S.lesson.explore) return "explore";
  const page = S.lesson.pages.find((p) => p.id === S.page);
  if (!page) return "empty";
  return page.kind === "link" ? `pagelink:${page.id}` : `page:${page.id}`;
}

function render(force = false) {
  renderTop();
  const mode = wantedMode();
  const sameLink = mode === "link" && S.mode === "link" && S.renderedLinkId === S.lesson.link?.id;
  if (force || mode !== S.mode || (mode === "link" && !sameLink)) {
    S.board?.detach();
    S.board = null;
    S.mode = mode;
    const main = $("#sMain");
    main.replaceChildren();
    $("#sBottom").replaceChildren();
    $("#sBottom").hidden = false;
    if (mode === "quiz") renderQuiz(main);
    else if (mode === "group") renderGroup(main);
    else if (mode === "link") renderLink(main, S.lesson.link, true);
    else if (mode === "explore") renderExplore(main);
    else if (mode.startsWith("pagelink")) renderLink(main, S.lesson.pages.find((p) => p.id === S.page).link, false);
    else if (mode.startsWith("page")) renderPage(main);
    else main.append(h("div", { class: "s-out" }, icon("board"), h("b", {}, "선생님이 활동지를 준비하고 있어요"), h("span", { class: "hint" }, "조금만 기다려요")));
    if (mode !== "quiz" && mode !== "group") renderPager();
  } else if (mode.startsWith("page") || mode.startsWith("pagelink")) {
    renderPager();
  }
  renderCovers();
  sendStatus();
}

// ---------------------------------------------------------------- 활동지·화이트보드
function renderPage(main) {
  const page = S.lesson.pages.find((p) => p.id === S.page);
  const stage = h("div", { class: "stage" });
  main.append(stage);
  S.board = new Board({
    layers: 2,
    editable: true,
    padding: 2,
    onStroke: (stroke) => {
      (S.myInk[page.id] ??= []).push(stroke);
      send({ type: "ink", pageId: page.id, stroke });
    },
  });
  S.board.setPage(page);
  S.board.attach(stage);
  S.board.setStrokes(0, S.lesson.teacherInk[page.id]);
  S.board.setStrokes(1, S.myInk[page.id]);
}

function renderPager() {
  const bottom = $("#sBottom");
  bottom.replaceChildren();
  const pages = S.lesson.pages;
  const i = pages.findIndex((p) => p.id === S.page);
  const locked = S.lesson.follow;
  const go = (d) => {
    const next = pages[i + d];
    if (!next) return;
    S.page = next.id;
    render();
  };
  if (pages.length) {
    bottom.append(
      h("div", { class: "pager" },
        h("button", { class: "icon-btn", "aria-label": "이전 쪽", disabled: locked || i <= 0, onclick: () => go(-1) }, icon("chev-l")),
        h("span", { class: "page-no" }, `${i + 1} / ${pages.length}`),
        h("button", { class: "icon-btn", "aria-label": "다음 쪽", disabled: locked || i >= pages.length - 1, onclick: () => go(1) }, icon("chev-r")),
      ),
    );
    if (locked) bottom.append(h("span", { class: "pill" }, icon("follow"), "선생님을 따라가요"));
  }
  if (S.board) {
    const page = S.board.page;
    bottom.append(
      penBar(S.board, {
        onUndo: () => {
          const list = S.myInk[page.id];
          if (!list?.length) return;
          list.pop();
          S.board.setStrokes(1, list);
          send({ type: "ink_undo", pageId: page.id });
        },
        onClear: () => {
          if (!confirm("이 쪽에 내가 쓴 것을 모두 지울까요?")) return;
          S.myInk[page.id] = [];
          S.board.setStrokes(1, []);
          send({ type: "ink_clear", pageId: page.id });
        },
        clearLabel: "모두 지우기",
      }),
    );
  }
}

// ---------------------------------------------------------------- 링크
function openOutside(url, title) {
  if (APP?.openTab) {
    APP.openTab(url, title || "");
    return;
  }
  const w = window.open(url, "_blank");
  if (w) {
    try {
      w.opener = null;
    } catch {
      /* 다른 출처 */
    }
    S.windows.push(w);
  }
}

function closeWindows() {
  for (const w of S.windows) {
    try {
      w.close();
    } catch {
      /* 이미 닫힘 */
    }
  }
  S.windows = [];
  S.outOpened = false;
}

function renderLink(main, lk, fromTeacher) {
  S.renderedLinkId = lk.id;
  const opened = () => {
    send({ type: "link_open" });
    S.outOpened = true;
    sendStatus();
  };
  if (lk.how === "out") {
    main.append(
      h("div", { class: "s-out" }, icon("external"), h("b", { style: { fontSize: "20px" } }, lk.title), h("p", {}, "선생님이 보낸 사이트예요. '열기'를 눌러 새 창에서 활동해요."),
        h("button", { class: "btn primary big", onclick: () => (openOutside(lk.url, lk.title), opened()) }, icon("external"), "열기"),
        h("p", { class: "hint" }, "다 하면 이 화면으로 돌아와요."),
      ),
    );
    return;
  }
  const frame = h("iframe", { src: lk.embed, title: lk.title, allow: "fullscreen; clipboard-write; autoplay; encrypted-media; microphone; camera", referrerpolicy: "strict-origin-when-cross-origin" });
  main.append(
    h("div", { class: "s-frame" },
      h("div", { class: "s-frame-h" },
        icon("link"),
        h("b", {}, lk.title),
        lk.login ? h("button", { class: "btn primary small", onclick: () => (openOutside(lk.url, lk.title), S.loginPending = true) }, icon("key"), "새 창에서 로그인") : null,
        h("button", { class: "btn small", onclick: () => (openOutside(lk.url, lk.title), opened()) }, icon("external"), "안 되면 새 창으로"),
      ),
      frame,
    ),
  );
  if (fromTeacher && !S.countedLinks.has(lk.id)) {
    S.countedLinks.add(lk.id);
    send({ type: "link_open" });
  }
}

// 로그인하러 새 창에 갔다 돌아오면 앱 안의 사이트를 다시 불러 로그인된 채로 열어요.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && S.loginPending) {
    S.loginPending = false;
    const frame = $("#sMain iframe");
    if (frame) frame.src = frame.src;
  }
});

// ---------------------------------------------------------------- 찾아보기
$("#exBtn").addEventListener("click", () => {
  S.explore.open = !S.explore.open;
  render();
});

function renderExplore(main) {
  const input = h("input", { type: "search", placeholder: "검색어나 사이트 주소", "aria-label": "검색어나 사이트 주소", enterkeyhint: "search" });
  const tabsBar = h("div", { class: "ex-tabs" });
  const body = h("div", { class: "s-frame" });
  const openTarget = (raw) => {
    const text = raw.trim();
    if (!text) return;
    const isUrl = /^https?:\/\//i.test(text) || /^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(text);
    const url = isUrl ? (/^https?:/i.test(text) ? text : `https://${text}`) : `https://www.google.com/search?igu=1&safe=active&q=${encodeURIComponent(text)}`;
    const title = isUrl ? new URL(url).hostname : `검색: ${text}`;
    send({ type: "explore", q: isUrl ? "" : text, url: isUrl ? url : "", title });
    if (S.explore.tabs.length >= 3) S.explore.tabs.shift();
    S.explore.tabs.push({ url, title });
    S.explore.cur = S.explore.tabs.length - 1;
    draw();
  };
  const draw = () => {
    tabsBar.replaceChildren(
      ...S.explore.tabs.map((t, i) =>
        h("button", { class: i === S.explore.cur ? "on" : "", onclick: () => ((S.explore.cur = i), draw()) }, h("span", {}, t.title),
          h("span", { "aria-label": "탭 닫기", role: "button", onclick: (e) => (e.stopPropagation(), S.explore.tabs.splice(i, 1), (S.explore.cur = Math.max(0, S.explore.tabs.length - 1)), draw()) }, "✕")),
      ),
    );
    const t = S.explore.tabs[S.explore.cur];
    body.replaceChildren(
      t
        ? h("div", { class: "s-frame-h" }, icon("search"), h("b", {}, t.title), h("button", { class: "btn small", onclick: () => (openOutside(t.url, t.title), (S.outOpened = true), sendStatus()) }, icon("external"), "안 되면 새 창으로"))
        : null,
      t ? h("iframe", { src: t.url, title: t.title, referrerpolicy: "strict-origin-when-cross-origin" }) : h("div", { class: "s-out" }, icon("search"), h("b", {}, "궁금한 것을 찾아봐요"), h("span", { class: "hint" }, "구글 안전 검색을 써요. 내가 찾아본 곳은 선생님 화면에 보여요.")),
    );
  };
  const linkPages = S.lesson.pages.filter((p) => p.kind === "link");
  main.append(
    h("form", { class: "ex-bar", onsubmit: (e) => (e.preventDefault(), openTarget(input.value), (input.value = "")) }, input, h("button", { class: "btn primary", type: "submit" }, icon("search"), "찾기"), h("button", { class: "btn", type: "button", onclick: () => ((S.explore.open = false), render()) }, "닫기")),
    linkPages.length ? h("div", { class: "ex-bar", style: { flexWrap: "wrap" } }, h("small", { class: "hint", style: { margin: 0 } }, "선생님 링크:"), linkPages.map((p) => h("button", { class: "btn small", type: "button", onclick: () => openTarget(p.link.url) }, p.link.title))) : null,
    tabsBar,
    body,
  );
  draw();
  $("#sBottom").hidden = true;
}

// ---------------------------------------------------------------- 모둠 판
function renderGroup(main) {
  const g = S.group;
  const stage = h("div", { class: "stage" });
  main.append(
    h("div", { class: "s-frame-h" }, icon("users"), h("b", {}, `${g.g}모둠 · ${g.members.map((s) => `${s}번`).join(", ")}`),
      g.locked ? h("span", { class: "pill live" }, "선생님이 이 모둠을 멈췄어요") : null,
      h("button", { class: "btn small", disabled: g.locked, onclick: addMemo }, icon("note"), "메모 붙이기"),
    ),
    stage,
  );
  S.board = new Board({ layers: 1, editable: !g.locked, padding: 2, onStroke: (stroke) => (S.group.ink.push(stroke), send({ type: "gink", stroke })) });
  S.board.setBackground(g);
  S.board.attach(stage);
  S.board.setStrokes(0, g.ink);
  drawMemos();
  if (!g.locked) $("#sBottom").append(penBar(S.board, {}));
  else $("#sBottom").hidden = true;
}

function drawMemos() {
  if (!S.board) return;
  S.board.extra.replaceChildren(
    ...S.group.memos.map((m) => memoEl(m, { onDelete: m.by === S.seat && !S.group.locked ? (mm) => send({ type: "gmemo_del", id: mm.id }) : null })),
  );
}

function addMemo() {
  const text = prompt("메모에 쓸 말");
  if (!text) return;
  const colors = ["yellow", "blue", "green", "pink"];
  send({ type: "gmemo", memo: { text, x: 0.05 + Math.random() * 0.65, y: 0.05 + Math.random() * 0.65, color: colors[S.seat % colors.length] } });
}

// ---------------------------------------------------------------- 퀴즈
function renderQuiz(main) {
  const q = S.quiz;
  const sheet = h("div", { class: "quiz-sheet" });
  main.append(sheet);
  $("#sBottom").hidden = true;
  const answers = q.answers ? [...q.answers] : q.items.map(() => null);
  sheet.append(h("div", { class: "qq", style: { background: "var(--navy-50)" } }, h("h3", {}, `퀴즈 · ${q.title}`), h("span", { class: "hint" }, `${q.items.length}문제`)));
  q.items.forEach((it, i) => {
    const box = h("div", { class: "qq" }, h("h3", {}, `${i + 1}. ${it.q}`, h("small", { class: "hint" }, ` (${it.points}점)`)));
    const res = q.result?.items[i];
    const name = `q${i}`;
    if (it.type === "choice") {
      box.append(h("div", { class: "opts" }, it.options.map((o, k) => h("label", {}, h("input", { type: "radio", name, checked: answers[i] === k, disabled: q.submitted, onchange: () => (answers[i] = k) }), o))));
    } else if (it.type === "ox") {
      box.append(h("div", { class: "opts ox" }, ["O", "X"].map((v) => h("label", {}, h("input", { type: "radio", name, checked: answers[i] === v, disabled: q.submitted, onchange: () => (answers[i] = v) }), v))));
    } else {
      const input = it.type === "essay" ? h("textarea", { rows: 4, disabled: q.submitted }, answers[i] ?? "") : h("input", { type: "text", value: answers[i] ?? "", disabled: q.submitted });
      input.addEventListener("input", () => (answers[i] = input.value));
      box.append(input);
    }
    if (q.result) {
      const correct = q.correct?.[i];
      const shown = it.type === "choice" ? it.options[correct] : correct;
      box.append(h("p", { class: res.correct === true ? "res-ok" : res.correct === false ? "res-bad" : "" },
        res.correct === true ? "○ 맞았어요" : res.correct === false ? "✕ 다시 생각해 봐요" : res.score != null ? `${res.score}점` : "선생님이 채점해요",
        shown ? h("span", { class: "hint", style: { fontWeight: 400 } }, ` · 정답/기준: ${shown}`) : null));
    }
    sheet.append(box);
  });
  const foot = h("div", { class: "qq", style: { textAlign: "center" } });
  if (!q.submitted) {
    foot.append(h("button", {
      class: "btn primary big",
      onclick: () => {
        const empty = answers.filter((a) => a == null || a === "").length;
        if (empty && !confirm(`${empty}문제를 안 풀었어요. 그래도 낼까요?`)) return;
        send({ type: "quiz_submit", answers });
      },
    }, icon("send"), "내기"));
  } else if (q.result) {
    foot.append(h("p", { style: { fontSize: "22px", fontWeight: 800, margin: "0 0 10px" } }, `${q.result.percent}점`), h("button", { class: "btn", onclick: () => ((S.quizDone = q.runId), render()) }, "활동지로 돌아가기"));
  } else {
    foot.append(h("p", {}, "냈어요! 선생님이 결과를 보내 줄 때까지 기다려요."), h("button", { class: "btn", onclick: () => ((S.quizDone = q.runId), render()) }, "활동지로 돌아가기"));
  }
  sheet.append(foot);
}

// ---------------------------------------------------------------- 덮개: 모두 멈춤 · 화면 공유
function renderCovers() {
  const main = $("#sMain");
  main.querySelector(".cover.lock")?.remove();
  const shareCover = main.querySelector(".cover.share");
  if (S.share && S.share.from !== S.seat) {
    const label = S.share.from === "teacher" ? "선생님 화면" : `${S.share.from}번 친구 화면`;
    if (!shareCover) {
      main.append(h("div", { class: "cover share" }, h("span", { class: "tag" }, label), h("img", { id: "shareImg", alt: label, src: S.share.frame ? `data:image/jpeg;base64,${S.share.frame}` : "" })));
    } else shareCover.querySelector(".tag").textContent = label;
  } else shareCover?.remove();
  if (S.lesson?.locked) {
    main.append(h("div", { class: "cover lock", role: "alert" }, icon("lock"), h("div", { class: "big" }, "선생님을 봐 주세요"), h("div", {}, "선생님이 화면을 잠깐 멈췄어요")));
  }
}

function showEnded() {
  $("#join").hidden = true;
  $("#sapp").hidden = false;
  S.board?.detach();
  $("#sBottom").hidden = true;
  $("#exBtn").hidden = true;
  $("#sMain").replaceChildren(
    h("div", { class: "cover ended" }, icon("check"), h("b", { style: { fontSize: "26px" } }, "수업이 끝났어요. 수고했어요!"), h("button", { class: "btn", onclick: () => ((S.code = ""), showJoin()) }, "다른 수업에 들어가기")),
  );
}

// ====================================================================== 화면 보내기 (학생 화면 보기 · 실시간 화면)

function setCapture(cfg) {
  S.capture = cfg;
  renderWatchTag();
  if (APP?.setCapture) {
    APP.setCapture(cfg.mode, cfg.intervalMs ?? 0, cfg.maxWidth ?? 0);
    return;
  }
  // 웹(노트북): 실시간 화면만, 학생이 허용해야 해요
  if (cfg.mode !== "live") return stopCapture();
  if (S.stream) return startCaptureLoop();
  const bar = h("div", { class: "cover", style: { inset: "auto 0 0 0", background: "var(--amber-50)", padding: "12px", gap: "8px", position: "absolute", zIndex: 45 } },
    h("b", {}, "선생님이 내 화면을 실시간으로 보려고 해요"),
    h("button", {
      class: "btn primary",
      onclick: async () => {
        try {
          S.stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 8 }, audio: false });
          S.stream.getVideoTracks()[0].addEventListener("ended", () => (stopCapture(), send({ type: "capture_state", state: "denied" })));
          bar.remove();
          send({ type: "capture_state", state: "sharing" });
          startCaptureLoop();
        } catch {
          send({ type: "capture_state", state: "denied" });
          bar.remove();
        }
      },
    }, icon("share"), "화면 선택·공유"),
  );
  bar.id = "capBar";
  $("#capBar")?.remove();
  $("#sMain").append(bar);
}

function startCaptureLoop() {
  clearInterval(S.captureTimer);
  const video = h("video", { muted: true, playsInline: true });
  video.srcObject = S.stream;
  video.play();
  const canvas = h("canvas");
  S.captureTimer = setInterval(() => {
    if (S.capture.mode !== "live" || !video.videoWidth || (S.ws?.bufferedAmount ?? 0) > 400_000) return;
    const scale = Math.min(1, (S.capture.maxWidth || 960) / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    send({ type: "frame", data: canvas.toDataURL("image/jpeg", 0.6).split(",")[1], w: canvas.width, h: canvas.height });
  }, Math.max(120, S.capture.intervalMs || 250));
}

function stopCapture() {
  clearInterval(S.captureTimer);
  S.stream?.getTracks().forEach((t) => t.stop());
  S.stream = null;
  $("#capBar")?.remove();
  APP?.setCapture?.("off", 0, 0);
}

function renderWatchTag() {
  $(".watch-tag")?.remove();
  if (S.capture.mode === "live") document.body.append(h("div", { class: "watch-tag" }, "● 선생님이 내 화면을 실시간으로 보는 중"));
  else if (S.capture.mode === "snap" && APP) document.body.append(h("div", { class: "watch-tag", style: { background: "var(--navy)" } }, "선생님이 내 화면을 보고 있어요"));
}

window.wooriApp = {
  onFrame(data, w, hgt, via) {
    send({ type: "frame", data, w, h: hgt, via: via || "image" });
  },
  onTabs(json) {
    try {
      S.appTabs = JSON.parse(json);
    } catch {
      S.appTabs = [];
    }
    sendStatus();
  },
  onCaptureState(state) {
    send({ type: "capture_state", state });
  },
};

// ====================================================================== 알림 ("선생님이 불러요")

$("#bellBtn").addEventListener("click", async () => {
  const p = await Notification.requestPermission();
  toast(p === "granted" ? "알림을 켰어요. 새 창에 있을 때 선생님이 부르면 알려 줘요." : "알림이 꺼져 있어요. 브라우저 설정에서 허용할 수 있어요.", p === "granted" ? "ok" : "warn");
  renderTop();
});

function notifyCall(body) {
  if (document.visibilityState === "visible" || !("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const n = new Notification("선생님이 불러요", { body, tag: "woori-call", requireInteraction: true });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* 모바일 크롬은 서비스워커 알림만 허용할 수 있어요 */
  }
}

// ====================================================================== 시작

const params = new URLSearchParams(location.search);
const saved = store.get(SAVE_KEY);
const fromQr = (params.get("c") || "").replace(/\D/g, "").slice(0, 4);
if (fromQr && (!saved || saved.code !== fromQr)) {
  S.code = fromQr;
  showJoin();
} else if (saved?.code) {
  S.code = saved.code;
  S.seat = saved.seat;
  connect();
  $("#join").hidden = true;
} else {
  showJoin();
}
