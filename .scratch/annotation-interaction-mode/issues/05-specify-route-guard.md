# Specify the route-guard state machine

State: closed
Status: ready-for-human
Labels: wayfinder:grilling
Assignee: Daniel
Parent: [Specify same-page interaction mode for persistent workflow annotation](../PRD.md)
Blocked by: [Prototype the pause, resume, and interaction-step interface](01-prototype-interaction-interface.md), [Establish Chromium route-guard coverage](02-research-route-guard-coverage.md), [Define atomic point-in-time element capture](03-define-atomic-capture.md)

## Question

Given Chromium's verified capabilities, what exact route-guard state machine should provide custom **Discard** / **Stay on this page** choices where possible and a native fallback elsewhere—defining when a draft becomes worth protecting, behavior in both annotator modes and during capture or delivery, handling of same-tab versus new-tab targets, forms, redirects, history traversal, fragments, repeated attempts, and the one-shot discard transition that must not trap the user?

## Comments

### Resolution

Use a minimal two-layer route guard and defer additional hardening until real failures justify it.

#### Core states

- **Clean:** The draft contains no recoverable user work. No custom or native route guard is active.
- **Dirty:** The draft contains any recoverable work: an accepted provisional capture, non-whitespace general context, a recorded Etch mutation, an active Element annotation, or a soft-deleted record that remains undoable. Arm both route guards.
- **Decision pending:** One cancelable route has been stopped and its replay descriptor retained while capture/delivery settles or the custom dialog is open.
- **Replaying clean:** A successful delivery or explicit whole-draft discard has made the draft clean and the retained route is replayed once.

Only acknowledged delivery or explicit whole-draft discard returns a dirty draft to clean. Deleting visible annotations does not clean the draft while soft-deleted records remain recoverable.

#### Guard behavior

- Keep `beforeunload` armed for the entire dirty lifetime in both Annotation and Interaction modes, including capture, delivery, and a custom-dialog wait. It is Chromium's native fallback for browser-owned or otherwise noncancelable transitions.
- For every cancelable top-level Navigation event while dirty, synchronously call `preventDefault()` before any asynchronous UI work. Do not gate this on `canIntercept`.
- Retain one route descriptor and show one custom dialog with **Discard** and **Stay on this page**.
- **Stay on this page** closes the dialog, clears the pending descriptor, and preserves the draft. The canceled route does not occur.
- **Discard** clears the whole draft, including undoable soft-deleted data, disarms both guards, and replays the triggering route once with its original semantics. Redirects after that confirmed replay proceed normally because the draft is already clean.
- Bind replay to the exact retained descriptor; never use a global “allow next navigation” flag. If replay throws or cannot be reconstructed, remain on the now-clean page, report that the draft was discarded and the route failed, and allow the user's next route attempt normally.
- Keep only one pending descriptor. Cancel repeated cancelable attempts while busy or while the dialog is open; do not queue them or add destination-changing UI.

#### Busy substates

- **Capture in progress:** Cancel and retain the first route synchronously. Let the atomic capture transaction reach its normal committed, discarded, or terminal-incomplete outcome, restore annotator UI, then show the custom dialog. Do not cancel or partially commit capture merely to navigate.
- **Delivery in progress:** Cancel and retain the first route while broker acknowledgement is pending. If delivery succeeds, the draft becomes clean and the retained route replays automatically without a discard dialog. If delivery fails, restore the dirty draft and show **Discard** / **Stay on this page**.

#### Route replay descriptors

Retain only the data needed to replay the canceled action faithfully:

- Destination URL plus push/replace/history state for ordinary links, Location/Navigation calls, fragments, and History API routes.
- Original source form, submitter, method, action, encoding, and captured form data for GET or POST submission; never convert POST to GET.
- Destination history-entry key for same-document traversal.
- Reload semantics for script/API reload.

A one-shot replay consumes and clears its descriptor on invocation, success, error, or timeout.

#### Coverage

- Use the custom path for cancelable same-tab links, forms, active-document script navigation, same-document push/replace, fragments, cancelable same-document traversal, declarative refresh, and script/API reload.
- New-tab/new-window targets and downloads do not replace the draft's document and receive no loss warning.
- Rely on native `beforeunload` for browser reload, address-bar/bookmark/search navigation, tab/window close, cross-document traversal, external-window/iframe navigation, and any event that is actually noncancelable.
- Chromium owns native warning text and may suppress it without sticky activation or under browser policy/sandboxing. Forced termination, hostile/exotic document replacement, and uninjectable pages remain explicitly unguardable; do not claim absolute containment.

Keep draft state and dialog UI in the isolated content script. Use the isolated-world Navigation listener if Chromium integration tests confirm it receives the required events; otherwise add only a minimal MAIN-world synchronous cancel-and-signal bridge. Do not monkey-patch page routing APIs or move draft data into the page's world.

This is intentionally the smallest complete state machine. Competing-navigation hardening, telemetry, persistence, and additional replay UX are deferred until observed failures require them.
