/**
 * 학생 기기 통제 정책 모델.
 * 서버가 정규화한 정책 JSON이 그대로 Android 에이전트(Policy.kt)와 웹 에이전트로 전달됩니다.
 */

const PKG_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;
const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;
const MAX_LIST = 500;

export const APP_MODES = ["off", "whitelist", "blacklist"];
export const WEB_MODES = ["off", "whitelist", "blacklist"];

export const RESTRICTION_KEYS = [
  "camera", // 카메라 비활성화
  "bluetooth", // 블루투스 사용 금지
  "tethering", // 핫스팟/테더링 금지
  "settings", // 설정 앱 접근 차단
  "installApps", // 앱 설치 금지
  "uninstallApps", // 앱 삭제 금지
  "statusBar", // 상단 알림창(상태바) 내리기 차단
  "safeBoot", // 안전모드 부팅 금지
  "factoryReset", // 초기화 금지
  "usbFileTransfer", // USB 파일 전송 금지
];

export function defaultPolicy() {
  return {
    appMode: "off",
    allowedApps: [],
    blockedApps: [],
    webMode: "off",
    allowedDomains: [],
    blockedDomains: [],
    blockedKeywords: [],
    restrictions: Object.fromEntries(RESTRICTION_KEYS.map((k) => [k, false])),
    volume: { locked: false, level: 50 },
    brightness: { locked: false, level: 60 },
    // packageName이 비어있으면 에이전트 자체 키오스크 런처(허용 앱 목록만 표시)를 고정합니다.
    kiosk: { enabled: false, packageName: "" },
    updatedAt: 0,
  };
}

export function normalizePackage(value) {
  const v = String(value ?? "").trim();
  return PKG_RE.test(v) ? v : null;
}

/** "https://www.YouTube.com/watch?v=1" → "youtube.com", "*.naver.com" → "naver.com" */
export function normalizeDomain(value) {
  let v = String(value ?? "").trim().toLowerCase();
  if (!v) return null;
  v = v.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  v = v.split(/[/?#]/)[0];
  v = v.replace(/:\d+$/, "");
  v = v.replace(/^\*\./, "").replace(/^www\./, "").replace(/\.$/, "");
  return DOMAIN_RE.test(v) ? v : null;
}

function normalizeKeyword(value) {
  const v = String(value ?? "").trim().toLowerCase();
  return v && v.length <= 100 ? v : null;
}

function cleanList(input, fn, fallback) {
  if (!Array.isArray(input)) return fallback;
  const out = [];
  const seen = new Set();
  for (const item of input) {
    const v = fn(item);
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
      if (out.length >= MAX_LIST) break;
    }
  }
  return out;
}

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function bool(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function level(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : fallback;
}

/**
 * 부분 정책(patch)을 base 위에 덮어써 완전한 정책을 만듭니다.
 * 알 수 없는 필드/잘못된 값은 버리고 base 값을 유지합니다.
 */
export function normalizePolicy(input, base = defaultPolicy()) {
  const p = input && typeof input === "object" ? input : {};
  const r = p.restrictions && typeof p.restrictions === "object" ? p.restrictions : {};
  const vol = p.volume && typeof p.volume === "object" ? p.volume : {};
  const bri = p.brightness && typeof p.brightness === "object" ? p.brightness : {};
  const kiosk = p.kiosk && typeof p.kiosk === "object" ? p.kiosk : {};

  return {
    appMode: pick(p.appMode, APP_MODES, base.appMode),
    allowedApps: cleanList(p.allowedApps, normalizePackage, base.allowedApps),
    blockedApps: cleanList(p.blockedApps, normalizePackage, base.blockedApps),
    webMode: pick(p.webMode, WEB_MODES, base.webMode),
    allowedDomains: cleanList(p.allowedDomains, normalizeDomain, base.allowedDomains),
    blockedDomains: cleanList(p.blockedDomains, normalizeDomain, base.blockedDomains),
    blockedKeywords: cleanList(p.blockedKeywords, normalizeKeyword, base.blockedKeywords),
    restrictions: Object.fromEntries(
      RESTRICTION_KEYS.map((k) => [k, bool(r[k], base.restrictions[k])]),
    ),
    volume: { locked: bool(vol.locked, base.volume.locked), level: level(vol.level, base.volume.level) },
    brightness: {
      locked: bool(bri.locked, base.brightness.locked),
      level: level(bri.level, base.brightness.level),
    },
    kiosk: {
      enabled: bool(kiosk.enabled, base.kiosk.enabled),
      packageName:
        kiosk.packageName === "" ? "" : normalizePackage(kiosk.packageName) ?? base.kiosk.packageName,
    },
    updatedAt: Date.now(),
  };
}

function hostMatches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

/** 웹 필터링 판정 (Android BlockerAccessibilityService의 로직과 동일) */
export function isUrlAllowed(policy, url) {
  if (!policy || policy.webMode === "off") return true;
  const lower = String(url).toLowerCase();
  if (policy.blockedKeywords.some((k) => lower.includes(k))) return false;

  let host;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:/.test(lower) ? lower : `https://${lower}`).hostname;
  } catch {
    return policy.webMode !== "whitelist";
  }
  if (!host) return policy.webMode !== "whitelist";
  host = host.replace(/^www\./, "");

  if (policy.webMode === "whitelist") return policy.allowedDomains.some((d) => hostMatches(host, d));
  return !policy.blockedDomains.some((d) => hostMatches(host, d));
}

const DISTRACTING_APPS = [
  "com.google.android.youtube",
  "com.instagram.android",
  "com.zhiliaoapp.musically",
  "com.ss.android.ugc.trill",
  "com.facebook.katana",
  "com.twitter.android",
  "com.netflix.mediaclient",
  "com.discord",
  "com.roblox.client",
  "com.supercell.clashofclans",
  "com.supercell.brawlstars",
  "com.kakao.talk",
  "tv.twitch.android.app",
];

const DISTRACTING_DOMAINS = [
  "youtube.com",
  "youtu.be",
  "instagram.com",
  "tiktok.com",
  "facebook.com",
  "x.com",
  "twitter.com",
  "netflix.com",
  "twitch.tv",
  "chzzk.naver.com",
  "afreecatv.com",
  "sooplive.co.kr",
  "discord.com",
  "roblox.com",
];

const LEARNING_APPS = [
  "com.android.chrome",
  "com.sec.android.app.sbrowser",
  "com.google.android.apps.classroom",
  "com.google.android.apps.docs",
  "com.google.android.apps.docs.editors.docs",
  "com.google.android.apps.docs.editors.sheets",
  "com.google.android.apps.docs.editors.slides",
  "com.microsoft.teams",
  "com.microsoft.office.officehubrow",
  "com.zoom.videomeetings",
  "com.google.android.calculator",
];

const LEARNING_DOMAINS = [
  "ebs.co.kr",
  "ebsi.co.kr",
  "classroom.google.com",
  "docs.google.com",
  "drive.google.com",
  "accounts.google.com",
  "google.com",
  "wikipedia.org",
  "padlet.com",
  "kahoot.it",
  "edunet.net",
  "e-hakseup.kr",
];

/** 교사 화면의 "정책 프리셋" 버튼 */
export const PRESETS = {
  free: { label: "자유 (제한 해제)", policy: defaultPolicy() },
  focus: {
    label: "집중 (게임·SNS·영상 차단)",
    policy: normalizePolicy({
      appMode: "blacklist",
      blockedApps: DISTRACTING_APPS,
      webMode: "blacklist",
      blockedDomains: DISTRACTING_DOMAINS,
      blockedKeywords: ["casino", "도박", "성인"],
      restrictions: { tethering: true, installApps: true, uninstallApps: true, safeBoot: true },
    }),
  },
  lesson: {
    label: "수업 (학습 앱·사이트만 허용)",
    policy: normalizePolicy({
      appMode: "whitelist",
      allowedApps: LEARNING_APPS,
      blockedApps: DISTRACTING_APPS,
      webMode: "whitelist",
      allowedDomains: LEARNING_DOMAINS,
      blockedKeywords: ["casino", "도박", "성인"],
      restrictions: {
        camera: true,
        tethering: true,
        settings: true,
        installApps: true,
        uninstallApps: true,
        statusBar: true,
        safeBoot: true,
      },
    }),
  },
  exam: {
    label: "시험 (키오스크 화면 고정)",
    policy: normalizePolicy({
      appMode: "whitelist",
      allowedApps: [],
      webMode: "whitelist",
      allowedDomains: [],
      restrictions: Object.fromEntries(RESTRICTION_KEYS.map((k) => [k, true])),
      volume: { locked: true, level: 0 },
      kiosk: { enabled: true, packageName: "" },
    }),
  },
};
