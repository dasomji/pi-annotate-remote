import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import registerPiAnnotate from "../index.ts";
import { AnnotationSessionClient } from "../broker/client.js";

const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=";

function deferred() {
  let resolve;
  const promise = new Promise((settle) => { resolve = settle; });
  return { promise, resolve };
}

function annotation() {
  const image = {
    status: "captured",
    mediaType: "image/png",
    dataUrl: PNG_DATA_URL,
  };
  return {
    schemaVersion: 2,
    success: true,
    url: "https://example.test/editor",
    context: "Hold formatting across session replacement",
    steps: [{
      id: "step-a",
      url: "https://example.test/editor",
      viewport: { width: 1280, height: 720 },
      viewportImage: image,
      elements: [{
        id: "element-a",
        historical: false,
        comment: "Do not deliver this to the replacement session",
        metadata: {
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
        },
        cropImage: image,
      }],
    }],
  };
}

async function stopBroker(lockPath) {
  try {
    const pid = Number.parseInt(fs.readFileSync(lockPath, "utf8").trim(), 10);
    if (Number.isInteger(pid) && pid > 0) process.kill(pid, "SIGTERM");
  } catch {}

  const deadline = Date.now() + 1_500;
  while (Date.now() < deadline && fs.existsSync(lockPath)) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test("session shutdown prevents in-flight annotations from touching the stale Pi runtime", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pi-annotate-lifecycle-test-"));
  const runtimeDir = path.join(directory, "runtime");
  const stateDir = path.join(directory, "state");
  const lockPath = path.join(runtimeDir, "broker.lock");
  const previousEnv = {
    PI_ANNOTATE_RUNTIME_DIR: process.env.PI_ANNOTATE_RUNTIME_DIR,
    PI_ANNOTATE_STATE_DIR: process.env.PI_ANNOTATE_STATE_DIR,
    PI_ANNOTATE_PORT: process.env.PI_ANNOTATE_PORT,
    PI_ANNOTATE_TAILSCALE: process.env.PI_ANNOTATE_TAILSCALE,
  };
  Object.assign(process.env, {
    PI_ANNOTATE_RUNTIME_DIR: runtimeDir,
    PI_ANNOTATE_STATE_DIR: stateDir,
    PI_ANNOTATE_PORT: "0",
    PI_ANNOTATE_TAILSCALE: "off",
  });

  const originalEnable = AnnotationSessionClient.prototype.enable;
  const originalWriteFile = fs.promises.writeFile;
  let client;
  let runtimeIsLive = true;
  const staleCalls = [];
  const handlers = new Map();
  let annotateTool;

  function requireLive(operation) {
    if (runtimeIsLive) return;
    staleCalls.push(operation);
    throw new Error(`stale Pi runtime used by ${operation}`);
  }

  try {
    AnnotationSessionClient.prototype.enable = async function enableWithoutRegistration() {
      client = this;
      this.enabled = true;
      this.registered = true;
      this.name = "Ada";
      this.label = `${this.baseLabel} · Ada`;
      await this.ensureBroker();
      return { name: this.name, label: this.label };
    };

    registerPiAnnotate({
      registerCommand() {},
      registerTool(tool) { annotateTool = tool; },
      on(eventName, handler) { handlers.set(eventName, handler); },
      sendUserMessage() { requireLive("pi.sendUserMessage"); },
    });

    const context = {
      hasUI: false,
      isIdle() {
        requireLive("ctx.isIdle");
        return true;
      },
      ui: {
        notify() { requireLive("ctx.ui.notify"); },
        setStatus() { requireLive("ctx.ui.setStatus"); },
      },
    };
    const enabled = await annotateTool.execute("tool-call", {}, undefined, undefined, context);
    assert.match(enabled.content[0].text, /Annotation session is available/);
    assert.ok(client, "the extension did not create its annotation client");

    const formattingStarted = deferred();
    const releaseFormatting = deferred();
    fs.promises.writeFile = async () => {
      formattingStarted.resolve();
      await releaseFormatting.promise;
    };

    const socket = {
      destroyed: false,
      destroy() { this.destroyed = true; },
      write() {},
    };
    client.socket = socket;
    client.enqueueAnnotation(socket, {
      type: "annotation",
      deliveryId: "delivery-lifecycle-test",
      annotation: annotation(),
    });
    await formattingStarted.promise;

    await handlers.get("session_shutdown")({ reason: "reload" }, context);
    runtimeIsLive = false;
    releaseFormatting.resolve();
    await client.annotationQueue;

    assert.deepEqual(staleCalls, []);
  } finally {
    runtimeIsLive = true;
    AnnotationSessionClient.prototype.enable = originalEnable;
    fs.promises.writeFile = originalWriteFile;
    for (const [name, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await stopBroker(lockPath);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
