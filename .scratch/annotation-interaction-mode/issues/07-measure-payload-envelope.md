# Measure the multi-step screenshot payload envelope

State: closed
Status: ready-for-agent
Labels: wayfinder:task
Assignee: Daniel
Parent: [Specify same-page interaction mode for persistent workflow annotation](../PRD.md)
Blocked by: [Define atomic point-in-time element capture](03-define-atomic-capture.md)

## Question

Measure representative encoded sizes and capture costs for the agreed viewport-plus-crop Interaction-step model against the broker's current body limits and acknowledgement timeouts, recording the resulting practical envelope for numbers of steps and Element annotations so a later limits decision rests on evidence rather than guesses.

## Comments

### Resolution

Measured the agreed viewport-plus-crop schema-v2 model at a 1440×900 CSS viewport, DPR 1 and 2, across low-, medium-, and conservative high-entropy scenes. Capture measurements used seven Chrome runs per scene; delivery measurements used three local-loopback runs through the real broker and `AnnotationSessionClient` with Pi-equivalent image decoding and sequential file writes.

The complete method, tables, limitations, and implications are recorded in the [payload-envelope report](../artifacts/07-payload-envelope-report.md), with compact raw [capture and payload data](../artifacts/07-payload-measurements.json) and [broker benchmark summaries](../artifacts/07-broker-benchmark-summary.json).

Key evidence:

- The current hard boundaries are a 32 MiB broker body, 34 MiB Pi-client incoming IPC buffer, 10-second broker acknowledgement, 20-second browser request, and 15 MiB decoded-image ceiling in the current formatter.
- PNG data URLs incur approximately 4/3 base64 expansion. At the same 1440×900 CSS viewport, retained viewport data ranged from 0.046 MiB for low-complexity DPR 1 to 13.556 MiB for high-entropy DPR 2; crops ranged from 0.028 MiB to 0.426 MiB.
- Medium DPR-2 drafts measured 9.04 MiB for 5 steps / 25 elements, 18.08 MiB for 10 / 50, and 27.10 MiB for 15 / 75.
- High-entropy DPR-1 drafts measured 13.56 MiB for 3 / 15 and 22.60 MiB for 5 / 25.
- High-entropy DPR-2 drafts measured 15.69 MiB for 1 / 5 and 31.38 MiB for only 2 / 10. A 3 / 15 case was 47.07 MiB and consistently received HTTP 413.
- The 31.38 MiB case delivered locally in a 7.10-second median and 7.41-second maximum. Image writes took only about 32 ms; JSON transfer/parsing and single-line IPC buffering dominated. Near-limit local success therefore leaves little acknowledgement margin, while remote upload can exhaust the browser's 20-second timeout first.
- A full 32 MiB request requires at least about 13.4 Mbit/s effective upload throughput merely to transmit within 20 seconds, before acknowledgement work. Tailnet throughput was not measured.
- Per-click screenshot medians ranged from 42 ms to 1.81 seconds. The conservative high-entropy DPR-2 case plus a cold crop reached roughly 2.3 seconds before frame-wait and UI overhead, so capture lock duration also needs user-visible degradation behavior.

Consequences for the next decision:

1. Enforce a live serialized-byte budget; counts alone cannot guarantee delivery.
2. Treat step viewports as the dominant risk on image-heavy/high-DPR pages.
3. Do not treat the 32 MiB hard boundary as a usable product target. The report includes an 80% planning line for headroom discussion, not as a selected policy.
4. Charge Etch images against the same total budget; they were intentionally omitted from these measurements.
5. Enforce both total-payload and per-image limits.

This ticket selects no limits or compression policy. Those decisions remain with [Set workflow limits and capture degradation behavior](08-set-workflow-limits.md).
