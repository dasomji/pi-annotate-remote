import assert from "node:assert/strict";
import test from "node:test";
import { sendAnnotationToPi } from "../index.ts";

function createPiHarness() {
  const calls = [];
  return {
    calls,
    pi: {
      sendUserMessage(content, options) {
        calls.push({ content, options });
      },
    },
  };
}

test("queues an annotation as a Pi follow-up while the agent is busy", () => {
  const harness = createPiHarness();

  const disposition = sendAnnotationToPi(
    harness.pi,
    "## Page Annotation: https://example.test",
    { isIdle: () => false },
  );

  assert.equal(disposition, "queued");
  assert.deepEqual(harness.calls, [{
    content: "## Page Annotation: https://example.test",
    options: { deliverAs: "followUp" },
  }]);
});

test("uses the race-safe follow-up delivery option even when Pi is currently idle", () => {
  const harness = createPiHarness();

  const disposition = sendAnnotationToPi(
    harness.pi,
    "## Page Annotation: https://example.test",
    { isIdle: () => true },
  );

  assert.equal(disposition, "delivered");
  assert.deepEqual(harness.calls[0].options, { deliverAs: "followUp" });
});
