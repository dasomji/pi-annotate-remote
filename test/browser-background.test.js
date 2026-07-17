import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const backgroundSource = readFileSync(new URL("../chrome-extension/background.js", import.meta.url), "utf8");
const EXTENSION_ID = "bpeadifabilnfpephegaodjbcjjfjghk";
const TARGET_TAB = {
  id: 7,
  windowId: 3,
  active: true,
  url: "https://example.test/products/42",
};

function createStorageArea(values) {
  return {
    async setAccessLevel() {},
    async get(keys) {
      const requested = Array.isArray(keys) ? keys : Object.keys(keys || values);
      return Object.fromEntries(requested.filter((key) => key in values).map((key) => [key, values[key]]));
    },
    async set(next) {
      Object.assign(values, JSON.parse(JSON.stringify(next)));
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
    },
  };
}

function createHarness({
  fetchImpl,
  targetTab = TARGET_TAB,
  failPositionedWindow = false,
  failSizedWindow = false,
  pickerMessageFailures = 0,
} = {}) {
  const storage = {};
  const sessionStorage = {};
  const fetchCalls = [];
  const tabMessages = [];
  const injected = [];
  const createdTabs = [];
  const createdWindows = [];
  const removedWindows = [];
  const windowUpdates = [];
  const runtimeMessages = [];
  const windows = new Map();
  const normalWindow = {
    id: 3,
    left: 100,
    top: 50,
    width: 1_200,
    height: 900,
    focused: true,
    type: "normal",
    tabs: [{ ...targetTab, active: true }],
  };
  windows.set(normalWindow.id, normalWindow);

  let nextTabId = 8;
  let nextWindowId = 10;
  let messageListener;
  let externalMessageListener;
  let commandListener;
  let actionListener;
  let windowRemovedListener;
  let failFirstTabMessage = false;

  const chrome = {
    runtime: {
      id: EXTENSION_ID,
      lastError: null,
      getURL(path) {
        return `chrome-extension://${EXTENSION_ID}/${path}`;
      },
      async sendMessage(message) {
        runtimeMessages.push(JSON.parse(JSON.stringify(message)));
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
    action: {
      onClicked: {
        addListener(listener) {
          actionListener = listener;
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
      local: createStorageArea(storage),
      session: createStorageArea(sessionStorage),
    },
    permissions: {
      async remove() {
        return true;
      },
    },
    tabs: {
      async query(query) {
        if (Number.isInteger(query?.windowId) && query.windowId !== targetTab.windowId) return [];
        return [{ ...targetTab, active: true }];
      },
      async get(tabId) {
        if (tabId === targetTab.id) return { ...targetTab, active: true };
        for (const tab of createdTabs) {
          if (tab.id === tabId) return tab;
        }
        throw new Error("No tab with id");
      },
      async create(options) {
        const tab = { id: nextTabId++, ...JSON.parse(JSON.stringify(options)) };
        createdTabs.push(tab);
        return tab;
      },
      async sendMessage(tabId, message) {
        if (message?.type === "OPEN_PICKER" && pickerMessageFailures > 0) {
          pickerMessageFailures -= 1;
          throw new Error("Receiving end does not exist");
        }
        if (failFirstTabMessage) {
          failFirstTabMessage = false;
          throw new Error("Receiving end does not exist");
        }
        tabMessages.push(JSON.parse(JSON.stringify({ tabId, message })));
        if (message?.type === "OPEN_PICKER") return { opened: true };
        return undefined;
      },
      captureVisibleTab(_windowId, _options, callback) {
        callback("data:image/png;base64,abc");
      },
    },
    windows: {
      async getLastFocused() {
        return JSON.parse(JSON.stringify(normalWindow));
      },
      async get(windowId) {
        const window = windows.get(windowId);
        if (!window) throw new Error("No window with id");
        return JSON.parse(JSON.stringify(window));
      },
      async create(options) {
        if (
          (failPositionedWindow && ("left" in options || "top" in options)) ||
          (failSizedWindow && ("width" in options || "height" in options))
        ) {
          throw new Error("Invalid value for bounds");
        }
        const window = {
          id: nextWindowId++,
          ...JSON.parse(JSON.stringify(options)),
          tabs: [{
            id: nextTabId++,
            active: true,
            windowId: nextWindowId - 1,
          }],
        };
        createdWindows.push(JSON.parse(JSON.stringify(options)));
        windows.set(window.id, window);
        return JSON.parse(JSON.stringify(window));
      },
      async update(windowId, options) {
        const window = windows.get(windowId);
        if (!window) throw new Error("No window with id");
        Object.assign(window, options);
        windowUpdates.push({ windowId, ...JSON.parse(JSON.stringify(options)) });
        return JSON.parse(JSON.stringify(window));
      },
      async remove(windowId) {
        if (!windows.has(windowId)) throw new Error("No window with id");
        windows.delete(windowId);
        removedWindows.push(windowId);
      },
      onRemoved: {
        addListener(listener) {
          windowRemovedListener = listener;
        },
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
    Date,
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
      if (!keepAlive) setImmediate(() => resolve(undefined));
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
    createdWindows,
    fetchCalls,
    injected,
    removedWindows,
    runtimeMessages,
    send,
    sendExternal,
    sessionStorage,
    storage,
    tabMessages,
    windowUpdates,
    setFailFirstTabMessage() {
      failFirstTabMessage = true;
    },
    triggerAction(tab = targetTab) {
      return actionListener(tab);
    },
    triggerCommand(command) {
      return commandListener(command);
    },
    removeWindow(windowId) {
      windows.delete(windowId);
      return windowRemovedListener(windowId);
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
    recommendedSessionId: "",
    baseOrigin: "",
  });
  assert.equal(harness.fetchCalls.length, 1);
  const [url, options] = harness.fetchCalls[0];
  assert.equal(url, "https://workstation.example.ts.net/v1/sessions");
  assert.equal(options.headers.Authorization, "Bearer secret-token");
});

test("in-page picker status never exposes broker credentials", async () => {
  const harness = createHarness();
  assert.deepEqual(await harness.send({ type: "GET_PICKER_STATUS" }), { configured: false });

  await configure(harness);
  assert.deepEqual(await harness.send({ type: "GET_PICKER_STATUS" }), { configured: true });
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

test("toolbar action and keyboard command open the picker as a dialog in the active page", async () => {
  const harness = createHarness();

  await harness.triggerAction();
  assert.deepEqual(harness.createdWindows, []);
  assert.deepEqual(harness.tabMessages, [{
    tabId: 7,
    message: { type: "OPEN_PICKER" },
  }]);
  assert.deepEqual(harness.sessionStorage.pickerState, {
    targetTabId: 7,
    targetWindowId: 3,
    baseOrigin: "https://example.test",
    modalTabId: 7,
    windowId: null,
    pickerTabId: null,
  });

  await harness.triggerCommand("toggle-picker");
  assert.equal(harness.createdWindows.length, 0);
  assert.deepEqual(harness.tabMessages.at(-1), {
    tabId: 7,
    message: { type: "OPEN_PICKER" },
  });
});

test("picker dialog script is injected on demand", async () => {
  const harness = createHarness({ pickerMessageFailures: 1 });

  await harness.triggerAction();
  assert.deepEqual(harness.injected, [{ target: { tabId: 7 }, files: ["picker.js"] }]);
  assert.deepEqual(harness.tabMessages, [{ tabId: 7, message: { type: "OPEN_PICKER" } }]);
  assert.deepEqual(harness.createdWindows, []);
});

test("uninjectable pages fall back to a smaller centered extension window", async () => {
  const harness = createHarness({ pickerMessageFailures: 2 });

  await harness.triggerAction();
  assert.deepEqual(harness.createdWindows, [{
    type: "popup",
    url: `chrome-extension://${EXTENSION_ID}/popup.html`,
    focused: true,
    width: 420,
    height: 560,
    left: 490,
    top: 220,
  }]);
});

test("repeated fallback opens reuse the existing compact window", async () => {
  const harness = createHarness({ pickerMessageFailures: 4 });

  await harness.triggerAction();
  await harness.triggerAction();

  assert.equal(harness.createdWindows.length, 1);
  assert.deepEqual(harness.windowUpdates.at(-1), { windowId: 10, focused: true });
});

test("opening an in-page dialog closes a previous fallback window", async () => {
  const harness = createHarness({ pickerMessageFailures: 2 });

  await harness.triggerAction();
  assert.equal(harness.createdWindows.length, 1);
  await harness.triggerAction();

  assert.deepEqual(harness.removedWindows, [10]);
  assert.deepEqual(harness.tabMessages.at(-1), { tabId: 7, message: { type: "OPEN_PICKER" } });
  assert.equal(harness.sessionStorage.pickerState.modalTabId, 7);
  assert.equal(harness.sessionStorage.pickerState.windowId, null);
});

test("fallback window still opens when Chrome rejects the calculated centered bounds", async () => {
  const harness = createHarness({ pickerMessageFailures: 2, failPositionedWindow: true });

  await harness.triggerAction();
  assert.deepEqual(harness.createdWindows, [{
    type: "popup",
    url: `chrome-extension://${EXTENSION_ID}/popup.html`,
    focused: true,
    width: 420,
    height: 560,
  }]);
});

test("fallback never asks Chrome for a near-full browser-sized window", async () => {
  const harness = createHarness({
    pickerMessageFailures: 2,
    failPositionedWindow: true,
    failSizedWindow: true,
  });

  await harness.triggerAction();
  assert.deepEqual(harness.createdWindows, []);
});

test("in-page connection settings open the compact fallback directly on its settings panel", async () => {
  const harness = createHarness();
  const response = await harness.send({ type: "OPEN_PICKER_SETTINGS" }, { tab: TARGET_TAB });

  assert.equal(response.windowId, 10);
  assert.equal(harness.createdWindows[0].url, `chrome-extension://${EXTENSION_ID}/popup.html?settings=1`);
  assert.equal(harness.createdWindows[0].width, 420);
  assert.equal(harness.createdWindows[0].height, 560);
});

test("a settings-window failure leaves the in-page chooser open", async () => {
  const harness = createHarness({ failPositionedWindow: true, failSizedWindow: true });
  await harness.triggerAction();

  const response = await harness.send({ type: "OPEN_PICKER_SETTINGS" }, { tab: TARGET_TAB });

  assert.match(response.error, /Invalid value for bounds/);
  assert.deepEqual(harness.tabMessages, [{ tabId: 7, message: { type: "OPEN_PICKER" } }]);
});

test("shortcut settings open in the normal browser window", async () => {
  const harness = createHarness();
  const response = await harness.send({ type: "OPEN_SHORTCUT_SETTINGS" });

  assert.equal(response.opened, true);
  assert.deepEqual(harness.createdTabs[0], {
    id: 8,
    windowId: 3,
    url: "chrome://extensions/shortcuts",
    active: true,
  });
  assert.deepEqual(harness.windowUpdates.at(-1), { windowId: 3, focused: true });
});

test("starting annotation targets the remembered page and records its origin recommendation", async () => {
  const harness = createHarness();
  await configure(harness);
  await harness.triggerAction();
  harness.setFailFirstTabMessage();

  const response = await harness.send({
    type: "START_ANNOTATION",
    sessionId: "session_abcdefghijkl",
  });
  assert.deepEqual(response, { started: true, baseOrigin: "https://example.test" });
  assert.deepEqual(harness.injected, [{ target: { tabId: 7 }, files: ["content.js"] }]);
  assert.deepEqual(harness.tabMessages, [
    { tabId: 7, message: { type: "OPEN_PICKER" } },
    {
      tabId: 7,
      message: { type: "START_ANNOTATION", sessionId: "session_abcdefghijkl" },
    },
  ]);
  assert.equal(harness.storage.selectedSessionId, "session_abcdefghijkl");
  assert.equal(
    harness.storage.sessionRecommendationsByOrigin["https://example.test"].sessionId,
    "session_abcdefghijkl",
  );
  assert.ok(Number.isFinite(harness.storage.sessionRecommendationsByOrigin["https://example.test"].updatedAt));
});

test("session listing recommends the last live session used on the active origin", async () => {
  const sessions = [
    { id: "session_abcdefghijkl", label: "shop (main)" },
    { id: "session_mnopqrstuvwx", label: "admin (feature)" },
  ];
  const harness = createHarness({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async text() { return JSON.stringify({ sessions }); },
    }),
  });
  await configure(harness);
  await harness.triggerAction();
  await harness.send({ type: "START_ANNOTATION", sessionId: sessions[1].id });
  await harness.send({ type: "SELECT_SESSION", sessionId: sessions[0].id });

  const response = await harness.send({ type: "LIST_SESSIONS" });
  assert.deepEqual(response, {
    sessions,
    selectedSessionId: sessions[0].id,
    recommendedSessionId: sessions[1].id,
    baseOrigin: "https://example.test",
  });
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
