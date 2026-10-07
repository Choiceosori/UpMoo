import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanQuiz,
  cleanStroke,
  frameable,
  gradeSubmission,
  normalizeLink,
  orderGroups,
  runSummary,
  seatStatus,
  shuffleGroups,
} from "../src/lesson.js";

test("cleanStroke validates and clamps", () => {
  assert.equal(cleanStroke({ p: [0.1] }), null);
  assert.equal(cleanStroke({ p: [0.1, "x"] }), null);
  const s = cleanStroke({ p: [0.123456, 2, 0.5, 0.5], c: "javascript:", w: 9 });
  assert.deepEqual(s.p, [0.1235, 1.2, 0.5, 0.5]);
  assert.equal(s.c, "#1f2328");
  assert.equal(s.w, 0.05);
});

test("normalizeLink: youtube/padlet embed, known sites, junk", () => {
  const yt = normalizeLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=75");
  assert.equal(yt.embed, "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=75");
  assert.equal(yt.how, "in");
  assert.equal(normalizeLink("youtu.be/dQw4w9WgXcQ?t=1m5s").embed.endsWith("start=65"), true);
  assert.equal(normalizeLink("https://padlet.com/teacher/board-q1w2e3r4t5y6").embed, "https://padlet.com/embed/q1w2e3r4t5y6");
  assert.equal(normalizeLink("www.canva.com/design/x").how, "out");
  assert.equal(normalizeLink("javascript:alert(1)"), null);
  assert.equal(normalizeLink(""), null);
});

test("frameable reads X-Frame-Options and CSP", () => {
  assert.equal(frameable(new Headers({})), true);
  assert.equal(frameable(new Headers({ "x-frame-options": "SAMEORIGIN" })), false);
  assert.equal(frameable(new Headers({ "content-security-policy": "frame-ancestors 'none'" })), false);
  assert.equal(frameable(new Headers({ "content-security-policy": "frame-ancestors *" })), true);
});

test("seatStatus", () => {
  assert.equal(seatStatus({ joined: false }), "empty");
  assert.equal(seatStatus({ joined: true, online: false }), "off");
  assert.equal(seatStatus({ joined: true, online: true, visible: true, link: "none" }), "here");
  assert.equal(seatStatus({ joined: true, online: true, visible: false, link: "none" }), "away");
  assert.equal(seatStatus({ joined: true, online: true, visible: true, link: "in" }), "link");
  assert.equal(seatStatus({ joined: true, online: true, visible: false, link: "out" }), "linkout");
  assert.equal(seatStatus({ joined: true, online: true, visible: false, link: "in" }), "check");
});

test("groups: order and shuffle cover all seats", () => {
  const seats = [1, 2, 3, 4, 5, 6, 7];
  assert.deepEqual(orderGroups(seats, 3), { 1: 1, 2: 1, 3: 1, 4: 2, 5: 2, 6: 2, 7: 3 });
  const sh = shuffleGroups(seats, 3, () => 0.5);
  assert.equal(Object.keys(sh).length, 7);
  assert.ok(Object.values(sh).every((g) => g >= 1 && g <= 3));
});

test("quiz: clean + grade + accept + manual", () => {
  assert.throws(() => cleanQuiz({ title: "" }));
  assert.throws(() => cleanQuiz({ title: "t", items: [{ type: "choice", q: "q", options: ["a"] }] }));
  const quiz = cleanQuiz({
    title: "분수",
    items: [
      { type: "choice", q: "1/2+1/2?", options: ["1", "2"], answer: 0 },
      { type: "ox", q: "1/3 > 1/2", answer: "X" },
      { type: "short", q: "1/4+1/4?", answer: "1/2, 2/4" },
      { type: "essay", q: "설명해요", points: 2 },
    ],
  });
  const run = { quiz, answers: { 3: { a: [0, "X", "0.5", "같은 분모"], submittedAt: 1 } }, accept: {}, manual: {} };
  let g = gradeSubmission(run, "3");
  assert.deepEqual(g.items.map((i) => i.correct), [true, true, false, null]);
  assert.equal(g.earned, 2);
  assert.equal(g.total, 5);
  run.accept[2] = ["0.5"];
  run.manual = { 3: { 3: 2 } };
  g = gradeSubmission(run, "3");
  assert.equal(g.percent, 100);
  assert.equal(runSummary(run).avg, 100);
});
