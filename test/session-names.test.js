import assert from "node:assert/strict";
import test from "node:test";
import {
  SESSION_NAMES,
  chooseAvailableSessionName,
  formatNamedSessionLabel,
} from "../broker/session-names.js";

test("the annotation session name pool contains 100 distinct common names", () => {
  assert.equal(SESSION_NAMES.length, 100);
  assert.equal(new Set(SESSION_NAMES).size, 100);
  assert.ok(SESSION_NAMES.every((name) => /^[A-Z][a-z]+$/.test(name)));
});

test("name allocation stays unique, reports exhaustion, and reuses released names", () => {
  const activeNames = new Set();
  for (let index = 0; index < SESSION_NAMES.length; index += 1) {
    const name = chooseAvailableSessionName(`session-${index}`, activeNames);
    assert.ok(name);
    assert.equal(activeNames.has(name), false);
    activeNames.add(name);
  }

  assert.equal(chooseAvailableSessionName("session-overflow", activeNames), null);
  const released = SESSION_NAMES[37];
  activeNames.delete(released);
  assert.equal(chooseAvailableSessionName("session-after-release", activeNames), released);
});

test("named session labels reserve room for the complete human name", () => {
  const label = formatNamedSessionLabel("x".repeat(250), "Benjamin");

  assert.equal(label.length, 200);
  assert.match(label, / · Benjamin$/);
});
