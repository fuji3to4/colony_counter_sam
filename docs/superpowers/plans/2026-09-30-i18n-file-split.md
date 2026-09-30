# i18n and File Split Implementation Plan

> **For agentic workers:** Inline execution is authorized by the user. Follow the steps in order and keep verification focused.

**Goal:** Add persistent Japanese/English UI selection and split the single HTML file into maintainable source files without changing counting behavior.

**Architecture:** Keep HTML markup in `index.html`, styles in `css/app.css`, application orchestration in `js/app.js`, locale dictionaries and helpers in `js/i18n.mjs`, and the pure light detector in `js/light-engine.js`. Use native ES modules and browser local storage, with Japanese fallback.

**Tech Stack:** HTML, CSS, browser JavaScript ES modules, Node built-in test runner for pure i18n checks.

---

### Task 1: Add and test locale dictionary

**Files:**
- Create: `js/i18n.mjs`
- Create: `tests/i18n.test.mjs`

- [ ] Write Node tests for Japanese default, English lookup, Japanese fallback for a missing key, and complete key parity between locales.
- [ ] Run `node --test tests/i18n.test.mjs` and confirm it fails because the module is missing.
- [ ] Implement the dictionaries and pure translation helper, then add DOM translation, language selection, `lang` attribute synchronization, and guarded local-storage persistence.
- [ ] Run `node --test tests/i18n.test.mjs` and confirm all tests pass.

### Task 2: Split styles and light detector

**Files:**
- Modify: `index.html`
- Create: `css/app.css`
- Create: `js/light-engine.js`
- Create: `js/app.js`

- [ ] Move the existing style block verbatim to `css/app.css` and the existing module script to `js/app.js`; replace them in HTML with stylesheet and module references.
- [ ] Move `boxMean`, `otsuIdx`, and `detectLight` to `js/light-engine.js`, export `detectLight`, and import it from `js/app.js`.
- [ ] Run `node --check js/app.js`, `node --check js/light-engine.js`, and `node --check js/i18n.mjs`.

### Task 3: Localize the application surface

**Files:**
- Modify: `index.html`
- Modify: `js/i18n.mjs`
- Modify: `js/app.js`
- Modify: `css/app.css`

- [ ] Add the Japanese / English selector and translation keys for all visible markup and accessible labels.
- [ ] Replace Japanese-only runtime status, help text, experiment-record labels, and PNG annotation text with locale lookups; keep machine-facing CSV headers stable.
- [ ] Initialize the saved locale before rendering translated UI and update labels when the selection changes.
- [ ] Run the focused Node i18n tests again.

### Task 4: Verify split application

**Files:**
- Verify: all files above

- [ ] Serve the app locally and load it in a browser in both locales; verify selector persistence, translated help/status, and no console module errors.
- [ ] Exercise image selection and light-engine detection if a suitable local image is available; confirm SAM remains lazily loaded only when selected.
- [ ] Inspect `git diff --check` and `git status --short`; preserve unrelated pre-existing workspace changes.