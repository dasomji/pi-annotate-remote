# Define the ordered interaction-step delivery contract

State: closed
Status: ready-for-human
Labels: wayfinder:grilling
Assignee: Daniel
Parent: [Specify same-page interaction mode for persistent workflow annotation](../PRD.md)
Blocked by: [Define atomic point-in-time element capture](03-define-atomic-capture.md)

## Question

What versioned Annotation result and Pi-facing presentation should preserve Interaction-step order and associate each step's URL, viewport, viewport image, Element annotations, cropped images, comments, historical-source status, and optional Etch capture without ambiguity, while giving existing broker validation and result formatting a safe migration path?

## Comments

### Resolution

Adopt a versioned delivery union with a nested, ordered v2 contract and a separate legacy read path.

#### Versioning and migration

- Treat payloads with no `schemaVersion` or with `schemaVersion: 1` as legacy v1. Validate them and preserve their existing flat **Page Annotation** presentation; do not normalize submit-time legacy evidence into a synthetic atomic step.
- New annotators emit only `schemaVersion: 2`. They must not dual-write legacy fields or duplicate image data.
- Keep the broker schema-agnostic: it continues enforcing authentication, body size, routing, and acknowledgement without understanding annotation fields.
- Make the receiving Pi extension the authoritative validator. It strictly validates known v1/v2 fields and invariants and rejects malformed or unsupported versions through the existing delivery-acknowledgement path.
- Permit and ignore unknown additive fields inside a supported version. Increment the schema version for incompatible shape or semantic changes.

#### V2 root

```ts
interface AnnotationResultV2 {
  schemaVersion: 2;
  success: true;
  url: string;
  context?: string;
  steps: InteractionStep[];
  etchCaptures?: EditCapture[];
  etchWarnings?: string[];
}
```

- `url` identifies the page associated with the overall draft/submission.
- `context` replaces the misleading legacy `prompt` name and remains distinct from per-element comments.
- `steps` is the authoritative workflow order.
- A zero-step result is valid only when `context` is non-empty. It may also include root-level `etchCaptures` and `etchWarnings`.
- `etchCaptures` contains non-empty Annotation-mode recording periods in order. Etch is deliberately draft-owned rather than step-owned; Interaction-mode mutations are excluded.
- `etchWarnings` retains bounded finalization failures for Etch periods omitted from `etchCaptures`, so a successful delivery does not lose the warning.
- Keep `success` for envelope continuity, but v2 accepts only the literal value `true`. Delivery and transport failures are protocol errors, not v2 annotation payloads.
- Do not emit wall-clock capture timestamps, explicit ordinal fields, or a redundant degraded flag.

#### Ordered step and element tree

```ts
interface InteractionStep {
  id: string;
  url: string;
  viewport: { width: number; height: number };
  viewportImage: ImageCaptureResult;
  elements: ElementAnnotation[];
}

interface ElementAnnotation {
  id: string;
  historical: boolean;
  comment: string;
  metadata: FrozenElementMetadata;
  cropImage: ImageCaptureResult;
}
```

- Every emitted step contains at least one active Element annotation. Empty steps and soft-deleted records/assets are absent from delivery.
- The `steps` array and each step's `elements` array are the sole ordering authority. Stable opaque IDs preserve identity and must be unique within the draft; consumers derive contiguous Step and Element numbers from array positions.
- Each step's `url` is the URL at its first capture. Its viewport dimensions are expressed in CSS pixels.
- `FrozenElementMetadata` contains the existing click-time DOM evidence—selector, DOM ID, tag, classes, text, rectangle, attributes, box model, accessibility, key styles, and optional debug fields—but excludes `comment`.
- `historical` reports exact source-node liveness at submission. Keep it and the editable user-authored `comment` outside frozen metadata.
- Etch data is not assigned to a step. The approved mode specification finalizes each non-empty Annotation-mode recording period into the root `etchCaptures` list.

#### Captured and missing images

```ts
type ImageCaptureResult =
  | {
      status: "captured";
      mediaType: "image/png";
      dataUrl: string;
    }
  | {
      status: "missing";
      reason: MissingReasonCode;
      attempts: 1 | 2 | 3;
      message?: string;
    };
```

- `viewportImage` and `cropImage` are always present as one branch of this union. Never use omission or `null` to represent an intentional degraded capture.
- Captured data must be a valid PNG data URL and remains subject to body and per-image limits.
- Missing reasons use stable, extensible codes, initially covering screenshot failure, crop failure, and source disconnection. Include the number of attempts and, when useful, a bounded and sanitized diagnostic message.
- Consumers derive degraded state from nested missing results. This makes user-confirmed incomplete delivery distinguishable from malformed payload loss.

#### Pi-facing presentation

- Render v2 as chronological Markdown that mirrors the payload tree: overall URL and Context first, followed by **Step 1…N** in array order.
- For each step, show its URL and viewport, then write its viewport PNG to a uniquely named temporary file or show its missing reason.
- Under that step, render **Element 1…N** with metadata, comment, a prominent **Historical** marker when applicable, and its adjacent crop file path or missing reason.
- After the ordered steps, render root-level Etch finalization failures under **Capture warnings**, followed by Etch captures in recording order under **Captured edits**. For a zero-step result, show the root URL, Context, and any capture warnings or captured edits.
- Include step and element positions in temporary image filenames. Opaque IDs need not clutter normal prose.
- Surface local image decode or filesystem-write failures as formatter warnings beside the owning image; never reassign or silently omit an asset.

This contract makes each v2 Interaction step's visual evidence self-contained, preserves associations without positional screenshot joins, keeps draft-level captured edits simple, and lets independently updated annotators and Pi consumers migrate safely through the existing opaque broker.

The draft-level `etchCaptures` list supersedes the earlier step-local Etch proposal and was approved with the consolidated interaction-mode specification on 2026-07-30. The additive `etchWarnings` field was documented during implementation repair so submit-time finalization failures remain visible to Pi.
