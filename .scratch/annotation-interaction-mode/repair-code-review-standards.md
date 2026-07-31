# Standards review

**Fixed point:** `HEAD` (`a8b98b67d7bef94fd3e6e1be07013f41647822c1`)

**Diff command:** `git diff HEAD` (plus relevant untracked files under `.scratch/annotation-interaction-mode/` and `chrome-extension/prototypes/`, because the selected scope is HEAD + working tree).

**Commit list:** `git log HEAD..HEAD --oneline` → none; the reviewed work is uncommitted.

## Hard violations

None found. The changed implementation and tests use the domain vocabulary in `CONTEXT.md`; no changed behavior conflicts with ADR-0001. Repository instructions in `AGENTS.md`, `docs/agents/domain.md`, and `docs/agents/issue-tracker.md` are followed.

## Judgement calls

1. **Duplicated Code** — `test/e2e/annotation-workflow.spec.js:3-8` and `test/e2e/review-workflows.spec.js:3-9` contain the same changed helper shape:

   > `await page.locator(...).click();`
   > `const note = page.locator(".pi-note-card:has(.pi-note-textarea:focus)");`
   > `await expect(note).toBeVisible();`
   > `await note.locator(".pi-note-textarea").fill(comment);`

   This is a small test-only duplication, but the two copies already had to change together when current-step filtering changed note-card counts. Move the helper to a shared E2E support module to prevent future behavioral drift.

No other Fowler-baseline smells were strong enough to report; cross-layer `etchWarnings` edits are required by the delivery contract rather than Shotgun Surgery.
