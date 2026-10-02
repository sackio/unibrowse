import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import { guardCookieClear } from "../../src/utils/cookie-guard.ts";

test("a tab-scoped clear is allowed — the normal case", () => {
  for (const t of [41939948, "tab-41939948", "ecobee-broker"]) {
    assert.equal(guardCookieClear({ tabTarget: t, domain: "claude.ai" }).allowed, true);
  }
});

test("⛔ no tabTarget is REFUSED, and the refusal names the remedy", () => {
  const v = guardCookieClear({ domain: "ebay.com" });
  assert.equal(v.allowed, false);
  assert.match(v.reason, /DEFAULT profile/);
  assert.match(v.reason, /tabTarget/);
  assert.match(v.reason, /includeDefaultProfile/);
  assert.match(v.reason, /Nothing has been deleted/);
  assert.match(v.reason, /ebay\.com/, "it echoes what WOULD have been cleared");
});

test("⛔ a narrower filter does NOT make it safe — that IS the damaging call", () => {
  assert.equal(guardCookieClear({ domain: "ebay.com" }).allowed, false);
  assert.equal(guardCookieClear({ url: "https://www.amazon.com/" }).allowed, false);
});

test("an unfiltered default-profile clear is refused and says so in the plainest terms", () => {
  const v = guardCookieClear({});
  assert.equal(v.allowed, false);
  assert.match(v.reason, /EVERY cookie in the profile/);
});

test("the explicit opt-in is honoured — a caller who means it can still do it", () => {
  assert.equal(guardCookieClear({ domain: "ebay.com", includeDefaultProfile: true }).allowed, true);
  assert.equal(guardCookieClear({ includeDefaultProfile: true }).allowed, true);
});

test("only a literal true opts in — a truthy string does not", () => {
  for (const bad of ["true", 1, {}, "yes"]) {
    assert.equal(guardCookieClear({ domain: "ebay.com", includeDefaultProfile: bad }).allowed, false);
  }
});

test("an empty-string or null tabTarget does not count as scoping", () => {
  assert.equal(guardCookieClear({ tabTarget: "", domain: "ebay.com" }).allowed, false);
  assert.equal(guardCookieClear({ tabTarget: null, domain: "ebay.com" }).allowed, false);
  assert.equal(guardCookieClear({ tabTarget: undefined }).allowed, false);
});

test("null/undefined request is refused rather than throwing", () => {
  assert.equal(guardCookieClear(null).allowed, false);
  assert.equal(guardCookieClear(undefined).allowed, false);
});

test("⛔ tabTarget 0 is a real tab id and must NOT be read as unscoped", () => {
  assert.equal(guardCookieClear({ tabTarget: 0, domain: "ebay.com" }).allowed, true);
});

test("⛔ the handler actually CALLS the guard — the module passing its own tests protects nobody", () => {
  const src = fs.readFileSync("src/tools/cookies.ts", "utf8");
  assert.match(src, /guardCookieClear\(/, "clearCookies must invoke the guard");
  assert.match(src, /if \(!verdict\.allowed\)/, "and must act on the verdict");
});

test("⛔ includeDefaultProfile is IN THE ZOD SCHEMA — zod strips unknown keys, so a flag it drops could never be passed", () => {
  const src = fs.readFileSync("src/types/tool-schemas.ts", "utf8");
  const clear = src.slice(src.indexOf("export const ClearCookiesTool"), src.indexOf("export const DownloadFileTool"));
  assert.match(clear, /includeDefaultProfile: z\s*\n?\s*\.boolean\(\)/, "must be declared on ClearCookiesTool");
});
