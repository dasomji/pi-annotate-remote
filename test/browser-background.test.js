import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const backgroundSource = readFileSync(new URL("../chrome-extension/background.js", import.meta.url), "utf8");
const EXTENSION_ID = "bpeadifabilnfpephegaodjbcjjfjghk";

function createHarness({ fetchImpl } = {}) {
  const storage = {};
  const fetchCalls = [];
  const tabMessages = [];
  const injected = [];
  const createdTabs = [];
  let messageListener;
  let externalMessageListener;
  let commandListener;
  let failFirstTabMessage = false;

  const chrome = {
    runtime: {
      id: EXTENSION_ID,
      lastError: null,
      getURL(path) {
        return `chrome-extension://${EXTENSION_ID}/${path}`;
      },
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        },
      },
      onMessageExternal: {
        addListener(listener) {
          externalMessageListener = listener;
        },
      },
    },
    commands: {
      onCommand: {
        addListener(listener) {
          commandListener = listener;
        },
      },
    },
    storage: {
      local: {
        async setAccessLevel() {},
        async get(keys) {
          return Object.fromEntries(keys.filter((key) => key in storage).map((key) => [key, storage[key]]));
        },
        async set(values) {
          Object.assign(storage, values);
        },
      },
    },
    permissions: {
      async remove() {
        return true;
      },
    },
    tabs: {
      async query() {
        return [{ id: 7, windowId: 3, url: "https://example.test/page" }];
      },
      async create(options) {
        createdTabs.push(JSON.parse(JSON.stringify(options)));
        return { id: 8, ...options };
      },
      async sendMessage(tabId, message) {
        if (failFirstTabMessage) {
          failFirstTabMessage = false;
          throw new Error("Receiving end does not exist");
        }
        tabMessages.push(JSON.parse(JSON.stringify({ tabId, message })));
      },
      captureVisibleTab(_windowId, _options, callback) {
        callback("data:image/png;base64,abc");
      },
    },
    scripting: {
      async executeScript(options) {
        injected.push(JSON.parse(JSON.stringify(options)));
      },
    },
  };

  const context = vm.createContext({
    AbortController,
    URL,
    chrome,
    clearTimeout,
    console,
    fetch: async (...args) => {
      fetchCalls.push(args);
      if (fetchImpl) return fetchImpl(...args);
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ sessions: [] });
        },
      };
    },
    setTimeout,
  });
  vm.runInContext(backgroundSource, context, { filename: "background.js" });

  async function send(message, sender = {}) {
    assert.equal(typeof messageListener, "function");
    return new Promise((resolve, reject) => {
      const keepAlive = messageListener(message, sender, (value) => {
        resolve(value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
      });
      if (!keepAlive) {
        setImmediate(() => resolve(undefined));
      }
      setTimeout(() => reject(new Error(`Timed out waiting for ${message.type}`)), 1_000);
    });
  }

  async function sendExternal(message, sender = {}) {
    assert.equal(typeof externalMessageListener, "function");
    return new Promise((resolve, reject) => {
      const keepAlive = externalMessageListener(message, sender, (value) => {
        resolve(value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
      });
      if (!keepAlive) setImmediate(() => resolve(undefined));
      setTimeout(() => reject(new Error(`Timed out waiting for external ${message.type}`)), 1_000);
    });
  }

  return {
    createdTabs,
    fetchCalls,
    injected,
    send,
    sendExternal,
    storage,
    tabMessages,
    setFailFirstTabMessage() {
      failFirstTabMessage = true;
    },
    triggerCommand(command) {
      commandListener(command);
    },
  };
}

async function configure(harness) {
  const response = await harness.send({
    type: "SAVE_BROKER_CONFIG",
    endpoint: "https://workstation.example.ts.net/",
    token: "secret-token",
  });
  assert.deepEqual(response, {
    endpoint: "https://workstation.example.ts.net",
    selectedSessionId: "",
  });
}

test("background stores broker config and lists only validated sessions", async () => {
  const harness = createHarness({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ sessions: [{ id: "session_abcdefghijkl", label: "shop (main)" }] });
      },
    }),
  });
  await configure(harness);

  const response = await harness.send({ type: "LIST_SESSIONS" });
  assert.deepEqual(response, {
    sessions: [{ id: "session_abcdefghijkl", label: "shop (main)" }],
    selectedSessionId: "",
  });
  assert.equal(harness.fetchCalls.length, 1);
  const [url, options] = harness.fetchCalls[0];
  assert.equal(url, "https://workstation.example.ts.net/v1/sessions");
  assert.equal(options.headers.Authorization, "Bearer secret-token");
});

test("background rejects insecure remote endpoints", async () => {
  const harness = createHarness();
  const response = await harness.send({
    type: "SAVE_BROKER_CONFIG",
    endpoint: "http://broker.example.com",
    token: "secret-token",
  });
  assert.match(response.error, /must use HTTPS/);
  assert.deepEqual(harness.storage, {});
});

test("starting annotation injects the content script and carries the selected opaque session ID", async () => {
  const harness = createHarness();
  await configure(harness);
  harness.setFailFirstTabMessage();

  const response = await harness.send({
    type: "START_ANNOTATION",
    sessionId: "session_abcdefghijkl",
  });
  assert.deepEqual(response, { started: true });
  assert.deepEqual(harness.injected, [{ target: { tabId: 7 }, files: ["content.js"] }]);
  assert.deepEqual(harness.tabMessages, [{
    tabId: 7,
    message: { type: "START_ANNOTATION", sessionId: "session_abcdefghijkl" },
  }]);
  assert.equal(harness.storage.selectedSessionId, "session_abcdefghijkl");
});

test("annotation delivery POSTs to exactly the selected session and waits for broker success", async () => {
  const harness = createHarness({
    fetchImpl: async () => ({
      ok: true,
      status: 202,
      async text() {
        return JSON.stringify({ delivered: true });
      },
    }),
  });
  await configure(harness);
  const result = { success: true, elements: [], prompt: "fix this" };

  const response = await harness.send({
    type: "ANNOTATIONS_COMPLETE",
    sessionId: "session_abcdefghijkl",
    result,
  }, { tab: { id: 7, windowId: 3 } });

  assert.deepEqual(response, { delivered: true });
  const [url, options] = harness.fetchCalls[0];
  assert.equal(url, "https://workstation.example.ts.net/v1/sessions/session_abcdefghijkl/annotations");
  assert.equal(options.method, "POST");
  assert.deepEqual(JSON.parse(options.body), result);
});

test("annotation delivery returns a bounded retryable error when the broker rejects it", async () => {
  const harness = createHarness({
    fetchImpl: async () => ({
      ok: false,
      status: 502,
      async text() {
        return JSON.stringify({ error: { message: `Pi rejected delivery\n${"x".repeat(500)}` } });
      },
    }),
  });
  await configure(harness);

  const response = await harness.send({
    type: "ANNOTATIONS_COMPLETE",
    sessionId: "session_abcdefghijkl",
    result: { success: true },
  });

  assert.match(response.error, /^Pi rejected delivery x+/);
  assert.ok(response.error.length <= 300);
  assert.equal(response.delivered, undefined);
});

test("external tailnet pairing requests open a trusted extension confirmation page", async () => {
  const harness = createHarness();
  const code = "a".repeat(43);

  const response = await harness.sendExternal({
    type: "PI_ANNOTATE_PAIR",
    code,
  }, {
    url: `https://workstation.example.ts.net/pair#${code}`,
  });

  assert.deepEqual(response, { accepted: true });
  assert.equal(harness.createdTabs.length, 1);
  const confirmation = new URL(harness.createdTabs[0].url);
  assert.equal(confirmation.protocol, "chrome-extension:");
  assert.equal(confirmation.host, EXTENSION_ID);
  assert.equal(confirmation.pathname, "/pair.html");
  const pairing = new URLSearchParams(confirmation.hash.slice(1));
  assert.equal(pairing.get("endpoint"), "https://workstation.example.ts.net");
  assert.equal(pairing.get("code"), code);

  const rejected = await harness.sendExternal({
    type: "PI_ANNOTATE_PAIR",
    code,
  }, {
    url: `https://malicious.example/pair#${code}`,
  });
  assert.match(rejected.error, /trusted Tailscale pairing page/);
  assert.equal(harness.createdTabs.length, 1);
});

test("trusted pairing confirmation exchanges the code and stores broker credentials", async () => {
  const code = "b".repeat(43);
  const harness = createHarness({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ token: "paired-secret-token" });
      },
    }),
  });

  const response = await harness.send({
    type: "COMPLETE_PAIRING",
    endpoint: "https://workstation.example.ts.net",
    code,
  }, {
    id: EXTENSION_ID,
    url: `chrome-extension://${EXTENSION_ID}/pair.html`,
  });

  assert.deepEqual(response, {
    connected: true,
    endpoint: "https://workstation.example.ts.net",
  });
  assert.equal(harness.fetchCalls.length, 1);
  const [url, options] = harness.fetchCalls[0];
  assert.equal(url, "https://workstation.example.ts.net/v1/pairings/exchange");
  assert.equal(options.method, "POST");
  assert.equal(options.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(options.body), { code });
  assert.equal(harness.storage.brokerEndpoint, "https://workstation.example.ts.net");
  assert.equal(harness.storage.brokerToken, "paired-secret-token");

  const untrusted = await harness.send({
    type: "COMPLETE_PAIRING",
    endpoint: "https://workstation.example.ts.net",
    code,
  }, { tab: { id: 7 } });
  assert.match(untrusted.error, /trusted pairing page/);
});
