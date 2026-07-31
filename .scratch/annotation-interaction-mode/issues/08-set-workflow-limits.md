# Set workflow limits and capture degradation behavior

State: closed
Status: wontfix
Labels: wayfinder:grilling
Assignee: Daniel
Parent: [Specify same-page interaction mode for persistent workflow annotation](../PRD.md)
Blocked by: [Define the ordered interaction-step delivery contract](04-define-delivery-contract.md), [Measure the multi-step screenshot payload envelope](07-measure-payload-envelope.md)

## Question

What limits should bound Interaction steps, Element annotations, image data, and total draft size, and what user-visible behavior should occur as capture or delivery approaches or exceeds those limits—without silently omitting required screenshots or sending deleted and stale assets?

## Comments

### Resolution

Do not introduce product-level workflow limits or limit-specific capture degradation in this effort. The tentative byte, image, step, and Element annotation thresholds discussed during grilling are discarded and are not decisions.

Specifically:

- Add no proactive cap on Interaction steps, Element annotations per step, total Element annotations, encoded draft size, or captured image size.
- Add no warning thresholds, automatic limit-driven image omission, compression, resizing, or special over-budget capture states.
- Never silently omit required screenshots or deleted/stale assets to force a payload under a transport boundary.
- Preserve the annotation draft when delivery fails so the user can delete content and retry through the ordinary delivery-retry path.
- Treat the current 32 MiB broker body limit, 34 MiB Pi-client IPC buffer, 10-second broker acknowledgement, 20-second browser request timeout, and 15 MiB formatter image ceiling as existing technical constraints rather than new product policy.
- Keep the [payload-envelope measurements](../artifacts/07-payload-envelope-report.md) as evidence for a future limits decision if real workflows demonstrate the need. Do not pre-emptively shape the product around conservative synthetic cases.

This intentionally leaves payload retention, compression, and workflow limits unspecified for now. The implementation handoff must test delivery-failure recovery and must not claim that arbitrarily large drafts are guaranteed to deliver.
