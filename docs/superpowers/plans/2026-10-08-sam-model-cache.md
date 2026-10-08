# SAM Model Browser Caching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse cached SAM model files between page visits and request browser storage persistence when supported.

**Architecture:** Keep the existing lazy SAM loading flow. Explicitly enable Transformers.js browser caching after the dynamic import, and isolate the optional Storage API persistence request in a small testable browser helper. A failed or denied persistence request must not prevent model loading.

**Tech Stack:** Browser JavaScript ES modules, Hugging Face Transformers.js 3.x, Node.js built-in test runner.

---

### Task 1: Enable and test persistent browser model caching

**Files:**
- Create: `js/model-cache.mjs` — request optional persistent storage without blocking model loading.
- Modify: `js/app.js` — explicitly enable Transformers.js browser caching and request persistence before loading model assets.
- Modify: `README.md` — document browser caching and its retention limits in English and Japanese.
- Test: `tests/model-cache.test.mjs` — verify persistence is requested when available and failures are non-fatal.

- [ ] **Step 1: Write tests for the persistence helper**

Create `tests/model-cache.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { requestPersistentStorage } from "../js/model-cache.mjs";

test("requests browser storage persistence when supported", async () => {
  let called = false;
  const storage = {
    async persist() {
      called = true;
      return true;
    }
  };

  assert.equal(await requestPersistentStorage(storage), true);
  assert.equal(called, true);
});

test("returns false when persistence is unavailable or denied", async () => {
  assert.equal(await requestPersistentStorage(undefined), false);
  assert.equal(await requestPersistentStorage({ async persist() { return false; } }), false);
});

test("continues when the persistence request rejects", async () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    assert.equal(await requestPersistentStorage({
      async persist() { throw new Error("not available"); }
    }), false);
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = originalWarn;
  }
});
```

- [ ] **Step 2: Run the new tests and confirm they fail before implementation**

Run: `node --test tests/model-cache.test.mjs`

Expected: FAIL because `js/model-cache.mjs` does not exist yet.

- [ ] **Step 3: Implement the narrow persistence helper**

Create `js/model-cache.mjs`:

```js
export async function requestPersistentStorage(storage) {
  if (typeof storage?.persist !== "function") return false;
  try {
    return await storage.persist();
  } catch (error) {
    console.warn("Persistent browser storage request failed; continuing with browser cache.", error);
    return false;
  }
}
```

- [ ] **Step 4: Integrate caching into the existing lazy model-loading flow**

In `js/app.js`, import the helper:

```js
import { requestPersistentStorage } from "./model-cache.mjs";
```

In `loadLib(url)`, directly after destructuring `env` from the imported module, set:

```js
env.useBrowserCache = typeof globalThis.caches !== "undefined";
```

This explicitly enables browser caching when Transformers.js' Cache API is available and preserves uncached model loading in environments without it.

In `loadModel()`, after `await loadLib(spec.lib)` and before calling `load(first)`, request persistence:

```js
await requestPersistentStorage(navigator.storage);
```

Do not return early when the helper returns `false`; the browser cache remains enabled and model loading proceeds.

- [ ] **Step 5: Document caching behavior and limitations**

In `README.md`, update both the English and Japanese descriptions to say that browser caching is used to reuse SAM model files between visits. State that private browsing, cleared site data, browser storage eviction, or denied persistent storage can cause another download, and that model initialization still occurs after a page reload.

- [ ] **Step 6: Run focused and existing tests**

Run: `node --test tests/model-cache.test.mjs tests/i18n.test.mjs`

Expected: all tests pass.

- [ ] **Step 7: Review the final diff**

Run: `git diff --check; git --no-pager diff -- js/app.js js/model-cache.mjs tests/model-cache.test.mjs README.md`

Expected: no whitespace errors; only model caching integration, its tests, and directly related documentation are changed. Confirm SAM remains lazily loaded and the lightweight engine has no new network dependency.
