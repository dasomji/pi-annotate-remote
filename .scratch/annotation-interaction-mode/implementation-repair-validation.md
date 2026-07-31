# Interaction-mode implementation repair validation

Date: 2026-07-30

All six spec-review findings have been repaired and covered at their observable seams.

| Finding | Repair | Regression evidence |
|---|---|---|
| Programmatic POST replay lost method/body | Navigation-event `formData` now creates a frozen POST replay; submit-event replay still preserves form/submitter overrides. | `Discard preserves a programmatic POST form method and body` |
| Failed capture could be stranded | Capture-failure modal no longer closes on Escape, and all draft controls remain disabled while a capture transaction exists. | `Escape cannot dismiss or strand a failed capture transaction` |
| Historical notes disappeared after filtering | Evidence rendering recreates missing visible note cards without stealing focus. | `a historical annotation remains visible after filtering away and back` |
| Etch stopped after delivery failure | Failed result construction/delivery restarts a fresh Etch period when Etch remains enabled in Annotation mode. | `enabled Etch starts a fresh recording period after delivery failure` |
| Submit-time Etch warning was lost | Added additive schema-v2 `etchWarnings?: string[]`, draft projection, authoritative validation, and Pi Markdown presentation under **Capture warnings**. | Draft/receiver unit tests plus `submit delivers an Etch finalization warning when its screenshot fails` |
| Current Interaction step was not selected by default | A transaction that creates a step selects that step after either complete or terminal-incomplete commit; captures added to an existing step do not override a deliberate filter. | `step filtering defaults to the current step and preserves other evidence` |

## Validation

- `npm run check` — passed.
- `npm test` — 92/92 passed.
- `npm run test:e2e` — 23/23 passed.
- `git diff --check` — passed.
- Proposed spec and Obsidian copy are byte-identical after documenting `etchWarnings`.

## Post-review repairs

- Programmatic form replay now freezes the original form method, action, target, encoding, and `FormData` from the browser's `formdata` event, including submissions made through `HTMLFormElement.submit()`. A non-default `text/plain` Chromium regression verifies wire-body semantics. If an exact POST descriptor is unavailable, replay fails explicitly instead of silently changing encoding.
- The duplicated `annotate()` E2E helper now lives in `test/e2e/helpers/annotation.js`.
- Post-review validation: `npm run check`, 92/92 unit tests, and 23/23 Playwright tests passed.

No commit was created.
