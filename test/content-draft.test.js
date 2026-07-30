import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const draftSource = readFileSync(
  new URL("../chrome-extension/content-draft.js", import.meta.url),
  "utf8",
);

const PNG = "data:image/png;base64,iVBORw0KGgo=";

function captured(dataUrl = PNG) {
  return { status: "captured", mediaType: "image/png", dataUrl };
}

function missing(reason, attempts, message) {
  return {
    status: "missing",
    reason,
    attempts,
    ...(message ? { message } : {}),
  };
}

function metadata(label) {
  return {
    selector: `#${label}`,
    tag: "button",
    id: label,
    classes: [],
    text: label,
    rect: { x: 10, y: 20, width: 30, height: 40 },
    attributes: {},
  };
}

function createHarness() {
  const window = {};
  const context = vm.createContext({
    chrome: { runtime: { id: "draft-test" } },
    crypto: { randomUUID: () => "unused-random-id" },
    window,
  });
  vm.runInContext(draftSource, context, { filename: "content-draft.js" });

  let nextId = 0;
  const draft = window["__piAnnotateModules_draft-test"].draft.createDraft({
    createId: () => `opaque-${++nextId}`,
  });
  return { draft };
}

function begin(draft, sourceNode, label, overrides = {}) {
  return draft.beginCapture({
    sourceNode,
    metadata: metadata(label),
    url: `https://example.test/${label}`,
    viewport: { width: 1200, height: 800 },
    ...overrides,
  });
}

test("a step boundary stays lazy until its first element commits atomically", () => {
  const { draft } = createHarness();
  draft.armStepBoundary();
  draft.setContext("workflow context");

  assert.equal(draft.toAnnotationResult({
    url: "https://example.test/root",
  }).steps.length, 0);

  const transaction = begin(draft, { isConnected: true }, "save");
  assert.equal(draft.toAnnotationResult({
    url: "https://example.test/root",
  }).steps.length, 0);

  const committed = draft.commitCapture(transaction, {
    viewportImage: captured("data:image/png;base64,viewport"),
    cropImage: captured("data:image/png;base64,crop"),
  });

  assert.equal(committed.status, "committed");
  assert.deepEqual(
    JSON.parse(JSON.stringify(draft.toAnnotationResult({
      url: "https://example.test/root",
    }).steps)),
    [{
      id: "opaque-1",
      url: "https://example.test/save",
      viewport: { width: 1200, height: 800 },
      viewportImage: captured("data:image/png;base64,viewport"),
      elements: [{
        id: "opaque-2",
        historical: false,
        comment: "",
        metadata: metadata("save"),
        cropImage: captured("data:image/png;base64,crop"),
      }],
    }],
  );
});

test("capture is serialized and exact source identity is unique only within the current step", () => {
  const { draft } = createHarness();
  const source = { isConnected: true };
  const first = begin(draft, source, "first");

  assert.deepEqual(
    JSON.parse(JSON.stringify(begin(draft, { isConnected: true }, "ignored"))),
    { status: "busy" },
  );
  draft.commitCapture(first, {
    viewportImage: captured("data:image/png;base64,first-viewport"),
    cropImage: captured("data:image/png;base64,first-crop"),
  });

  assert.deepEqual(
    JSON.parse(JSON.stringify(begin(draft, source, "duplicate"))),
    { status: "focused", id: "opaque-2", restored: false },
  );
  draft.softDelete("opaque-2");
  assert.deepEqual(
    JSON.parse(JSON.stringify(begin(draft, source, "restore"))),
    { status: "focused", id: "opaque-2", restored: true },
  );

  draft.armStepBoundary();
  const later = begin(draft, source, "later");
  draft.commitCapture(later, {
    viewportImage: captured("data:image/png;base64,later-viewport"),
    cropImage: captured("data:image/png;base64,later-crop"),
  });

  const result = JSON.parse(JSON.stringify(draft.toAnnotationResult({
    url: "https://example.test/root",
  })));
  assert.deepEqual(result.steps.map((step) => ({
    id: step.id,
    elementIds: step.elements.map((element) => element.id),
  })), [
    { id: "opaque-1", elementIds: ["opaque-2"] },
    { id: "opaque-3", elementIds: ["opaque-4"] },
  ]);
});

test("a retry is a fresh frozen attempt and stale attempts cannot mix into its commit", () => {
  const { draft } = createHarness();
  const source = { isConnected: true };
  const firstMetadata = metadata("before");
  const first = draft.beginCapture({
    sourceNode: source,
    metadata: firstMetadata,
    cropRect: { x: 12, y: 24, width: 30, height: 40 },
    url: "https://example.test/before",
    viewport: { width: 800, height: 600 },
  });
  firstMetadata.text = "mutated after freeze";

  assert.equal(draft.commitCapture(first, {
    viewportImage: missing("screenshot_failure", 1),
    cropImage: missing("crop_failure", 1),
  }).status, "failed");

  const retry = begin(draft, source, "after", {
    cropRect: { x: 16, y: 32, width: 35, height: 45 },
    url: "https://example.test/after",
    viewport: { width: 1024, height: 768 },
  });
  assert.equal(retry.attempt, 2);
  assert.deepEqual(
    JSON.parse(JSON.stringify(retry.cropRect)),
    { x: 16, y: 32, width: 35, height: 45 },
  );
  assert.throws(() => draft.commitCapture(first, {
    viewportImage: captured(),
    cropImage: captured(),
  }), /stale/);

  draft.commitIncomplete(retry, {
    viewportImage: missing("screenshot_failure", 2, "fresh screenshot failed"),
    cropImage: missing("crop_failure", 2),
  });

  const [step] = JSON.parse(JSON.stringify(draft.toAnnotationResult({
    url: "https://example.test/root",
  }).steps));
  assert.equal(step.url, "https://example.test/after");
  assert.deepEqual(step.viewport, { width: 1024, height: 768 });
  assert.equal(step.elements[0].metadata.text, "after");
  assert.deepEqual(step.viewportImage, missing(
    "screenshot_failure",
    2,
    "fresh screenshot failed",
  ));

  const later = begin(draft, { isConnected: true }, "later");
  draft.commitCapture(later, {
    viewportImage: captured("data:image/png;base64,must-not-backfill"),
    cropImage: captured("data:image/png;base64,later-crop"),
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(draft.toAnnotationResult({
      url: "https://example.test/root",
    }).steps[0].viewportImage)),
    missing("screenshot_failure", 2, "fresh screenshot failed"),
  );
});

test("capture failure retries are bounded and disconnected sources cannot be freshly retried", () => {
  const { draft } = createHarness();
  const source = { isConnected: true };
  const first = begin(draft, source, "attempt-1");
  draft.commitCapture(first, {
    viewportImage: missing("screenshot_failure", 1),
    cropImage: missing("crop_failure", 1),
  });

  source.isConnected = false;
  assert.equal(begin(draft, source, "disconnected").status, "source-disconnected");
  source.isConnected = true;
  const second = begin(draft, source, "attempt-2");
  draft.commitCapture(second, {
    viewportImage: missing("screenshot_failure", 2),
    cropImage: missing("crop_failure", 2),
  });
  const third = begin(draft, source, "attempt-3");
  draft.commitCapture(third, {
    viewportImage: missing("screenshot_failure", 3),
    cropImage: missing("crop_failure", 3),
  });
  assert.equal(begin(draft, source, "attempt-4").status, "attempts-exhausted");

  assert.throws(() => draft.commitIncomplete(third, {
    viewportImage: missing("screenshot_failure", 2),
    cropImage: missing("crop_failure", 2),
  }), /attempt/i);
  source.isConnected = false;
  draft.commitIncomplete(third, {
    viewportImage: missing("screenshot_failure", 3),
    cropImage: missing("source_disconnected", 3),
  });
  const element = draft.toAnnotationResult({
    url: "https://example.test/root",
  }).steps[0].elements[0];
  assert.equal(element.metadata.text, "attempt-3");
  assert.equal(element.historical, true);
});

test("soft deletion keeps assets and positions undoable while liveness follows exact nodes", () => {
  const { draft } = createHarness();
  const firstNode = { isConnected: true };
  const lookalikeNode = { isConnected: true };
  const first = begin(draft, firstNode, "first");
  draft.commitCapture(first, {
    viewportImage: captured("data:image/png;base64,viewport"),
    cropImage: captured("data:image/png;base64,first"),
  });
  const second = begin(draft, lookalikeNode, "second");
  draft.commitCapture(second, {
    viewportImage: captured("data:image/png;base64,discarded-viewport"),
    cropImage: captured("data:image/png;base64,second"),
  });

  firstNode.isConnected = false;
  draft.refreshLiveness();
  let elements = JSON.parse(JSON.stringify(draft.toAnnotationResult({
    url: "https://example.test/root",
  }).steps[0].elements));
  assert.equal(elements[0].historical, true);
  assert.equal(elements[1].historical, false);

  draft.softDelete("opaque-2");
  draft.softDelete("opaque-3");
  draft.setContext("Keep an otherwise empty draft deliverable");
  assert.equal(draft.toAnnotationResult({
    url: "https://example.test/root",
  }).steps.length, 0);
  assert.equal(draft.hasRecoverableWork(), true);

  assert.deepEqual(
    JSON.parse(JSON.stringify(draft.undo())),
    { stepId: "opaque-1", id: "opaque-3" },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(draft.undo())),
    { stepId: "opaque-1", id: "opaque-2" },
  );
  elements = JSON.parse(JSON.stringify(draft.toAnnotationResult({
    url: "https://example.test/root",
  }).steps[0].elements));
  assert.deepEqual(elements.map(({ id, cropImage }) => ({ id, cropImage })), [
    { id: "opaque-2", cropImage: captured("data:image/png;base64,first") },
    { id: "opaque-3", cropImage: captured("data:image/png;base64,second") },
  ]);

  firstNode.isConnected = true;
  draft.refreshLiveness();
  assert.equal(draft.findBySource(firstNode).element.historical, false);
  assert.equal(draft.findBySource({ isConnected: true }), null);

  draft.purge();
  assert.equal(draft.hasRecoverableWork(), false);
  assert.equal(draft.findBySource(firstNode), null);
});

test("snapshot exposes renderable active/deleted state without exposing mutable draft internals", () => {
  const { draft } = createHarness();
  const sourceNode = { isConnected: true };
  const transaction = begin(draft, sourceNode, "render");
  draft.commitIncomplete(transaction, {
    viewportImage: captured("data:image/png;base64,viewport"),
    cropImage: missing("crop_failure", 1),
  });
  draft.updateComment("opaque-2", "Original comment");
  draft.setContext("Original context");
  draft.appendEtchCapture({ changeCount: 1 });
  draft.addEtchWarning("Etch finalization failed");
  draft.softDelete("opaque-2");

  const snapshot = draft.snapshot();
  assert.deepEqual(
    JSON.parse(JSON.stringify({
      context: snapshot.context,
      steps: snapshot.steps,
      deleted: snapshot.deleted.map(({ sourceNode: _sourceNode, ...record }) => record),
      etchCaptures: snapshot.etchCaptures,
      etchWarnings: snapshot.etchWarnings,
      canUndo: snapshot.canUndo,
      hasRecoverableWork: snapshot.hasRecoverableWork,
      hasMissingEvidence: snapshot.hasMissingEvidence,
      stepBoundaryArmed: snapshot.stepBoundaryArmed,
    })),
    {
      context: "Original context",
      steps: [],
      deleted: [{
        stepId: "opaque-1",
        stepIndex: 0,
        stepUrl: "https://example.test/render",
        stepViewport: { width: 1200, height: 800 },
        stepViewportImage: captured("data:image/png;base64,viewport"),
        elementIndex: 0,
        id: "opaque-2",
        historical: false,
        comment: "Original comment",
        metadata: metadata("render"),
        cropImage: missing("crop_failure", 1),
      }],
      etchCaptures: [{ changeCount: 1 }],
      etchWarnings: ["Etch finalization failed"],
      canUndo: true,
      hasRecoverableWork: true,
      hasMissingEvidence: false,
      stepBoundaryArmed: false,
    },
  );
  assert.equal(snapshot.deleted[0].sourceNode, sourceNode);

  snapshot.context = "Mutated projection";
  snapshot.deleted[0].comment = "Mutated projection";
  snapshot.etchWarnings.push("Mutated projection");
  const fresh = draft.snapshot();
  assert.equal(fresh.context, "Original context");
  assert.equal(fresh.deleted[0].comment, "Original comment");
  assert.deepEqual(
    JSON.parse(JSON.stringify(fresh.etchWarnings)),
    ["Etch finalization failed"],
  );
});

test("recoverable-work and schema-v2 projection enforce the dirty and zero-step rules", () => {
  const { draft } = createHarness();
  assert.equal(draft.hasRecoverableWork(), false);
  assert.equal(draft.setContext("   "), true);
  assert.equal(draft.hasRecoverableWork(), false);
  assert.throws(
    () => draft.toAnnotationResult({ url: "https://example.test/root" }),
    /zero-step/,
  );

  const provisional = begin(draft, { isConnected: true }, "provisional");
  assert.equal(draft.hasRecoverableWork(), true);
  draft.discardCapture(provisional);
  assert.equal(draft.hasRecoverableWork(), false);

  draft.appendEtchCapture({ changeCount: 1, dom: [{ type: "text" }] });
  assert.equal(draft.hasRecoverableWork(), true);
  assert.throws(
    () => draft.toAnnotationResult({ url: "https://example.test/root" }),
    /zero-step/,
  );
  draft.setContext("General context");
  assert.deepEqual(
    JSON.parse(JSON.stringify(draft.toAnnotationResult({
      url: "https://example.test/root",
    }))),
    {
      schemaVersion: 2,
      success: true,
      url: "https://example.test/root",
      context: "General context",
      steps: [],
      etchCaptures: [{ changeCount: 1, dom: [{ type: "text" }] }],
    },
  );

  draft.purge();
  const incomplete = begin(draft, { isConnected: false }, "historical");
  draft.commitIncomplete(incomplete, {
    viewportImage: missing("screenshot_failure", 1),
    cropImage: missing("source_disconnected", 1),
  });
  assert.equal(draft.hasMissingEvidence(), true);
  draft.softDelete("opaque-4");
  assert.equal(draft.hasMissingEvidence(), false);
  assert.equal(draft.hasRecoverableWork(), true);
});
