# Specify mode transitions, event ownership, and Etch behavior

State: closed
Status: ready-for-human
Labels: wayfinder:grilling
Assignee: Daniel
Parent: [Specify same-page interaction mode for persistent workflow annotation](../PRD.md)
Blocked by: [Prototype the pause, resume, and interaction-step interface](01-prototype-interaction-interface.md), [Define atomic point-in-time element capture](03-define-atomic-capture.md)

## Question

What complete annotator state machine should govern Annotation mode, Interaction mode, minimized presentation, capture, delivery, retry, cancellation, and abort confirmation—including which mouse, wheel, keyboard, focus, scroll, resize, and drag behaviors belong to the page or annotator in each state; accessible pause/resume operation; overlay visibility; and suspension and resumption of an enabled Etch recording?

## Comments

### Resolution

Approved the minimal state machine and event-ownership contract in [`PROPOSED-SPEC.md`](../PROPOSED-SPEC.md):

- Keep primary `annotating` / `interacting` modes separate from bounded `idle` / `capturing` / `pausing` / `delivering` operations and modal decisions; do not create a Cartesian state graph.
- **Pause & interact** hides panel/overlays, leaves one accessible draggable Resume bubble, and returns normal site input to the page. Activating the bubble restores Annotation mode and arms—but does not create—the next step.
- Annotation-mode minimization changes presentation only, not input ownership. Capture serializes one click transaction and disables conflicting mutations; delivery freezes draft mutation until acknowledgement or failure.
- Normal scrolling remains page-owned in both modes. Annotation mode owns page hover/click selection and existing Alt+wheel depth selection; Interaction mode owns only the paused π bubble. Add no global keyboard shortcuts.
- Preserve the user's Etch-enabled preference, but record only Annotation-mode periods. Finalize a non-empty capture on Pause and Submit, restart a baseline on Resume, and deliver the ordered captures at draft level.
- Draft-level Etch intentionally supersedes the earlier per-step ownership proposal. It avoids empty-step and no-selection ownership cases without adding speculative machinery.

The approved acceptance details and explicit deferrals live in the linked specification.
