import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// The annotator ships as ordered classic scripts: module files first, then the
// content.js entry point (mirrors ANNOTATOR_SCRIPT_FILES in background.js).
const ANNOTATOR_SCRIPT_FILES = [
  "content-styles.js",
  "content-inspect.js",
  "content-capture.js",
  "content-etch.js",
  "content.js",
];
const annotatorSources = ANNOTATOR_SCRIPT_FILES.map((file) => ({
  file,
  source: readFileSync(new URL(`../chrome-extension/${file}`, import.meta.url), "utf8"),
}));
const stylesSource = annotatorSources.find(({ file }) => file === "content-styles.js").source;
const contentSource = annotatorSources.find(({ file }) => file === "content.js").source;

class FakeClassList {
  constructor() {
    this.values = new Set();
  }
  add(...values) { values.forEach((value) => this.values.add(value)); }
  remove(...values) { values.forEach((value) => this.values.delete(value)); }
  toggle(value, force) {
    const add = force === undefined ? !this.values.has(value) : force;
    if (add) this.values.add(value); else this.values.delete(value);
    return add;
  }
  contains(value) { return this.values.has(value); }
}

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.style = {};
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.children = [];
    this.isConnected = true;
    this.hidden = false;
    this.disabled = false;
    this.textContent = "";
    this.value = "";
    this.checked = false;
    this._innerHTML = "";
    this.offsetHeight = 96;
  }
  set innerHTML(value) {
    this._innerHTML = value;
    if (value.includes('id="pi-abort-continue"')) {
      const continueButton = new FakeElement("button");
      continueButton.id = "pi-abort-continue";
      const abortButton = new FakeElement("button");
      abortButton.id = "pi-abort-confirm";
      this.appendChild(continueButton);
      this.appendChild(abortButton);
    }
  }
  get innerHTML() { return this._innerHTML; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
  appendChild(child) { this.children.push(child); child.parentElement = this; child.isConnected = true; return child; }
  remove() { this.isConnected = false; }
  setAttribute(name, value) { this[name] = value; }
  removeAttribute(name) { delete this[name]; }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  querySelectorAll(selector) {
    const matches = [];
    for (const child of this.children) {
      if ((selector.startsWith("#") && child.id === selector.slice(1)) ||
          (selector === "button" && child.tagName === "BUTTON")) matches.push(child);
      matches.push(...child.querySelectorAll(selector));
    }
    return matches;
  }
  closest(selector) {
    let element = this;
    while (element) {
      if (selector.startsWith("#") && element.id === selector.slice(1)) return element;
      if (selector.startsWith(".") && element.className?.split(/\s+/).includes(selector.slice(1))) return element;
      element = element.parentElement;
    }
    return null;
  }
  focus() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 40, right: 100, bottom: 40 }; }
  async trigger(type, event = {}) {
    return this.listeners.get(type)?.({
      button: 0,
      clientX: 0,
      clientY: 0,
      preventDefault() {},
      stopPropagation() {},
      stopImmediatePropagation() {},
      target: this,
      ...event,
    });
  }
}

function createHarness() {
  const ids = new Map();
  const requiredIds = [
    "pi-close", "pi-cancel", "pi-submit", "pi-minimize", "pi-minimized-bubble",
    "pi-mode-single", "pi-mode-multi", "pi-ss-each", "pi-ss-full", "pi-ss-none",
    "pi-notes-visible", "pi-debug-mode", "pi-etch-mode", "pi-etch-count", "pi-context",
    "pi-delivery-error",
  ];
  for (const id of requiredIds) {
    const element = new FakeElement(id.includes("mode") || id.includes("ss-") || ["pi-close", "pi-cancel", "pi-submit", "pi-minimize"].includes(id) ? "button" : "div");
    element.id = id;
    ids.set(id, element);
  }

  const documentListeners = new Map();
  const document = {
    activeElement: null,
    body: new FakeElement("body"),
    head: new FakeElement("head"),
    documentElement: new FakeElement("html"),
    addEventListener(type, listener) { documentListeners.set(type, listener); },
    removeEventListener(type) { documentListeners.delete(type); },
    createElement(tagName) { return new FakeElement(tagName); },
    createElementNS(_namespace, tagName) { return new FakeElement(tagName); },
    getElementById(id) { return ids.get(id) || null; },
    querySelectorAll() { return []; },
    contains(element) { return element?.isConnected !== false; },
  };

  let runtimeListener;
  let deliveryAttempts = 0;
  const sentMessages = [];
  const chrome = {
    runtime: {
      id: "test-extension",
      onMessage: {
        addListener(listener) { runtimeListener = listener; },
      },
      async sendMessage(message) {
        sentMessages.push(JSON.parse(JSON.stringify(message)));
        if (message.type === "CAPTURE_SCREENSHOT") return {};
        if (message.type === "ANNOTATIONS_COMPLETE") {
          deliveryAttempts += 1;
          return deliveryAttempts === 1
            ? { error: "annotation session disconnected" }
            : { delivered: true };
        }
        return {};
      },
    },
  };

  const window = {
    addEventListener() {},
    removeEventListener() {},
    innerHeight: 800,
    innerWidth: 1200,
    location: { href: "https://example.test/page" },
    scrollX: 0,
    scrollY: 0,
  };

  const context = vm.createContext({
    chrome,
    console,
    document,
    navigator: { platform: "Linux" },
    requestAnimationFrame(callback) { setImmediate(callback); },
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    window,
  });
  for (const { file, source } of annotatorSources) {
    vm.runInContext(source, context, { filename: file });
  }

  return { document, documentListeners, ids, runtimeListener, sentMessages };
}

function dispatchDocumentEvent(harness, type, target, properties = {}) {
  let propagationStopped = false;
  const event = {
    key: "",
    repeat: false,
    target,
    preventDefault() {},
    stopPropagation() { propagationStopped = true; },
    stopImmediatePropagation() { propagationStopped = true; },
    ...properties,
  };
  harness.documentListeners.get(type)?.(event);
  if (!propagationStopped) target?.listeners.get(type)?.(event);
}

test("annotation bar is a floating rounded panel with a multiline context field", () => {
  assert.match(stylesSource, /#pi-panel\s*\{[\s\S]*?bottom: 20px;[\s\S]*?left: 30px;[\s\S]*?right: 30px;/);
  assert.match(stylesSource, /#pi-panel\s*\{[\s\S]*?border-radius: 14px;/);
  assert.match(contentSource, /<textarea id="pi-context" rows="2"/);
});

test("content UI stays open with Retry until broker delivery is acknowledged", async () => {
  const harness = createHarness();
  let startResponse;
  harness.runtimeListener(
    { type: "START_ANNOTATION", sessionId: "session_abcdefghijkl" },
    {},
    (response) => { startResponse = response; },
  );
  assert.equal(startResponse?.started, true);

  const submit = harness.ids.get("pi-submit");
  const error = harness.ids.get("pi-delivery-error");
  await submit.trigger("click");

  assert.equal(submit.disabled, false);
  assert.equal(submit.textContent, "Retry");
  assert.equal(error.hidden, false);
  assert.match(error.textContent, /Delivery failed: annotation session disconnected/);
  const firstDelivery = harness.sentMessages.find((message) => message.type === "ANNOTATIONS_COMPLETE");
  assert.equal(firstDelivery.sessionId, "session_abcdefghijkl");

  await submit.trigger("click");
  const deliveries = harness.sentMessages.filter((message) => message.type === "ANNOTATIONS_COMPLETE");
  assert.equal(deliveries.length, 2);
  const panel = harness.document.body.children.find((element) => element.id === "pi-panel");
  assert.equal(panel.isConnected, false);
});

test("Continue annotating closes the Escape abort dialog", () => {
  const harness = createHarness();
  harness.runtimeListener(
    { type: "START_ANNOTATION", sessionId: "session_abcdefghijkl" },
    {},
    () => {},
  );

  for (let press = 0; press < 3; press += 1) {
    dispatchDocumentEvent(harness, "keydown", harness.document.body, { key: "Escape" });
  }

  const dialog = harness.document.body.children.find((element) => element.className === "pi-abort-backdrop");
  assert.ok(dialog?.isConnected, "abort dialog should open after the Escape sequence");

  dispatchDocumentEvent(harness, "click", dialog.querySelector("#pi-abort-continue"));

  assert.equal(dialog.isConnected, false, "Continue annotating should close the abort dialog");
});
