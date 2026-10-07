import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Auth, passwordMatches, verifyGoogleIdToken } from "../src/auth.js";

test("tokens verify and reject tampering/expiry", () => {
  const auth = new Auth("secret");
  const t = auth.issueTeacher({ email: "a@b.kr" }, 60_000);
  assert.equal(auth.verify(t).email, "a@b.kr");
  assert.equal(new Auth("other").verify(t), null);
  assert.equal(auth.verify(auth.sign({ role: "teacher", exp: Date.now() - 1 })), null);
  assert.equal(auth.verify("garbage"), null);
});

test("passwordMatches", () => {
  assert.equal(passwordMatches("pw", "pw"), true);
  assert.equal(passwordMatches("pw2", "pw"), false);
  assert.equal(passwordMatches("pw", ""), false);
});

test("verifyGoogleIdToken checks signature, audience, issuer, expiry", async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256" };
  const make = (payload, kid = "k1") => {
    const h = Buffer.from(JSON.stringify({ alg: "RS256", kid })).toString("base64url");
    const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = crypto.sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url");
    return `${h}.${p}.${sig}`;
  };
  const good = { iss: "https://accounts.google.com", aud: "cid", email: "T@School.kr", email_verified: true, name: "김선생", exp: Date.now() / 1000 + 60 };
  assert.deepEqual(await verifyGoogleIdToken(make(good), "cid", { keys: [jwk] }), { email: "t@school.kr", name: "김선생" });
  assert.equal(await verifyGoogleIdToken(make(good), "other", { keys: [jwk] }), null);
  assert.equal(await verifyGoogleIdToken(make({ ...good, exp: 1 }), "cid", { keys: [jwk] }), null);
  assert.equal(await verifyGoogleIdToken(make({ ...good, iss: "evil" }), "cid", { keys: [jwk] }), null);
  assert.equal(await verifyGoogleIdToken(make(good, "nope"), "cid", { keys: [jwk] }), null);
  const tampered = make(good).split(".");
  tampered[1] = Buffer.from(JSON.stringify({ ...good, email: "x@evil.com" })).toString("base64url");
  assert.equal(await verifyGoogleIdToken(tampered.join("."), "cid", { keys: [jwk] }), null);
});
