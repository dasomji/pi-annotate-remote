/**
 * Pi Annotate - Schema-v2 annotation draft and capture transaction model.
 *
 * This module owns all mutable v2 draft state. DOM/UI code supplies frozen
 * click-time evidence and image results through the public transaction seam.
 */

(() => {
  const modules = (window["__piAnnotateModules_" + chrome.runtime.id] ??= {});
  if (modules.draft) return;

  const MISSING_REASONS = new Set([
    "screenshot_failure",
    "crop_failure",
    "source_disconnected",
  ]);

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
  }

  function isCapturedImage(value) {
    return value?.status === "captured" &&
      value.mediaType === "image/png" &&
      typeof value.dataUrl === "string" &&
      value.dataUrl.startsWith("data:image/png;base64,");
  }

  function isMissingImage(value) {
    return value?.status === "missing" &&
      MISSING_REASONS.has(value.reason) &&
      Number.isInteger(value.attempts) &&
      value.attempts >= 1 &&
      value.attempts <= 3 &&
      (value.message === undefined || typeof value.message === "string");
  }

  function isImageResult(value) {
    return isCapturedImage(value) || isMissingImage(value);
  }

  function createDraft({ createId = () => crypto.randomUUID() } = {}) {
    const token = {};
    let steps = [];
    let context = "";
    let etchCaptures = [];
    let etchWarnings = [];
    let undoStack = [];
    let activeStep = null;
    let stepBoundaryArmed = true;
    let capture = null;

    function activeElements(step) {
      return step.elements.filter((element) => !element.deleted);
    }

    function activeSteps() {
      return steps.filter((step) => activeElements(step).length > 0);
    }

    function publicElement(element) {
      return {
        id: element.id,
        historical: element.historical,
        comment: element.comment,
        metadata: clone(element.metadata),
        cropImage: clone(element.cropImage),
      };
    }

    function stageElement({ sourceNode, metadata, url, viewport }) {
      if (!sourceNode || !metadata || typeof url !== "string" || !viewport) {
        throw new TypeError("Staging requires a source node, metadata, URL, and viewport");
      }
      if (capture) return { status: "busy" };

      if (!stepBoundaryArmed && activeStep) {
        const existing = activeStep.elements.find(
          (element) => element.sourceNode === sourceNode,
        );
        if (existing) {
          const restored = existing.deleted;
          if (restored) {
            existing.deleted = false;
            undoStack = undoStack.filter((id) => id !== existing.id);
          }
          return { status: "focused", id: existing.id, restored };
        }
      }

      if (stepBoundaryArmed || !activeStep) {
        activeStep = {
          id: createId(),
          url,
          viewport: clone(viewport),
          viewportImage: null,
          elements: [],
        };
        steps.push(activeStep);
        stepBoundaryArmed = false;
      }
      const element = {
        id: createId(),
        sourceNode,
        historical: sourceNode.isConnected === false,
        comment: "",
        metadata: clone(metadata),
        cropImage: null,
        capturePending: true,
        deleted: false,
      };
      activeStep.elements.push(element);
      return { status: "staged", stepId: activeStep.id, id: element.id };
    }

    function retargetElement({ id, sourceNode, metadata }) {
      if (capture || typeof id !== "string" || !sourceNode || !metadata) {
        return { status: "busy" };
      }
      const found = locateElement(id);
      if (!found || found.element.deleted || stepBoundaryArmed || found.step !== activeStep) {
        return { status: "step-closed" };
      }
      const duplicate = found.step.elements.find(
        (element) => !element.deleted && element.id !== id && element.sourceNode === sourceNode,
      );
      if (duplicate) return { status: "target-already-annotated", id: duplicate.id };
      found.element.sourceNode = sourceNode;
      found.element.historical = sourceNode.isConnected === false;
      found.element.metadata = clone(metadata);
      found.element.cropImage = null;
      found.element.capturePending = true;
      return { status: "retargeted", stepId: found.step.id, id };
    }

    function publicStep(step) {
      return {
        id: step.id,
        url: step.url,
        viewport: clone(step.viewport),
        viewportImage: clone(step.viewportImage),
        elements: activeElements(step).map(publicElement),
      };
    }

    function locateElement(id) {
      for (const step of steps) {
        const element = step.elements.find((candidate) => candidate.id === id);
        if (element) return { step, element };
      }
      return null;
    }

    function assertCurrent(transaction) {
      if (transaction?.draftToken !== token || capture?.transaction !== transaction) {
        throw new Error("Capture transaction is stale or does not belong to this draft");
      }
    }

    function createCaptureTransaction({
      id, retargetId, stepId, attempt, sourceNode, metadata, cropRect, url, viewport, createsStep,
    }) {
      const transaction = Object.freeze({
        draftToken: token,
        id,
        ...(retargetId ? { retargetId } : {}),
        stepId,
        attempt,
        sourceNode,
        metadata: deepFreeze(clone(metadata)),
        cropRect: deepFreeze(clone(cropRect)),
        url,
        viewport: deepFreeze(clone(viewport)),
        createsStep,
      });
      capture = { state: "capturing", sourceNode, transaction };
      return transaction;
    }

    function beginCapture({ sourceNode, metadata, cropRect = metadata?.rect, url, viewport }) {
      if (!sourceNode || !metadata || typeof url !== "string" || !viewport) {
        throw new TypeError("Capture requires a source node, metadata, URL, and viewport");
      }

      if (capture?.state === "capturing") {
        return { status: "busy" };
      }

      if (capture?.state === "failed") {
        if (capture.sourceNode !== sourceNode) return { status: "busy" };
        if (capture.transaction.attempt >= 3) {
          return { status: "attempts-exhausted", transaction: capture.transaction };
        }
        if (sourceNode.isConnected === false) {
          return { status: "source-disconnected", transaction: capture.transaction };
        }

        return createCaptureTransaction({
          id: capture.transaction.id,
          stepId: capture.transaction.stepId,
          attempt: capture.transaction.attempt + 1,
          sourceNode,
          metadata,
          cropRect,
          url,
          viewport,
          createsStep: capture.transaction.createsStep,
        });
      }

      if (!stepBoundaryArmed && activeStep) {
        const existing = activeStep.elements.find(
          (element) => element.sourceNode === sourceNode,
        );
        if (existing) {
          const restored = existing.deleted;
          if (restored) {
            existing.deleted = false;
            undoStack = undoStack.filter((id) => id !== existing.id);
          }
          return { status: "focused", id: existing.id, restored };
        }
      }

      const createsStep = stepBoundaryArmed || !activeStep;
      const stepId = createsStep ? createId() : activeStep.id;
      return createCaptureTransaction({
        id: createId(),
        stepId,
        attempt: 1,
        sourceNode,
        metadata,
        cropRect,
        url,
        viewport,
        createsStep,
      });
    }

    function beginRetarget({ id, sourceNode, metadata, cropRect = metadata?.rect, url, viewport }) {
      if (typeof id !== "string" || !sourceNode || !metadata || typeof url !== "string" || !viewport) {
        throw new TypeError("Retarget capture requires an annotation ID, source node, metadata, URL, and viewport");
      }

      if (capture?.state === "capturing") return { status: "busy" };

      if (capture?.state === "failed") {
        if (capture.transaction.retargetId !== id || capture.sourceNode !== sourceNode) {
          return { status: "busy" };
        }
        if (capture.transaction.attempt >= 3) {
          return { status: "attempts-exhausted", transaction: capture.transaction };
        }
        if (sourceNode.isConnected === false) {
          return { status: "source-disconnected", transaction: capture.transaction };
        }
        return createCaptureTransaction({
          id,
          retargetId: id,
          stepId: capture.transaction.stepId,
          attempt: capture.transaction.attempt + 1,
          sourceNode,
          metadata,
          cropRect,
          url,
          viewport,
          createsStep: false,
        });
      }

      const found = locateElement(id);
      if (!found || found.element.deleted || stepBoundaryArmed || found.step !== activeStep) {
        return { status: "step-closed" };
      }
      const duplicate = found.step.elements.find(
        (element) => !element.deleted && element.id !== id && element.sourceNode === sourceNode,
      );
      if (duplicate) return { status: "target-already-annotated", id: duplicate.id };

      return createCaptureTransaction({
        id,
        retargetId: id,
        stepId: found.step.id,
        attempt: 1,
        sourceNode,
        metadata,
        cropRect,
        url,
        viewport,
        createsStep: false,
      });
    }

    function beginElementCapture({ id, sourceNode, cropRect, url, viewport }) {
      if (typeof id !== "string" || !sourceNode || !cropRect || typeof url !== "string" || !viewport) {
        throw new TypeError("Element capture requires an annotation ID, source node, crop rectangle, URL, and viewport");
      }
      const found = locateElement(id);
      if (!found || found.element.deleted) return { status: "step-closed" };
      const metadata = found.element.metadata;
      if (capture?.state === "capturing") return { status: "busy" };
      if (capture?.state === "failed") {
        return beginRetarget({ id, sourceNode, metadata, cropRect, url, viewport });
      }
      return createCaptureTransaction({
        id,
        retargetId: id,
        stepId: found.step.id,
        attempt: 1,
        sourceNode,
        metadata,
        cropRect,
        url,
        viewport,
        createsStep: false,
      });
    }

    function commit(transaction, { viewportImage, cropImage }, incomplete) {
      assertCurrent(transaction);
      if (!isImageResult(viewportImage) || !isImageResult(cropImage)) {
        throw new TypeError("Capture commits require explicit image results");
      }
      for (const image of [viewportImage, cropImage]) {
        if (isMissingImage(image) && image.attempts !== transaction.attempt) {
          throw new TypeError("Missing-image attempts must match the capture attempt");
        }
      }

      const complete = isCapturedImage(viewportImage) && isCapturedImage(cropImage);
      if (!incomplete && !complete) {
        capture.state = "failed";
        return {
          status: "failed",
          attempt: transaction.attempt,
          transaction,
          missing: [
            !isCapturedImage(viewportImage) && "viewportImage",
            !isCapturedImage(cropImage) && "cropImage",
          ].filter(Boolean),
        };
      }
      if (incomplete && complete) {
        throw new TypeError("Incomplete commits must identify missing evidence");
      }

      if (transaction.retargetId) {
        const found = locateElement(transaction.retargetId);
        if (!found || found.element.deleted || found.step.id !== transaction.stepId) {
          throw new Error("Element capture target is no longer available");
        }
        found.element.sourceNode = transaction.sourceNode;
        found.element.historical = transaction.sourceNode.isConnected === false;
        // Metadata is frozen when the target is accepted (initial click or an
        // explicit retarget). Send-time capture contributes images only.
        found.element.metadata = clone(transaction.metadata);
        found.element.cropImage = clone(cropImage);
        found.element.capturePending = false;
        if (!isImageResult(found.step.viewportImage)) {
          found.step.url = transaction.url;
          found.step.viewport = clone(transaction.viewport);
          found.step.viewportImage = clone(viewportImage);
        }
        capture = null;
        return {
          status: "committed",
          stepId: found.step.id,
          id: found.element.id,
          incomplete,
          retargeted: true,
        };
      }

      let step = activeStep;
      if (transaction.createsStep) {
        step = {
          id: transaction.stepId,
          url: transaction.url,
          viewport: clone(transaction.viewport),
          viewportImage: clone(viewportImage),
          elements: [],
        };
        steps.push(step);
        activeStep = step;
        stepBoundaryArmed = false;
      } else if (!step || step.id !== transaction.stepId) {
        throw new Error("Capture transaction targets an unavailable step");
      }

      const element = {
        id: transaction.id,
        sourceNode: transaction.sourceNode,
        historical: transaction.sourceNode.isConnected === false,
        comment: "",
        metadata: clone(transaction.metadata),
        cropImage: clone(cropImage),
        capturePending: false,
        deleted: false,
      };
      step.elements.push(element);
      capture = null;
      return { status: "committed", stepId: step.id, id: element.id, incomplete };
    }

    function commitCapture(transaction, images) {
      return commit(transaction, images, false);
    }

    function commitIncomplete(transaction, images) {
      return commit(transaction, images, true);
    }

    function discardCapture(transaction) {
      assertCurrent(transaction);
      capture = null;
      return { status: "discarded" };
    }

    function armStepBoundary() {
      if (capture) return false;
      stepBoundaryArmed = true;
      activeStep = null;
      return true;
    }

    function isCurrentStep(id) {
      if (stepBoundaryArmed || !activeStep) return false;
      const found = locateElement(id);
      return Boolean(found && !found.element.deleted && found.step === activeStep);
    }

    function canRetarget(id) {
      return !capture && isCurrentStep(id);
    }

    function findBySource(sourceNode) {
      for (const step of steps) {
        const element = step.elements.find(
          (candidate) => candidate.sourceNode === sourceNode,
        );
        if (element) {
          return {
            stepId: step.id,
            element: publicElement(element),
            deleted: element.deleted,
          };
        }
      }
      return null;
    }

    function updateComment(id, text) {
      if (capture) return false;
      const found = locateElement(id);
      if (!found || typeof text !== "string") return false;
      found.element.comment = text;
      return true;
    }

    function softDelete(id) {
      if (capture) return false;
      const found = locateElement(id);
      if (!found || found.element.deleted) return false;
      found.element.deleted = true;
      undoStack.push(id);
      return true;
    }

    function undo() {
      if (capture) return null;
      while (undoStack.length > 0) {
        const id = undoStack.pop();
        const found = locateElement(id);
        if (found?.element.deleted) {
          found.element.deleted = false;
          return { stepId: found.step.id, id };
        }
      }
      return null;
    }

    function setContext(text) {
      if (capture || typeof text !== "string") return false;
      context = text;
      return true;
    }

    function appendEtchCapture(etchCapture) {
      if (capture) return false;
      etchCaptures.push(clone(etchCapture));
      return true;
    }

    function addEtchWarning(message) {
      if (typeof message !== "string" || !message.trim()) return false;
      etchWarnings.push(message);
      return true;
    }

    function refreshLiveness(isConnected = (node) => node?.isConnected !== false) {
      for (const step of steps) {
        for (const element of step.elements) {
          element.historical = !isConnected(element.sourceNode);
        }
      }
    }

    function hasRecoverableWork() {
      return Boolean(
        capture ||
        context.trim() ||
        etchCaptures.length ||
        steps.some((step) => step.elements.length > 0),
      );
    }

    function hasMissingEvidence() {
      return activeSteps().some((step) =>
        isMissingImage(step.viewportImage) ||
        activeElements(step).some((element) => isMissingImage(element.cropImage)));
    }

    function hasPendingEvidence() {
      return activeSteps().some((step) =>
        !isImageResult(step.viewportImage) ||
        activeElements(step).some((element) => element.capturePending || !isImageResult(element.cropImage)));
    }

    function snapshot() {
      refreshLiveness();
      const snapshotElement = (element) => ({
        ...publicElement(element),
        sourceNode: element.sourceNode,
        ...(element.capturePending === true ? { capturePending: true } : {}),
      });
      const snapshotSteps = activeSteps().map((step) => ({
        id: step.id,
        url: step.url,
        viewport: clone(step.viewport),
        viewportImage: clone(step.viewportImage),
        elements: activeElements(step).map(snapshotElement),
      }));
      const deleted = [];
      steps.forEach((step, stepIndex) => {
        step.elements.forEach((element, elementIndex) => {
          if (!element.deleted) return;
          deleted.push({
            stepId: step.id,
            stepIndex,
            stepUrl: step.url,
            stepViewport: clone(step.viewport),
            stepViewportImage: clone(step.viewportImage),
            elementIndex,
            ...snapshotElement(element),
          });
        });
      });
      return {
        context,
        steps: snapshotSteps,
        deleted,
        etchCaptures: clone(etchCaptures),
        etchWarnings: [...etchWarnings],
        canUndo: undoStack.length > 0,
        undoDepth: undoStack.length,
        hasRecoverableWork: hasRecoverableWork(),
        hasMissingEvidence: hasMissingEvidence(),
        hasPendingEvidence: hasPendingEvidence(),
        stepBoundaryArmed,
        capture: capture ? {
          state: capture.state,
          id: capture.transaction.id,
          stepId: capture.transaction.stepId,
          attempt: capture.transaction.attempt,
        } : null,
      };
    }

    function toAnnotationResult({ url }) {
      refreshLiveness();
      if (hasPendingEvidence()) {
        throw new Error("Send every Element annotation before submitting");
      }
      const deliveredSteps = activeSteps().map(publicStep);
      if (deliveredSteps.length === 0 && !context.trim()) {
        throw new Error("A zero-step annotation requires non-empty context");
      }
      const result = {
        schemaVersion: 2,
        success: true,
        url,
        steps: deliveredSteps,
      };
      if (context.trim()) result.context = context;
      if (etchCaptures.length) result.etchCaptures = clone(etchCaptures);
      if (etchWarnings.length) result.etchWarnings = [...etchWarnings];
      return result;
    }

    function purge() {
      steps = [];
      context = "";
      etchCaptures = [];
      etchWarnings = [];
      undoStack = [];
      activeStep = null;
      stepBoundaryArmed = true;
      capture = null;
    }

    return {
      armStepBoundary,
      beginCapture,
      beginRetarget,
      beginElementCapture,
      stageElement,
      retargetElement,
      canRetarget,
      isCurrentStep,
      commitCapture,
      commitIncomplete,
      discardCapture,
      findBySource,
      updateComment,
      softDelete,
      undo,
      setContext,
      appendEtchCapture,
      addEtchWarning,
      refreshLiveness,
      hasRecoverableWork,
      hasMissingEvidence,
      hasPendingEvidence,
      snapshot,
      toAnnotationResult,
      purge,
    };
  }

  modules.draft = { createDraft };
})();
