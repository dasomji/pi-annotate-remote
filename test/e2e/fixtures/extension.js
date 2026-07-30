import { test as base, chromium, expect } from "@playwright/test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const EXTENSION_SOURCE = path.join(REPO_ROOT, "chrome-extension");
const SESSION_ID = "e2e-session-0001";
const BROKER_TOKEN = "e2e-broker-token";

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify(body));
}

function pageMarkup(origin) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Pi Annotate E2E workflow</title>
    <style>
      body { font: 16px system-ui; margin: 40px; }
      main { display: grid; gap: 18px; max-width: 720px; }
      button, a, input { font: inherit; padding: 10px; }
      button:focus-visible, a:focus-visible { outline: 4px solid rgb(0 95 204); }
      #transient[hidden] { display: none; }
      #transient { padding: 24px; border: 2px solid #6d28d9; }
    </style>
  </head>
  <body>
    <main>
      <h1>Workflow fixture</h1>
      <button id="state-one" type="button">State one target</button>
      <label>Site input <input id="site-input" autocomplete="off"></label>
      <button id="open-transient" type="button">Open transient state</button>
      <section id="transient" role="dialog" aria-label="Transient site UI" hidden>
        <button id="state-two" type="button">State two target</button>
        <button id="close-transient" type="button">Close transient state</button>
      </section>
      <button id="mutate" type="button">Mutate page</button>
      <output id="mutation-log"></output>
      <a id="same-tab-route" href="${origin}/destination?source=same-tab">Same-tab destination</a>
      <form id="post-route" method="post" action="${origin}/destination?source=post-form">
        <input name="workflow" value="preserve-this-body">
        <button type="submit">POST-form destination</button>
      </form>
      <a id="new-target-route" href="${origin}/destination?source=new-target" target="_blank">New-target destination</a>
      <button id="reload-page" type="button">Reload page</button>
    </main>
    <script>
      let mutationNumber = 0;
      document.querySelector("#open-transient").addEventListener("click", () => {
        document.querySelector("#transient").hidden = false;
      });
      document.querySelector("#close-transient").addEventListener("click", () => {
        document.querySelector("#transient").hidden = true;
      });
      document.querySelector("#mutate").addEventListener("click", () => {
        mutationNumber += 1;
        document.querySelector("#mutation-log").textContent = "mutation-" + mutationNumber;
      });
      document.querySelector("#reload-page").addEventListener("click", () => location.reload());
    </script>
  </body>
</html>`;
}

async function startFixtureServer() {
  const state = {
    annotations: [],
    annotationAttempts: 0,
    failDeliveries: 0,
    destinationRequests: [],
  };

  const server = createServer(async (request, response) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const url = new URL(request.url, origin);

    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Origin": "*",
      });
      response.end();
      return;
    }

    if (request.method === "GET" && url.pathname === "/workflow") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(pageMarkup(origin));
      return;
    }

    if (["GET", "POST"].includes(request.method) && url.pathname === "/destination") {
      state.destinationRequests.push({
        method: request.method,
        search: url.search,
        body: request.method === "POST" ? await readBody(request) : "",
      });
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end("<!doctype html><title>Destination</title><h1>Destination reached</h1>");
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/sessions") {
      sendJson(response, 200, { sessions: [{ id: SESSION_ID, label: "E2E session" }] });
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === `/v1/sessions/${SESSION_ID}/annotations`
    ) {
      state.annotationAttempts += 1;
      let annotation;
      try {
        annotation = JSON.parse(await readBody(request));
      } catch {
        sendJson(response, 400, { error: { message: "Fixture received invalid JSON" } });
        return;
      }
      state.annotations.push(annotation);
      if (state.failDeliveries > 0) {
        state.failDeliveries -= 1;
        sendJson(response, 503, { error: { message: "Intentional E2E delivery failure" } });
      } else {
        sendJson(response, 200, { delivered: true });
      }
      return;
    }

    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("Not found");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    state,
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve())
      );
    },
  };
}

async function makeTestExtension() {
  const root = await mkdtemp(path.join(tmpdir(), "pi-annotate-e2e-"));
  const extensionPath = path.join(root, "extension");
  await cp(EXTENSION_SOURCE, extensionPath, { recursive: true });

  const manifestPath = path.join(extensionPath, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.host_permissions = [
    ...new Set([...(manifest.host_permissions || []), "<all_urls>"]),
  ];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { root, extensionPath };
}

export const test = base.extend({
  context: async ({ headless }, use) => {
    const extension = await makeTestExtension();
    const userDataDir = path.join(extension.root, "profile");
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless,
      args: [
        `--disable-extensions-except=${extension.extensionPath}`,
        `--load-extension=${extension.extensionPath}`,
      ],
    });

    try {
      await use(context);
    } finally {
      await context.close();
      await rm(extension.root, { recursive: true, force: true });
    }
  },

  fixtureServer: async ({}, use) => {
    const fixtureServer = await startFixtureServer();
    try {
      await use(fixtureServer);
    } finally {
      await fixtureServer.close();
    }
  },

  extensionWorker: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    worker ||= await context.waitForEvent("serviceworker");
    await use(worker);
  },

  extensionId: async ({ extensionWorker }, use) => {
    await use(new URL(extensionWorker.url()).host);
  },

  workflow: async ({ context, extensionWorker, fixtureServer }, use) => {
    const pages = context.pages();
    const page = pages[0] || await context.newPage();
    await page.goto(`${fixtureServer.origin}/workflow`);

    await extensionWorker.evaluate(async ({ endpoint, token, sessionId }) => {
      await chrome.storage.local.set({
        brokerEndpoint: endpoint,
        brokerToken: token,
        selectedSessionId: sessionId,
      });
    }, {
      endpoint: fixtureServer.origin,
      token: BROKER_TOKEN,
      sessionId: SESSION_ID,
    });

    const startResponse = await extensionWorker.evaluate(
      async (sessionId) => startAnnotation(sessionId),
      SESSION_ID,
    );
    if (!startResponse?.started) {
      throw new Error(`Background failed to start annotator: ${JSON.stringify(startResponse)}`);
    }

    await expect(page.locator("#pi-panel")).toBeVisible();
    await use({
      page,
      server: fixtureServer,
      sessionId: SESSION_ID,
    });
  },
});

export { expect };
