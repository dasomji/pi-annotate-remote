import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { metadata, capturedImage } from "./helpers/annotation.js";

function deferred() {
  let resolve;
  const promise = new Promise(settle => { resolve = settle; });
  return { promise, resolve };
}

function harness(captureImages) {
  const window = {};
  const context = vm.createContext({ window, chrome: { runtime: { id: "test" } } });
  for (const file of ["content-run.js", "content-draft.js", "content-capture.js", "content-capture-coordinator.js"]) {
    vm.runInContext(readFileSync(new URL(`../chrome-extension/${file}`, import.meta.url), "utf8"), context);
  }
  const modules = window.__piAnnotateModules_test;
  const run = modules.run.createAnnotationRun();
  let nextId = 0;
  let draft;
  const geometry = { url: "https://example.test/", viewport: { width: 800, height: 600 }, cropRect: metadata().rect };
  const failures = [], discarded = [];
  const coordinator = modules.captureCoordinator.createCaptureCoordinator({
    run, getDraft: () => draft, captureImages, readGeometry: () => geometry,
    onChange() {},
    onFailure(disconnected, attempt) { failures.push({ disconnected, attempt }); },
    onDiscard(id) { discarded.push(id); },
  });
  function start() {
    run.start("session");
    coordinator.reset();
    draft = modules.draft.createDraft({ createId: () => `id-${++nextId}` });
    const node = { isConnected: true };
    const { id } = draft.stageElement({ sourceNode: node, metadata: metadata(), ...geometry });
    return { draft, node, id };
  }
  return { start, coordinator, run, failures, discarded };
}
const images = () => ({ viewportImage: capturedImage(), cropImage: capturedImage() });

test("a replaced run ignores old screenshot completions and releases its navigation waiter", async () => {
  const oldCapture = deferred(), newCapture = deferred();
  let calls = 0;
  const h = harness(() => ++calls === 1 ? oldCapture.promise : newCapture.promise);
  const first = h.start();
  const oldSend = h.coordinator.send(first.id, first.node);
  const oldWaiter = h.coordinator.settled();
  const replacement = h.start();
  await oldWaiter;
  const newSend = h.coordinator.send(replacement.id, replacement.node);
  oldCapture.resolve(images());
  await oldSend;
  assert.equal(h.run.operation, "capturing");
  assert.equal(replacement.draft.hasPendingEvidence(), true);
  assert.equal(first.draft.hasPendingEvidence(), true);
  newCapture.resolve(images());
  await newSend;
  assert.equal(replacement.draft.hasPendingEvidence(), false);
  assert.equal(h.run.operation, "idle");
});

test("navigation waits through failed attempts until Retry captures the element", async () => {
  let calls = 0;
  const h = harness(async () => {
    if (++calls === 1) throw new Error("Screenshot failed");
    return images();
  });
  const { id, node, draft } = h.start();
  await h.coordinator.send(id, node);
  let settled = false;
  const waiting = h.coordinator.settled().then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.deepEqual(h.failures, [{ disconnected: false, attempt: 1 }]);
  await h.coordinator.retry();
  await waiting;
  assert.equal(draft.hasPendingEvidence(), false);
});

test("discard settles a failed capture and leaves its comment pending for another Send", async () => {
  const h = harness(async () => { throw new Error("Screenshot unavailable"); });
  const { id, node, draft } = h.start();
  draft.updateComment(id, "Do not lose this comment");
  await h.coordinator.send(id, node);
  const waiting = h.coordinator.settled();
  h.coordinator.discard();
  await waiting;
  assert.deepEqual(h.discarded, [id]);
  assert.equal(draft.snapshot().steps[0].elements[0].comment, "Do not lose this comment");
  assert.equal(draft.hasPendingEvidence(), true);
});
