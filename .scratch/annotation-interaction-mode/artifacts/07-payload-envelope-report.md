# Multi-step screenshot payload envelope

## Scope and method

Measured 2026-07-30 against the current checkout and the agreed schema-v2 shape from [Define the ordered interaction-step delivery contract](../issues/04-define-delivery-contract.md).

- Chrome: Headless Chrome 150 on Linux.
- Viewport: 1440×900 CSS pixels at DPR 1 and DPR 2.
- Scenes: low-complexity document/form UI, medium-complexity dashboard UI, and a conservative high-entropy image workspace.
- Capture: seven PNG captures per scene/DPR through CDP `Page.captureScreenshot`, used as a proxy for `chrome.tabs.captureVisibleTab`; crop processing used the same image-to-canvas-to-PNG path and frozen CSS geometry as the extension design.
- Payload model: one retained viewport PNG per step, one retained crop PNG per Element annotation, nested image result objects, and representative element metadata/comments. No Etch images were included.
- Delivery: three local-loopback runs through the real broker and `AnnotationSessionClient`; the simulated Pi consumer decoded and sequentially wrote every image, matching the current formatter's material work.

CDP capture is not the extension API, synthetic scenes are not a population study, and local loopback does not measure Tailscale throughput. Results are sizing evidence and order-of-magnitude capture costs, not production latency guarantees.

Raw compact results:

- [`07-payload-measurements.json`](07-payload-measurements.json)
- [`07-broker-benchmark-summary.json`](07-broker-benchmark-summary.json)

## Current hard boundaries

| Boundary | Current value | Consequence |
|---|---:|---|
| Broker request body | 32 MiB (33,554,432 bytes) | Larger JSON receives HTTP 413. |
| Pi client's incoming IPC buffer | 34 MiB | Leaves about 2 MiB for the broker's message wrapper above the maximum annotation body. |
| Broker delivery acknowledgement | 10 s | Starts after the HTTP body has been read and parsed, while IPC transfer, Pi validation/formatting, and acknowledgement are pending. |
| Browser broker request | 20 s | Covers upload plus broker wait and response. |
| Current formatter per decoded screenshot | 15 MiB binary | A single larger PNG is reported as too large even if the JSON body fits. |

PNG data URLs add almost exactly 4/3 base64 expansion before JSON metadata. The broker does not apply content encoding.

## Encoded image sizes and per-click capture cost

Sizes below are UTF-8 data-URL sizes carried in JSON. Screenshot time is the seven-run median. Crop time shows the in-page median and cold/slow maximum; add roughly two animation frames when annotator chrome is hidden before capture.

| Scene | DPR | Step viewport | Element crop | Screenshot median | Crop median / max |
|---|---:|---:|---:|---:|---:|
| Low | 1 | 0.046 MiB | 0.028 MiB | 42 ms | 2 ms / 11 ms |
| Medium | 1 | 0.264 MiB | 0.074 MiB | 119 ms | 3 ms / 18 ms |
| High entropy | 1 | 3.529 MiB | 0.198 MiB | 486 ms | 6 ms / 111 ms |
| Low | 2 | 0.110 MiB | 0.069 MiB | 146 ms | 6 ms / 34 ms |
| Medium | 2 | 0.692 MiB | 0.223 MiB | 348 ms | 8 ms / 52 ms |
| High entropy | 2 | 13.556 MiB | 0.426 MiB | 1,812 ms | 16 ms / 475 ms |

Every Element annotation pays the full screenshot cost even when its full viewport bitmap is discarded after deriving the crop. A conservative high-entropy DPR-2 click can therefore occupy the input lock for roughly 2.3 seconds before frame-wait and UI overhead. Typical UI-heavy DPR-1/2 scenes were under roughly 0.45 seconds before frame-wait.

The DPR-2 high-entropy viewport decoded to 10.17 MiB, below the current 15 MiB per-image formatter ceiling, but consumed 13.56 MiB of the JSON body by itself. Larger physical viewports can breach the per-image ceiling before step counts become relevant.

## Representative v2 payloads

| Scene | DPR | Steps | Elements | JSON body | Share of 32 MiB |
|---|---:|---:|---:|---:|---:|
| Medium | 2 | 5 | 25 | 9.04 MiB | 28% |
| Medium | 2 | 10 | 50 | 18.08 MiB | 56% |
| Medium | 2 | 15 | 75 | 27.10 MiB | 85% |
| High entropy | 1 | 1 | 1 | 3.73 MiB | 12% |
| High entropy | 1 | 3 | 15 | 13.56 MiB | 42% |
| High entropy | 1 | 5 | 25 | 22.60 MiB | 71% |
| High entropy | 2 | 1 | 1 | 13.98 MiB | 44% |
| High entropy | 2 | 1 | 5 | 15.69 MiB | 49% |
| High entropy | 2 | 2 | 10 | 31.38 MiB | 98% |
| High entropy | 2 | 3 | 15 | 47.07 MiB | 147%; rejected |

The 3-step DPR-2 high-entropy case received HTTP 413 in all three runs. The 2-step/10-element case fit by only 0.62 MiB; ordinary metadata variation or Etch images could push it over the limit.

## Count envelope implied by measured sizes

This table is an arithmetic projection using the measured viewport/crop plus representative record overhead. “80% planning line” is evidence for headroom discussion, not a product limit decision.

| Scene | DPR | At 80%: steps with 1 element each | At 80%: steps with 5 elements each | Hard max: steps with 1 each | Hard max: steps with 5 each |
|---|---:|---:|---:|---:|---:|
| Medium | 2 | 27 | 14 | 34 | 17 |
| High entropy | 1 | 6 | 5 | 8 | 7 |
| High entropy | 2 | 1 | 1 | 2 | 2 |

With only one retained step viewport, the measured 80% line permits roughly 111 medium-DPR-2 crops, 111 high-entropy-DPR-1 crops, or 28 high-entropy-DPR-2 crops. Those figures demonstrate why count limits alone are not a transport guarantee; step viewports dominate high-entropy payloads, while crops dominate dense single-step drafts.

## Local delivery and acknowledgement

Three-run local medians through the real broker:

| Payload | JSON body | HTTP + broker + Pi acknowledgement median / max | Simulated formatter image-write median |
|---|---:|---:|---:|
| Medium DPR 2, 5 steps / 25 elements | 9.03 MiB | 651 / 664 ms | 15 ms |
| Medium DPR 2, 10 / 50 | 18.07 MiB | 2,515 / 2,613 ms | 27 ms |
| Medium DPR 2, 15 / 75 | 27.10 MiB | 5,379 / 5,743 ms | 42 ms |
| High DPR 1, 5 / 25 | 22.59 MiB | 3,832 / 3,930 ms | 27 ms |
| High DPR 2, 2 / 10 | 31.38 MiB | 7,104 / 7,408 ms | 32 ms |

Near-limit latency was strongly superlinear even though image decoding/writes remained tens of milliseconds. JSON upload/parsing and the single-line IPC buffering path, rather than filesystem work, dominated. The 31.38 MiB case remained below both current timeouts locally, but left only about 2.6 seconds of broker acknowledgement margin and 12.6 seconds of total browser-request margin before adding Tailnet upload latency, validation, formatter Markdown work, host load, or Etch processing.

The 20-second browser timeout implies that a full 32 MiB body alone requires at least about 13.4 Mbit/s effective upload throughput, before acknowledgement work. At 10 Mbit/s, transmitting 32 MiB takes about 26.8 seconds and cannot succeed under the current browser timeout; transmitting an 80% body takes about 21.5 seconds and is also already too slow. No remote Tailnet throughput was measured, so a near-hard-limit draft cannot be considered reliably deliverable from this evidence.

## Findings for the limits decision

1. **A live serialized-byte budget is required.** Count caps cannot protect the broker because measured viewport data varied from 0.046 MiB to 13.556 MiB at the same CSS viewport.
2. **Step count is the dangerous dimension on image-heavy/high-DPR pages.** Two high-entropy DPR-2 steps nearly exhaust the hard body limit regardless of modest element count.
3. **The hard 32 MiB boundary is not a practical target.** At 98% capacity, local delivery already took about 7.1 seconds and had little acknowledgement headroom; remote upload may hit the browser's 20-second timeout first.
4. **A warning/block threshold needs material headroom.** The measured 80% line (25.6 MiB) is a reasonable boundary for the next ticket to evaluate, but is not proven safe on slow Tailnet links.
5. **Etch must consume the same byte budget.** This measurement omitted Etch before/after images. Any per-step or zero-step Etch images directly reduce the available viewport/crop envelope.
6. **Per-image checks are still necessary.** A draft can be below the total body limit while one large physical-viewport PNG exceeds the formatter's 15 MiB decoded-image ceiling.
7. **Capture responsiveness also needs a UX threshold.** Payload size is not the only degradation: conservative DPR-2 high-entropy capture held one serialized transaction for roughly two seconds before UI overhead.

No product limits or compression policy are selected here; those remain for [Set workflow limits and capture degradation behavior](../issues/08-set-workflow-limits.md).
