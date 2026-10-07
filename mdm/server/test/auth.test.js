import { test } from "node:test";
import assert from "node:assert/strict";
import { Auth, passwordMatches } from "../src/auth.js";

test("tokens verify and reject tampering/expiry", () => {
  const auth = new Auth("secret");
  const t = auth.issueTeacher(60_000);
  assert.equal(auth.verify(t).role, "teacher");
  assert.equal(new Auth("other").verify(t), null);
  assert.equal(auth.verify(t.slice(0, -2) + "xx"), null);
  assert.equal(auth.verify(auth.sign({ role: "teacher", exp: Date.now() - 1 })), null);
  assert.equal(auth.verify("garbage"), null);
});

test("passwordMatches", () => {
  assert.equal(passwordMatches("pw", "pw"), true);
  assert.equal(passwordMatches("pw2", "pw"), false);
  assert.equal(passwordMatches("pw", ""), false);
});
