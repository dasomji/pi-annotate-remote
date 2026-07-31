# Approve end-to-end acceptance scenarios

State: closed
Status: ready-for-human
Labels: wayfinder:grilling
Assignee: Daniel
Parent: [Specify same-page interaction mode for persistent workflow annotation](../PRD.md)
Blocked by: [Specify the route-guard state machine](05-specify-route-guard.md), [Specify mode transitions, event ownership, and Etch behavior](06-specify-mode-state-machine.md), [Set workflow limits and capture degradation behavior](08-set-workflow-limits.md)

## Question

Which end-to-end scenarios and observable outcomes form the implementation handoff contract across pause and resume, multi-step transient UI, historical Element annotations, asset deletion, mandatory capture and failure recovery, Etch suspension, submit retry, custom and native route warnings, accessibility, and the explicit boundary against cross-page persistence?

## Comments

### Resolution

Approved the 17 end-to-end scenarios in [`PROPOSED-SPEC.md`](../PROPOSED-SPEC.md) as the implementation handoff contract. They cover:

- Lazy first-step creation, ordered same-state captures, Pause/Resume, transient UI, and prevention of empty steps.
- Filmstrip filtering, historical source nodes, logical deletion and Undo.
- Serialized point-in-time capture, bounded fresh retries, explicit incomplete evidence, and degraded-delivery confirmation.
- Draft-level Etch captures that exclude Interaction-mode mutations.
- Delivery acknowledgement/retry, custom route decisions, native fallback, and new-target behavior.
- Keyboard accessibility and the explicit same-document boundary.

Implementation must satisfy these observable outcomes without adding cross-page persistence, speculative limits, queued-route UX, per-step Etch ownership, or adversarial hardening.
