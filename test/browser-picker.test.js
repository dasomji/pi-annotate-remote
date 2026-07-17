import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const pickerSource = readFileSync(new URL("../chrome-extension/picker.js", import.meta.url), "utf8");

class PickerElement {
  constructor(tagName = "div", root = null) {
    this.tagName = tagName.toUpperCase();
    this.root = root;
    this.id = "";
    this.value = "";
    this.textContent = "";
    this.type = "";
    this.name = "";
    this.checked = false;
    this.disabled = false;
    this.isConnected = true;
    this.children = [];
    this.listeners = new Map();
    this._classes = new Set();
    this.style = {
      values: new Map(),
      setProperty: (name, value, priority) => this.style.values.set(name, { value, priority }),
    };
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
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  appendChild(child) {
    child.root ||= this.root;
    this.children.push(child);
    return child;
  }
  replaceChildren(...children) { this.children = [...children]; }
  getClientRects() { return this.classList.contains("hidden") ? [] : [{}]; }
  focus() { if (this.root) this.root.activeElement = this; }
  remove() { this.isConnected = false; }
  attachShadow() {
    this.shadow = new PickerShadow();
    return this.shadow;
  }
  async trigger(type, overrides = {}) {
    const event = {
      key: "",
      shiftKey: false,
      target: this,
      preventDefault() {},
      stopPropagation() {},
      ...overrides,
    };
    for (const listener of this.listeners.get(type) || []) await listener(event);
  }
}

class PickerShadow {
  constructor() {
    this.elements = new Map();
    this.listeners = new Map();
    this.activeElement = null;
    this.markup = "";
    this.backdrop = new PickerElement("div", this);
    this.backdrop.className = "backdrop";
  }
  set innerHTML(value) {
    this.markup = value;
    const pattern = /<(button|span|div|p|section)[^>]*\sid="([^"]+)"[^>]*>/g;
    for (const match of value.matchAll(pattern)) {
      const element = new PickerElement(match[1], this);
      element.id = match[2];
      const className = match[0].match(/\sclass="([^"]+)"/)?.[1] || "";
      element.className = className;
      element.disabled = /\sdisabled(?:\s|>)/.test(match[0]);
      this.elements.set(element.id, element);
    }
  }
  get innerHTML() { return this.markup; }
  getElementById(id) { return this.elements.get(id) || null; }
  querySelector(selector) {
    if (selector === ".backdrop") return this.backdrop;
    return null;
  }
  querySelectorAll() {
    const staticControls = [...this.elements.values()].filter((element) =>
      ["BUTTON", "INPUT"].includes(element.tagName));
    const dynamicControls = [];
    const visit = (element) => {
      if (["BUTTON", "INPUT"].includes(element.tagName)) dynamicControls.push(element);
      for (const child of element.children) visit(child);
    };
    for (const child of this.getElementById("session-list")?.children || []) visit(child);
    return [...staticControls, ...dynamicControls].filter((element) => !element.disabled);
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
}

async function flushAsync() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function createPickerHarness({ configured = true } = {}) {
  const messages = [];
  let runtimeListener;
  let appendedHost = null;
  let latestShadow = null;
  const previousFocus = new PickerElement("button");
  let focusRestored = false;
  previousFocus.focus = () => { focusRestored = true; };

  const document = {
    activeElement: previousFocus,
    createElement(tagName) { return new PickerElement(tagName, latestShadow); },
    documentElement: {
      appendChild(host) {
        host.isConnected = true;
        appendedHost = host;
        latestShadow = host.shadow;
        return host;
      },
    },
    body: null,
  };

  const chrome = {
    runtime: {
      onMessage: {
        addListener(listener) { runtimeListener = listener; },
      },
      async sendMessage(message) {
        messages.push(JSON.parse(JSON.stringify(message)));
        switch (message.type) {
          case "GET_PICKER_STATUS":
            return { configured };
          case "LIST_SESSIONS":
            return {
              sessions: [
                { id: "session_abcdefghijkl", label: "shop (main)" },
                { id: "session_mnopqrstuvwx", label: "shop (feature)" },
              ],
              selectedSessionId: "session_abcdefghijkl",
              recommendedSessionId: "session_mnopqrstuvwx",
              baseOrigin: "https://shop.example.test",
            };
          case "SELECT_SESSION":
            return { selectedSessionId: message.sessionId };
          case "START_ANNOTATION":
            return { started: true };
          case "OPEN_PICKER_SETTINGS":
            return { windowId: 10 };
          case "PICKER_CLOSED":
            return { closed: true };
          default:
            return {};
        }
      },
    },
  };

  const context = vm.createContext({
    Error,
    Object,
    Set,
    URL,
    chrome,
    console,
    document,
  });
  vm.runInContext(pickerSource, context, { filename: "picker.js" });

  function deliver(message) {
    let response;
    runtimeListener(message, {}, (value) => {
      response = value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    });
    return response;
  }

  return {
    deliver,
    messages,
    wasFocusRestored: () => focusRestored,
    get host() { return appendedHost; },
    get shadow() { return latestShadow; },
  };
}

test("in-page picker is a compact modal with recommended session preselected", async () => {
  const harness = createPickerHarness();

  assert.deepEqual(harness.deliver({ type: "OPEN_PICKER" }), { opened: true });
  await flushAsync();

  assert.equal(harness.host.id, "pi-annotate-picker-host");
  assert.match(harness.shadow.markup, /role="dialog" aria-modal="true"/);
  assert.match(harness.shadow.markup, /width: min\(420px, calc\(100vw - 32px\)\)/);
  assert.match(harness.shadow.markup, /max-height: min\(560px, calc\(100vh - 32px\)\)/);
  assert.equal(harness.shadow.getElementById("base-origin").textContent, "for shop.example.test");

  const options = harness.shadow.getElementById("session-list").children;
  assert.equal(options.length, 2);
  assert.equal(options[0].children[0].value, "session_mnopqrstuvwx");
  assert.equal(options[0].children[0].checked, true);
  assert.equal(options[0].children[1].children[1].textContent, "Last used for this site");
  assert.equal(harness.shadow.getElementById("start").disabled, false);

  await harness.shadow.getElementById("start").trigger("click");
  await flushAsync();
  assert.ok(harness.messages.some((message) =>
    message.type === "START_ANNOTATION" && message.sessionId === "session_mnopqrstuvwx"));
  assert.ok(harness.messages.some((message) => message.type === "PICKER_CLOSED"));
  assert.equal(harness.host.isConnected, false);
  assert.equal(harness.wasFocusRestored(), true);
});

test("unconfigured modal routes connection setup to the compact extension window", async () => {
  const harness = createPickerHarness({ configured: false });

  harness.deliver({ type: "OPEN_PICKER" });
  await flushAsync();

  assert.equal(harness.shadow.getElementById("connect").classList.contains("hidden"), false);
  assert.equal(harness.shadow.getElementById("start").disabled, true);
  assert.match(harness.shadow.getElementById("status-text").textContent, /Connect Pi Annotate/);

  await harness.shadow.getElementById("connect").trigger("click");
  await flushAsync();
  assert.ok(harness.messages.some((message) => message.type === "OPEN_PICKER_SETTINGS"));
  assert.equal(harness.host.isConnected, false);
});
