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

  issueTeacher(ttlMs) {
    return this.sign({ role: "teacher", exp: Date.now() + ttlMs });
  }

  issueStudent(classId, studentId) {
    return this.sign({ role: "student", classId, studentId });
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
