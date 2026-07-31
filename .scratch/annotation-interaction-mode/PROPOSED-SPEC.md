# Pi Annotate — Same-page Interaction Mode

> **Status:** Approved — 2026-07-30
> **Purpose:** The deliberately small implementation contract for this feature.
> **Planning effect:** This replaces further question-by-question planning for the current scope.

## Recommendation

Add one **Pause & interact** action to the existing annotator. Pausing hides annotation UI except for a clearly paused π bubble and returns page input to the site. Activating the bubble resumes annotation. The first selected element after activation or resume creates a new ordered Interaction step.

Keep this version page-bound. It protects an unfinished draft from navigation, but it does not carry that draft to another page or recover it after reload/crash.

## Goal

Let a user document a transient workflow on one loaded page:

1. Select elements in the current page state.
2. Pause annotation and operate the site.
3. Resume and select elements in the new state.
4. Submit the ordered states and their evidence to Pi.

The result should make clear what the user saw, which elements they selected, and in which order.

## Non-goals

This version does **not** add:

- Cross-page or cross-document draft persistence.
- SPA route changes while retaining the draft; SPA routes are guarded like other navigation.
- Recovery after reload, browser crash, extension reload, or browser restart.
- Full-scroll-page screenshots.
- Adversarial navigation containment.
- Product limits, compression policy, automatic screenshot omission, or workflow-size warnings.
- A general browser macro recorder, click replay system, or page interaction history.
- New global keyboard shortcuts.

## User experience

### 1. Start annotating

The annotator opens in **Annotation mode**. No Interaction step exists yet.

The first accepted element click:

- Creates Step 1.
- Captures one image of the visible viewport.
- Captures the selected element from that same image.
- Adds the first Element annotation to Step 1.

Additional selections made before pausing belong to Step 1. Empty steps are never shown or delivered.

### 2. Pause and operate the page

The panel has one primary secondary action: **Pause & interact**.

When activated:

- Annotation overlays and the panel disappear.
- A draggable paused π bubble remains visible.
- The site receives normal pointer, keyboard, focus, wheel, and scroll input.
- The current draft stays in memory.
- Enabled Etch recording is suspended before the site receives Interaction-mode input.

The bubble is visibly different from the ordinary minimized Annotation-mode bubble and has the accessible name **Resume annotation**.

Dragging the bubble only moves it. Clicking it, or pressing Enter/Space while it is focused, resumes Annotation mode.

### 3. Resume and create the next state

Resuming restores the panel and annotation overlays and arms a new step boundary. It does not immediately create a step.

The first accepted selection after resume creates the next step and captures its viewport. Further selections remain in that step until the next pause.

If the user pauses and resumes without selecting anything, no empty step is created.

### 4. Review the workflow

Show an ordered filmstrip:

- **All steps** shows every active Element annotation.
- Selecting a step shows only that step's overlays and notes.
- Hidden saved steps receive a closed-eye marker.
- Filtering never deletes data.
- Each step thumbnail uses its visible-viewport image and shows its active annotation count.

If a selected source node disappears, its Element annotation remains in the draft and is marked **Historical — source element no longer exists**. It keeps its frozen metadata, comment, and crop.

### 5. Submit

Submission freezes draft mutation while delivery is pending.

- On acknowledgement, clear the draft and close the annotator.
- On delivery failure, restore the same draft and offer Retry.
- If mandatory image capture was exhausted for any record, show the missing evidence and require **Return to draft** or **Submit without screenshots** before delivery.

No new count or byte limit is imposed. Existing transport limits may still cause delivery failure; failure must leave the draft intact.

## Minimal state model

Do not model every combination as a separate state. Keep three small pieces of state:

```ts
type Mode = "annotating" | "interacting";
type Operation = "idle" | "capturing" | "pausing" | "delivering";
type Modal = "none" | "abort" | "captureFailure" | "degradedDelivery" | "routeGuard";
```

Only valid combinations are allowed:

- `capturing` occurs only in Annotation mode.
- `pausing` occurs only while finalizing an enabled Etch segment.
- `delivering` starts from Annotation mode.
- Interaction mode presents only the paused π bubble and any browser-owned dialog.
- Only one annotator modal may be active.

### Primary transitions

| From | Event | To | Rule |
|---|---|---|---|
| Annotating / idle | Pause & interact | Interacting / idle | If Etch has pending work, briefly use `pausing`, finalize it, then switch. |
| Interacting / idle | Activate Resume bubble | Annotating / idle | Restore UI and arm a new step boundary. |
| Annotating / idle | Accept element click | Annotating / capturing | Run one atomic capture transaction. |
| Capturing | Capture succeeds | Annotating / idle | Commit the provisional element and, if needed, its new step. |
| Capturing | Capture fails | Annotating / idle + capture modal | Offer the bounded retry/discard flow below. |
| Annotating / idle | Submit | Annotating / delivering | Freeze mutations until acknowledgement or failure. |
| Delivering | Acknowledged | Closed | Purge the draft. |
| Delivering | Failed | Annotating / idle | Preserve the draft and show Retry. |

Pause, resume, submit, delete, and filter changes are disabled during capture. Draft mutation is disabled during delivery.

## Event ownership

| Input | Annotation mode | Interaction mode |
|---|---|---|
| Pointer hover over page | Annotator identifies the candidate element. | Site owns it. |
| Click on page content | Annotator prevents the site action and starts selection capture. | Site owns it. |
| Annotator panel/bubble input | Annotator owns it. | Annotator owns only the paused π bubble. |
| Wheel and ordinary scrolling | Site scrolls; annotator repositions overlays. Existing Alt+wheel depth selection remains available in Annotation mode. | Site owns it. |
| Keyboard and focus | The focused control owns input. Keep existing annotator Escape/abort behavior; add no global shortcuts. | Site owns input except when the paused bubble is focused. |
| Panel or bubble drag | Annotator moves the control and clamps it to the viewport. Dragging does not activate it. | Same for the paused bubble. |
| Window scroll/resize | Recompute live overlay placement and clamp UI; never alter frozen capture geometry. | Clamp the bubble only. |

Annotation-panel minimization is presentation-only: page clicks still select elements. Its bubble must be visibly and accessibly distinct from the paused Interaction-mode bubble.

## Atomic element capture

Each accepted element click is one serialized transaction:

1. Freeze the exact source-node reference, metadata, crop geometry, and intended order.
2. Hide annotator chrome.
3. Capture one visible-viewport bitmap immediately.
4. Derive the element crop from that same bitmap.
5. Keep the viewport bitmap only when creating the step; keep every element crop.
6. Restore annotator chrome.
7. Commit the step and Element annotation together only after required work succeeds.

While capturing:

- Show capture progress.
- Ignore additional selection clicks.
- Do not allow pause, filter changes, deletion, or submit.

A repeated click on the same live node in the same step focuses its existing annotation. If that record was soft-deleted, the click restores it. Selecting the node in a later step creates a new Element annotation for that later page state.

### Failure behavior

- Offer Retry or Discard after failure.
- Permit three total attempts.
- Every retry freezes fresh metadata, geometry, and pixels; never combine different attempts.
- If all attempts fail, keep the last frozen metadata as an explicitly incomplete annotation with the exact missing image reason.
- If the source node disconnects before retry, offer **Keep incomplete** or **Discard**.
- Never use a later element capture to backfill a missing first-state viewport.

This is the only degraded capture path. Do not silently omit required evidence.

## Historical records and deletion

Source-node liveness is based on exact DOM node identity, not selector matching.

- A disconnected source becomes historical.
- Reinserting that exact node makes it live again.
- A lookalike replacement remains a different node; do not relink it.

Deletion is logically immediate but undoable for the draft lifetime:

- A deleted Element annotation disappears from overlays, ordering, and delivery.
- Its crop is retained only for Undo.
- Deleting the final active element removes its step and viewport from active display/delivery, while retaining them for Undo.
- Undo restores original ordered positions.
- Successful delivery or whole-draft discard permanently purges deleted records and assets.

## Etch recommendation — intentionally simpler

This proposal intentionally revises the earlier idea of assigning Etch data to individual Interaction steps.

For this version, Etch belongs to the **whole draft**, not to a step:

```ts
interface AnnotationResultV2 {
  // ...
  etchCaptures?: EditCapture[];
  etchWarnings?: string[];
}
```

Behavior:

- Preserve the user's Etch-enabled preference across pause/resume.
- Record only during Annotation-mode periods.
- On Pause, finalize the current non-empty Etch capture before entering Interaction mode.
- On Resume, start a fresh Etch baseline.
- On Submit, finalize the current non-empty capture.
- Deliver the resulting captures in recording order at the root of the draft.
- Pi presents them after the ordered workflow evidence under **Captured edits**.
- Empty Etch periods are omitted.
- An Etch-finalization failure does not block pausing; retain it in `etchWarnings` for submission and Pi presentation.

Why: step-local ownership creates edge cases when edits occur in an Annotation-mode period that never produces an Element annotation. A root-level ordered list excludes Interaction-mode mutations without inventing empty steps or a more complex ownership model. Step-local Etch can be reconsidered only if real workflows need that association.

## Route protection

A draft becomes protected as soon as it contains recoverable work: an accepted capture, non-empty general context, an Etch mutation, an active annotation, or an undoable deleted record.

While protected:

- Arm native `beforeunload` in both modes.
- Cancel a cancelable top-level Navigation event synchronously and show **Discard** / **Stay on this page**.
- **Stay** preserves the draft and leaves the attempted route canceled.
- **Discard** clears the whole draft, disarms protection, and replays the triggering same-tab route once.
- New-tab/new-window targets and downloads do not replace the current page and need no warning.
- Browser-owned or noncancelable navigation relies on Chromium's native warning.
- If capture is active, settle capture before showing the custom dialog.
- If delivery is active, replay automatically after successful acknowledgement; after failure, restore the draft and show the dialog.
- Keep only one pending route. Cancel and ignore repeated attempts while a decision is pending; add no queue or competing-navigation UX.

The guard is best effort. Browser suppression, forced termination, exotic document replacement, and pages where the extension cannot run remain unsupported.

## Delivery contract

New submissions use a nested schema v2. Existing v1 handling remains separate and unchanged.

```ts
interface AnnotationResultV2 {
  schemaVersion: 2;
  success: true;
  url: string;
  context?: string;
  steps: InteractionStep[];
  etchCaptures?: EditCapture[];
  etchWarnings?: string[];
}

interface InteractionStep {
  id: string;
  url: string;
  viewport: { width: number; height: number };
  viewportImage: ImageCaptureResult;
  elements: ElementAnnotation[];
}

interface ElementAnnotation {
  id: string;
  historical: boolean;
  comment: string;
  metadata: FrozenElementMetadata;
  cropImage: ImageCaptureResult;
}

type ImageCaptureResult =
  | { status: "captured"; mediaType: "image/png"; dataUrl: string }
  | {
      status: "missing";
      reason: "screenshot_failure" | "crop_failure" | "source_disconnected";
      attempts: 1 | 2 | 3;
      message?: string;
    };
```

Rules:

- Array order is authoritative; IDs are stable and opaque.
- Every delivered step has at least one active Element annotation.
- Soft-deleted records/assets are not delivered.
- Step URL and CSS-pixel viewport dimensions come from its first capture.
- Captured and missing images are explicit union branches, never `null` or silent omission.
- A zero-step submission requires non-empty general context; it may also contain Etch captures or warnings.
- `etchWarnings` retains bounded Etch-finalization failures whose periods were omitted.
- The broker remains schema-agnostic. The receiving Pi extension validates v1/v2.
- Unknown additive fields are ignored within a supported version.

Pi presents v2 chronologically: overall URL/context, then Step 1…N with each viewport image and Element 1…N evidence, followed by root-level capture warnings and captured edits. Missing or locally unwritable images produce an adjacent warning and are never reassigned.

## Acceptance scenarios

Approval of this proposal approves the following observable contract.

1. **First selection:** Starting the annotator creates no step. The first successful selection creates Step 1 with one viewport and one crop from the same bitmap.
2. **Multiple elements in one state:** Consecutive selections before pausing appear in accepted-click order inside the same step.
3. **Pause and resume:** While paused, the site receives normal input and only the paused π bubble remains. Resuming arms, but does not create, the next step.
4. **Transient UI:** A user pauses, opens transient site UI, resumes, and selects it. The new step preserves that state even if the UI later disappears.
5. **No empty steps:** Repeated pause/resume cycles without a successful selection produce no step.
6. **Filtering:** Selecting one filmstrip step hides other overlays without deleting them; All steps restores them; hidden steps show a closed-eye marker.
7. **Historical element:** Removing the exact source node marks its annotation historical while retaining metadata/comment/crop. A lookalike node does not replace it.
8. **Deletion and Undo:** Deleting an element removes it from active display/delivery; deleting the last element removes the active step. Undo restores both at their original positions.
9. **Capture serialization:** Rapid extra clicks and mode changes during capture do not create duplicates, reorder records, or partially commit a step.
10. **Capture failure:** Retry creates a fresh point-in-time attempt. Exhausted failure is explicit and requires degraded-delivery confirmation.
11. **Etch suspension:** Mutations made while paused are absent from delivered Etch captures; Annotation-mode mutations before and after the pause are delivered as ordered root-level captures.
12. **Delivery retry:** A transport or acknowledgement failure leaves the complete draft available and retryable. Acknowledged delivery purges it.
13. **Custom route guard:** A cancelable same-tab route with a protected draft leaves the URL unchanged and shows Discard/Stay. Stay preserves work; Discard clears it and performs the route once.
14. **Native route guard:** Reload, tab close, address-bar navigation, and other browser-owned transitions use Chromium's native warning when available.
15. **New target:** Opening a link in a new tab/window does not warn or disturb the current draft.
16. **Keyboard accessibility:** Pause and Resume are reachable by Tab, expose mode-specific names/states, activate with Enter/Space, and retain visible focus. Modal dialogs trap focus and return it to a sensible control.
17. **Scope boundary:** Completing a route, reloading, crashing, or restarting never claims to restore or continue the draft on the resulting document.

## Suggested implementation slices

Keep each slice independently testable:

1. **V2 model and formatter:** Ordered steps, explicit image results, root-level Etch captures, v1 compatibility.
2. **Atomic capture transaction:** Step creation, viewport/crop ownership, retries, incomplete evidence.
3. **Mode UI and ownership:** Pause action, paused bubble, resume, filmstrip filters, accessible controls.
4. **Draft lifecycle:** Historical nodes, soft deletion/Undo, delivery freeze/retry.
5. **Etch suspension:** Finalize Annotation-mode captures on pause/submit; exclude Interaction-mode mutations.
6. **Route guard:** Custom cancel/replay plus native fallback.
7. **End-to-end Chromium tests:** Exercise the acceptance scenarios above without expanding the product scope.

## Explicitly deferred

Do not add speculative handling for:

- Multiple queued or competing navigation intents.
- Draft persistence or restoration.
- Cross-page workflows.
- Per-step Etch ownership.
- Screenshot budgets or automatic degradation.
- Reordering steps/elements unless later requested.
- Editing or replaying site interactions.
- Hostile pages intentionally racing or disabling the extension.

## Review checklist

Approved as a whole. The main recommendation that differs from earlier planning is accepted:

- [x] Keep Etch as an ordered **draft-level** list rather than assigning it to Interaction steps.

The deliberately narrow boundaries are also accepted:

- [x] Same loaded page only; routes are guarded, not persisted across.
- [x] One Pause/Resume workflow with no additional modes or shortcuts.
- [x] No speculative limits or hardening until observed use requires them.
