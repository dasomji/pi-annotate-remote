## Standards

**Diff:** `git diff 4abcca6...HEAD`
**Commits:** `b1c0e60 feat: add same-page annotation interaction mode`; `a8b98b6 fix: close interaction mode review gaps`

No repository coding-standard violations found. `AGENTS.md` documents issue/domain workflow rather than source conventions, and the changed commits do not alter those tracker artifacts. `git diff --check`, `npm run check`, and the repository’s syntax checks pass.

### Judgement calls (Fowler smell baseline)

1. **Possible Duplicated Code — image-result policy.** `MISSING_REASONS` and captured/missing image validation are independently encoded in `chrome-extension/content-capture.js:15-42`, `chrome-extension/content-draft.js:12-42`, and `index.ts:188-197`. Runtime boundaries justify receiver-side validation, but the two content-script copies can drift on reason codes, attempt bounds, or sanitization. Consider one browser-side image-result module, while retaining authoritative receiver validation.

2. **Possible Divergent Change — controller breadth.** `chrome-extension/content.js` remains a 1,113-line controller containing capture orchestration (`captureElement`), mode transitions (`pause`/`resume`), rendering, modal/focus management, form replay, and route integration. The change does extract draft and route modules, so this is improved rather than a hard failure; nevertheless, future changes to unrelated UI/navigation/capture concerns still converge on this file.

3. **Possible Divergent Change — extension entrypoint breadth.** `index.ts` grows from 557 to 1,160 lines and now owns schema validation (`isV2AnnotationResult`), image persistence/formatting (`formatV2Image`/`formatV2Result`), plus the existing extension and broker lifecycle. The v2 validator/formatter form a cohesive module-sized concern and could be extracted to reduce future unrelated edits to the entrypoint.

All three findings are heuristic maintainability concerns, not hard violations. No additional baseline smell was strong enough to report.
