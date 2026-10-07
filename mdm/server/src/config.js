import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function list(value) {
  return String(value ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function loadConfig(env = process.env) {
  return {
    port: num(env.MDM_PORT ?? env.PORT, 8787),
    host: env.MDM_HOST || "0.0.0.0",
    schoolName: env.MDM_SCHOOL_NAME || "우리 학교",
    appName: env.MDM_APP_NAME || "우리반 수업도우미",
    // 관리자 비밀번호 (구글 로그인 설정 전이나 비상용). 비우면 시작할 때 임시 비밀번호를 만들어 출력합니다.
    adminPassword: env.MDM_ADMIN_PASSWORD || env.MDM_TEACHER_PASSWORD || "",
    // Google Identity Services 웹 클라이언트 ID. 비우면 구글 로그인 단추가 숨겨집니다.
    googleClientId: env.MDM_GOOGLE_CLIENT_ID || "",
    // 처음부터 관리자인 구글 계정(쉼표로 구분)
    adminEmails: list(env.MDM_ADMIN_EMAILS),
    // '로그인이 필요해요'를 저절로 켤 도메인(쉼표로 구분, 예: 경북AI배움터 도메인)
    loginSites: list(env.MDM_LOGIN_SITES),
    secret: env.MDM_SECRET || "",
    dataDir: env.MDM_DATA_DIR === "" ? "" : env.MDM_DATA_DIR || path.resolve(here, "../data"),
    publicDir: path.resolve(here, "../public"),
    timezone: env.MDM_TIMEZONE || "Asia/Seoul",
    maxMessageBytes: num(env.MDM_MAX_MESSAGE_BYTES, 2_000_000),
    maxUploadBytes: num(env.MDM_MAX_UPLOAD_BYTES, 8_000_000),
    teacherTokenTtlMs: num(env.MDM_TEACHER_TOKEN_TTL_MS, 14 * 24 * 60 * 60 * 1000),
    pingIntervalMs: num(env.MDM_PING_INTERVAL_MS, 15_000),
    // 학생 화면 보기(작은 그림) / 실시간 화면
    snapIntervalMs: num(env.MDM_SNAP_INTERVAL_MS, 4000),
    snapMaxWidth: num(env.MDM_SNAP_MAX_WIDTH, 360),
    liveMaxWidth: num(env.MDM_LIVE_MAX_WIDTH, 960),
    liveMaxSeats: 6,
    // 학생 화면을 반 모두에게 보여 줄 때(그림) 와이파이가 막히지 않게 0.4초에 한 장
    presentIntervalMs: 400,
  };
}
