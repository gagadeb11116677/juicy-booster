import { test } from "node:test";
import assert from "node:assert";
import { validatePid, isProtected } from "../lib/processes.js";

test("validatePid terima integer positif", () => {
  assert.strictEqual(validatePid("123"), 123);
  assert.strictEqual(validatePid(123), 123);
  assert.strictEqual(validatePid("1"), 1);
});

test("validatePid tolak input berbahaya", () => {
  assert.strictEqual(validatePid("12;rm"), null);
  assert.strictEqual(validatePid("-1"), null);
  assert.strictEqual(validatePid("0"), null);
  assert.strictEqual(validatePid("123456789"), null);
  assert.strictEqual(validatePid(null), null);
  assert.strictEqual(validatePid({}), null);
  assert.strictEqual(validatePid(""), null);
});

test("isProtected proses sistem", () => {
  assert.strictEqual(isProtected(1, "svchost"), true);
  assert.strictEqual(isProtected(1, "lsass.exe"), true);
  assert.strictEqual(isProtected(1, "Explorer"), true);
  assert.strictEqual(isProtected(1, "systemd"), true);
  assert.strictEqual(isProtected(100, "notepad"), false);
  assert.strictEqual(isProtected(100, "chrome"), false);
});

test("isProtected PID kritis", () => {
  assert.strictEqual(isProtected(0, "System"), true);
  assert.strictEqual(isProtected(4, "System"), true);
});
