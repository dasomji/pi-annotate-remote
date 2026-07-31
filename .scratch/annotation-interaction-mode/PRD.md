# Specify same-page interaction mode for persistent workflow annotation

State: closed
Status: ready-for-human
Labels: wayfinder:map
Assignee: Daniel

## Destination

An implementation-ready product and technical specification for pausing element selection, interacting with one loaded page, resuming annotation, and delivering persistent ordered workflow steps without accidental routing loss.

## Notes

- This is a planning map. Production implementation, release work, and documentation changes happen after handoff, not inside this map.
- Use the vocabulary in [`CONTEXT.md`](../../CONTEXT.md) and update it inline through `/skill:domain-modeling` when a term is sharpened.
- HITL tickets use `/skill:grilling` one question at a time; visual questions use `/skill:prototype`.
- Interaction mode reuses the draggable π bubble. The bubble visibly indicates that annotation is paused, and clicking it returns to Annotation mode.
- Each Interaction step begins with the first element annotation after activation or resume. It captures one visible-viewport image, while every Element annotation captures a point-in-time metadata snapshot and cropped image.
- Screenshots are mandatory: the existing Crop / Full / None choice is replaced by viewport-plus-crop capture. Deleting an Element annotation removes its crop; deleting the last Element annotation in a step also removes the step viewport image.
- Element annotations remain in the draft when their source DOM elements disappear and are visibly identified as historical.
- All top-level route attempts, including SPA routes, are guarded. Interceptable routes use a custom **Discard** / **Stay on this page** dialog; browser-owned transitions use Chromium's native warning fallback.
- Etch retains the user's enabled preference but suspends recording during Interaction mode and resumes in Annotation mode.
- True full-scroll-page capture is not implied by “viewport”; current capture covers only what is visible.

## Decisions so far

<!-- Closed ticket answers are indexed here by linked title and a one-line gist. -->

- [Prototype the pause, resume, and interaction-step interface](issues/01-prototype-interaction-interface.md) — Use a viewport-screenshot filmstrip with one Pause & interact action, a paused π Resume bubble, current-step filtering, an explicit All steps view, and closed-eye markers on saved steps hidden by the filter.
- [Define atomic point-in-time element capture](issues/03-define-atomic-capture.md) — Serialize accepted-click transactions, derive first-step viewport and crop from one immediate bitmap, retry as fresh point-in-time capture up to three attempts, explicitly preserve exhausted incomplete captures, track source-node liveness, and retain soft-deleted assets for draft-lifetime Undo.
- [Define the ordered interaction-step delivery contract](issues/04-define-delivery-contract.md) — Emit a validated schema-v2 ordered step tree with nested captured-or-missing images and ordered draft-level Etch captures, preserve a separate legacy-v1 formatter, keep the broker schema-agnostic, and present Pi evidence chronologically.
- [Measure the multi-step screenshot payload envelope](issues/07-measure-payload-envelope.md) — Measured 1440×900 DPR-1/2 capture and delivery: image complexity makes count-only safety unreliable, two conservative high-entropy DPR-2 steps nearly exhaust 32 MiB, and near-limit local acknowledgement already takes about seven seconds before remote upload.
- [Set workflow limits and capture degradation behavior](issues/08-set-workflow-limits.md) — Add no product-level count or byte caps, warnings, compression, or limit-driven screenshot omission for now; preserve drafts after ordinary delivery failure and revisit the retained measurements only if real workflows justify limits.
- [Specify the route-guard state machine](issues/05-specify-route-guard.md) — Arm custom Navigation cancellation plus native `beforeunload` for any recoverable work, serialize one exact replay, defer routes through capture/delivery, and leave new-target, native-fallback, and explicitly unguardable cases minimal.
- [Establish Chromium route-guard coverage](issues/02-research-route-guard-coverage.md) — Cancel Navigation API events before showing the custom dialog, keep `beforeunload` armed for browser-owned transitions, and explicitly exclude forced termination, suppressed native prompts, and exotic document replacement from the guarantee.
- [Specify mode transitions, event ownership, and Etch behavior](issues/06-specify-mode-state-machine.md) — Use a small orthogonal mode/operation/modal model, return site input only in Interaction mode, and record ordered draft-level Etch captures from Annotation-mode periods.
- [Approve end-to-end acceptance scenarios](issues/09-approve-acceptance-scenarios.md) — Adopt the consolidated 17-scenario contract for capture, pause/resume, review, failure recovery, delivery, routing, accessibility, and scope boundaries.

## Explicitly deferred

- Product limits, retention, compression, workflow-shaping policy, and speculative hardening remain deferred until real workflow evidence demonstrates a need.

## Out of scope

- Cross-document or cross-page annotation persistence, including carrying a draft through a completed navigation.
- Allowing SPA route changes inside this effort; they are treated as guarded top-level routes.
- Recovery after reload, browser crash, extension reload, or browser restart.
- True full-scroll-page screenshots below the fold.
- Production implementation, migration, release, and end-user documentation.

## Comments

### Resolution

Approved [`PROPOSED-SPEC.md`](PROPOSED-SPEC.md) on 2026-07-30 as the implementation-ready handoff. All child questions are resolved. Production implementation remains a separate next phase.
