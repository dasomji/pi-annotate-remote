import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(
  new URL("../chrome-extension/content-route-guard.js", import.meta.url),
  "utf8",
);

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }

  dispatch(type, event) {
    this.listeners.get(type)?.(event);
  }
}

function createHarness({ operation = "idle" } = {}) {
  const navigation = new FakeEventTarget();
  const browserWindow = new FakeEventTarget();
  browserWindow.navigation = navigation;
  const modules = {};
  browserWindow.__piAnnotateModules_test = modules;

  vm.runInContext(source, vm.createContext({
    chrome: { runtime: { id: "test" } },
    console,
    window: browserWindow,
  }), { filename: "content-route-guard.js" });

  let dirty = false;
  let currentOperation = operation;
  let settle;
  const settled = new Promise((resolve) => { settle = resolve; });
  const decisions = [];
  const replays = [];
  let discardCount = 0;

  const guard = modules.routeGuard.createRouteGuard({
    navigation,
    eventTarget: browserWindow,
    isDirty: () => dirty,
    getOperation: () => currentOperation,
    settleOperation: () => currentOperation === "capturing" ? settled : Promise.resolve(),
    discardDraft: async () => {
      discardCount += 1;
      dirty = false;
    },
    showDecision: () => decisions.push("shown"),
    createReplayDescriptor: (event) => ({
      replay: async () => { replays.push(event.destination.url); },
    }),
  });
  guard.start();

  function navigate(url = "https://example.test/next") {
    let prevented = false;
    const event = {
      cancelable: true,
      destination: { url },
      preventDefault() { prevented = true; },
    };
    navigation.dispatch("navigate", event);
    return { event, prevented: () => prevented };
  }

  return {
    browserWindow,
    decisions,
    guard,
    navigate,
    replays,
    settle,
    setDirty(value) { dirty = value; },
    setOperation(value) { currentOperation = value; },
    discardCount: () => discardCount,
  };
}

const settleTasks = () => new Promise((resolve) => setImmediate(resolve));

test("dirty cancelable navigation is stopped synchronously before the decision is shown", async () => {
  const harness = createHarness();
  harness.setDirty(true);

  const attempt = harness.navigate();
  assert.equal(attempt.prevented(), true);
  assert.deepEqual(harness.decisions, []);

  await settleTasks();
  assert.deepEqual(harness.decisions, ["shown"]);
});

test("Stay preserves the draft and a later route gets a fresh decision", async () => {
  const harness = createHarness();
  harness.setDirty(true);
  harness.navigate("https://example.test/first");
  await settleTasks();

  harness.guard.stay();
  harness.navigate("https://example.test/second");
  await settleTasks();

  assert.deepEqual(harness.decisions, ["shown", "shown"]);
  assert.deepEqual(harness.replays, []);
});

test("Discard purges the draft and replays the exact retained route once", async () => {
  const harness = createHarness();
  harness.setDirty(true);
  harness.navigate("https://example.test/retained");
  await settleTasks();

  await harness.guard.discardAndReplay();
  await harness.guard.discardAndReplay();

  assert.equal(harness.discardCount(), 1);
  assert.deepEqual(harness.replays, ["https://example.test/retained"]);
});

test("repeated routes are canceled but not queued while one decision is pending", async () => {
  const harness = createHarness();
  harness.setDirty(true);
  const first = harness.navigate("https://example.test/first");
  const second = harness.navigate("https://example.test/second");
  await settleTasks();

  assert.equal(first.prevented(), true);
  assert.equal(second.prevented(), true);
  assert.deepEqual(harness.decisions, ["shown"]);

  await harness.guard.discardAndReplay();
  assert.deepEqual(harness.replays, ["https://example.test/first"]);
});

test("an already-canceled form route uses the same serialized decision seam", async () => {
  const harness = createHarness();
  harness.setDirty(true);

  const accepted = harness.guard.retainCanceledRoute({
    replay: async () => { harness.replays.push("post-form"); },
  });
  const competing = harness.guard.retainCanceledRoute({
    replay: async () => { harness.replays.push("competing"); },
  });
  await settleTasks();

  assert.equal(accepted, true);
  assert.equal(competing, false);
  assert.deepEqual(harness.decisions, ["shown"]);

  await harness.guard.discardAndReplay();
  assert.deepEqual(harness.replays, ["post-form"]);
});

test("capture settles before the route decision is presented", async () => {
  const harness = createHarness({ operation: "capturing" });
  harness.setDirty(true);
  harness.navigate();
  await Promise.resolve();
  assert.deepEqual(harness.decisions, []);

  harness.setOperation("idle");
  harness.settle();
  await settleTasks();
  assert.deepEqual(harness.decisions, ["shown"]);
});

test("delivery acknowledgement replays automatically while failure asks the user", async () => {
  const acknowledged = createHarness({ operation: "delivering" });
  acknowledged.setDirty(true);
  acknowledged.navigate("https://example.test/after-delivery");
  await settleTasks();
  assert.deepEqual(acknowledged.decisions, []);

  acknowledged.setDirty(false);
  await acknowledged.guard.deliverySettled({ acknowledged: true });
  assert.deepEqual(acknowledged.replays, ["https://example.test/after-delivery"]);

  const failed = createHarness({ operation: "delivering" });
  failed.setDirty(true);
  failed.navigate();
  await failed.guard.deliverySettled({ acknowledged: false });
  assert.deepEqual(failed.decisions, ["shown"]);
});

test("beforeunload uses the native fallback only while recoverable work exists", () => {
  const harness = createHarness();
  let prevented = false;
  const event = {
    returnValue: undefined,
    preventDefault() { prevented = true; },
  };

  harness.browserWindow.dispatch("beforeunload", event);
  assert.equal(prevented, false);

  harness.setDirty(true);
  harness.browserWindow.dispatch("beforeunload", event);
  assert.equal(prevented, true);
  assert.equal(event.returnValue, "");
});
