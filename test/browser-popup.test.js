import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const popupSource = readFileSync(new URL("../chrome-extension/popup.js", import.meta.url), "utf8");

class PopupElement {
  constructor() {
    this.value = "";
    this.textContent = "";
    this.type = "text";
    this.disabled = false;
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.className = "";
    this.classList = {
      add: (value) => this.attributes.set(`class:${value}`, true),
      remove: (value) => this.attributes.delete(`class:${value}`),
    };
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  async trigger(type) {
    return this.listeners.get(type)?.({ preventDefault() {}, target: this });
  }
}

function createPopupHarness() {
  const ids = [
    "broker-endpoint", "broker-token", "broker-form", "save-btn", "toggle-token",
    "refresh-btn", "session-select", "empty-sessions", "start-btn", "status-dot",
    "status-text", "shortcut-key",
  ];
  const elements = new Map(ids.map((id) => [id, new PopupElement()]));
  const messages = [];
  const permissionRequests = [];
  let closed = false;

  const chrome = {
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
            return { endpoint: "", token: "", selectedSessionId: "" };
          case "SAVE_BROKER_CONFIG":
            return { endpoint: message.endpoint, selectedSessionId: "" };
          case "LIST_SESSIONS":
            return {
              sessions: [{ id: "session_abcdefghijkl", label: "shop (main)" }],
              selectedSessionId: "",
            };
          case "SELECT_SESSION":
            return { selectedSessionId: message.sessionId };
          case "START_ANNOTATION":
            return { started: true };
          default:
            return {};
        }
      },
    },
  };

  const document = {
    getElementById(id) { return elements.get(id) || null; },
    createElement() { return new PopupElement(); },
  };
  const window = { close() { closed = true; } };

  vm.runInContext(popupSource, vm.createContext({
    URL,
    chrome,
    console,
    document,
    navigator: { platform: "Linux" },
    window,
  }), { filename: "popup.js" });

  return {
    elements,
    messages,
    permissionRequests,
    wasClosed() { return closed; },
  };
}

test("popup requests only the configured broker origin, lists sessions, and starts the selection", async () => {
  const harness = createPopupHarness();
  await new Promise((resolve) => setImmediate(resolve));

  harness.elements.get("broker-endpoint").value = "https://workstation.example.ts.net:8443/";
  harness.elements.get("broker-token").value = "secret-token";
  await harness.elements.get("broker-form").trigger("submit");

  assert.deepEqual(harness.permissionRequests, [{ origins: ["https://workstation.example.ts.net/*"] }]);
  const saveMessage = harness.messages.find((message) => message.type === "SAVE_BROKER_CONFIG");
  assert.equal(saveMessage.endpoint, "https://workstation.example.ts.net:8443");
  const select = harness.elements.get("session-select");
  assert.equal(select.disabled, false);
  assert.equal(select.value, "session_abcdefghijkl");
  assert.equal(select.children[0].textContent, "shop (main)");
  assert.equal(harness.elements.get("start-btn").disabled, false);

  await harness.elements.get("start-btn").trigger("click");
  const startMessage = harness.messages.find((message) => message.type === "START_ANNOTATION");
  assert.deepEqual(startMessage, {
    type: "START_ANNOTATION",
    sessionId: "session_abcdefghijkl",
  });
  assert.equal(harness.wasClosed(), true);
});
