import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadConfig(env = process.env) {
  return {
    port: num(env.MDM_PORT ?? env.PORT, 8787),
    host: env.MDM_HOST || "0.0.0.0",
    // 비워두면 서버 시작 시 무작위 비밀번호를 생성해 콘솔에 출력합니다.
    teacherPassword: env.MDM_TEACHER_PASSWORD || "",
    // 비워두면 데이터 파일에 무작위 서명 키를 생성해 저장합니다.
    secret: env.MDM_SECRET || "",
    dataFile: env.MDM_DATA_FILE || path.resolve(here, "../data/mdm.json"),
    publicDir: path.resolve(here, "../public"),
    timezone: env.MDM_TIMEZONE || "Asia/Seoul",
    // WebSocket 한 메시지 최대 크기 (base64 JPEG 프레임 포함)
    maxMessageBytes: num(env.MDM_MAX_MESSAGE_BYTES, 1_500_000),
    // 썸네일 전송 주기/해상도 — 30~40명 동시 접속 시 AP 부하를 고려한 기본값
    capture: {
      grid: {
        intervalMs: num(env.MDM_GRID_INTERVAL_MS, 3000),
        maxWidth: num(env.MDM_GRID_MAX_WIDTH, 320),
        quality: num(env.MDM_GRID_QUALITY, 45),
      },
      focus: {
        intervalMs: num(env.MDM_FOCUS_INTERVAL_MS, 600),
        maxWidth: num(env.MDM_FOCUS_MAX_WIDTH, 960),
        quality: num(env.MDM_FOCUS_QUALITY, 60),
      },
    },
    teacherTokenTtlMs: num(env.MDM_TEACHER_TOKEN_TTL_MS, 12 * 60 * 60 * 1000),
    schedulerIntervalMs: num(env.MDM_SCHEDULER_INTERVAL_MS, 15_000),
    pingIntervalMs: num(env.MDM_PING_INTERVAL_MS, 15_000),
  };
}
