import crypto from "node:crypto";

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

/**
 * HMAC 서명 토큰 (JWT 유사, 의존성 없음).
 * 형식: base64url(JSON payload) + "." + base64url(HMAC-SHA256)
 */
export class Auth {
  constructor(secret) {
    if (!secret) throw new Error("Auth secret is required");
    this.secret = secret;
  }

  sign(payload) {
    const body = b64url(JSON.stringify(payload));
    const mac = crypto.createHmac("sha256", this.secret).update(body).digest();
    return `${body}.${b64url(mac)}`;
  }

  verify(token) {
    if (typeof token !== "string") return null;
    const [body, mac] = token.split(".");
    if (!body || !mac) return null;
    const expected = crypto.createHmac("sha256", this.secret).update(body).digest();
    const given = Buffer.from(mac, "base64url");
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
      if (payload.exp && Date.now() > payload.exp) return null;
      return payload;
    } catch {
      return null;
    }
  }

  /** email이 null이면 관리자 비밀번호로 들어온 관리자 세션입니다. */
  issueTeacher({ email = null, admin = false }, ttlMs) {
    return this.sign({ role: "teacher", email, admin, exp: Date.now() + ttlMs });
  }
}

export function passwordMatches(given, expected) {
  if (typeof given !== "string" || !expected) return false;
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export function randomSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

/** 간단한 고정 윈도우 rate limiter (로그인 무차별 대입 방지용) */
export class RateLimiter {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  allow(key) {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || now - entry.start > this.windowMs) {
      this.hits.set(key, { start: now, count: 1 });
      return true;
    }
    entry.count += 1;
    return entry.count <= this.limit;
  }
}

// ---------------------------------------------------------------- Google 로그인 (ID 토큰 검증)

const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
let certCache = { keys: [], fetchedAt: 0 };

async function googleKeys(fetchImpl) {
  if (Date.now() - certCache.fetchedAt < 60 * 60 * 1000 && certCache.keys.length) return certCache.keys;
  const res = await fetchImpl(GOOGLE_CERTS_URL);
  if (!res.ok) throw new Error("구글 인증서를 가져오지 못했어요");
  const { keys } = await res.json();
  certCache = { keys, fetchedAt: Date.now() };
  return keys;
}

/**
 * Google Identity Services가 준 ID 토큰(JWT, RS256)을 검증하고 이메일·이름을 돌려줍니다.
 * @returns {Promise<{email:string,name:string}|null>}
 */
export async function verifyGoogleIdToken(credential, clientId, { fetchImpl = fetch, keys } = {}) {
  if (typeof credential !== "string" || !clientId) return null;
  const parts = credential.split(".");
  if (parts.length !== 3) return null;
  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (header.alg !== "RS256") return null;
  const jwk = (keys ?? (await googleKeys(fetchImpl))).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const ok = crypto.verify(
    "RSA-SHA256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    crypto.createPublicKey({ key: jwk, format: "jwk" }),
    Buffer.from(parts[2], "base64url"),
  );
  if (!ok) return null;
  const issOk = payload.iss === "accounts.google.com" || payload.iss === "https://accounts.google.com";
  if (!issOk || payload.aud !== clientId || !payload.email || payload.email_verified === false) return null;
  if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
  return { email: String(payload.email).toLowerCase(), name: String(payload.name ?? "") };
}
