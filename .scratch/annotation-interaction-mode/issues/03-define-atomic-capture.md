# Define atomic point-in-time element capture

State: closed
Status: ready-for-human
Labels: wayfinder:grilling
Assignee: Daniel
Parent: [Specify same-page interaction mode for persistent workflow annotation](../PRD.md)
Blocked by: none

## Question

What exact atomic lifecycle should turn a click into an Element annotation and, when needed, a new Interaction step—covering frozen metadata, one visible-viewport image on the step's first selection, one crop per selected element, annotation ordering, capture-in-progress behavior, rapid input, capture failure and retry, mode switching during capture, source-element disappearance, and removal of per-element or now-empty step assets?

## Comments

### Resolution

Define each accepted element click as one serialized capture transaction with the following lifecycle:

1. **Arm step creation on activation or resume.** Entering Annotation mode arms a new Interaction step boundary but does not create an empty step. The first committed Element annotation in that uninterrupted Annotation-mode period creates the step and its first annotation together.
2. **Freeze the click-time state.** On an accepted click, synchronously freeze the exact source-node reference, element metadata, crop geometry, and ordering intent. Hide annotator chrome and immediately capture one visible-viewport bitmap. Derive the element crop from that same bitmap using the frozen geometry. Retain that bitmap as the step viewport only for the step's first annotation; for later annotations, retain only the derived crop.
3. **Serialize input.** Permit only one capture transaction at a time and visibly report that capture is in progress. Ignore additional selection clicks and disable mode switching until the transaction succeeds, is discarded, or reaches a terminal incomplete commit. A repeat click on the same live node in the same step focuses its existing annotation instead of recapturing it. If that annotation is soft-deleted, the repeat click restores and focuses it.
4. **Commit atomically and in order.** Keep the prospective step and annotation provisional until every required asset succeeds. Then append them together in accepted-click order. Use stable opaque identities internally; derive contiguous display and delivery positions from the active ordered lists.
5. **Retry as a new point in time.** On image or crop failure, commit nothing and offer **Retry** or **Discard**. Retry freezes fresh metadata and geometry and captures fresh pixels; it does not combine old metadata with later pixels. Allow three total attempts. After the third failure, commit the last attempt's frozen metadata as an explicitly incomplete annotation and record exactly which required assets are missing.
6. **Handle disappearance during retry honestly.** If the exact source node disconnects after a failed attempt, a fresh retry is impossible. Offer **Keep incomplete** or **Discard** instead. Keeping it commits the last frozen metadata as historical. Disconnection after a successful viewport bitmap does not invalidate the crop because crop geometry was already frozen.
7. **Never backfill the first-state viewport.** If an incomplete first annotation leaves its step viewport missing, later element captures must not substitute a later page state. Keep the viewport missing and surface that fact at delivery.
8. **Track historical state by node identity.** Mark an Element annotation historical whenever its exact captured DOM node is disconnected. Never relink it by selector. If the exact node object is reinserted, return the annotation to live status. Frozen metadata, comment, and crop remain unchanged throughout.
9. **Require degraded-delivery confirmation.** If any committed annotation or step is missing a mandatory image, submission must first list the affected records and asset types and offer **Return to draft** or **Submit without screenshots**. Delivery proceeds only after explicit confirmation.
10. **Soft-delete for the draft lifetime.** Deletion immediately excludes an Element annotation from overlays, active ordering, and delivery. If it was the step's final active annotation, also exclude the step. Retain deleted records and their crop or viewport assets for Undo until successful submission or draft discard/close, then purge them. Undo restores their original ordered positions. Thus deletion is logically immediate, while physical asset removal occurs when undo is no longer possible.

This lifecycle deliberately makes the screenshot API's small asynchronous delay part of the accepted-click transaction rather than attempting to freeze the host page. It guarantees that every complete Element annotation's crop and, where applicable, step viewport come from one bitmap, while representing exhausted failures explicitly instead of silently mixing capture times.
