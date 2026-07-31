# Proposed interaction-mode spec — drafting notes

Status: working notes, not approved, not a Wayfinder resolution.

User request: stop one-question-at-a-time grilling, write one simple suggested spec for asynchronous review, copy it to `/home/dev/Obsidian/Coolify Share`, and avoid designing out-of-scope/future hardening.

Planned output: `.scratch/annotation-interaction-mode/PROPOSED-SPEC.md`, copied as `/home/dev/Obsidian/Coolify Share/pi-annotate-interaction-mode-proposed-spec.md`.

The proposal should consolidate approved decisions and fill the two remaining open areas: mode/event/Etch behavior and end-to-end acceptance scenarios. Do not close issue 06, issue 09, or the map until Daniel reviews/approves the proposal.

Suggested structure:

1. Proposal status and short recommendation.
2. Goal and non-goals.
3. Simple UX flow: activate → annotate → pause/interact → resume/new step → submit.
4. Minimal state model: primary mode (`annotating` / `interacting`) plus bounded transient operations (`capturing`, `capture-failed`, `delivering`) and modal decisions; avoid a Cartesian state explosion.
5. Event-ownership table for page input, annotator controls, keyboard/focus, scrolling/resizing, and bubble dragging.
6. Atomic click capture, historical elements, deletion/Undo, filtering, and delivery behavior already approved.
7. Etch behavior.
8. Minimal route guard already approved.
9. Schema-v2 delivery and Pi presentation.
10. End-to-end acceptance scenarios.
11. Implementation slices and explicit deferred work.
12. Small “review these recommendations” section.

Important simplification to propose clearly for review: use one draft-level Etch capture in v2 (preserving the current collector shape) while suspending recording in Interaction mode, instead of implementing per-step Etch segmentation now. This intentionally revises the previously approved per-step Etch delivery decision and should be flagged, not silently changed. It avoids the unresolved case where an Annotation-mode period records Etch changes but never creates a step.

Likely event ownership recommendation:

- Annotation mode: page hover/click belongs to element selection except annotator UI; normal scroll remains page-owned and overlays reposition; retain existing Alt+wheel depth selection; focused controls own keyboard input; no new global shortcuts.
- Interaction mode: all page input belongs to the site except the paused π bubble. All annotation overlays/panel are hidden. Bubble click or Enter/Space resumes; dragging the bubble does not resume.
- Annotation-mode minimization is presentation-only and does not change event ownership. Use distinct accessible labels/appearance for minimized Annotation versus paused Interaction bubbles.
- Capture: one transaction; ignore extra page clicks; disable pause/resume; hide annotator chrome only for screenshot; restore afterward.
- Delivery: freeze draft mutations, preserve draft/mode on failure, close only on acknowledged success.
- Etch enabled preference persists; recorder is active only in Annotation mode, suspended before Interaction mode passes input to the page, and resumed on Annotation mode.

Acceptance scenarios should cover first capture/step creation, pause/site interaction/resume/new step, no empty steps, filtering versus deletion, historical node identity, capture retry/incomplete delivery, soft deletion/Undo, Etch suspension, delivery retry, custom route dialog, native fallback, accessibility, and out-of-scope cross-page/crash recovery.
