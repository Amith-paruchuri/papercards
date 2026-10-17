import { test } from "node:test";
import assert from "node:assert/strict";
import { checkEmail, checkPassword, friendlyAuthError, safeNext } from "../src/lib/auth-validate.ts";
import { feedbackCsv, validateFeedback } from "../src/lib/feedback.ts";

test("checkEmail accepts real addresses and catches typos and throwaway inboxes", () => {
  assert.equal(checkEmail("ada@aiims.edu"), null);
  assert.equal(checkEmail("ada@gmial.com"), "Did you mean ada@gmail.com?");
  assert.match(checkEmail("x@mailinator.com") ?? "", /keep/);
  assert.match(checkEmail("not-an-email") ?? "", /doesn't look right/);
  assert.match(checkEmail("") ?? "", /Enter/);
});

test("checkPassword wants 8+ characters with letters and a number", () => {
  assert.equal(checkPassword("papers2026"), null);
  assert.match(checkPassword("short1") ?? "", /at least 8/);
  assert.match(checkPassword("onlyletters") ?? "", /number/);
  assert.match(checkPassword(undefined) ?? "", /Enter/);
});

test("safeNext blocks open redirects", () => {
  assert.equal(safeNext("/paper/1?x=2"), "/paper/1?x=2");
  assert.equal(safeNext("//evil.com"), "/");
  assert.equal(safeNext("https://evil.com"), "/");
  assert.equal(safeNext("/\\evil.com"), "/");
  assert.equal(safeNext(null, "/account"), "/account");
});

test("friendlyAuthError maps Supabase codes to plain sentences", () => {
  assert.equal(friendlyAuthError({ code: "invalid_credentials", message: "Invalid login credentials" }), "Wrong email or password.");
  assert.match(friendlyAuthError({ code: "over_email_send_rate_limit", message: "email rate limit exceeded" }), /Wait a minute/);
  assert.match(friendlyAuthError({ message: "Error sending confirmation email" }), /couldn't send/);
});

test("validateFeedback cleans input and rejects bad rows", () => {
  const ok = validateFeedback({ product: "choticopy", kind: "bug", rating: 4, message: "  Cards don't flip on iPad  ", email: "A@B.org", name: "" });
  assert.ok(typeof ok !== "string");
  assert.equal(ok.message, "Cards don't flip on iPad");
  assert.equal(ok.email, "a@b.org");
  assert.equal(ok.name, null);
  assert.equal(ok.rating, 4);
  assert.equal(typeof validateFeedback({ product: "x", kind: "bug", message: "hello" }), "string");
  assert.equal(typeof validateFeedback({ product: "papercards", kind: "idea", message: "hi" }), "string");
  assert.equal(typeof validateFeedback({ product: "papercards", kind: "idea", message: "hello", email: "nope" }), "string");
  const r = validateFeedback({ product: "both", kind: "love", rating: 9, message: "great" });
  assert.ok(typeof r !== "string" && r.rating === null);
});

test("feedbackCsv quotes commas, quotes and new lines", () => {
  const csv = feedbackCsv([
    { id: "1", created_at: "2026-10-17T12:00:00Z", updated_at: "", product: "papercards", kind: "idea", rating: 5, message: 'Add "Word", please\nthanks', name: null, email: null, role: null, page: null, status: "new", admin_note: null, user_agent: null, user_id: null },
  ]);
  assert.ok(csv.includes('"Add ""Word"", please\nthanks"'));
  assert.ok(csv.startsWith("﻿\"Date\""));
});
