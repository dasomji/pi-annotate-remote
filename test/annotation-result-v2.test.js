import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import test from "node:test";
import {
  formatAnnotationResult,
  isAnnotationResult,
} from "../index.ts";

const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=";

function metadata(overrides = {}) {
  return {
    selector: "#save",
    tag: "button",
    id: "save",
    classes: ["primary"],
    text: "Save",
    rect: { x: 10, y: 20, width: 80, height: 32 },
    attributes: { type: "button" },
    boxModel: {
      content: { width: 76, height: 28 },
      padding: { top: 2, right: 2, bottom: 2, left: 2 },
      border: { top: 0, right: 0, bottom: 0, left: 0 },
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    },
    accessibility: {
      role: "button",
      name: "Save",
      description: null,
      focusable: true,
      disabled: false,
    },
    keyStyles: { display: "inline-block" },
    ...overrides,
  };
}

function capturedImage() {
  return {
    status: "captured",
    mediaType: "image/png",
    dataUrl: PNG_DATA_URL,
  };
}

function v2Result(overrides = {}) {
  return {
    schemaVersion: 2,
    success: true,
    url: "https://example.test/editor",
    context: "The save state is confusing",
    steps: [{
      id: "step-a",
      url: "https://example.test/editor",
      viewport: { width: 1280, height: 720 },
      viewportImage: capturedImage(),
      elements: [{
        id: "element-a",
        historical: false,
        comment: "Clarify this action",
        metadata: metadata(),
        cropImage: capturedImage(),
      }],
    }],
    ...overrides,
  };
}

test("authoritative validation accepts a complete schema-v2 annotation", () => {
  assert.equal(isAnnotationResult(v2Result()), true);
});

test("schema-v2 validation enforces delivery invariants while ignoring additive fields", () => {
  const additive = v2Result({ futureRootField: "ignored" });
  additive.steps[0].futureStepField = true;
  additive.steps[0].elements[0].futureElementField = { version: 3 };
  assert.equal(isAnnotationResult(additive), true);

  assert.equal(isAnnotationResult(v2Result({ success: false })), false);
  assert.equal(isAnnotationResult(v2Result({ steps: [], context: "   " })), false);

  const emptyStep = v2Result();
  emptyStep.steps[0].elements = [];
  assert.equal(isAnnotationResult(emptyStep), false);

  const duplicateId = v2Result();
  duplicateId.steps[0].elements[0].id = duplicateId.steps[0].id;
  assert.equal(isAnnotationResult(duplicateId), false);

  const omittedImage = v2Result();
  omittedImage.steps[0].viewportImage = null;
  assert.equal(isAnnotationResult(omittedImage), false);

  const wrongKnownField = v2Result();
  wrongKnownField.steps[0].elements[0].historical = "false";
  assert.equal(isAnnotationResult(wrongKnownField), false);

  const invalidPng = v2Result();
  invalidPng.steps[0].elements[0].cropImage.dataUrl =
    "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
  assert.equal(isAnnotationResult(invalidPng), false);

  const truncatedPng = v2Result();
  truncatedPng.steps[0].elements[0].cropImage.dataUrl =
    "data:image/png;base64,iVBORw0KGgo=";
  assert.equal(isAnnotationResult(truncatedPng), false);

  const incompleteMetadata = v2Result();
  delete incompleteMetadata.steps[0].elements[0].metadata.boxModel;
  assert.equal(isAnnotationResult(incompleteMetadata), false);

  assert.equal(isAnnotationResult(v2Result({
    etchCaptures: [{
      inlineStyles: [],
      rules: [],
      dom: [],
      duration: 0,
      changeCount: 0,
    }],
  })), false);

  assert.equal(isAnnotationResult({ ...v2Result(), schemaVersion: 99 }), false);
});

test("legacy payloads use a separate schema-v1 validation path", () => {
  const legacy = {
    success: true,
    url: "https://example.test/legacy",
    prompt: "Keep the flat presentation",
    elements: [{
      ...metadata(),
      comment: "Legacy element",
    }],
    screenshots: [{ index: 1, dataUrl: "data:image/png;base64,legacy" }],
    futureLegacyField: "ignored",
  };

  assert.equal(isAnnotationResult(legacy), true);
  assert.equal(isAnnotationResult({ ...legacy, schemaVersion: 1 }), true);
  assert.equal(isAnnotationResult({ ...legacy, prompt: 42 }), false);
  assert.equal(isAnnotationResult({
    schemaVersion: 2,
    ...legacy,
  }), false);
});

test("schema-v2 formatting mirrors step, element, and captured-edit chronology", async () => {
  const result = v2Result({
    steps: [{
      id: "step-first",
      url: "https://example.test/editor?state=first",
      viewport: { width: 800, height: 600 },
      viewportImage: {
        status: "missing",
        reason: "screenshot_failure",
        attempts: 3,
        message: "capture timed out",
      },
      elements: [{
        id: "element-first",
        historical: true,
        comment: "FIRST ELEMENT",
        metadata: metadata({ selector: "#first", text: "First" }),
        cropImage: {
          status: "missing",
          reason: "source_disconnected",
          attempts: 2,
        },
      }],
    }, {
      id: "step-second",
      url: "https://example.test/editor?state=second",
      viewport: { width: 1024, height: 768 },
      viewportImage: {
        status: "missing",
        reason: "screenshot_failure",
        attempts: 1,
      },
      elements: [{
        id: "element-second",
        historical: false,
        comment: "SECOND ELEMENT",
        metadata: metadata({ selector: "#second", text: "Second" }),
        cropImage: {
          status: "missing",
          reason: "crop_failure",
          attempts: 3,
          message: "outside bitmap",
        },
      }],
    }],
    etchCaptures: [{
      inlineStyles: [],
      rules: [],
      dom: [{
        type: "text",
        selector: "#status",
        detail: "CAPTURED EDIT LAST",
      }],
      duration: 400,
      changeCount: 1,
      beforeScreenshot: PNG_DATA_URL,
    }],
  });

  const output = await formatAnnotationResult(result);

  assert.match(output, /^## Workflow Annotation: https:\/\/example\.test\/editor/m);
  assert.match(output, /\*\*Context:\*\* The save state is confusing/);
  assert.match(output, /## Step 1\n[\s\S]*state=first[\s\S]*800×600/);
  assert.match(output, /### Element 1\n[\s\S]*\*\*Historical\*\*[\s\S]*FIRST ELEMENT/);
  assert.match(output, /Viewport image missing: screenshot_failure \(3 attempts\) — capture timed out/);
  assert.match(output, /Crop image missing: source_disconnected \(2 attempts\)/);
  assert.match(output, /## Captured edits/);
  const beforePath = output.match(/\*\*Before:\*\* (\/tmp\/\S+-capture1-before\.png)/)?.[1];
  assert.ok(beforePath, "captured-edit image path includes its chronological position");
  await unlink(beforePath);

  const first = output.indexOf("FIRST ELEMENT");
  const second = output.indexOf("SECOND ELEMENT");
  const edits = output.indexOf("CAPTURED EDIT LAST");
  assert.ok(first < second && second < edits);
});

test("legacy schema-v1 formatting keeps the existing flat Page Annotation presentation", async () => {
  const output = await formatAnnotationResult({
    schemaVersion: 1,
    success: true,
    url: "https://example.test/legacy",
    prompt: "LEGACY CONTEXT",
    viewport: { width: 640, height: 480 },
    elements: [{
      ...metadata({ selector: "#legacy", text: "Legacy" }),
      comment: "LEGACY ELEMENT",
    }],
  });

  assert.match(output, /^## Page Annotation: https:\/\/example\.test\/legacy/m);
  assert.match(output, /### Selected Elements \(1\)/);
  assert.match(output, /LEGACY CONTEXT/);
  assert.match(output, /LEGACY ELEMENT/);
  assert.doesNotMatch(output, /Workflow Annotation|## Step 1/);
});
