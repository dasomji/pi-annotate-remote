/**
 * Pi Annotate - page-bound draft route protection.
 *
 * The guard owns only navigation serialization. Draft state and dialog UI stay
 * with the annotator controller and are supplied through callbacks.
 */

(() => {
  const modules = (window["__piAnnotateModules_" + chrome.runtime.id] ??= {});
  if (modules.routeGuard) return;

  function createRouteGuard({
    navigation = window.navigation,
    eventTarget = window,
    isDirty,
    getOperation = () => "idle",
    settleOperation = () => Promise.resolve(),
    discardDraft,
    showDecision,
    createReplayDescriptor,
    onReplayError = () => {},
  }) {
    let started = false;
    let pending = null;

    function consumePending() {
      const retained = pending;
      pending = null;
      return retained;
    }

    async function replay(retained) {
      if (!retained) return;
      try {
        await retained.descriptor.replay();
      } catch (error) {
        onReplayError(error);
      }
    }

    async function presentAfterSettling(retained) {
      try {
        await settleOperation();
      } catch {
        // Capture/Etch errors are represented by the draft. They do not release
        // a retained route or bypass the user's navigation decision.
      }
      if (pending !== retained) return;
      if (!isDirty()) {
        consumePending();
        await replay(retained);
        return;
      }
      retained.decisionShown = true;
      showDecision();
    }

    function retainCanceledRoute(descriptor, retainedOperation = getOperation()) {
      if (pending) return false;
      if (!descriptor || typeof descriptor.replay !== "function") {
        onReplayError(new Error("The canceled route could not be retained"));
        return false;
      }

      const retained = {
        descriptor,
        operation: retainedOperation,
        decisionShown: false,
      };
      pending = retained;

      if (retained.operation !== "delivering") {
        void presentAfterSettling(retained);
      }
      return true;
    }

    function onNavigate(event) {
      if (!isDirty() || event.downloadRequest || event.cancelable !== true) return;

      // Cancellation must happen in the synchronous navigate dispatch. The
      // annotator dialog is necessarily asynchronous.
      event.preventDefault();
      if (pending) return;

      let descriptor;
      try {
        descriptor = createReplayDescriptor(event);
      } catch (error) {
        onReplayError(error);
        return;
      }
      // Delivery has its own acknowledgement boundary. A successful delivery
      // makes the draft clean and replays automatically; a failure asks.
      retainCanceledRoute(descriptor);
    }

    function onBeforeUnload(event) {
      if (!isDirty()) return;
      event.preventDefault();
      event.returnValue = "";
    }

    function start() {
      if (started) return;
      started = true;
      navigation?.addEventListener?.("navigate", onNavigate);
      eventTarget.addEventListener("beforeunload", onBeforeUnload);
    }

    function stop() {
      if (!started) return;
      started = false;
      navigation?.removeEventListener?.("navigate", onNavigate);
      eventTarget.removeEventListener("beforeunload", onBeforeUnload);
      pending = null;
    }

    function stay() {
      consumePending();
    }

    async function discardAndReplay() {
      const retained = consumePending();
      if (!retained) return;
      await discardDraft();
      await replay(retained);
    }

    async function deliverySettled({ acknowledged }) {
      const retained = pending;
      if (!retained || retained.operation !== "delivering") return;
      if (acknowledged) {
        consumePending();
        await replay(retained);
        return;
      }
      if (!retained.decisionShown) {
        retained.decisionShown = true;
        showDecision();
      }
    }

    return {
      start,
      stop,
      stay,
      discardAndReplay,
      deliverySettled,
      retainCanceledRoute,
      hasPendingRoute: () => pending !== null,
    };
  }

  modules.routeGuard = { createRouteGuard };
})();
