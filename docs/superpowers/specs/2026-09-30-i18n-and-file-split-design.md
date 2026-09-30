# i18n and File Split Design

## Goal

Add Japanese and English UI support to the colony counter and split the growing single-file implementation into focused files without changing colony detection behavior.

## User Experience

- Add a Japanese / English language selector to the existing header.
- Start in Japanese unless a saved language preference exists; persist the selection in local storage.
- Translate visible UI text, accessible labels, runtime status and error messages, help content, experiment-record CSV labels, and text embedded in exported result images.
- Keep machine-oriented CSV column names stable in English.
- Update the document `lang` attribute when the selected language changes.

## Structure

- `index.html`: semantic markup and references to the external stylesheet and JavaScript entry point.
- `css/app.css`: all current styles.
- `js/app.js`: application state, image interaction, model coordination, rendering, and exports.
- `js/i18n.mjs`: Japanese and English dictionaries plus language selection, persistence, and translation helpers. The `.mjs` extension lets the Node built-in test runner import the module without adding package metadata.
- `js/light-engine.js`: the existing pure light-engine detection functions, exported for use by the application.

Use native ES modules and no new runtime dependency. Preserve the existing SAM dynamic imports and model-loading behavior.

## Boundaries and Failure Behavior

Static strings use translation keys in markup; dynamic messages and help text use the same locale dictionaries. Missing keys fall back to Japanese and are surfaced during verification. If local storage is unavailable, use Japanese for the current page session without blocking the counter.

## Verification

- Load the page in both languages and confirm that static UI, help, status/error text, CSV record labels, and PNG annotations follow the selected language.
- Confirm language preference survives reload and `document.documentElement.lang` matches the selection.
- Confirm image selection, light-engine detection, manual add/remove, and existing SAM lazy-load wiring remain functional.
- Check browser console for module load errors and inspect the final diff for unintended changes.

## Scope

Do not change detection algorithms, model versions, default detection settings, export schemas, or visual design beyond fitting the language selector into the existing header.