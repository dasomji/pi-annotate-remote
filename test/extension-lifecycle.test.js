import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { registerPiAnnotate } from "../index.ts";
import { createBroker } from "../broker/server.js";
import { createAnnotationFormatter } from "../annotation/format.ts";
import { v2Result } from "./helpers/annotation.js";

function deferred() {
  let resolve;
  const promise = new Promise((settle) => { resolve = settle; });
  return { promise, resolve };
}

test("session shutdown prevents in-flight annotations from touching the stale Pi runtime", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pi-annotate-lifecycle-"));
  const token = "lifecycle-test-broker-token";
  const config = { host: "127.0.0.1", port: 0, socketPath: join(directory, "broker.sock") };
  const broker = createBroker({ ...config, token });
  const address = await broker.start();
  const endpoint = `http://${address.host}:${address.port}`;
  const formattingStarted = deferred(), releaseFormatting = deferred(), formattingFinished = deferred();
  const handlers = new Map();
  const staleCalls = [];
  let runtimeIsLive = true;
  let annotateTool;
  t.after(async () => {
    releaseFormatting.resolve();
    await handlers.get("session_shutdown")?.();
    await broker.close();
    await rm(directory, { recursive: true, force: true });
  });
  function requireLive(operation) {
    if (!runtimeIsLive) staleCalls.push(operation);
  }
  const formatter = createAnnotationFormatter(async (filename) => {
    formattingStarted.resolve();
    await releaseFormatting.promise;
    return join(directory, filename);
  });
  registerPiAnnotate({
    registerCommand() {},
    registerTool(tool) { annotateTool = tool; },
    on(name, handler) { handlers.set(name, handler); },
    sendUserMessage() { requireLive("sendUserMessage"); },
  }, {
    config,
    ensureBroker: async () => token,
    ensureServe: async () => ({ active: false, endpoint: null, localEndpoint: endpoint }),
    formatAnnotation: async (value) => {
      try { return await formatter(value); }
      finally { formattingFinished.resolve(); }
    },
  });
  const enabled = await annotateTool.execute("tool-call", {}, undefined, undefined, {
    hasUI: false,
    ui: {
      notify() { requireLive("notify"); },
      setStatus() { requireLive("setStatus"); },
    },
  });
  assert.match(enabled.content[0].text, /Annotation session is available/);
  const delivery = fetch(`${endpoint}/v1/sessions/${enabled.details.sessionId}/annotations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(v2Result()),
  });
  await formattingStarted.promise;
  await handlers.get("session_shutdown")();
  runtimeIsLive = false;
  releaseFormatting.resolve();
  await formattingFinished.promise;
  assert.equal((await delivery).status, 503);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(staleCalls, []);
});
