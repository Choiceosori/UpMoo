// Smart Class Control — 교사 콘솔 (의존성 없는 바닐라 JS)

const TOKEN_KEY = "mdm.teacherToken";
const RESTRICTION_LABELS = {
  camera: "카메라 비활성화",
  bluetooth: "블루투스 금지",
  tethering: "핫스팟/테더링 금지",
  settings: "설정 앱 접근 차단",
  installApps: "앱 설치 금지",
  uninstallApps: "앱 삭제 금지",
  statusBar: "상단 알림창 차단",
  safeBoot: "안전모드 부팅 금지",
  factoryReset: "초기화 금지",
  usbFileTransfer: "USB 파일 전송 금지",
};
const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

const state = {
  token: safeGet(TOKEN_KEY),
  classes: [],
  cls: null,
  students: new Map(),
  frames: new Map(),
  selected: new Set(),
  tab: "monitor",
  ws: null,
  wsReady: false,
  broadcast: null,
  focusId: null,
  presets: null,
  alerts: new Set(),
  teacherCast: null,
};

// ---------------------------------------------------------------- utils

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* 저장 불가 환경 무시 */
  }
}

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (["checked", "value", "disabled", "selected", "muted", "playsInline"].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const $app = document.getElementById("app");

function toast(text, kind = "") {
  const el = h("div", { class: `toast ${kind}` }, text);
  document.getElementById("toasts").append(el);
  setTimeout(() => el.remove(), kind === "danger" ? 6000 : 3500);
}

function fmtTime(ts) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json", ...(state.token ? { authorization: `Bearer ${state.token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/api/login") {
    logout();
    throw new Error("로그인이 만료되었습니다");
  }
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}

function wsUrl() {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
}

function studentLabel(s) {
  return s ? `${s.number ? `${s.number}번 ` : ""}${s.name}` : "";
}

// ---------------------------------------------------------------- websocket

let reconnectDelay = 1000;

function connectWs() {
  if (!state.token || state.ws) return;
  const ws = new WebSocket(wsUrl());
  state.ws = ws;
  ws.onopen = () => ws.send(JSON.stringify({ type: "hello", role: "teacher", token: state.token }));
  ws.onmessage = (ev) => onWsMessage(JSON.parse(ev.data));
  ws.onclose = (ev) => {
    state.ws = null;
    state.wsReady = false;
    renderTopbar();
    if (ev.code === 4003) return logout();
    if (!state.token) return;
    setTimeout(connectWs, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 15000);
  };
}

function wsSend(msg) {
  if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(msg));
}

function onWsMessage(msg) {
  switch (msg.type) {
    case "welcome":
      state.wsReady = true;
      reconnectDelay = 1000;
      renderTopbar();
      if (state.cls) wsSend({ type: "subscribe", classId: state.cls.id });
      if (state.focusId) wsSend({ type: "focus", studentId: state.focusId });
      break;
    case "class_state":
      if (msg.classId !== state.cls?.id) return;
      state.cls = { ...state.cls, ...msg.class };
      state.students = new Map(msg.students.map((s) => [s.id, s]));
      state.broadcast = msg.broadcast;
      if (state.tab === "monitor") renderTab();
      break;
    case "student_update":
      state.students.set(msg.student.id, msg.student);
      updateTile(msg.student.id);
      if (state.focusId === msg.student.id) renderStudentInfo();
      break;
    case "student_removed":
      state.students.delete(msg.studentId);
      state.selected.delete(msg.studentId);
      if (state.tab === "monitor") renderTab();
      break;
    case "frame": {
      const url = `data:image/jpeg;base64,${msg.data}`;
      state.frames.set(msg.studentId, url);
      const img = document.querySelector(`.tile[data-id="${msg.studentId}"] .thumb img`);
      if (img) img.src = url;
      else updateTile(msg.studentId);
      if (state.focusId === msg.studentId) {
        document.getElementById("sm-screen").src = url;
        document.getElementById("sm-empty").hidden = true;
      }
      break;
    }
    case "violation": {
      const s = state.students.get(msg.studentId);
      toast(`⚠ ${studentLabel(s)}: ${msg.kind === "web" ? "차단 사이트" : "차단 앱"} 시도 — ${msg.target}`, "danger");
      state.alerts.add(msg.studentId);
      setTimeout(() => {
        state.alerts.delete(msg.studentId);
        updateTile(msg.studentId);
      }, 10_000);
      updateTile(msg.studentId);
      break;
    }
    case "class_policy":
      if (state.cls) state.cls.policy = msg.policy;
      break;
    case "broadcast_state":
      state.broadcast = msg.source;
      if (state.tab === "monitor") renderTab();
      break;
    case "error":
      toast(msg.error, "danger");
      break;
  }
}

// ---------------------------------------------------------------- routing

function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

window.addEventListener("hashchange", route);

async function route() {
  if (!state.token) return renderLogin();
  connectWs();
  const [, page, id, tab] = location.hash.replace(/^#/, "").split("/");
  if (page === "class" && id) {
    if (state.cls?.id !== id) {
      stopTeacherCast();
      state.selected.clear();
      state.frames.clear();
      state.students.clear();
      try {
        state.cls = await api("GET", `/api/classes/${id}`);
      } catch (err) {
        toast(err.message, "danger");
        return navigate("#/");
      }
      wsSend({ type: "subscribe", classId: id });
    }
    state.tab = tab || "monitor";
    return renderClass();
  }
  if (state.cls) {
    stopTeacherCast();
    state.cls = null;
  }
  return renderClassList();
}

function logout() {
  state.token = null;
  safeSet(TOKEN_KEY, null);
  stopTeacherCast();
  state.ws?.close();
  state.cls = null;
  renderTopbar();
  renderLogin();
}

function renderTopbar() {
  const right = document.getElementById("topbar-right");
  right.replaceChildren();
  if (!state.token) return;
  right.append(
    h("span", { class: `badge ${state.wsReady ? "ok" : "warn"}` }, state.wsReady ? "실시간 연결됨" : "연결 중…"),
    " ",
    h("button", { class: "btn", onclick: logout }, "로그아웃"),
  );
}

// ---------------------------------------------------------------- login

function renderLogin() {
  renderTopbar();
  const input = h("input", { type: "password", placeholder: "교사 비밀번호", autocomplete: "current-password", required: true });
  const form = h(
    "form",
    {
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          const { token } = await api("POST", "/api/login", { password: input.value });
          state.token = token;
          safeSet(TOKEN_KEY, token);
          renderTopbar();
          route();
        } catch (err) {
          toast(err.message, "danger");
        }
      },
    },
    h("h2", {}, "교사 로그인"),
    input,
    h("button", { class: "btn primary", type: "submit" }, "로그인"),
    h("p", { class: "hint" }, "서버의 MDM_TEACHER_PASSWORD 환경변수 값입니다."),
  );
  $app.replaceChildren(h("div", { class: "panel login" }, form));
  input.focus();
}

// ---------------------------------------------------------------- class list

async function renderClassList() {
  renderTopbar();
  try {
    state.classes = await api("GET", "/api/classes");
  } catch (err) {
    return toast(err.message, "danger");
  }
  const nameInput = h("input", { type: "text", placeholder: "예: 2학년 3반 과학", maxlength: 50 });
  const create = h(
    "form",
    {
      class: "toolbar",
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          const cls = await api("POST", "/api/classes", { name: nameInput.value });
          navigate(`#/class/${cls.id}`);
        } catch (err) {
          toast(err.message, "danger");
        }
      },
    },
    nameInput,
    h("button", { class: "btn primary", type: "submit" }, "+ 새 수업 만들기"),
  );

  const cards = state.classes.map((c) =>
    h(
      "div",
      { class: "panel class-card", onclick: () => navigate(`#/class/${c.id}`) },
      h("h3", {}, c.name),
      h("div", { class: "pin" }, c.pin),
      h(
        "div",
        { class: "muted" },
        `접속 ${c.onlineCount} / 등록 ${c.studentCount}명`,
        c.schedule?.enabled ? " · 시간표 사용" : "",
      ),
    ),
  );

  $app.replaceChildren(
    h("h2", {}, "내 수업"),
    create,
    cards.length ? h("div", { class: "class-grid" }, cards) : h("div", { class: "panel empty" }, "아직 수업이 없습니다. 새 수업을 만들어 PIN을 학생에게 안내하세요."),
  );
}

// ---------------------------------------------------------------- class view

function renderClass() {
  const c = state.cls;
  const tabs = [
    ["monitor", "실시간 모니터링"],
    ["policy", "기기 통제 정책"],
    ["schedule", "정책 시간표"],
    ["report", "리포트"],
  ];
  $app.replaceChildren(
    h(
      "div",
      { class: "class-head" },
      h("button", { class: "btn ghost", onclick: () => navigate("#/") }, "← 수업 목록"),
      h("h2", { style: "margin:0" }, c.name),
      h("span", { class: "pin-chip", title: "학생 참여 안내", onclick: openJoinModal }, `PIN ${c.pin}`),
      h("div", { class: "spacer" }),
      h(
        "button",
        {
          class: "btn ghost",
          onclick: async () => {
            const name = prompt("수업 이름", c.name);
            if (!name) return;
            state.cls = { ...state.cls, ...(await api("PATCH", `/api/classes/${c.id}`, { name })) };
            renderClass();
          },
        },
        "이름 변경",
      ),
      h(
        "button",
        {
          class: "btn ghost danger",
          onclick: async () => {
            if (!confirm(`"${c.name}" 수업과 모든 학생/기록을 삭제할까요?`)) return;
            await api("DELETE", `/api/classes/${c.id}`);
            navigate("#/");
          },
        },
        "수업 삭제",
      ),
    ),
    h(
      "nav",
      { class: "tabs" },
      tabs.map(([key, label]) =>
        h("button", { class: state.tab === key ? "active" : "", onclick: () => navigate(`#/class/${c.id}/${key}`) }, label),
      ),
    ),
    h("section", { id: "tab" }),
  );
  renderTab();
}

function renderTab() {
  const el = document.getElementById("tab");
  if (!el) return;
  const renderers = { monitor: renderMonitor, policy: renderPolicy, schedule: renderSchedule, report: renderReport };
  (renderers[state.tab] ?? renderMonitor)(el);
}

// ---------------------------------------------------------------- monitor

function targets() {
  return state.selected.size ? [...state.selected] : "all";
}

function command(cmd, args, explicitTargets) {
  wsSend({ type: "command", cmd, args, targets: explicitTargets ?? targets() });
}

function renderMonitor(el) {
  const students = [...state.students.values()];
  const online = students.filter((s) => s.online).length;
  const selCount = state.selected.size;
  const scope = selCount ? `선택 ${selCount}명` : "전체";
  const kioskOn = state.cls.policy?.kiosk?.enabled;

  const banner = state.broadcast
    ? h(
        "div",
        { class: "broadcast-banner" },
        state.broadcast === "teacher"
          ? "📡 교사 화면을 학생 기기로 전송 중입니다."
          : `📡 발표 모드: ${studentLabel(state.students.get(state.broadcast))} 학생 화면을 전체에 공유 중입니다.`,
        h("button", { class: "btn", onclick: stopBroadcast }, "전송 중지"),
      )
    : null;

  el.replaceChildren(
    banner ?? "",
    h(
      "div",
      { class: "toolbar" },
      h("span", { class: "muted" }, `접속 ${online} / ${students.length}명`),
      h("div", { class: "sep" }),
      h(
        "button",
        {
          class: "btn",
          onclick: () => {
            if (state.selected.size === students.length) state.selected.clear();
            else students.forEach((s) => state.selected.add(s.id));
            renderTab();
          },
        },
        selCount && selCount === students.length ? "선택 해제" : "전체 선택",
      ),
      h("button", { class: "btn danger", onclick: () => command("lock") }, `🔒 ${scope} 화면 잠금`),
      h("button", { class: "btn", onclick: () => command("unlock") }, `🔓 ${scope} 잠금 해제`),
      h(
        "button",
        {
          class: "btn",
          onclick: () => {
            const url = prompt(`${scope} 학생 기기 브라우저로 열 URL`, "https://");
            if (url) command("open_url", { url });
          },
        },
        "🌐 URL 열기",
      ),
      h(
        "button",
        {
          class: "btn",
          onclick: () => {
            const text = prompt(`${scope} 학생에게 보낼 알림 메시지`);
            if (text) command("message", { text });
          },
        },
        "💬 메시지",
      ),
      h("div", { class: "sep" }),
      state.teacherCast
        ? h("button", { class: "btn active", onclick: stopBroadcast }, "📡 내 화면 전송 중지")
        : h("button", { class: "btn", onclick: startTeacherCast }, "📡 내 화면 전송"),
      h(
        "button",
        { class: `btn ${kioskOn ? "active" : ""}`, onclick: () => toggleKiosk(!kioskOn) },
        kioskOn ? "📌 키오스크 해제" : "📌 키오스크 모드",
      ),
    ),
    students.length
      ? h("div", { class: "grid", id: "grid" }, students.map(renderTile))
      : h("div", { class: "panel empty" }, `학생이 아직 없습니다. 학생 기기에서 PIN ${state.cls.pin}로 참여하세요.`),
  );
}

function renderTile(s) {
  const frame = state.frames.get(s.id);
  const live = s.live ?? {};
  const caps = live.capabilities ?? {};
  const missing = s.online && (caps.accessibility === false || caps.capture === false);
  const badges = [
    h("span", { class: `badge ${s.online ? "ok" : ""}` }, s.online ? "온라인" : "오프라인"),
    s.locked ? h("span", { class: "badge danger" }, "잠금") : null,
    live.kioskActive ? h("span", { class: "badge accent" }, "키오스크") : null,
    state.broadcast === s.id ? h("span", { class: "badge accent" }, "발표 중") : null,
    s.violations?.app || s.violations?.web
      ? h("span", { class: "badge warn" }, `위반 ${(s.violations.app ?? 0) + (s.violations.web ?? 0)}`)
      : null,
    missing ? h("span", { class: "badge warn", title: "학생 앱에서 접근성/화면 캡처 권한을 허용해야 합니다" }, "권한 필요") : null,
    live.battery != null ? h("span", { class: "badge" }, `🔋${live.battery}%`) : null,
  ];
  const tile = h(
    "div",
    {
      class: `tile ${s.online ? "" : "offline"} ${state.selected.has(s.id) ? "selected" : ""} ${state.alerts.has(s.id) ? "alert" : ""}`,
      "data-id": s.id,
      onclick: () => openStudentModal(s.id),
    },
    h("input", {
      type: "checkbox",
      class: "check",
      checked: state.selected.has(s.id),
      onclick: (e) => {
        e.stopPropagation();
        if (e.target.checked) state.selected.add(s.id);
        else state.selected.delete(s.id);
        renderTab();
      },
    }),
    h("div", { class: "thumb" }, frame ? h("img", { src: frame, alt: "" }) : s.online ? "화면 대기 중" : "오프라인"),
    s.locked ? h("div", { class: "lock-overlay" }, "🔒 잠금됨") : null,
    h(
      "div",
      { class: "meta" },
      h("div", { class: "name" }, studentLabel(s), h("span", { class: "muted", style: "font-weight:400;font-size:12px" }, s.platform)),
      h("div", { class: "app", title: live.foregroundApp || "" }, s.online ? live.foregroundLabel || live.foregroundApp || "-" : `마지막 접속 ${fmtTime(s.lastSeenAt)}`),
      h("div", { class: "badges" }, badges),
    ),
  );
  return tile;
}

function updateTile(id) {
  if (state.tab !== "monitor") return;
  const s = state.students.get(id);
  const grid = document.getElementById("grid");
  if (!s || !grid) return renderTab();
  const old = grid.querySelector(`.tile[data-id="${id}"]`);
  if (old) old.replaceWith(renderTile(s));
  else renderTab();
}

async function toggleKiosk(enabled) {
  try {
    const policy = { ...state.cls.policy, kiosk: { ...state.cls.policy.kiosk, enabled } };
    state.cls.policy = await api("PUT", `/api/classes/${state.cls.id}/policy`, { policy });
    toast(enabled ? "키오스크 모드를 적용했습니다" : "키오스크 모드를 해제했습니다");
    renderTab();
  } catch (err) {
    toast(err.message, "danger");
  }
}

// ---------------------------------------------------------------- teacher screen broadcast

async function startTeacherCast() {
  if (!navigator.mediaDevices?.getDisplayMedia) return toast("이 브라우저는 화면 공유를 지원하지 않습니다", "danger");
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
  } catch {
    return;
  }
  const video = h("video", { muted: true, playsInline: true });
  video.srcObject = stream;
  await video.play();
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const timer = setInterval(() => {
    if (!video.videoWidth || (state.ws?.bufferedAmount ?? 0) > 1_000_000) return;
    const scale = Math.min(1, 1280 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL("image/jpeg", 0.6).split(",")[1];
    wsSend({ type: "broadcast_frame", data });
  }, 400);
  stream.getVideoTracks()[0].addEventListener("ended", stopBroadcast);
  state.teacherCast = { stream, timer };
  wsSend({ type: "broadcast_start", source: "teacher" });
  renderTab();
}

function stopTeacherCast() {
  if (!state.teacherCast) return;
  clearInterval(state.teacherCast.timer);
  state.teacherCast.stream.getTracks().forEach((t) => t.stop());
  state.teacherCast = null;
}

function stopBroadcast() {
  stopTeacherCast();
  wsSend({ type: "broadcast_stop" });
  renderTab();
}

// ---------------------------------------------------------------- student modal (zoom + remote control)

const modal = document.getElementById("student-modal");
modal.addEventListener("close", () => {
  state.focusId = null;
  wsSend({ type: "focus", studentId: null });
  document.getElementById("sm-remote").checked = false;
  document.getElementById("sm-screen").classList.remove("remote");
});
for (const dialog of document.querySelectorAll("dialog")) {
  dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
}

function openStudentModal(id) {
  const s = state.students.get(id);
  if (!s) return;
  state.focusId = id;
  wsSend({ type: "focus", studentId: id });
  const img = document.getElementById("sm-screen");
  const frame = state.frames.get(id);
  img.src = frame ?? "";
  img.hidden = !frame;
  document.getElementById("sm-empty").hidden = !!frame;
  renderStudentInfo();
  modal.showModal();
}

function renderStudentInfo() {
  const s = state.students.get(state.focusId);
  if (!s) return;
  const live = s.live ?? {};
  const caps = live.capabilities ?? {};
  const yn = (v) => (v === true ? "허용" : v === false ? "미허용" : "-");
  document.getElementById("sm-title").textContent = `${studentLabel(s)} ${s.online ? "" : "(오프라인)"}`;
  document.getElementById("sm-screen").hidden = !state.frames.get(s.id);
  const rows = [
    ["상태", s.online ? "온라인" : `오프라인 (마지막 ${fmtTime(s.lastSeenAt)})`],
    ["기기", s.platform],
    ["현재 앱", live.foregroundLabel ? `${live.foregroundLabel} (${live.foregroundApp})` : live.foregroundApp || "-"],
    ["배터리", live.battery != null ? `${live.battery}%` : "-"],
    ["접근성 서비스", yn(caps.accessibility)],
    ["화면 캡처", yn(caps.capture)],
    ["기기 관리자", yn(caps.deviceAdmin)],
    ["Device Owner", yn(caps.deviceOwner)],
    ["위반(앱/웹)", `${s.violations?.app ?? 0} / ${s.violations?.web ?? 0}`],
  ];
  document.getElementById("sm-info").replaceChildren(...rows.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]));
}

document.getElementById("sm-remote").addEventListener("change", (e) => {
  document.getElementById("sm-screen").classList.toggle("remote", e.target.checked);
});
for (const btn of document.querySelectorAll("[data-remote]")) {
  btn.addEventListener("click", () => wsSend({ type: "remote_input", studentId: state.focusId, action: btn.dataset.remote }));
}
document.getElementById("sm-lock").addEventListener("click", () => command("lock", {}, [state.focusId]));
document.getElementById("sm-unlock").addEventListener("click", () => command("unlock", {}, [state.focusId]));
document.getElementById("sm-url").addEventListener("click", () => {
  const url = prompt("이 학생 기기에서 열 URL", "https://");
  if (url) command("open_url", { url }, [state.focusId]);
});
document.getElementById("sm-present").addEventListener("click", () => {
  stopTeacherCast();
  wsSend({ type: "broadcast_start", source: state.focusId });
  toast("발표 모드를 시작했습니다");
});
document.getElementById("sm-remove").addEventListener("click", async () => {
  const s = state.students.get(state.focusId);
  if (!s || !confirm(`${studentLabel(s)} 학생을 수업에서 제거할까요?`)) return;
  await api("DELETE", `/api/classes/${state.cls.id}/students/${s.id}`);
  modal.close();
});

(() => {
  const img = document.getElementById("sm-screen");
  let start = null;
  const norm = (e) => {
    const r = img.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, t: performance.now() };
  };
  img.addEventListener("pointerdown", (e) => {
    if (!document.getElementById("sm-remote").checked) return;
    e.preventDefault();
    start = norm(e);
  });
  img.addEventListener("pointerup", (e) => {
    if (!start) return;
    const end = norm(e);
    const dist = Math.hypot(end.x - start.x, end.y - start.y);
    const dt = end.t - start.t;
    const base = { type: "remote_input", studentId: state.focusId, x: start.x, y: start.y };
    if (dist < 0.02) wsSend({ ...base, action: dt > 600 ? "long_press" : "tap" });
    else wsSend({ ...base, action: "swipe", x2: end.x, y2: end.y, durationMs: Math.round(dt) });
    start = null;
  });
})();

// ---------------------------------------------------------------- join modal (PIN / QR)

function openJoinModal() {
  const c = state.cls;
  const joinUrl = `${location.origin}/join?pin=${c.pin}`;
  document.getElementById("jm-pin").textContent = c.pin;
  document.getElementById("jm-server").textContent = `서버 주소: ${wsUrl()}`;
  document.getElementById("jm-url").textContent = joinUrl;
  const qr = document.getElementById("jm-qr");
  qr.replaceChildren();
  if (window.QRCode) new window.QRCode(qr, { text: joinUrl, width: 200, height: 200 });
  document.getElementById("join-modal").showModal();
}

// ---------------------------------------------------------------- policy editor

async function renderPolicy(el) {
  if (!state.presets) state.presets = await api("GET", "/api/presets").catch(() => ({}));
  const p = structuredClone(state.cls.policy);

  const listArea = (value, placeholder) => h("textarea", { placeholder }, value.join("\n"));
  const radios = (name, value, options) =>
    h(
      "div",
      { class: "radio-row" },
      options.map(([v, label]) =>
        h("label", { class: "inline" }, h("input", { type: "radio", name, value: v, checked: value === v }), label),
      ),
    );

  const allowedApps = listArea(p.allowedApps, "com.android.chrome\ncom.google.android.apps.classroom");
  const blockedApps = listArea(p.blockedApps, "com.google.android.youtube\ncom.instagram.android");
  const allowedDomains = listArea(p.allowedDomains, "ebs.co.kr\nclassroom.google.com");
  const blockedDomains = listArea(p.blockedDomains, "youtube.com\ninstagram.com");
  const keywords = listArea(p.blockedKeywords, "게임\ncasino");
  const restrictionBoxes = Object.entries(RESTRICTION_LABELS).map(([k, label]) =>
    h("label", { class: "inline" }, h("input", { type: "checkbox", "data-restriction": k, checked: p.restrictions[k] }), label),
  );
  const volLocked = h("input", { type: "checkbox", checked: p.volume.locked });
  const volLevel = h("input", { type: "range", min: 0, max: 100, value: p.volume.level });
  const briLocked = h("input", { type: "checkbox", checked: p.brightness.locked });
  const briLevel = h("input", { type: "range", min: 0, max: 100, value: p.brightness.level });
  const kioskEnabled = h("input", { type: "checkbox", checked: p.kiosk.enabled });
  const kioskPkg = h("input", { type: "text", value: p.kiosk.packageName, placeholder: "비우면 허용 앱 런처 화면 고정", style: "width:100%" });

  const lines = (ta) => ta.value.split(/[\n,]/).map((v) => v.trim()).filter(Boolean);

  async function save() {
    const policy = {
      appMode: el.querySelector('input[name="appMode"]:checked').value,
      allowedApps: lines(allowedApps),
      blockedApps: lines(blockedApps),
      webMode: el.querySelector('input[name="webMode"]:checked').value,
      allowedDomains: lines(allowedDomains),
      blockedDomains: lines(blockedDomains),
      blockedKeywords: lines(keywords),
      restrictions: Object.fromEntries([...el.querySelectorAll("[data-restriction]")].map((i) => [i.dataset.restriction, i.checked])),
      volume: { locked: volLocked.checked, level: Number(volLevel.value) },
      brightness: { locked: briLocked.checked, level: Number(briLevel.value) },
      kiosk: { enabled: kioskEnabled.checked, packageName: kioskPkg.value.trim() },
    };
    try {
      state.cls.policy = await api("PUT", `/api/classes/${state.cls.id}/policy`, { policy });
      toast("정책을 저장하고 학생 기기에 적용했습니다");
      renderTab();
    } catch (err) {
      toast(err.message, "danger");
    }
  }

  async function applyPreset(key) {
    if (!confirm(`"${state.presets[key].label}" 프리셋을 지금 적용할까요? 현재 정책을 덮어씁니다.`)) return;
    state.cls.policy = await api("POST", `/api/classes/${state.cls.id}/policy/preset`, { preset: key });
    toast("프리셋을 적용했습니다");
    renderTab();
  }

  el.replaceChildren(
    h(
      "div",
      { class: "panel" },
      h("h3", {}, "빠른 프리셋"),
      h(
        "div",
        { class: "btn-row" },
        Object.entries(state.presets ?? {}).map(([k, v]) => h("button", { class: "btn", onclick: () => applyPreset(k) }, v.label)),
      ),
      h("p", { class: "hint" }, `마지막 변경: ${fmtTime(p.updatedAt)}`),
    ),
    h(
      "div",
      { class: "form-grid" },
      h(
        "div",
        { class: "panel" },
        h("h3", {}, "앱 사용 제한"),
        radios("appMode", p.appMode, [
          ["off", "제한 없음"],
          ["whitelist", "화이트리스트 (허용 앱만)"],
          ["blacklist", "블랙리스트 (지정 앱 차단)"],
        ]),
        h("p", { class: "hint" }, "패키지명을 한 줄에 하나씩 입력합니다. 런처·전화·UpMoo 에이전트는 항상 허용됩니다."),
        h("label", {}, "허용 앱 (화이트리스트)"),
        allowedApps,
        h("label", {}, "차단 앱 (블랙리스트, 화이트리스트에서도 우선 차단)"),
        blockedApps,
      ),
      h(
        "div",
        { class: "panel" },
        h("h3", {}, "웹사이트 차단"),
        radios("webMode", p.webMode, [
          ["off", "제한 없음"],
          ["whitelist", "학습 사이트만 허용"],
          ["blacklist", "지정 사이트 차단"],
        ]),
        h("p", { class: "hint" }, "도메인 입력 시 하위 도메인까지 적용됩니다 (예: naver.com → m.naver.com 포함)."),
        h("label", {}, "허용 도메인"),
        allowedDomains,
        h("label", {}, "차단 도메인"),
        blockedDomains,
        h("label", {}, "차단 키워드 (URL에 포함 시 차단)"),
        keywords,
      ),
      h(
        "div",
        { class: "panel" },
        h("h3", {}, "하드웨어 및 시스템 제어"),
        h("p", { class: "hint" }, "대부분의 항목은 학생 기기에 Device Owner 권한이 설정되어 있어야 적용됩니다."),
        h("div", { class: "checks" }, restrictionBoxes),
        h("hr"),
        h("label", { class: "inline" }, volLocked, "볼륨 고정"),
        volLevel,
        h("br"),
        h("label", { class: "inline" }, briLocked, "화면 밝기 고정"),
        briLevel,
      ),
      h(
        "div",
        { class: "panel" },
        h("h3", {}, "락다운 (키오스크) 모드"),
        h("label", { class: "inline" }, kioskEnabled, "학생 기기를 단일 앱/전용 런처 화면에 고정"),
        h("p", { class: "hint" }, "홈·최근 앱 버튼, 상단 알림창, 전원 메뉴가 차단됩니다 (Device Owner 필요)."),
        h("label", {}, "고정할 앱 패키지명"),
        kioskPkg,
      ),
    ),
    h("div", { class: "toolbar" }, h("button", { class: "btn primary", onclick: save }, "저장 및 즉시 적용")),
  );
}

// ---------------------------------------------------------------- schedule editor

async function renderSchedule(el) {
  if (!state.presets) state.presets = await api("GET", "/api/presets").catch(() => ({}));
  const schedule = await api("GET", `/api/classes/${state.cls.id}/schedule`);
  const entries = schedule.entries.map((e) => ({ ...e, preset: e.preset ?? "lesson" }));

  const enabled = h("input", { type: "checkbox", checked: schedule.enabled });
  const autoRelease = h("input", { type: "checkbox", checked: schedule.autoRelease });
  const tbody = h("tbody");

  function row(e) {
    const tr = h(
      "tr",
      {},
      h("td", {}, h("input", { type: "text", value: e.label, placeholder: "1교시", style: "width:90px", "data-f": "label" })),
      h(
        "td",
        { class: "days" },
        DAY_LABELS.map((d, i) =>
          h("label", {}, h("input", { type: "checkbox", "data-day": i, checked: e.days.includes(i) }), d),
        ),
      ),
      h("td", {}, h("input", { type: "time", value: e.start, "data-f": "start" })),
      h("td", {}, h("input", { type: "time", value: e.end, "data-f": "end" })),
      h(
        "td",
        {},
        h(
          "select",
          { "data-f": "preset" },
          Object.entries(state.presets ?? {}).map(([k, v]) => h("option", { value: k, selected: e.preset === k }, v.label)),
        ),
      ),
      h("td", {}, h("button", { class: "btn ghost danger", onclick: () => tr.remove() }, "삭제")),
    );
    tr.dataset.id = e.id ?? "";
    return tr;
  }

  function addPeriod(label, start, end) {
    tbody.append(row({ label, days: [1, 2, 3, 4, 5], start, end, preset: "lesson" }));
  }

  entries.forEach((e) => tbody.append(row(e)));

  async function save() {
    const out = [...tbody.querySelectorAll("tr")].map((tr) => ({
      id: tr.dataset.id || undefined,
      label: tr.querySelector('[data-f="label"]').value,
      start: tr.querySelector('[data-f="start"]').value,
      end: tr.querySelector('[data-f="end"]').value,
      preset: tr.querySelector('[data-f="preset"]').value,
      days: [...tr.querySelectorAll("[data-day]")].filter((c) => c.checked).map((c) => Number(c.dataset.day)),
    }));
    try {
      await api("PUT", `/api/classes/${state.cls.id}/schedule`, {
        enabled: enabled.checked,
        autoRelease: autoRelease.checked,
        entries: out,
      });
      toast("시간표를 저장했습니다");
      renderTab();
    } catch (err) {
      toast(err.message, "danger");
    }
  }

  el.replaceChildren(
    h(
      "div",
      { class: "panel" },
      h("h3", {}, "교시별 자동 정책"),
      h("label", { class: "inline" }, enabled, "시간표 사용"),
      " ",
      h("label", { class: "inline" }, autoRelease, "교시 외 시간(쉬는 시간·방과 후) 자동 해제"),
      h("p", { class: "hint" }, "교시가 시작될 때 지정한 프리셋이 적용되고, 수업 중 교사가 바꾼 설정은 해당 교시가 끝날 때까지 유지됩니다."),
      h(
        "table",
        {},
        h("thead", {}, h("tr", {}, ["교시", "요일", "시작", "종료", "적용 정책", ""].map((t) => h("th", {}, t)))),
        tbody,
      ),
      h(
        "div",
        { class: "toolbar", style: "margin-top:10px" },
        h("button", { class: "btn", onclick: () => addPeriod(`${tbody.children.length + 1}교시`, "09:00", "09:45") }, "+ 교시 추가"),
        h(
          "button",
          {
            class: "btn",
            onclick: () => {
              tbody.replaceChildren();
              [
                ["1교시", "09:00", "09:45"],
                ["2교시", "09:55", "10:40"],
                ["3교시", "10:50", "11:35"],
                ["4교시", "11:45", "12:30"],
                ["5교시", "13:30", "14:15"],
                ["6교시", "14:25", "15:10"],
              ].forEach((p) => addPeriod(...p));
            },
          },
          "기본 시간표 채우기 (1~6교시)",
        ),
        h("div", { style: "flex:1" }),
        h("button", { class: "btn primary", onclick: save }, "시간표 저장"),
      ),
    ),
  );
}

// ---------------------------------------------------------------- report

async function renderReport(el) {
  const rangeSel = h(
    "select",
    { onchange: () => load() },
    h("option", { value: "today" }, "오늘"),
    h("option", { value: "7d" }, "최근 7일"),
    h("option", { value: "all" }, "전체"),
  );
  const body = h("div");

  async function load() {
    const now = new Date();
    const since =
      rangeSel.value === "today"
        ? new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
        : rangeSel.value === "7d"
          ? now.getTime() - 7 * 86400_000
          : 0;
    const report = await api("GET", `/api/classes/${state.cls.id}/report?since=${since}`);
    const names = new Map(report.students.map((s) => [s.id, studentLabel(s)]));
    const rows = report.students.map((s) =>
      h(
        "tr",
        {},
        h("td", {}, s.number ?? "-"),
        h("td", {}, s.name),
        h("td", {}, s.online ? h("span", { class: "badge ok" }, "온라인") : h("span", { class: "badge" }, "오프라인")),
        h("td", {}, fmtTime(s.lastSeenAt)),
        h("td", { class: "num" }, s.connects),
        h("td", { class: "num" }, s.periodViolations.app),
        h("td", { class: "num" }, s.periodViolations.web),
        h("td", { class: "num" }, (s.violations?.app ?? 0) + (s.violations?.web ?? 0)),
      ),
    );
    const typeLabel = { connect: "접속", disconnect: "접속 해제", violation: "위반", command: "명령", policy: "정책", schedule: "시간표" };
    const events = report.events.map((e) =>
      h(
        "tr",
        {},
        h("td", {}, fmtTime(e.ts)),
        h("td", {}, typeLabel[e.type] ?? e.type),
        h("td", {}, names.get(e.studentId) ?? ""),
        h("td", {}, e.type === "violation" ? `${e.kind === "web" ? "웹" : "앱"}: ${e.detail}` : e.detail ?? ""),
      ),
    );

    function downloadCsv() {
      const header = ["번호", "이름", "마지막 접속", "접속 횟수", "앱 위반", "웹 위반", "누적 위반"];
      const data = report.students.map((s) => [
        s.number ?? "",
        s.name,
        fmtTime(s.lastSeenAt),
        s.connects,
        s.periodViolations.app,
        s.periodViolations.web,
        (s.violations?.app ?? 0) + (s.violations?.web ?? 0),
      ]);
      const csv = [header, ...data].map((r) => r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\r\n");
      const a = h("a", { href: URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" })), download: `${state.cls.name}_리포트.csv` });
      a.click();
      URL.revokeObjectURL(a.href);
    }

    body.replaceChildren(
      h(
        "div",
        { class: "panel" },
        h(
          "div",
          { class: "toolbar" },
          h("h3", { style: "margin:0" }, "학생별 현황"),
          h("div", { style: "flex:1" }),
          h("button", { class: "btn", onclick: downloadCsv }, "CSV 다운로드"),
          h(
            "button",
            {
              class: "btn ghost danger",
              onclick: async () => {
                if (!confirm("누적 위반 횟수를 0으로 초기화할까요?")) return;
                await api("POST", `/api/classes/${state.cls.id}/reset-violations`);
                load();
              },
            },
            "누적 위반 초기화",
          ),
        ),
        h(
          "table",
          {},
          h("thead", {}, h("tr", {}, ["번호", "이름", "상태", "마지막 접속", "접속 횟수", "앱 위반", "웹 위반", "누적 위반"].map((t) => h("th", {}, t)))),
          h("tbody", {}, rows),
        ),
      ),
      h(
        "div",
        { class: "panel" },
        h("h3", {}, "최근 기록"),
        h(
          "div",
          { class: "events" },
          h("table", {}, h("thead", {}, h("tr", {}, ["시각", "종류", "학생", "내용"].map((t) => h("th", {}, t)))), h("tbody", {}, events)),
        ),
      ),
    );
  }

  el.replaceChildren(h("div", { class: "toolbar" }, h("span", {}, "기간"), rangeSel), body);
  load().catch((err) => toast(err.message, "danger"));
}

route();
