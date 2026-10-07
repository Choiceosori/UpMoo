// 우리반 수업도우미 — 선생님·학생 화면이 함께 쓰는 도구

export const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
export const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
export const QRLIB = "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js";

// ------------------------------------------------------------------ DOM

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") {
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith("--")) el.style.setProperty(prop, val);
        else el.style[prop] = val;
      }
    }
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (["value", "checked", "disabled", "selected", "hidden", "muted", "playsInline"].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const SVGNS = "http://www.w3.org/2000/svg";
export function icon(name, cls = "") {
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("class", `i ${cls}`.trim());
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVGNS, "use");
  use.setAttribute("href", `/icons.svg#${name}`);
  svg.append(use);
  return svg;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function toast(text, kind = "") {
  let box = document.getElementById("toasts");
  if (!box) {
    box = h("div", { id: "toasts", class: "toasts", "aria-live": "polite" });
    document.body.append(box);
  }
  const el = h("div", { class: `toast ${kind}` }, text);
  box.append(el);
  setTimeout(() => el.remove(), kind === "warn" ? 6000 : 3500);
}

export function fmtTime(ts) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function fmtClock(ts) {
  if (!ts) return "-";
  return new Date(ts).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

// ------------------------------------------------------------------ storage (막힌 환경에서도 동작)

export const store = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* 저장 안 되는 환경 */
    }
  },
};

// ------------------------------------------------------------------ API

export async function api(method, path, body, { token, raw, headers } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      ...(raw ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: raw ?? (body == null ? undefined : JSON.stringify(body)),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `요청에 실패했어요 (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export function wsUrl() {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
}

export function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)?.dataset.loaded) return resolve();
    const s = h("script", { src, async: true });
    s.onload = () => {
      s.dataset.loaded = "1";
      resolve();
    };
    s.onerror = () => reject(new Error("스크립트를 불러오지 못했어요 (인터넷 연결 확인)"));
    document.head.append(s);
  });
}

// ------------------------------------------------------------------ QR

export async function qrSvg(text) {
  try {
    await loadScript(QRLIB);
    const qr = window.qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const wrap = h("div");
    wrap.innerHTML = qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
    return wrap.firstElementChild;
  } catch {
    return h("p", { class: "hint" }, "QR을 만들지 못했어요. 아래 주소와 방 코드를 알려 주세요.");
  }
}

// ------------------------------------------------------------------ 활동지 파일 → 그림

/** PDF는 쪽마다, 사진은 한 장씩 JPEG로 바꿉니다. */
export async function filesToImages(files, onProgress = () => {}) {
  const out = [];
  for (const file of files) {
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
      await loadScript(PDFJS);
      const lib = window.pdfjsLib;
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
      for (let i = 1; i <= doc.numPages; i++) {
        onProgress(`${file.name} ${i}/${doc.numPages}쪽 바꾸는 중…`);
        const page = await doc.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(2.5, 1600 / base.width) });
        const canvas = h("canvas", { width: Math.round(viewport.width), height: Math.round(viewport.height) });
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        out.push({ blob: await toJpeg(canvas, 0.85), w: canvas.width, h: canvas.height, name: `${file.name} ${i}쪽` });
      }
    } else if (file.type.startsWith("image/")) {
      onProgress(`${file.name} 준비 중…`);
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
      const canvas = h("canvas", { width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale) });
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      out.push({ blob: await toJpeg(canvas, 0.88), w: canvas.width, h: canvas.height, name: file.name });
    }
  }
  return out;
}

function toJpeg(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

export async function uploadPages(lessonId, files, token, onProgress) {
  const images = await filesToImages(files, onProgress);
  let n = 0;
  for (const img of images) {
    n += 1;
    onProgress?.(`올리는 중… ${n}/${images.length}`);
    await api("POST", `/api/lessons/${lessonId}/pages/image?w=${img.w}&h=${img.h}&name=${encodeURIComponent(img.name)}`, null, {
      token,
      raw: img.blob,
      headers: { "content-type": "image/jpeg" },
    });
  }
  return images.length;
}

// ------------------------------------------------------------------ 판(Board): 쪽 바탕 + 필기 층

export const BOARD_AR = 1.6;
export const PEN_COLORS = [
  ["검정", "#1f2328"],
  ["빨강", "#e5484d"],
  ["파랑", "#0b6bcb"],
  ["초록", "#1a7f37"],
  ["주황", "#f76b15"],
];

export function pageAr(page) {
  return page?.kind === "image" ? page.ar || 0.707 : BOARD_AR;
}

/**
 * 쪽 하나를 그리는 판. 필기는 층(layer)마다 따로 그려 지우개가 다른 사람 필기를 지우지 않아요.
 * 좌표는 0~1 비율이라 화면 크기가 달라도 같은 자리에 보여요.
 */
export class Board {
  constructor({ layers = 1, editable = false, onStroke, padding = 0 } = {}) {
    this.el = h("div", { class: "page" });
    this.layers = [];
    this.editable = editable;
    this.onStroke = onStroke;
    this.padding = padding;
    this.ar = BOARD_AR;
    this.tool = { color: PEN_COLORS[0][1], width: 0.0035, eraser: false };
    this.extra = h("div", { class: "page-extra" });
    for (let i = 0; i < layers; i++) this.addLayer();
    this.el.append(this.extra);
    if (editable) this.enableDrawing();
  }

  addLayer() {
    const canvas = h("canvas");
    this.el.insertBefore(canvas, this.extra?.parentNode ? this.extra : null);
    this.layers.push({ canvas, strokes: [] });
    this.layers.forEach((l, i) => l.canvas.classList.toggle("top", i === this.layers.length - 1));
    return this.layers.length - 1;
  }

  attach(parent) {
    parent.append(this.el);
    this.parent = parent;
    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(parent);
    this.fit();
    return this;
  }

  detach() {
    this.ro?.disconnect();
    this.el.remove();
  }

  setPage(page) {
    this.page = page;
    this.ar = pageAr(page);
    this.el.className = `page${this.editable ? " drawing" : ""}`;
    this.el.querySelector(".page-bg")?.remove();
    this.el.querySelector(".link-face")?.remove();
    if (!page) {
      this.el.classList.add("board-blank");
    } else if (page.kind === "image") {
      const img = h("img", { class: "page-bg", src: page.src, alt: "", draggable: "false" });
      this.el.prepend(img);
    } else if (page.kind === "board") {
      this.el.classList.add(`board-${page.board || "blank"}`);
    } else if (page.kind === "link") {
      this.el.classList.add("board-link");
      this.el.prepend(h("div", { class: "link-face" }, icon("link"), h("b", {}, page.link?.title || "링크")));
    }
    this.fit();
  }

  /** 모둠 판처럼 쪽이 아닌 바탕 */
  setBackground({ bg, src, ar }) {
    this.setPage(bg === "page" && src ? { kind: "image", src, ar } : { kind: "board", board: bg === "grid" ? "grid" : "blank" });
  }

  fit() {
    const parent = this.parent;
    if (!parent) return;
    const cs = getComputedStyle(parent);
    const pw = parent.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - this.padding * 2;
    const ph = parent.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - this.padding * 2;
    if (pw <= 0 || ph <= 0) return;
    let w = pw;
    let hgt = w / this.ar;
    if (hgt > ph) {
      hgt = ph;
      w = hgt * this.ar;
    }
    this.el.style.width = `${Math.floor(w)}px`;
    this.el.style.height = `${Math.floor(hgt)}px`;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const layer of this.layers) {
      layer.canvas.width = Math.max(1, Math.round(w * dpr));
      layer.canvas.height = Math.max(1, Math.round(hgt * dpr));
    }
    this.redraw();
  }

  setStrokes(i, strokes) {
    this.layers[i].strokes = strokes ? [...strokes] : [];
    this.redraw(i);
  }

  addStroke(i, stroke) {
    this.layers[i].strokes.push(stroke);
    this.draw(this.layers[i].canvas, stroke);
  }

  redraw(only) {
    this.layers.forEach((layer, i) => {
      if (only != null && only !== i) return;
      const ctx = layer.canvas.getContext("2d");
      ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
      for (const s of layer.strokes) this.draw(layer.canvas, s);
    });
  }

  draw(canvas, s, from = 0) {
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;
    ctx.save();
    ctx.globalCompositeOperation = s.e ? "destination-out" : "source-over";
    ctx.strokeStyle = s.c;
    ctx.fillStyle = s.c;
    ctx.lineWidth = Math.max(1, s.w * W * (s.e ? 4 : 1));
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const p = s.p;
    if (p.length === 2) {
      ctx.beginPath();
      ctx.arc(p[0] * W, p[1] * H, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      const start = Math.max(0, from - 2);
      ctx.moveTo(p[start] * W, p[start + 1] * H);
      for (let k = start + 2; k < p.length; k += 2) ctx.lineTo(p[k] * W, p[k + 1] * H);
      ctx.stroke();
    }
    ctx.restore();
  }

  enableDrawing() {
    let cur = null;
    const point = (e) => {
      const r = this.el.getBoundingClientRect();
      return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
    };
    this.el.addEventListener("pointerdown", (e) => {
      if (!this.editable || this.disabled || e.button > 0) return;
      e.preventDefault();
      this.el.setPointerCapture(e.pointerId);
      const [x, y] = point(e);
      cur = { id: Math.random().toString(36).slice(2, 10), c: this.tool.color, w: this.tool.width, e: this.tool.eraser, p: [x, y] };
      this.draw(this.layers.at(-1).canvas, cur);
    });
    this.el.addEventListener("pointermove", (e) => {
      if (!cur) return;
      const events = e.getCoalescedEvents?.() ?? [e];
      const before = cur.p.length;
      for (const ev of events) {
        const [x, y] = point(ev);
        const lx = cur.p.at(-2);
        const ly = cur.p.at(-1);
        if (Math.abs(x - lx) + Math.abs(y - ly) > 0.0015) cur.p.push(x, y);
      }
      if (cur.p.length > before) this.draw(this.layers.at(-1).canvas, cur, before);
    });
    const end = () => {
      if (!cur) return;
      const stroke = { ...cur, p: cur.p.map((v) => Math.round(v * 10000) / 10000) };
      cur = null;
      this.layers.at(-1).strokes.push(stroke);
      this.redraw(this.layers.length - 1);
      this.onStroke?.(stroke);
    };
    this.el.addEventListener("pointerup", end);
    this.el.addEventListener("pointercancel", end);
  }
}

/** 펜 도구 막대 (선생님 판서·학생 필기·모둠 판이 함께 씀) */
export function penBar(board, { onUndo, onClear, clearLabel = "지우기", hint } = {}) {
  const bar = h("div", { class: "pen-bar tools", role: "toolbar", "aria-label": "판서 도구" });
  const colorBtns = PEN_COLORS.map(([name, c], i) =>
    h("button", { class: "tool color", type: "button", "aria-label": `${name} 펜`, "aria-pressed": String(i === 0), style: { "--c": c } }, h("span")),
  );
  const thin = h("button", { class: "tool", type: "button", "aria-label": "가늘게", "aria-pressed": "false" }, icon("thin"), h("span", { class: "lbl" }, "가늘게"));
  const eraser = h("button", { class: "tool", type: "button", "aria-label": "지우개", "aria-pressed": "false" }, icon("eraser"), h("span", { class: "lbl" }, "지우개"));
  const sync = () => {
    colorBtns.forEach((b, i) => b.setAttribute("aria-pressed", String(!board.tool.eraser && board.tool.color === PEN_COLORS[i][1])));
    eraser.setAttribute("aria-pressed", String(board.tool.eraser));
    thin.setAttribute("aria-pressed", String(board.tool.width < 0.003));
  };
  colorBtns.forEach((b, i) =>
    b.addEventListener("click", () => {
      board.tool.color = PEN_COLORS[i][1];
      board.tool.eraser = false;
      sync();
    }),
  );
  thin.addEventListener("click", () => {
    board.tool.width = board.tool.width < 0.003 ? 0.0035 : 0.0018;
    sync();
  });
  eraser.addEventListener("click", () => {
    board.tool.eraser = !board.tool.eraser;
    sync();
  });
  bar.append(...colorBtns, h("span", { class: "gap" }), thin, eraser);
  if (onUndo) bar.append(h("button", { class: "tool", type: "button", "aria-label": "되돌리기", onclick: onUndo }, icon("undo"), h("span", { class: "lbl" }, "되돌리기")));
  if (onClear) bar.append(h("button", { class: "tool", type: "button", "aria-label": clearLabel, onclick: onClear }, icon("trash"), h("span", { class: "lbl" }, clearLabel)));
  if (hint) bar.append(h("span", { class: "spacer" }), h("span", { class: "hint", style: { margin: 0 } }, hint));
  return bar;
}

/** 모둠 메모 */
export function memoEl(memo, { onDelete } = {}) {
  const el = h(
    "div",
    { class: `memo ${memo.color}`, style: { left: `${memo.x * 100}%`, top: `${memo.y * 100}%` }, "data-id": memo.id },
    h("b", {}, memo.by === "T" ? "선생님" : `${memo.by}번`),
    memo.text,
  );
  if (onDelete) el.append(h("button", { type: "button", "aria-label": "메모 지우기", onclick: (e) => (e.stopPropagation(), onDelete(memo)) }, "✕"));
  return el;
}

/** 이름표 (선생님 기기에만 저장) */
export function namesFor(classId) {
  return store.get(`woori.names.${classId}`, {});
}

export function seatLabel(seat, names) {
  const nm = names?.[seat];
  return nm ? `${seat}번 ${nm}` : `${seat}번`;
}
