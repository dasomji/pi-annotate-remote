import assert from "node:assert/strict";
import test from "node:test";
import { sendAnnotationToPi } from "../index.ts";

test("annotations always use Pi's race-safe follow-up queue", () => {
  const calls = [];
  sendAnnotationToPi({
    sendUserMessage(content, options) { calls.push({ content, options }); },
  }, "Please inspect this page");
  assert.deepEqual(calls, [{
    content: "Please inspect this page",
    options: { deliverAs: "followUp" },
  }]);
});
