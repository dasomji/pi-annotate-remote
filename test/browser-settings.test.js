import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const settingsSource = readFileSync(new URL("../chrome-extension/settings.js", import.meta.url), "utf8");
const settingsMarkup = readFileSync(new URL("../chrome-extension/settings.html", import.meta.url), "utf8");

class SettingsElement {
  constructor() {
    this.value = "";
    this.textContent = "";
    this.type = "text";
    this.disabled = false;
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
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name); }
  async trigger(type) {
    return this.listeners.get(type)?.({ preventDefault() {}, target: this });
  }
}

async function flushAsync() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function createSettingsHarness({
  configured = false,
  shortcut = "Ctrl+Shift+P",
} = {}) {
  const ids = [
    "broker-endpoint", "broker-token", "broker-form", "save-btn", "toggle-token",
    "status-dot", "status-text", "shortcut-key", "edit-shortcut",
  ];
  const elements = new Map(ids.map((id) => [id, new SettingsElement()]));
  elements.get("broker-token").type = "password";

  const messages = [];
  const permissionRequests = [];
  const windowListeners = new Map();

  const chrome = {
    commands: {
      async getAll() {
        return [{ name: "toggle-session-chooser", shortcut }];
      },
    },
    permissions: {
      async request(request) {
        permissionRequests.push(JSON.parse(JSON.stringify(request)));
        return true;
      },
    },
    runtime: {
      async sendMessage(message) {
        messages.push(JSON.parse(JSON.stringify(message)));
        switch (message.type) {
          case "GET_BROKER_CONFIG":
            return configured
              ? { endpoint: "https://workstation.example.ts.net", token: "secret-token" }
              : { endpoint: "", token: "" };
          case "SAVE_BROKER_CONFIG":
            configured = true;
            return { endpoint: message.endpoint, selectedSessionId: "" };
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
  };
  const window = {
    addEventListener(type, listener) { windowListeners.set(type, listener); },
  };

  vm.runInContext(settingsSource, vm.createContext({
    Error,
    URL,
    chrome,
    console,
    document,
    window,
  }), { filename: "settings.js" });

  return { elements, messages, permissionRequests, windowListeners };
}

test("settings page is connection-only and loads trusted broker configuration", async () => {
  assert.match(settingsMarkup, /<title>Pi Annotate settings<\/title>/);
  assert.doesNotMatch(settingsMarkup, /session-list|start-btn|refresh-btn/);

  const harness = createSettingsHarness({ configured: true });
  await flushAsync();

  assert.equal(harness.elements.get("broker-endpoint").value, "https://workstation.example.ts.net");
  assert.equal(harness.elements.get("broker-token").value, "secret-token");
  assert.equal(harness.elements.get("status-dot").classList.contains("connected"), true);
  assert.match(harness.elements.get("status-text").textContent, /Connected to/);
});

test("manual recovery requests scoped permission and saves broker configuration", async () => {
  const harness = createSettingsHarness({ configured: false });
  await flushAsync();

  harness.elements.get("broker-endpoint").value = "https://workstation.example.ts.net:8443/";
  harness.elements.get("broker-token").value = "secret-token";
  await harness.elements.get("broker-form").trigger("submit");

  assert.deepEqual(harness.permissionRequests, [{ origins: ["https://workstation.example.ts.net/*"] }]);
  const saveMessage = harness.messages.find((message) => message.type === "SAVE_BROKER_CONFIG");
  assert.deepEqual(saveMessage, {
    type: "SAVE_BROKER_CONFIG",
    endpoint: "https://workstation.example.ts.net:8443",
    token: "secret-token",
  });
  assert.equal(harness.elements.get("status-dot").classList.contains("connected"), true);
  assert.match(harness.elements.get("status-text").textContent, /:8443/);
});

test("settings page exposes Chrome-managed shortcut configuration", async () => {
  const harness = createSettingsHarness({ shortcut: "" });
  await flushAsync();

  assert.equal(harness.elements.get("shortcut-key").textContent, "Not set");
  assert.equal(harness.elements.get("shortcut-key").classList.contains("unassigned"), true);

  await harness.elements.get("edit-shortcut").trigger("click");
  assert.ok(harness.messages.some((message) => message.type === "OPEN_SHORTCUT_SETTINGS"));

  await harness.elements.get("toggle-token").trigger("click");
  assert.equal(harness.elements.get("broker-token").type, "text");
  assert.equal(harness.elements.get("toggle-token").getAttribute("aria-label"), "Hide broker token");
});
