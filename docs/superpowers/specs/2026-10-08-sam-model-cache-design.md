# SAM Model Browser Cache Design

## Goal

Avoid repeatedly downloading SAM model files when the browser can reuse its
local cache, while preserving the current static-site deployment and model
loading flow.

## Context

`js/app.js` lazily imports Hugging Face Transformers.js and loads the selected
model with `from_pretrained()`. It disables local models but does not explicitly
configure browser caching or request persistent browser storage.

## Design

- Explicitly enable Transformers.js browser caching through `env.useBrowserCache`
  after loading the library.
- Before loading model files, request persistent storage through
  `navigator.storage.persist()` when that API is available.
- Treat a denied, unavailable, or failing persistence request as non-fatal:
  model loading must continue and browser caching remains enabled.
- Update the README in English and Japanese to explain that model files are
  cached by the browser, but can be downloaded again if browser data is cleared,
  storage is evicted, or the browser does not grant persistent storage.
- Do not introduce a Service Worker, custom cache management UI, or new
  dependencies.

## Behavior and limitations

The cache stores model assets, not the initialized in-memory model. A page
reload still requires model initialization, but a cache hit should avoid
downloading model files again. Cache retention remains subject to browser
storage policy.

## Validation

- Run the existing test suite.
- Inspect the change to confirm light-engine behavior and lazy SAM loading are
  unchanged.
- Verify the browser-cache setting and persistence request are guarded for
  browser support and that persistence failure does not block model loading.
