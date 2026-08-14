/**
 * Pi Annotate - annotation-run lifecycle.
 *
 * Owns the legal state transitions for one page-bound annotation run. DOM,
 * draft, capture, Etch, and route effects stay in the controller as adapters.
 */

(() => {
  const modules = (window["__piAnnotateModules_" + chrome.runtime.id] ??= {});
  if (modules.run) return;

  const INACTIVE = Object.freeze({
    active: false,
    sessionId: null,
    mode: "annotating",
    operation: "idle",
    modal: "none",
  });

  function createAnnotationRun() {
    let generation = 0;
    let operationId = 0;
    let state = { ...INACTIVE };

    function operationToken(kind) {
      return Object.freeze({ generation, id: ++operationId, kind });
    }

    function tokenMatches(token) {
      return token?.generation === generation &&
        token.id === operationId &&
        token.kind === state.operation;
    }

    function start(sessionId) {
      generation += 1;
      operationId = 0;
      state = {
        active: true,
        sessionId: typeof sessionId === "string" ? sessionId : null,
        mode: "annotating",
        operation: "idle",
        modal: "none",
      };
      return generation;
    }

    function stop() {
      generation += 1;
      operationId = 0;
      state = { ...INACTIVE };
    }

    function canBegin(kind, requiredMode = null) {
      if (!state.active || state.operation !== "idle" || state.modal !== "none") return null;
      if (requiredMode && state.mode !== requiredMode) return null;
      state.operation = kind;
      return operationToken(kind);
    }

    function settle(token) {
      if (!tokenMatches(token)) return false;
      state.operation = "idle";
      return true;
    }

    function finishPause(token) {
      if (!tokenMatches(token) || state.operation !== "pausing") return false;
      state.mode = "interacting";
      state.operation = "idle";
      return true;
    }

    function resume() {
      if (!state.active || state.mode !== "interacting" ||
          state.operation !== "idle" || state.modal !== "none") return false;
      state.mode = "annotating";
      return true;
    }

    function openModal(kind) {
      if (!state.active || state.operation !== "idle" || state.modal !== "none" ||
          typeof kind !== "string" || kind === "none") return false;
      state.modal = kind;
      return true;
    }

    function closeModal() {
      state.modal = "none";
    }

    function snapshot() {
      return Object.freeze({ generation, ...state });
    }

    return Object.freeze({
      start,
      stop,
      beginCapture: () => canBegin("capturing", "annotating"),
      beginPause: () => canBegin("pausing", "annotating"),
      beginDelivery: () => canBegin("delivering"),
      settle,
      finishPause,
      resume,
      openModal,
      closeModal,
      canAnnotate: () => state.active && state.mode === "annotating" &&
        state.operation === "idle" && state.modal === "none",
      ownsPageClicks: () => state.active && state.mode === "annotating",
      isCurrent: tokenMatches,
      snapshot,
      get active() { return state.active; },
      get sessionId() { return state.sessionId; },
      get mode() { return state.mode; },
      get operation() { return state.operation; },
      get modal() { return state.modal; },
    });
  }

  modules.run = { createAnnotationRun };
})();
