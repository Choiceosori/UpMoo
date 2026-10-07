// 웹 기반 학생 에이전트.
// Android 에이전트 앱 없이도 PC/크롬북/테스트 환경에서 수업에 참여할 수 있습니다.
// 브라우저 특성상 다른 앱/탭을 강제로 차단할 수는 없으며, 화면 잠금·자료 열기·화면 공유 수신·
// 내 화면 공유(교사 모니터링)를 지원합니다. 실제 기기 통제는 Android 에이전트를 사용하세요.
import { isUrlAllowed } from "/policy.js";

const STORE_KEY = "mdm.student";
const ANDROID_PACKAGE = "com.upmoo.mdm.agent";

const params = new URLSearchParams(location.search);
const saved = load();
const state = {
  ws: null,
  policy: null,
  info: null,
  capture: { enabled: false },
  stream: null,
  captureTimer: null,
  stopped: false,
  retry: 1000,
};

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) ?? {};
  } catch {
    return {};
  }
}
function persist(patch) {
  Object.assign(saved, patch);
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(saved));
  } catch {
    /* 무시 */
  }
}
if (!saved.deviceId) persist({ deviceId: crypto.randomUUID() });

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

function toast(text, kind = "") {
  const el = h("div", { class: `toast ${kind}` }, text);
  document.getElementById("toasts").append(el);
  setTimeout(() => el.remove(), 6000);
}

const $app = document.getElementById("app");
const $status = document.getElementById("status");

function setStatus(text, kind) {
  $status.replaceChildren(h("span", { class: `badge ${kind}` }, text));
}

// ---------------------------------------------------------------- join

function renderJoin(error) {
  const pin = h("input", { type: "text", inputmode: "numeric", maxlength: 6, placeholder: "수업 PIN 6자리", value: params.get("pin") ?? saved.pin ?? "", required: true });
  const name = h("input", { type: "text", maxlength: 30, placeholder: "이름", value: saved.name ?? "", required: true });
  const number = h("input", { type: "number", min: 1, max: 999, placeholder: "번호 (선택)", value: saved.number ?? "" });
  const isAndroid = /Android/i.test(navigator.userAgent);
  const appLink = () =>
    `intent://join?server=${encodeURIComponent(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`)}&pin=${encodeURIComponent(pin.value)}#Intent;scheme=upmoo-mdm;package=${ANDROID_PACKAGE};end`;

  $app.replaceChildren(
    h(
      "div",
      { class: "panel" },
      h("h2", {}, "수업 참여"),
      error ? h("p", { class: "result-bad" }, error) : null,
      isAndroid
        ? h(
            "p",
            {},
            h("a", { class: "btn primary", href: "#", onclick: (e) => ((e.target.href = appLink()), true) }, "UpMoo MDM 앱으로 참여 (권장)"),
          )
        : null,
      h(
        "form",
        {
          onsubmit: async (e) => {
            e.preventDefault();
            if (saved.pin !== pin.value) persist({ token: null });
            persist({ pin: pin.value.trim(), name: name.value.trim(), number: number.value });
            connect();
          },
        },
        pin,
        name,
        number,
        h("button", { class: "btn primary", type: "submit" }, "참여하기"),
      ),
    ),
  );
}

// ---------------------------------------------------------------- websocket

function connect() {
  state.stopped = false;
  setStatus("연결 중…", "warn");
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  state.ws = ws;
  ws.onopen = () =>
    send({
      type: "hello",
      role: "student",
      token: saved.token ?? undefined,
      pin: saved.pin,
      name: saved.name,
      number: saved.number,
      deviceId: saved.deviceId,
      platform: "web",
    });
  ws.onmessage = (ev) => onMessage(JSON.parse(ev.data));
  ws.onclose = () => {
    state.ws = null;
    if (state.stopped) return;
    setStatus("재연결 대기", "warn");
    setTimeout(connect, state.retry);
    state.retry = Math.min(state.retry * 2, 15000);
  };
}

function send(msg) {
  if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(msg));
}

function onMessage(msg) {
  switch (msg.type) {
    case "welcome":
      state.retry = 1000;
      state.info = msg;
      state.policy = msg.policy;
      persist({ token: msg.token });
      setStatus("수업 연결됨", "ok");
      setLock(msg.locked);
      renderJoined();
      heartbeat();
      break;
    case "rejected":
      state.stopped = true;
      persist({ token: null });
      setStatus("연결 안 됨", "danger");
      renderJoin(msg.error);
      break;
    case "removed":
      state.stopped = true;
      persist({ token: null });
      stopShare();
      renderJoin("선생님이 수업에서 내보냈습니다.");
      break;
    case "policy":
      state.policy = msg.policy;
      renderJoined();
      toast("선생님이 기기 사용 정책을 변경했습니다");
      break;
    case "lock":
      setLock(msg.locked, msg.text);
      break;
    case "open_url":
      openUrl(msg.url);
      break;
    case "message":
      toast(`📢 선생님: ${msg.text}`);
      break;
    case "capture_config":
      state.capture = msg;
      scheduleCapture();
      break;
    case "broadcast_start":
      showViewer(msg.source === "teacher" ? "선생님 화면" : "친구 발표 화면");
      break;
    case "broadcast_frame":
      document.getElementById("viewer-img").src = `data:image/jpeg;base64,${msg.data}`;
      break;
    case "broadcast_stop":
      document.getElementById("viewer").hidden = true;
      break;
    case "remote_input":
      toast("이 기기(웹)는 원격 제어를 지원하지 않습니다");
      break;
  }
}

function setLock(locked, text) {
  document.getElementById("lock").hidden = !locked;
  if (text) document.getElementById("lock-text").textContent = text;
}

function showViewer(label) {
  document.getElementById("viewer-label").textContent = label;
  document.getElementById("viewer-img").removeAttribute("src");
  document.getElementById("viewer").hidden = false;
}

function openUrl(url) {
  if (!isUrlAllowed(state.policy, url)) {
    send({ type: "violation", kind: "web", target: url });
    return toast("차단된 사이트입니다", "danger");
  }
  const win = window.open(url, "_blank", "noopener");
  if (!win) toast(`선생님이 자료를 보냈습니다: ${url}`);
}

function heartbeat() {
  clearInterval(state.hbTimer);
  const beat = () =>
    send({
      type: "heartbeat",
      foregroundApp: document.visibilityState === "visible" ? "web-agent" : "background",
      foregroundLabel: document.visibilityState === "visible" ? "웹 에이전트 (화면 보는 중)" : "다른 탭/창 사용 중",
      capabilities: { capture: !!state.stream, accessibility: null, deviceAdmin: null, deviceOwner: null },
    });
  beat();
  state.hbTimer = setInterval(beat, 5000);
}
document.addEventListener("visibilitychange", () => state.ws && heartbeat());

// ---------------------------------------------------------------- screen share to teacher

async function startShare() {
  try {
    state.stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
  } catch {
    return toast("화면 공유가 취소되었습니다");
  }
  state.video = Object.assign(document.createElement("video"), { muted: true, playsInline: true, srcObject: state.stream });
  await state.video.play();
  state.stream.getVideoTracks()[0].addEventListener("ended", stopShare);
  scheduleCapture();
  heartbeat();
  renderJoined();
}

function stopShare() {
  clearInterval(state.captureTimer);
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null;
  if (state.ws) heartbeat();
  if (state.info) renderJoined();
}

function scheduleCapture() {
  clearInterval(state.captureTimer);
  const c = state.capture;
  if (!state.stream || !c.enabled || !c.intervalMs) return;
  const canvas = document.createElement("canvas");
  state.captureTimer = setInterval(() => {
    const v = state.video;
    if (!v?.videoWidth || (state.ws?.bufferedAmount ?? 0) > 500_000) return;
    const scale = Math.min(1, c.maxWidth / v.videoWidth);
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    canvas.getContext("2d").drawImage(v, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL("image/jpeg", c.quality / 100).split(",")[1];
    send({ type: "frame", data, w: canvas.width, h: canvas.height });
  }, c.intervalMs);
}

// ---------------------------------------------------------------- joined view

function renderJoined() {
  const p = state.policy ?? {};
  const rules = [];
  if (p.webMode === "whitelist") rules.push(`허용된 사이트만 접속 가능: ${p.allowedDomains.join(", ") || "(없음)"}`);
  if (p.webMode === "blacklist") rules.push(`차단 사이트: ${p.blockedDomains.join(", ") || "(없음)"}`);
  if (p.appMode && p.appMode !== "off") rules.push(p.appMode === "whitelist" ? "허용된 앱만 사용 가능" : "일부 앱 사용 차단");
  if (p.kiosk?.enabled) rules.push("키오스크(화면 고정) 모드");

  const testInput = h("input", { type: "url", placeholder: "https://… 접속해도 되는지 확인", style: "flex:1" });
  const result = h("span");

  $app.replaceChildren(
    h(
      "div",
      { class: "panel" },
      h("h2", {}, state.info.className),
      h("p", {}, `${state.info.studentName} 학생으로 참여 중입니다.`),
      h(
        "div",
        { class: "btn-row" },
        state.stream
          ? h("button", { class: "btn active", onclick: stopShare }, "내 화면 공유 중지")
          : h("button", { class: "btn primary", onclick: startShare }, "내 화면 공유 시작 (선생님 모니터링)"),
        h(
          "button",
          {
            class: "btn ghost danger",
            onclick: () => {
              state.stopped = true;
              stopShare();
              state.ws?.close();
              persist({ token: null });
              setStatus("나감", "");
              renderJoin();
            },
          },
          "수업 나가기",
        ),
      ),
    ),
    h(
      "div",
      { class: "panel" },
      h("h3", {}, "현재 수업 규칙"),
      rules.length ? h("ul", { class: "rules" }, rules.map((r) => h("li", {}, r))) : h("p", { class: "muted" }, "제한 없음"),
      h(
        "form",
        {
          class: "toolbar",
          onsubmit: (e) => {
            e.preventDefault();
            if (!testInput.value) return;
            const ok = isUrlAllowed(state.policy, testInput.value);
            result.className = ok ? "result-ok" : "result-bad";
            result.textContent = ok ? "접속 가능" : "차단됨";
            if (ok) openUrl(testInput.value);
            else send({ type: "violation", kind: "web", target: testInput.value });
          },
        },
        testInput,
        h("button", { class: "btn", type: "submit" }, "열기"),
        result,
      ),
    ),
  );
}

if (saved.token && saved.pin && !params.get("pin")) connect();
else renderJoin();
