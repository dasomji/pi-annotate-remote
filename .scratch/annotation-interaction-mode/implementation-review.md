## Standards

**Diff:** `git diff 4abcca6...HEAD`
**Commits:** `b1c0e60 feat: add same-page annotation interaction mode`; `a8b98b6 fix: close interaction mode review gaps`

No repository coding-standard violations found. `AGENTS.md` documents issue/domain workflow rather than source conventions, and the changed commits do not alter those tracker artifacts. `git diff --check`, `npm run check`, and the repository’s syntax checks pass.

### Judgement calls (Fowler smell baseline)

1. **Possible Duplicated Code — image-result policy.** `MISSING_REASONS` and captured/missing image validation are independently encoded in `chrome-extension/content-capture.js:15-42`, `chrome-extension/content-draft.js:12-42`, and `index.ts:188-197`. Runtime boundaries justify receiver-side validation, but the two content-script copies can drift on reason codes, attempt bounds, or sanitization. Consider one browser-side image-result module, while retaining authoritative receiver validation.

2. **Possible Divergent Change — controller breadth.** `chrome-extension/content.js` remains a 1,113-line controller containing capture orchestration (`captureElement`), mode transitions (`pause`/`resume`), rendering, modal/focus management, form replay, and route integration. The change does extract draft and route modules, so this is improved rather than a hard failure; nevertheless, future changes to unrelated UI/navigation/capture concerns still converge on this file.

3. **Possible Divergent Change — extension entrypoint breadth.** `index.ts` grows from 557 to 1,160 lines and now owns schema validation (`isV2AnnotationResult`), image persistence/formatting (`formatV2Image`/`formatV2Result`), plus the existing extension and broker lifecycle. The v2 validator/formatter form a cohesive module-sized concern and could be extracted to reduce future unrelated edits to the entrypoint.

All three findings are heuristic maintainability concerns, not hard violations. No additional baseline smell was strong enough to report.

## Spec

1. **Programmatic POST replay is wrong.** The route contract requires forms to replay “the original submission rather than converting it to a GET” (`issues/05-specify-route-guard.md`, Coverage matrix). `HTMLFormElement.submit()` bypasses the `submit` listener; `createReplayDescriptor()` sees `event.formData` without `rememberedFormReplay`, falls through to `navigation.navigate(destination)`, and replays a GET. A targeted Chromium probe confirmed the original POST body became `GET /destination?source=post-form` with an empty body.

2. **Escape strands a failed capture and enables forbidden transitions.** The spec says capture failure must “Offer the bounded retry/discard flow” and “Pause, resume, submit, delete, and filter changes are disabled during capture” (`PROPOSED-SPEC.md:124-129`). `onKeyDown()` closes every non-route modal on Escape without resolving `draft.capture`. A Chromium probe then successfully entered Interaction mode with the failed transaction still pending; later captures/submission can remain blocked.

3. **Historical evidence disappears after filtering.** The spec says selecting a step shows its “overlays and notes” and a disconnected source remains visibly marked Historical (`PROPOSED-SPEC.md:79-86`). `renderEvidence()` removes cards hidden by a filter but recreates only live markers, not cards. After filtering away and back to a historical step, a Chromium probe found zero notes and no Historical marker, leaving the retained annotation inaccessible.

4. **Etch does not resume after failed delivery.** The spec requires restoring the same draft on failure and preserving enabled Etch recording across Annotation-mode periods (`PROPOSED-SPEC.md:93,207-213`). `submit()` finalizes and consumes the current Etch period; its catch path returns to idle without `etch.start()`. The checkbox remains enabled, but subsequent Annotation-mode mutations are not recorded.

5. **Submit-time Etch failure warning is effectively lost.** The spec says to “retain a warning for submission” (`PROPOSED-SPEC.md:215`). The warning exists only in private draft UI state, is not included in v2, and successful delivery immediately closes the annotator, so a finalization failure during Submit is neither shown before sending nor delivered to Pi.

6. **Current-step default is missing.** The approved filmstrip decision says “Select the current Interaction step by default” (`issues/01-prototype-interaction-interface.md`). `stepFilter` stays `"all"` after commits, so new/current steps are never selected automatically.

No unrelated product scope expansion was found.

## Validation

- `npm run check`: passed.
- `npm test`: 92/92 passed.
- `npm run test:e2e`: 18/18 passed.
- `git diff --check 4abcca6...HEAD`: passed.
- Three targeted Chromium probes exposed the programmatic-POST, capture-Escape, and historical-filter findings above; temporary probe files and generated artifacts were removed.

**Summary:** Standards: 3 judgement-call maintainability findings, worst is duplicated browser-side image policy/controller breadth. Spec: 6 findings, worst are incorrect programmatic POST replay and the strandable failed-capture transaction.
