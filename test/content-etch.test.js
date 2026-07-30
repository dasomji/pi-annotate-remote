import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const etchSource = readFileSync(
  new URL("../chrome-extension/content-etch.js", import.meta.url),
  "utf8",
);

class FakeStyle {
  constructor() {
    this.values = new Map();
  }

  set cssText(value) {
    this.values.clear();
    for (const declaration of String(value || "").split(";")) {
      const separator = declaration.indexOf(":");
      if (separator < 0) continue;
      const property = declaration.slice(0, separator).trim();
      const propertyValue = declaration.slice(separator + 1).trim();
      if (property) this.values.set(property, propertyValue);
    }
    this.syncIndexes();
  }

  get cssText() {
    return [...this.values].map(([property, value]) => `${property}: ${value}`).join("; ");
  }

  get length() {
    return this.values.size;
  }

  getPropertyValue(property) {
    return this.values.get(property) || "";
  }

  syncIndexes() {
    for (const key of Object.keys(this)) {
      if (/^\d+$/.test(key)) delete this[key];
    }
    [...this.values.keys()].forEach((property, index) => {
      this[index] = property;
    });
  }
}

class FakeElement {
  constructor(tagName = "div", id = "") {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.nodeType = 1;
    this.parentElement = null;
    this.attributes = new Map();
    this.style = new FakeStyle();
    this.children = [];
    if (id) this.attributes.set("id", id);
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "style") this.style.cssText = value;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "style") this.style.cssText = "";
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  remove() {
    this.parentElement?.children.splice(this.parentElement.children.indexOf(this), 1);
    this.parentElement = null;
  }
}

class FakeMutationObserver {
  static latest = null;

  constructor(callback) {
    this.callback = callback;
    this.records = [];
    this.connected = false;
    FakeMutationObserver.latest = this;
  }

  observe() {
    this.connected = true;
  }

  disconnect() {
    this.connected = false;
  }

  takeRecords() {
    const records = this.records;
    this.records = [];
    return records;
  }

  queue(record) {
    if (this.connected) this.records.push(record);
  }
}

function createHarness({ screenshots = ["data:image/png;base64,after", "data:image/png;base64,before"] } = {}) {
  FakeMutationObserver.latest = null;
  const documentElement = new FakeElement("html");
  const head = documentElement.appendChild(new FakeElement("head"));
  const body = documentElement.appendChild(new FakeElement("body"));
  const target = body.appendChild(new FakeElement("div", "target"));
  const screenshotResults = [...screenshots];
  const screenshotMessages = [];
  let now = 1_000;

  const document = {
    body,
    documentElement,
    head,
    styleSheets: [],
    contains(node) {
      let current = node;
      while (current) {
        if (current === documentElement) return true;
        current = current.parentElement;
      }
      return false;
    },
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    getElementById() {
      return null;
    },
    querySelectorAll(selector) {
      if (selector !== "[data-pi-changed]") return [];
      return [documentElement, head, body, target].filter((element) =>
        element.hasAttribute("data-pi-changed"));
    },
  };

  const chrome = {
    runtime: {
      id: "test-extension",
      async sendMessage(message) {
        screenshotMessages.push(structuredClone(message));
        const next = screenshotResults.shift();
        if (next instanceof Error) throw next;
        return typeof next === "string" ? { dataUrl: next } : next;
      },
    },
  };
  const modules = {
    inspect: {
      isPiElement: () => false,
      generateSelector: (element) => `#${element.id}`,
    },
  };
  const window = { [`__piAnnotateModules_${chrome.runtime.id}`]: modules };
  const context = vm.createContext({
    chrome,
    console,
    Date: { now: () => now },
    document,
    MutationObserver: FakeMutationObserver,
    Node: { ELEMENT_NODE: 1 },
    requestAnimationFrame(callback) {
      callback();
    },
    structuredClone,
    window,
  });
  vm.runInContext(etchSource, context, { filename: "content-etch.js" });

  function changeStyle(value) {
    const oldValue = target.getAttribute("style");
    target.setAttribute("style", value);
    FakeMutationObserver.latest?.queue({
      type: "attributes",
      target,
      attributeName: "style",
      oldValue,
    });
  }

  return {
    changeStyle,
    etch: modules.etch,
    screenshotMessages,
    setNow(value) {
      now = value;
    },
    target,
  };
}

test("finalizing a changed annotation period returns its capture and clears the period", async () => {
  const harness = createHarness();

  harness.etch.start();
  harness.changeStyle("color: red");
  harness.setNow(1_250);

  assert.equal(harness.etch.hasChanges(), true);
  assert.deepEqual(structuredClone(await harness.etch.finalize()), {
    inlineStyles: [{
      selector: "#target",
      tag: "div",
      added: { color: "red" },
      changed: [],
      removed: [],
    }],
    rules: [],
    dom: [],
    beforeScreenshot: "data:image/png;base64,before",
    afterScreenshot: "data:image/png;base64,after",
    duration: 250,
    changeCount: 1,
    warnings: undefined,
  });
  assert.equal(harness.etch.hasChanges(), false);
  assert.equal(await harness.etch.finalize(), null);
  assert.equal(harness.screenshotMessages.length, 2);
});

test("a finalization failure is reportable, restores the page, and consumes the period", async () => {
  const harness = createHarness({
    screenshots: [
      "data:image/png;base64,after",
      { error: "before screenshot unavailable" },
    ],
  });

  harness.etch.start();
  harness.changeStyle("color: red");

  await assert.rejects(
    harness.etch.finalize(),
    /before screenshot unavailable/,
  );
  assert.equal(harness.target.getAttribute("style"), "color: red");
  assert.equal(harness.etch.hasChanges(), false);
  assert.equal(await harness.etch.finalize(), null);
});

test("finalizing an empty annotation period omits it without capturing screenshots", async () => {
  const harness = createHarness();

  harness.etch.start();

  assert.equal(harness.etch.hasChanges(), false);
  assert.equal(await harness.etch.finalize(), null);
  assert.equal(harness.screenshotMessages.length, 0);
});

test("a resumed period starts a fresh baseline and excludes paused mutations", async () => {
  const harness = createHarness({
    screenshots: [
      "data:image/png;base64,period-1-after",
      "data:image/png;base64,period-1-before",
      "data:image/png;base64,period-2-after",
      "data:image/png;base64,period-2-before",
    ],
  });

  harness.etch.start();
  harness.changeStyle("color: red");
  await harness.etch.finalize();

  harness.changeStyle("color: blue");

  harness.etch.start();
  harness.changeStyle("color: green");
  const resumedCapture = structuredClone(await harness.etch.finalize());

  assert.deepEqual(resumedCapture.inlineStyles, [{
    selector: "#target",
    tag: "div",
    added: {},
    changed: [{ property: "color", from: "blue", to: "green" }],
    removed: [],
  }]);
  assert.equal(resumedCapture.changeCount, 1);
});

test("reset purges a pending period before a fresh recording starts", async () => {
  const harness = createHarness();

  harness.etch.start();
  harness.changeStyle("color: red");
  harness.etch.reset();

  assert.equal(harness.etch.hasChanges(), false);
  assert.equal(await harness.etch.finalize(), null);
  assert.equal(harness.screenshotMessages.length, 0);

  harness.etch.start();
  harness.changeStyle("color: blue");
  const capture = structuredClone(await harness.etch.finalize());

  assert.deepEqual(capture.inlineStyles[0].changed, [{
    property: "color",
    from: "red",
    to: "blue",
  }]);
});
