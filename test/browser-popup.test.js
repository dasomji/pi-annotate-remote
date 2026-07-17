import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const popupSource = readFileSync(new URL("../chrome-extension/popup.js", import.meta.url), "utf8");
const popupMarkup = readFileSync(new URL("../chrome-extension/popup.html", import.meta.url), "utf8");

class PopupElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.value = "";
    this.textContent = "";
    this.type = "text";
    this.name = "";
    this.checked = false;
    this.disabled = false;
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this._classes = new Set();
    this.classList = {
      add: (...values) => values.forEach((value) => this._classes.add(value)),
      remove: (...values) => values.forEach((value) => this._classes.delete(value)),
      contains: (value) => this._classes.has(value),
      toggle: (value, force) => {
        const enabled = force === undefined ? !this._classes.has(value) : Boolean(force);
        if (enabled) this._classes.add(value);
        else this._classes.delete(value);
        return enabled;
      },
    };
  }
  get className() { return [...this._classes].join(" "); }
  set className(value) { this._classes = new Set(String(value || "").split(/\s+/).filter(Boolean)); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name); }
  async trigger(type, overrides = {}) {
    return this.listeners.get(type)?.({
      preventDefault() {},
      target: this,
      ...overrides,
    });
  }
}

async function flushAsync() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function createPopupHarness({
  configured = false,
  shortcut = "Ctrl+Shift+P",
  sessions = [{ id: "session_abcdefghijkl", label: "shop (main)" }],
  selectedSessionId = "",
  recommendedSessionId = "",
  baseOrigin = "https://shop.example.test",
} = {}) {
  const ids = [
    "broker-endpoint", "broker-token", "broker-form", "save-btn", "toggle-token",
    "refresh-btn", "settings-btn", "settings-panel", "session-list", "empty-sessions",
    "start-btn", "status-dot", "status-text", "base-origin", "shortcut-key",
    "edit-shortcut",
  ];
  const elements = new Map(ids.map((id) => [id, new PopupElement()]));
  elements.get("settings-panel").classList.add("hidden");
  elements.get("empty-sessions").classList.add("hidden");
  elements.get("settings-btn").setAttribute("aria-expanded", "false");

  const messages = [];
  const permissionRequests = [];
  const windowListeners = new Map();
  let runtimeListener;
  let closed = false;

  const chrome = {
    commands: {
      async getAll() {
        return [{ name: "toggle-picker", shortcut }];
      },
    },
    permissions: {
      async request(request) {
        permissionRequests.push(JSON.parse(JSON.stringify(request)));
        return true;
      },
    },
    runtime: {
      onMessage: {
        addListener(listener) {
          runtimeListener = listener;
        },
      },
      async sendMessage(message) {
        messages.push(JSON.parse(JSON.stringify(message)));
        switch (message.type) {
          case "GET_BROKER_CONFIG":
            return configured
              ? { endpoint: "https://workstation.example.ts.net", token: "secret-token", selectedSessionId }
              : { endpoint: "", token: "", selectedSessionId: "" };
          case "SAVE_BROKER_CONFIG":
            configured = true;
            return { endpoint: message.endpoint, selectedSessionId: "" };
          case "LIST_SESSIONS":
            return { sessions, selectedSessionId, recommendedSessionId, baseOrigin };
          case "SELECT_SESSION":
            selectedSessionId = message.sessionId;
            return { selectedSessionId: message.sessionId };
          case "START_ANNOTATION":
            return { started: true, baseOrigin };
          case "OPEN_SHORTCUT_SETTINGS":
            return { opened: true };
          default:
            return {};
        }
      },
    },
  };

  const document = {
    getElementById(id) { return elements.get(id) || null; },
    createElement(tagName) { return new PopupElement(tagName); },
  };
  const window = {
    addEventListener(type, listener) { windowListeners.set(type, listener); },
    close() { closed = true; },
  };

  vm.runInContext(popupSource, vm.createContext({
    Error,
    Set,
    URL,
    chrome,
    console,
    document,
    window,
  }), { filename: "popup.js" });

  return {
    elements,
    messages,
    permissionRequests,
    runtimeListener,
    windowListeners,
    wasClosed() { return closed; },
  };
}

test("refresh control is a circular icon button", () => {
  assert.match(popupMarkup, /#refresh-btn\s*\{\s*border-radius:\s*50%;\s*\}/);
  assert.match(popupMarkup, /id="refresh-btn"[\s\S]*?<svg/);
});

test("connected picker hides settings, recommends by origin, and starts the chosen session", async () => {
  const recommended = "session_mnopqrstuvwx";
  const harness = createPopupHarness({
    configured: true,
    sessions: [
      { id: "session_abcdefghijkl", label: "shop (main)" },
      { id: recommended, label: "shop (feature)" },
    ],
    selectedSessionId: "session_abcdefghijkl",
    recommendedSessionId: recommended,
  });
  await flushAsync();

  assert.equal(harness.elements.get("settings-panel").classList.contains("hidden"), true);
  assert.equal(harness.elements.get("settings-btn").getAttribute("aria-expanded"), "false");
  assert.equal(harness.elements.get("base-origin").textContent, "for shop.example.test");

  const options = harness.elements.get("session-list").children;
  assert.equal(options.length, 2);
  const recommendedRadio = options[0].children[0];
  const recommendedCopy = options[0].children[1];
  assert.equal(recommendedRadio.value, recommended);
  assert.equal(recommendedRadio.checked, true);
  assert.equal(recommendedCopy.children[0].textContent, "shop (feature)");
  assert.equal(recommendedCopy.children[1].textContent, "Last used for this site");
  assert.equal(harness.elements.get("start-btn").disabled, false);

  await harness.elements.get("start-btn").trigger("click");
  const startMessage = harness.messages.find((message) => message.type === "START_ANNOTATION");
  assert.deepEqual(startMessage, { type: "START_ANNOTATION", sessionId: recommended });
  assert.equal(harness.wasClosed(), true);
});

test("unconfigured picker exposes connection and Chrome-managed shortcut settings", async () => {
  const harness = createPopupHarness({ configured: false, shortcut: "" });
  await flushAsync();

  assert.equal(harness.elements.get("settings-panel").classList.contains("hidden"), false);
  assert.equal(harness.elements.get("settings-btn").getAttribute("aria-expanded"), "true");
  assert.equal(harness.elements.get("shortcut-key").textContent, "Not set");
  assert.equal(harness.elements.get("shortcut-key").classList.contains("unassigned"), true);

  harness.elements.get("broker-endpoint").value = "https://workstation.example.ts.net:8443/";
  harness.elements.get("broker-token").value = "secret-token";
  await harness.elements.get("broker-form").trigger("submit");

  assert.deepEqual(harness.permissionRequests, [{ origins: ["https://workstation.example.ts.net/*"] }]);
  const saveMessage = harness.messages.find((message) => message.type === "SAVE_BROKER_CONFIG");
  assert.equal(saveMessage.endpoint, "https://workstation.example.ts.net:8443");
  assert.equal(harness.elements.get("settings-panel").classList.contains("hidden"), true);
  assert.equal(harness.elements.get("session-list").children.length, 1);

  await harness.elements.get("settings-btn").trigger("click");
  assert.equal(harness.elements.get("settings-panel").classList.contains("hidden"), false);
  await harness.elements.get("edit-shortcut").trigger("click");
  assert.ok(harness.messages.some((message) => message.type === "OPEN_SHORTCUT_SETTINGS"));
});

test("refresh icon reloads sessions when picker context changes", async () => {
  const harness = createPopupHarness({ configured: true });
  await flushAsync();
  const before = harness.messages.filter((message) => message.type === "LIST_SESSIONS").length;

  harness.runtimeListener({ type: "PICKER_CONTEXT_UPDATED" });
  await flushAsync();

  const after = harness.messages.filter((message) => message.type === "LIST_SESSIONS").length;
  assert.equal(after, before + 1);
});
