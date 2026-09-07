import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { isAnnotationResult } from "../annotation/validate.ts";
import { capturedImage, metadata } from "./helpers/annotation.js";

function createDraft() {
  const window = {};
  vm.runInNewContext(readFileSync(new URL("../chrome-extension/content-draft.js", import.meta.url), "utf8"), {
    chrome: { runtime: { id: "draft-test" } }, window,
  });
  let nextId = 0;
  return window["__piAnnotateModules_draft-test"].draft.createDraft({ createId: () => `id-${++nextId}` });
}

const viewport = { width: 1200, height: 800 };
const url = "https://example.test/editor";
const images = () => ({ viewportImage: capturedImage(), cropImage: capturedImage() });
const missing = (attempts) => ({ status: "missing", reason: "screenshot_failure", attempts });
const failures = (attempts) => ({ viewportImage: missing(attempts), cropImage: missing(attempts) });
const stage = (draft, sourceNode, evidence = metadata()) => draft.stageElement({ sourceNode, metadata: evidence, url, viewport });
const begin = (draft, id, sourceNode, overrides = {}) => draft.beginElementCapture({
  id, sourceNode, cropRect: metadata().rect, url, viewport, ...overrides,
});
function result(draft) {
  const value = structuredClone(draft.toAnnotationResult({ url }));
  assert.equal(isAnnotationResult(value), true, "the receiver must accept every delivered draft");
  return value;
}

test("staging freezes click evidence, blocks submission until Send, and uses Send-time viewport", () => {
  const draft = createDraft();
  const node = { isConnected: true };
  draft.setContext("General context");
  draft.armStepBoundary();
  assert.equal(result(draft).steps.length, 0);
  const evidence = metadata();
  const staged = stage(draft, node, evidence);
  evidence.text = "Changed after click";
  assert.equal(draft.hasPendingEvidence(), true);
  assert.throws(() => result(draft), /Send every/);
  const transaction = begin(draft, staged.id, node, {
    url: `${url}?sent`, viewport: { width: 800, height: 600 },
  });
  assert.throws(() => result(draft), /Send every/);
  draft.commitCapture(transaction, images());
  const [step] = result(draft).steps;
  assert.equal(step.elements[0].metadata.text, "Save");
  assert.equal(step.url, `${url}?sent`);
  assert.deepEqual(step.viewport, { width: 800, height: 600 });
  assert.equal(draft.hasPendingEvidence(), false);
});

test("source identity focuses and restores within a step, but can appear again after Resume", () => {
  const draft = createDraft();
  const node = { isConnected: true };
  const first = stage(draft, node);
  assert.equal(stage(draft, node).id, first.id);
  draft.softDelete(first.id);
  assert.equal(stage(draft, node).restored, true);
  assert.equal(draft.snapshot().canUndo, false);
  const tx = begin(draft, first.id, node);
  assert.equal(stage(draft, { isConnected: true }).status, "busy");
  assert.equal(draft.armStepBoundary(), false);
  draft.commitCapture(tx, images());
  draft.armStepBoundary();
  const later = stage(draft, node);
  assert.notEqual(later.id, first.id);
  draft.commitCapture(begin(draft, later.id, node), images());
  assert.deepEqual(result(draft).steps.map(step => step.elements[0].id), [first.id, later.id]);
});

test("retries refresh screenshot geometry, retain click metadata, and reject stale completions", () => {
  const draft = createDraft();
  const node = { isConnected: true };
  const { id } = stage(draft, node);
  const first = begin(draft, id, node);
  assert.equal(draft.commitCapture(first, failures(1)).status, "failed");
  assert.equal(begin(draft, id, { isConnected: true }).status, "busy");
  const rect = { x: 50, y: 60, width: 70, height: 80 };
  const retry = begin(draft, id, node, { cropRect: rect, url: `${url}?retry` });
  rect.x = 999;
  assert.equal(retry.cropRect.x, 50);
  assert.equal(retry.attempt, 2);
  assert.throws(() => draft.commitCapture(first, images()), /stale/);
  draft.commitIncomplete(retry, failures(2));
  const [step] = result(draft).steps;
  assert.equal(step.elements[0].metadata.text, "Save");
  assert.equal(step.url, `${url}?retry`);
  assert.deepEqual(step.viewportImage, missing(2));
  const other = { isConnected: true };
  const later = stage(draft, other);
  draft.commitCapture(begin(draft, later.id, other), images());
  assert.deepEqual(result(draft).steps[0].viewportImage, missing(2), "later images must not replace the representative viewport");
});

test("retry limits and disconnected sources require explicit incomplete evidence", () => {
  const draft = createDraft();
  const node = { isConnected: true };
  const { id } = stage(draft, node);
  const first = begin(draft, id, node);
  draft.commitCapture(first, failures(1));
  node.isConnected = false;
  assert.equal(begin(draft, id, node).status, "source-disconnected");
  node.isConnected = true;
  draft.commitCapture(begin(draft, id, node), failures(2));
  const third = begin(draft, id, node);
  draft.commitCapture(third, failures(3));
  assert.equal(begin(draft, id, node).status, "attempts-exhausted");
  assert.throws(() => draft.commitIncomplete(third, failures(2)), /attempt/i);
  node.isConnected = false;
  draft.commitIncomplete(third, failures(3));
  assert.equal(result(draft).steps[0].elements[0].historical, true);
});

test("retarget replaces frozen metadata, prevents duplicate targets, and preserves the step viewport", () => {
  const draft = createDraft();
  const source = { isConnected: true }, target = { isConnected: true }, other = { isConnected: true };
  const first = stage(draft, source), second = stage(draft, other);
  draft.commitCapture(begin(draft, first.id, source), images());
  draft.commitCapture(begin(draft, second.id, other), images());
  assert.equal(draft.retargetElement({ id: first.id, sourceNode: other, metadata: metadata() }).status, "target-already-annotated");
  assert.equal(draft.retargetElement({ id: first.id, sourceNode: target, metadata: metadata({ text: "Retargeted" }) }).status, "retargeted");
  assert.throws(() => result(draft), /Send every/);
  draft.commitCapture(begin(draft, first.id, target, { url: `${url}?later` }), images());
  const [step] = result(draft).steps;
  assert.equal(step.elements[0].metadata.text, "Retargeted");
  assert.equal(step.url, url);
  draft.armStepBoundary();
  assert.equal(draft.retargetElement({ id: first.id, sourceNode: source, metadata: metadata() }).status, "step-closed");
});

test("delete and Undo preserve order and pending evidence; liveness follows the exact node", () => {
  const draft = createDraft();
  const node = { isConnected: true };
  const first = stage(draft, node);
  draft.commitCapture(begin(draft, first.id, node), images());
  draft.armStepBoundary();
  const other = { isConnected: true }, second = stage(draft, other);
  draft.softDelete(first.id);
  draft.softDelete(second.id);
  draft.setContext("Keep this draft");
  assert.equal(result(draft).steps.length, 0);
  assert.equal(draft.hasRecoverableWork(), true);
  assert.equal(draft.undo().id, second.id);
  assert.equal(draft.hasPendingEvidence(), true);
  assert.equal(draft.undo().id, first.id);
  draft.commitCapture(begin(draft, second.id, other), images());
  node.isConnected = false;
  assert.equal(result(draft).steps[0].elements[0].historical, true);
  node.isConnected = true;
  assert.equal(result(draft).steps[0].elements[0].historical, false);
  assert.deepEqual(result(draft).steps.map(step => step.elements[0].id), [first.id, second.id]);
});

test("discard reopens pending work; snapshots cannot mutate it and purge invalidates captures", () => {
  const draft = createDraft();
  assert.equal(draft.hasRecoverableWork(), false);
  assert.throws(() => result(draft), /context/i);
  const node = { isConnected: true }, { id } = stage(draft, node);
  const tx = begin(draft, id, node);
  draft.discardCapture(tx);
  assert.equal(draft.hasPendingEvidence(), true);
  draft.updateComment(id, "Original");
  draft.addEtchWarning("Capture unavailable");
  draft.softDelete(id);
  const snapshot = draft.snapshot();
  snapshot.deleted[0].comment = "Modified";
  snapshot.deleted[0].metadata.text = "Modified";
  snapshot.etchWarnings.push("Modified");
  draft.undo();
  const fresh = draft.snapshot();
  assert.equal(fresh.steps[0].elements[0].comment, "Original");
  assert.equal(fresh.steps[0].elements[0].metadata.text, "Save");
  assert.equal(fresh.etchWarnings.length, 1);
  const pending = begin(draft, id, node);
  draft.purge();
  assert.throws(() => draft.commitCapture(pending, images()), /stale/);
  assert.equal(draft.hasRecoverableWork(), false);
});
