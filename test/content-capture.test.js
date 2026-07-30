import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const captureSource = readFileSync(
  new URL("../chrome-extension/content-capture.js", import.meta.url),
  "utf8",
);

const PNG = "data:image/png;base64,iVBORw0KGgo=";

function createHarness({
  decodeFails = false,
  contextAvailable = true,
  imageWidth = 2400,
  imageHeight = 1600,
} = {}) {
  const drawCalls = [];
  let canvas;

  class FakeImage {
    set src(_value) {
      queueMicrotask(() => {
        if (decodeFails) this.onerror?.(new Error("decode failed"));
        else {
          this.width = imageWidth;
          this.height = imageHeight;
          this.onload?.();
        }
      });
    }
  }

  const document = {
    createElement(tag) {
      assert.equal(tag, "canvas");
      const context = contextAvailable ? {
        drawImage(...args) { drawCalls.push(args); },
      } : null;
      canvas = {
        width: 0,
        height: 0,
        getContext(type) {
          assert.equal(type, "2d");
          return context;
        },
        toDataURL(type) {
          assert.equal(type, "image/png");
          return "data:image/png;base64,cropped";
        },
      };
      return canvas;
    },
  };
  const window = { devicePixelRatio: 99, innerWidth: 1, innerHeight: 1 };
  const context = vm.createContext({
    chrome: { runtime: { id: "capture-test" } },
    document,
    Error,
    Image: FakeImage,
    Math,
    Promise,
    queueMicrotask,
    window,
  });
  vm.runInContext(captureSource, context, { filename: "content-capture.js" });
  return {
    capture: window["__piAnnotateModules_capture-test"].capture,
    drawCalls,
    get canvas() { return canvas; },
  };
}

test("cropToRect uses only frozen click-time geometry and returns an explicit captured image", async () => {
  const harness = createHarness();
  const result = await harness.capture.cropToRect(PNG, {
    rect: { x: 10, y: 20, width: 30, height: 40 },
    viewport: { width: 1200, height: 800 },
    dpr: 2,
  });

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    status: "captured",
    mediaType: "image/png",
    dataUrl: "data:image/png;base64,cropped",
  });
  assert.equal(harness.canvas.width, 120);
  assert.equal(harness.canvas.height, 160);
  assert.deepEqual(harness.drawCalls[0].slice(1), [
    0, 0, 120, 160, 0, 0, 120, 160,
  ]);
});

test("cropToRect rejects decode, canvas, and invalid frozen-geometry failures", async () => {
  await assert.rejects(
    createHarness({ decodeFails: true }).capture.cropToRect(PNG, {
      rect: { x: 0, y: 0, width: 10, height: 10 },
      viewport: { width: 100, height: 100 },
      dpr: 1,
    }),
    /decode/,
  );
  await assert.rejects(
    createHarness({ contextAvailable: false }).capture.cropToRect(PNG, {
      rect: { x: 0, y: 0, width: 10, height: 10 },
      viewport: { width: 100, height: 100 },
      dpr: 1,
    }),
    /canvas/i,
  );
  await assert.rejects(
    createHarness().capture.cropToRect(PNG, {
      rect: { x: 200, y: 200, width: 10, height: 10 },
      viewport: { width: 100, height: 100 },
      dpr: 1,
    }),
    /outside|geometry/i,
  );
  await assert.rejects(
    createHarness({ imageWidth: 10, imageHeight: 10 }).capture.cropToRect(PNG, {
      rect: { x: 50, y: 50, width: 10, height: 10 },
      viewport: { width: 100, height: 100 },
      dpr: 2,
    }),
    /bitmap/i,
  );
});

test("captured and missing image factories enforce the schema-v2 image union", () => {
  const { capture } = createHarness();
  assert.deepEqual(
    JSON.parse(JSON.stringify(capture.capturedImage(PNG))),
    { status: "captured", mediaType: "image/png", dataUrl: PNG },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(capture.missingImage(
      "crop_failure",
      2,
      "canvas unavailable",
    ))),
    {
      status: "missing",
      reason: "crop_failure",
      attempts: 2,
      message: "canvas unavailable",
    },
  );
  assert.throws(() => capture.capturedImage("data:image/jpeg;base64,bad"), /PNG/);
  assert.throws(() => capture.missingImage("unknown", 1), /reason/);
  assert.throws(() => capture.missingImage("crop_failure", 4), /attempt/);
});
