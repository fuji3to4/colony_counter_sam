import test from "node:test";
import assert from "node:assert/strict";
import { requestPersistentStorage } from "../js/model-cache.mjs";

test("returns true and calls persist when granted", async () => {
  let calls = 0;
  const storage = { persist: async () => { calls++; return true; } };
  assert.equal(await requestPersistentStorage(storage), true);
  assert.equal(calls, 1);
});

test("returns false when the persist API is missing", async () => {
  assert.equal(await requestPersistentStorage({}), false);
  assert.equal(await requestPersistentStorage(undefined), false);
});

test("returns false when persistence is denied", async () => {
  assert.equal(await requestPersistentStorage({ persist: async () => false }), false);
});

test("returns false and warns when persist rejects or throws", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  assert.equal(await requestPersistentStorage({ persist: async () => { throw new Error("x"); } }), false);
  assert.equal(await requestPersistentStorage({ persist: () => { throw new Error("y"); } }), false);
  assert.equal(warn.mock.callCount(), 2);
  assert.match(String(warn.mock.calls[0].arguments[0]), /continu/i);
});
