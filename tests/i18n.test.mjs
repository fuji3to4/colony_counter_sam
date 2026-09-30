import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveLocale, translate, translations } from "../js/i18n.mjs";

test("Japanese is the default and supported saved locales are restored", () => {
  assert.equal(resolveLocale(null), "ja");
  assert.equal(resolveLocale("en"), "en");
  assert.equal(resolveLocale("fr"), "ja");
});

test("translations resolve in the selected locale and fall back to Japanese", () => {
  assert.equal(translate("app.title", "en"), "E. coli Colony Counter");
  assert.equal(translate("app.title", "ja"), "大腸菌コロニーカウンタ");
  assert.equal(translate("missing.key", "en"), "missing.key");
});

test("translations interpolate runtime values", () => {
  assert.equal(
    translate("status.progress", "en", { done: 2, total: 10, seconds: 5 }),
    "Checking 2 / 10 points · about 5s left"
  );
});

test("Japanese and English dictionaries contain the same keys", () => {
  assert.deepEqual(Object.keys(translations.en).sort(), Object.keys(translations.ja).sort());
});

test("all static translation keys used by the page exist in both dictionaries", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const keys = [...html.matchAll(/data-i18n(?:-aria-label|-title)?="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(keys.length > 0, "the page should mark translatable text");
  for (const key of keys) {
    assert.ok(translations.ja[key], `missing Japanese translation: ${key}`);
    assert.ok(translations.en[key], `missing English translation: ${key}`);
  }
});

test("all literal translation keys used by the application exist in both dictionaries", async () => {
  const app = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
  const keys = [...app.matchAll(/\bt\(["']([^"']+)["']/g)].map((match) => match[1]);
  assert.ok(keys.length > 0, "the application should use translation keys");
  for (const key of keys) {
    assert.ok(translations.ja[key], `missing Japanese translation: ${key}`);
    assert.ok(translations.en[key], `missing English translation: ${key}`);
  }
});