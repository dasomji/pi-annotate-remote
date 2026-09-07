/** Coordinates one element's Send, retry decision, and eventual settlement. */
(() => {
  const modules = (window["__piAnnotateModules_" + chrome.runtime.id] ??= {});
  if (modules.captureCoordinator) return;

  function createCaptureCoordinator({ run, getDraft, readGeometry, captureImages, onChange, onFailure, onDiscard }) {
    let failure = null;
    let lifecycle = null;
    let resolveLifecycle = null;
    let revision = 0;

    function settle() {
      resolveLifecycle?.();
      resolveLifecycle = null;
      lifecycle = null;
      failure = null;
    }

    async function send(id, sourceNode) {
      if (!run.canAnnotate()) return;
      const draft = getDraft();
      const transaction = draft.beginElementCapture({ id, sourceNode, ...readGeometry(sourceNode) });
      if (transaction.status === "busy" || transaction.status === "step-closed") return;
      if (transaction.status) {
        onFailure(transaction.status === "source-disconnected", transaction.transaction.attempt);
        return;
      }
      const token = run.beginCapture();
      if (!token) {
        draft.discardCapture(transaction);
        return;
      }
      const currentRevision = revision;
      lifecycle ||= new Promise(resolve => { resolveLifecycle = resolve; });
      failure = { transaction, sourceNode };
      onChange();
      let images;
      try {
        images = await captureImages(transaction, () => run.isCurrent(token));
      } catch (error) {
        const missing = modules.capture.missingImage("screenshot_failure", transaction.attempt, String(error));
        images = { viewportImage: missing, cropImage: missing };
      }
      if (revision !== currentRevision || getDraft() !== draft || !run.settle(token)) return;
      const result = draft.commitCapture(transaction, images);
      if (result.status === "committed") {
        settle();
      } else if (transaction.attempt >= 3) {
        draft.commitIncomplete(transaction, images);
        settle();
      } else {
        failure = { transaction, sourceNode, images };
        onFailure(false, transaction.attempt);
      }
      onChange();
    }

    async function retry() {
      if (!failure || run.operation !== "idle") return;
      if (failure.sourceNode.isConnected === false) {
        onFailure(true, failure.transaction.attempt);
        return;
      }
      await send(failure.transaction.id, failure.sourceNode);
    }

    function keepIncomplete() {
      if (!failure || run.operation !== "idle") return;
      const { transaction, sourceNode } = failure;
      const disconnected = sourceNode.isConnected === false;
      const images = failure.images || {
        viewportImage: modules.capture.missingImage(disconnected ? "source_disconnected" : "screenshot_failure", transaction.attempt),
        cropImage: modules.capture.missingImage(disconnected ? "source_disconnected" : "crop_failure", transaction.attempt),
      };
      getDraft().commitIncomplete(transaction, images);
      settle();
      onChange();
    }

    function discard() {
      if (!failure) return;
      const id = failure.transaction.id;
      getDraft().discardCapture(failure.transaction);
      settle();
      onChange();
      onDiscard(id);
    }

    return {
      send, retry, keepIncomplete, discard,
      reset() { revision += 1; settle(); },
      settled: () => lifecycle || Promise.resolve(),
    };
  }
  modules.captureCoordinator = { createCaptureCoordinator };
})();
