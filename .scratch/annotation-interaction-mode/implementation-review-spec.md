## Spec

1. **Programmatic POST replay is wrong.** The route contract requires forms to replay “the original submission rather than converting it to a GET” (`issues/05-specify-route-guard.md`, Coverage matrix). `HTMLFormElement.submit()` bypasses the `submit` listener; `createReplayDescriptor()` sees `event.formData` without `rememberedFormReplay`, falls through to `navigation.navigate(destination)`, and replays a GET. A targeted Chromium probe confirmed the original POST body became `GET /destination?source=post-form` with an empty body.

2. **Escape strands a failed capture and enables forbidden transitions.** The spec says capture failure must “Offer the bounded retry/discard flow” and “Pause, resume, submit, delete, and filter changes are disabled during capture” (`PROPOSED-SPEC.md:124-129`). `onKeyDown()` closes every non-route modal on Escape without resolving `draft.capture`. A Chromium probe then successfully entered Interaction mode with the failed transaction still pending; later captures/submission can remain blocked.

3. **Historical evidence disappears after filtering.** The spec says selecting a step shows its “overlays and notes” and a disconnected source remains visibly marked Historical (`PROPOSED-SPEC.md:79-86`). `renderEvidence()` removes cards hidden by a filter but recreates only live markers, not cards. After filtering away and back to a historical step, a Chromium probe found zero notes and no Historical marker, leaving the retained annotation inaccessible.

4. **Etch does not resume after failed delivery.** The spec requires restoring the same draft on failure and preserving enabled Etch recording across Annotation-mode periods (`PROPOSED-SPEC.md:93,207-213`). `submit()` finalizes and consumes the current Etch period; its catch path returns to idle without `etch.start()`. The checkbox remains enabled, but subsequent Annotation-mode mutations are not recorded.

5. **Submit-time Etch failure warning is effectively lost.** The spec says to “retain a warning for submission” (`PROPOSED-SPEC.md:215`). The warning exists only in private draft UI state, is not included in v2, and successful delivery immediately closes the annotator, so a finalization failure during Submit is neither shown before sending nor delivered to Pi.

6. **Current-step default is missing.** The approved filmstrip decision says “Select the current Interaction step by default” (`issues/01-prototype-interaction-interface.md`). `stepFilter` stays `"all"` after commits, so new/current steps are never selected automatically.

No unrelated product scope expansion was found.
