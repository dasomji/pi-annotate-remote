import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "./fixtures/extension.js";
import { annotate, submitAnnotation } from "./helpers/annotation.js";
import { createBroker } from "../../broker/server.js";
import { registerPiAnnotate } from "../../index.ts";
import { createAnnotationFormatter } from "../../annotation/format.ts";

// Browser -> HTTP broker -> IPC client -> validation/formatting -> Pi follow-up -> acknowledgement.
test("real broker acknowledges only after the browser annotation reaches Pi", async ({ context, extensionWorker, fixtureServer }) => {
  const directory = await mkdtemp(join(tmpdir(), "annotate-delivery-e2e-"));
  const config = { host: "127.0.0.1", port: 0, socketPath: join(directory, "broker.sock") };
  const token = "real-broker-e2e-token";
  const broker = createBroker({ ...config, token });
  const handlers = new Map(), messages = [];
  let annotateTool, release;
  const held = new Promise(resolve => { release = resolve; });
  let writing = false;
  try {
    const address = await broker.start();
    const endpoint = `http://${address.host}:${address.port}`;
    registerPiAnnotate({
      registerCommand() {},
      registerTool(tool) { annotateTool = tool; },
      on(name, handler) { handlers.set(name, handler); },
      sendUserMessage(content, options) { messages.push({ content, options }); },
    }, {
      config,
      ensureBroker: async () => token,
      ensureServe: async () => ({ active: false, endpoint: null, localEndpoint: endpoint }),
      formatAnnotation: createAnnotationFormatter(async (filename) => {
        writing = true;
        await held;
        return join(directory, filename);
      }),
    });
    const enabled = await annotateTool.execute("enable", {}, undefined, undefined, { hasUI: false });
    const page = context.pages()[0] || await context.newPage();
    await page.goto(`${fixtureServer.origin}/workflow`);
    await extensionWorker.evaluate(async ({ endpoint, token, sessionId }) => {
      await chrome.storage.local.set({ brokerEndpoint: endpoint, brokerToken: token });
      const response = await startAnnotation(sessionId);
      if (!response.started) throw new Error(JSON.stringify(response));
    }, { endpoint, token, sessionId: enabled.details.sessionId });
    await annotate(page, "#state-one", "Deliver this through Pi");
    await submitAnnotation(page);
    await expect.poll(() => writing).toBe(true);
    expect(messages).toHaveLength(0);
    await expect(page.locator("#pi-panel")).toBeVisible();
    release();
    await expect(page.locator("#pi-panel")).toHaveCount(0);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain("Deliver this through Pi");
    expect(messages[0].options).toEqual({ deliverAs: "followUp" });
  } finally {
    release();
    await handlers.get("session_shutdown")?.();
    await broker.close();
    await rm(directory, { recursive: true, force: true });
  }
});
