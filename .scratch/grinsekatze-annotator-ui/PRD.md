# Implement the Grinsekatze filmstrip-and-composer annotator UI

State: open
Status: ready-for-agent

## Problem Statement

The annotator's production panel exposes the correct workflow, but its full-width multi-row control layout gives every control similar visual weight and makes the annotation draft harder to scan than necessary. Interaction steps, mode changes, general context, advanced capture options, draft cancellation, and delivery compete inside one panel.

The approved visual prototype establishes a clearer hierarchy without changing annotation behavior: review interaction steps in a compact screenshot-backed strip, write general context and submit from a focused composer directly below it, and move secondary guidance and controls out of the primary path. The production annotator now needs to adopt that direction while preserving every existing annotation-draft, capture, interaction-mode, Etch, route-protection, accessibility, and delivery guarantee.

## Solution

Replace the expanded annotator panel presentation with the favored **Filmstrip + composer** design.

At the bottom of the viewport, show two coordinated floating bars:

- An upper interaction-step strip containing the selected Grinsekatze icon, **All steps**, screenshot-backed interaction-step controls with annotation counts, **Interact with page**, contextual or secondary controls, help, minimize, and close.
- A lower composer containing a two-line general-context textarea, **Etch**, and **Submit**.

Use the selected original Grinsekatze mark: dark navy cat eyes and grin on a warm-white square, without the earlier π identity or center pin. The icon identifies the annotator but does not alter session routing or delivery terminology.

The visible **Interact with page** action performs the existing transition from Annotation mode to Interaction mode. The existing draggable resume bubble remains the way back to Annotation mode. A centered help dialog opened by **?** gives new users a short explanation of selecting elements, interacting with the page to create later interaction steps, adding general context, submitting, Etch, and the emergency abort gesture.

The implementation is a presentation and accessibility refresh. Existing domain behavior and payload contracts remain unchanged.

## User Stories

1. As an annotator user, I want the controls grouped by purpose, so that I can understand the workflow at a glance.
2. As an annotator user, I want the controls to remain near the bottom of the viewport, so that they do not dominate the page I am reviewing.
3. As an annotator user, I want interaction steps in their own strip, so that the ordered workflow is visually distinct from draft composition.
4. As an annotator user, I want the interaction-step strip directly above the composer, so that both surfaces feel like one tool without becoming one dense panel.
5. As an annotator user, I want **All steps** available, so that I can review every active element annotation together.
6. As an annotator user, I want each interaction step to retain its viewport screenshot thumbnail, so that I can recognize page states visually.
7. As an annotator user, I want each interaction step to show its active element-annotation count, so that I can understand the draft's distribution without opening every step.
8. As an annotator user, I want the current step visibly selected, so that I know which overlays and element annotations are being shown.
9. As an annotator user, I want hidden saved steps to retain their existing hidden-by-filter indication, so that filtering is not mistaken for deletion.
10. As an annotator user, I want interaction-step filtering to preserve the annotation draft, so that changing the view cannot lose evidence.
11. As an annotator user, I want empty interaction steps to remain absent, so that the filmstrip represents only captured page states.
12. As an annotator user, I want **Interact with page** in the interaction-step strip, so that advancing the workflow is located beside the resulting steps.
13. As an annotator user, I want **Interact with page** to perform the existing pause behavior, so that the site receives pointer, keyboard, focus, wheel, and scroll input.
14. As an annotator user, I want the draggable resume bubble to remain available during Interaction mode, so that I can return to Annotation mode.
15. As an annotator user, I want resuming without selecting an element to avoid creating an empty step, so that the workflow remains accurate.
16. As an annotator user, I want a two-line general-context field, so that I can add meaningful overall guidance without expanding a large panel.
17. As an annotator user, I want my existing general context preserved while filtering, minimizing, interacting with the page, and recovering from delivery failure, so that presentation changes never lose work.
18. As an annotator user, I want **Etch** next to the general-context field, so that recording visible edits remains available in the primary composition workflow.
19. As an annotator user, I want the Etch enabled state and capture count communicated clearly, so that I know whether edits are being recorded.
20. As an annotator user, I want Etch to retain its existing pause and resume semantics, so that Interaction-mode mutations are not accidentally captured.
21. As an annotator user, I want **Submit** visually emphasized in the composer, so that the final action is unambiguous.
22. As an annotator user, I want submission to retain all current acknowledgement, failure, retry, and degraded-evidence behavior, so that the visual refresh does not weaken delivery safety.
23. As an annotator user, I want delivery failures displayed without obscuring or discarding my draft, so that I can retry unchanged.
24. As a new user, I want a visible **?** control, so that I can understand the workflow without external documentation.
25. As a new user, I want help in a centered dialog, so that guidance has enough room to be readable without permanently enlarging the bars.
26. As a new user, I want help to explain element selection, interaction steps, general context, submission, Etch, and abort behavior, so that I can complete an annotation confidently.
27. As a keyboard user, I want to open and close help without a pointer, so that onboarding is accessible.
28. As a keyboard user, I want closing help to restore focus to the **?** control, so that I do not lose my place.
29. As a keyboard user, I want Escape to close help before it participates in the annotator's abort sequence, so that dismissing documentation cannot accidentally advance cancellation.
30. As a screen-reader user, I want the help dialog to have a clear accessible name and modal semantics, so that its purpose and boundaries are announced.
31. As a screen-reader user, I want screenshot-backed step controls to retain meaningful accessible names and pressed state, so that thumbnails are not the only way to navigate.
32. As a keyboard user, I want all step-strip and composer actions to show visible focus, so that I can operate the annotator confidently.
33. As an annotator user, I want to minimize the two-bar interface without losing draft state, so that I can inspect more of the page.
34. As an annotator user, I want the minimized bubble to retain the current active annotation count, so that the draft remains visible while compact.
35. As an annotator user, I want the close control to retain the existing abort-confirmation flow, so that accidental closure cannot discard work.
36. As an annotator user, I do not want a duplicate visible **Cancel** action when close already performs the same guarded behavior, so that the composer remains focused.
37. As an annotator user, I want **Undo delete** to appear contextually when an element annotation can be restored, so that undo remains available without occupying permanent primary space.
38. As an advanced user, I want the existing Debug capture option to remain reachable from a secondary surface, so that the simplified default UI does not remove diagnostic evidence.
39. As an advanced user, I want Debug state to remain visible when enabled, so that enhanced capture is never active without indication.
40. As an annotator user, I want capture progress and disabled states reflected across both bars, so that I cannot trigger incompatible actions during an atomic capture.
41. As an annotator user, I want delivery progress reflected across both bars, so that draft mutation remains visibly unavailable while delivery is pending.
42. As an annotator user, I want historical element annotations and missing-evidence states to remain represented exactly as before, so that the visual refresh does not alter evidence semantics.
43. As an annotator user, I want both bars and their dialogs clamped to the viewport, so that controls remain usable at narrow and short viewport sizes.
44. As an annotator user, I want element-annotation cards to avoid the combined footprint of the two bars, so that cards do not open underneath primary controls.
45. As an annotator user, I want minimization and Interaction mode to release the reserved bottom area appropriately, so that hidden controls do not continue displacing cards.
46. As a Grinsekatze user, I want the selected dark-blue eyes-and-grin icon in the annotator and help dialog, so that the product has a coherent identity.
47. As a user integrating with Pi, I want annotation-session and broker behavior to remain unchanged, so that the standalone-facing Grinsekatze identity does not break current Pi workflows.
48. As a maintainer, I want the implementation to reuse the existing annotation-draft and controller behavior, so that a visual redesign does not create a second state model.
49. As a maintainer, I want the throwaway prototype kept separate until production behavior is validated, so that prototype shortcuts are not promoted as production code.
50. As a maintainer, I want obsolete prototype variants removable after the production design is accepted, so that stale UI directions do not become maintenance burden.

## Implementation Decisions

- Treat this as a production presentation refactor around the existing annotator controller, annotation draft, and state model. Do not create a parallel controller or duplicate draft state.
- Preserve the existing orthogonal `mode`, `operation`, and `modal` model. The redesign must not change valid transitions or event ownership.
- Render two coordinated fixed surfaces in Annotation mode: the interaction-step strip above and the composer below. They share one responsive positioning strategy and one combined reserved region for element-annotation card placement.
- Keep the interaction-step strip ordered as: Grinsekatze identity, **All steps**, active interaction-step controls, **Interact with page**, contextual/secondary controls, **?**, minimize, and close. Horizontal overflow must remain usable when many steps exist.
- Continue using each interaction step's captured visible-viewport image for its thumbnail. Do not generate new screenshots for the redesigned UI.
- Keep the current step-filter state, accessible pressed state, hidden-step status, active annotation counts, and behavior unchanged.
- Change the visible pause-action wording from **Pause & interact** to **Interact with page**. This is a label and placement change only; it enters the existing Interaction mode and finalizes Etch using the existing transition.
- Retain **Resume annotation** as the accessible name of the Interaction-mode bubble. Do not add a persistent Annotation/Interaction mode toggle.
- Make the general-context control two visible text lines high. It remains bound to the existing draft-level general context and keeps the existing protection and delivery semantics.
- Keep **Etch** in the composer. Preserve its enabled preference, recording-state treatment, count badge, pause finalization, resume baseline, and delivery behavior.
- Keep **Submit** in the composer and retain its dynamic busy/retry behavior, delivery error presentation, degraded-evidence confirmation, and disabled states.
- Do not show a duplicate permanent **Cancel** action. The close control continues to open the existing abort dialog.
- Show **Undo delete** contextually in the interaction-step strip only while undo is available. It must use the existing draft-lifetime undo behavior and restore original ordering and assets.
- Keep Debug reachable through a compact secondary/advanced control associated with the step strip or help dialog. The default surface must remain visually quiet, while an enabled Debug state must be apparent without reopening the secondary surface.
- Add a **?** button to the interaction-step strip. It opens one centered modal dialog owned by the annotator's existing modal discipline; it may not coexist with another annotator modal.
- Help content is concise and in-product: select an element and write its element annotation; use **Interact with page** and resume to create later interaction steps; add general context and submit; use Etch for captured edits; use the established Escape gesture to abort.
- The help dialog closes through its close button, backdrop activation, or Escape. Escape closes help without incrementing the abort sequence, and focus returns to the opener.
- Use semantic buttons, a labelled modal dialog, accessible pressed/checked/busy states, and visible focus styles. Do not make thumbnails or color the sole carriers of state.
- Use the selected Grinsekatze icon asset derived from the approved concept: dark navy cat eyes and grin, warm-white field, no center pin, no π glyph. Produce appropriately sized, crisp production assets rather than depending on the full concept-board image.
- Limit branding changes in this implementation to the in-page annotator identity and its help surface. The extension manifest, session chooser, broker protocol, command names, package identity, and delivered annotation vocabulary are not renamed by this spec.
- Preserve current light/dark compatibility and ensure the warm-white icon remains bounded and legible against both themes.
- Preserve existing capture-status, delivery-error, historical-evidence, missing-evidence, and modal presentations. Their placement may adapt to the two-bar design, but their wording and behavior remain governed by the existing contracts.
- The production implementation should absorb the approved decisions rather than copying the prototype wholesale. Prototype-only variant switching, mock site data, mock notes, and preview-server behavior must not enter production.

## Testing Decisions

- Use the existing full-extension Playwright workflow fixture as the primary and highest test seam. The feature is successful only when a user can operate the redesigned injected annotator against a real fixture page while existing capture and broker behavior remains intact.
- Prefer role, accessible-name, pressed-state, checked-state, and visible-behavior assertions over internal class names or implementation-specific DOM structure.
- Update existing end-to-end tests that address **Pause & interact** to use the new **Interact with page** label while preserving all assertions about Interaction mode, the resume bubble, step creation, event ownership, and Etch suspension.
- Extend existing interaction-step review tests to verify screenshot thumbnails, annotation counts, current filtering, **All steps**, hidden-step indicators, contextual Undo, and restored assets in the redesigned strip.
- Add an end-to-end help-dialog test covering keyboard opening, modal semantics, expected quick-start topics, Escape closing without advancing abort, backdrop/close-button dismissal, and focus restoration.
- Add responsive end-to-end coverage at representative narrow and short viewports. Assert that the step strip, composer, help dialog, and element-annotation cards remain within the viewport and that step overflow remains operable.
- Preserve the existing end-to-end submission test as regression coverage for schema-v2 payload delivery. The visual implementation must not change payload shape, ordering, captured images, general context, or Etch captures.
- Preserve existing tests for failed delivery and Retry, incomplete screenshots, historical element annotations, deletion/Undo, pause/resume without empty steps, and keyboard-operable mode controls.
- Keep lower-level controller harness tests for cases already covered there, especially element lookup, busy-state rendering, panel minimization, and event wiring. Do not add low-level tests merely to assert CSS class composition.
- Add a lightweight asset validation that production icon files exist at required dimensions and decode successfully. Pixel-perfect snapshot tests are not required.
- A good test observes user-visible behavior or delivered annotation results. It must not assert incidental nesting, exact pixel values, private state variables, or the number of helper functions.
- The test suite should demonstrate that this is a presentation refactor: all existing behavior-oriented tests continue to pass after selectors and accessible labels are updated only where the approved interface changed.

## Out of Scope

- Changing annotation-draft semantics, interaction-step creation, capture transactions, route protection, Etch ownership, or schema-v2 delivery.
- Cross-page annotation persistence, reload/crash recovery, full-scroll-page screenshots, workflow limits, compression, or screenshot omission policy.
- Renaming the extension package, manifest, broker, Pi command, session chooser, annotation session, or transport protocol from Pi Annotate to Grinsekatze.
- Rebranding the compact extension window, pairing pages, broker setup output, README, or distribution assets beyond what is necessary for the in-page annotator prototype direction.
- Replacing the selected icon with another generated concept or reproducing Disney, Tenniel, or another existing Cheshire Cat depiction.
- Adding a persistent Annotation/Interaction mode toggle.
- Adding global keyboard shortcuts.
- Rebuilding element-annotation cards beyond spacing and collision adjustments required by the new bars.
- Shipping the prototype route, variant switcher, mock dashboard, mock annotation data, or preview server as product functionality.
- Trademark, domain, package-name, or store-listing clearance for Grinsekatze.

## Further Notes

- The approved visual reference is prototype **C — Filmstrip + composer** in the repository's prototype artifacts.
- The selected brand asset is the revised concept B: abstract dark-navy cat eyes and grin, with the center pin removed.
- The prototype intentionally did not exercise production functionality. Implementation must be driven by existing behavior and acceptance tests, using the prototype only for hierarchy, spacing, styling, and wording.
- The primary test seam is the existing Playwright browser-extension workflow because it covers the injected annotator, page event ownership, capture behavior, and broker delivery together. Lower seams are retained only for existing hard-to-drive controller states.
- This specification does not reopen the approved same-page Interaction mode contract or either broker ADR.
