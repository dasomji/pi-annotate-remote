/**
 * Pi Annotate - page controller.
 *
 * Keeps annotation/interaction mode, the current operation, and modal state
 * orthogonal. Draft and capture invariants live in content-draft.js.
 */
(() => {
  const LOADED_KEY = "__piAnnotate_" + chrome.runtime.id;
  if (window[LOADED_KEY]) return;
  window[LOADED_KEY] = true;

  const modules = window["__piAnnotateModules_" + chrome.runtime.id];
  const { STYLES } = modules.styles;
  const inspect = modules.inspect;
  const capture = modules.capture;
  const etch = modules.etch;
  const { createDraft } = modules.draft;
  const { createRouteGuard } = modules.routeGuard;

  const TEXT_MAX_LENGTH = 500;
  let nextId = 0;
  const makeId = () => globalThis.crypto?.randomUUID?.() || `annotation-${++nextId}`;

  let active = false;
  let sessionId = null;
  let mode = "annotating";
  let operation = "idle";
  let modal = "none";
  let minimized = false;
  let etchEnabled = false;
  let debugMode = false;
  let stepFilter = "all";
  let stepsExpanded = false;
  let activeRecordId = null;
  let hovered = null;
  let hoverStack = [];
  let hoverIndex = 0;
  let capturePromise = null;
  let captureLifecyclePromise = null;
  let resolveCaptureLifecycle = null;
  let transitionPromise = null;
  let failedCapture = null;
  let deliveryError = "";
  let deliveryConfirmedDegraded = false;
  let lastFocusedControl = null;
  let routeDialog = null;
  let bubbleDrag = null;
  let noteDrag = null;
  let bubbleDragged = false;
  let bubblePosition = null;
  let escapeCount = 0;
  let escapeTimer = null;
  let livenessObserver = null;
  let livenessFrame = null;
  let captureReturnTimer = null;

  let draft = createDraft({ createId: makeId });
  const records = new Map();
  let styleEl;
  let panelEl;
  let highlightEl;
  let connectorsEl;
  let markersEl;
  let notesEl;

  function byId(id) {
    return document.getElementById(id);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== "START_ANNOTATION") return;
    sessionId = typeof message.sessionId === "string" ? message.sessionId : null;
    if (active) resetDraft();
    else activate();
    sendResponse({ started: true });
  });

  function activate() {
    active = true;
    styleEl = document.createElement("style");
    styleEl.id = "pi-styles";
    styleEl.textContent = STYLES;
    (document.head || document.documentElement).appendChild(styleEl);

    highlightEl = document.createElement("div");
    highlightEl.id = "pi-highlight";
    highlightEl.style.display = "none";
    document.body.appendChild(highlightEl);

    connectorsEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    connectorsEl.classList.add("pi-connectors");
    connectorsEl.setAttribute("aria-hidden", "true");
    document.body.appendChild(connectorsEl);

    markersEl = document.createElement("div");
    markersEl.id = "pi-markers";
    document.body.appendChild(markersEl);

    notesEl = document.createElement("div");
    notesEl.className = "pi-notes-container";
    document.body.appendChild(notesEl);

    createPanel();
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("click", onPageClick, true);
    document.addEventListener("wheel", onWheel, { capture: true, passive: false });
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("mousemove", onDragMove, true);
    document.addEventListener("mouseup", endBubbleDrag, true);
    document.addEventListener("submit", onFormSubmit, true);
    document.addEventListener("formdata", onFormData, true);
    window.addEventListener("scroll", renderEvidence, true);
    window.addEventListener("resize", onResize);
    if (typeof MutationObserver !== "undefined") {
      livenessObserver = new MutationObserver(onPageMutations);
      livenessObserver.observe(document.body, { childList: true, subtree: true });
    }
    document.body.style.cursor = "crosshair";
    routeGuard.start();
    render();
  }

  function createPanel() {
    const grinsekatzeIcon = chrome.runtime.getURL?.("assets/grinsekatze.svg") ||
      "assets/grinsekatze.svg";
    panelEl = document.createElement("div");
    panelEl.id = "pi-panel";
    panelEl.innerHTML = `
      <button class="pi-resume-bubble" id="pi-resume-bubble" type="button"
        aria-label="Resume annotation" title="Resume annotation">
        <img class="pi-bubble-logo" src="${grinsekatzeIcon}" alt=""><span>Resume</span>
      </button>
      <button class="pi-minimized-bubble" id="pi-minimized-bubble" type="button"
        aria-label="Restore annotation bar" title="Restore annotation bar">
        <img class="pi-bubble-logo" src="${grinsekatzeIcon}" alt=""><span class="pi-bubble-count" id="pi-bubble-count">0</span>
      </button>
      <nav class="pi-step-strip" aria-label="Interaction steps">
        <button class="pi-btn pi-btn-secondary pi-steps-toggle" id="pi-steps-toggle"
          type="button" aria-expanded="false" aria-controls="pi-filmstrip">Steps</button>
        <div class="pi-filmstrip" id="pi-filmstrip" aria-label="Interaction steps">
          <button class="pi-step-filter active" id="pi-filter-all" data-step="all"
            aria-pressed="true">All steps</button>
        </div>
        <button class="pi-btn pi-btn-pause" id="pi-pause">Interact with page</button>
        <button class="pi-btn pi-btn-secondary" id="pi-undo" hidden>Undo delete</button>
        <details class="pi-advanced" id="pi-advanced">
          <summary role="button" aria-label="More options" title="More options">•••</summary>
          <div class="pi-advanced-menu">
            <label class="pi-notes-toggle pi-etch-toggle">
              <input type="checkbox" id="pi-etch-mode" aria-label="Etch"><span aria-hidden="true">Etch</span>
              <span class="pi-etch-badge" id="pi-etch-count" style="display:none"></span>
            </label>
            <label class="pi-notes-toggle" title="Include computed CSS, parent layout, and CSS variables">
              <input type="checkbox" id="pi-debug-mode"><span>Debug capture</span>
            </label>
          </div>
        </details>
        <button class="pi-icon-button pi-help" id="pi-help" aria-label="How to annotate" title="How to annotate">?</button>
        <button class="pi-icon-button pi-minimize" id="pi-minimize" aria-label="Minimize annotation bar" title="Minimize">−</button>
        <button class="pi-icon-button pi-close" id="pi-close" aria-label="Cancel annotation" title="Close">×</button>
      </nav>
      <div class="pi-composer" role="group" aria-label="Annotation composer">
        <textarea id="pi-context" rows="2" aria-label="General context"
          placeholder="General context (optional)..."></textarea>
        <div class="pi-composer-status">
          <span class="pi-capture-status" id="pi-capture-status" role="status" aria-live="polite"></span>
          <div class="pi-delivery-error" id="pi-delivery-error" role="alert" aria-live="assertive" hidden></div>
        </div>
        <button class="pi-btn pi-btn-submit" id="pi-submit">Submit</button>
      </div>`;
    document.body.appendChild(panelEl);

    byId("pi-pause")?.addEventListener("click", pause);
    byId("pi-resume-bubble")?.addEventListener("mousedown", beginBubbleDrag);
    byId("pi-resume-bubble")?.addEventListener("click", activateResumeBubble);
    byId("pi-minimized-bubble")?.addEventListener("mousedown", beginBubbleDrag);
    byId("pi-minimized-bubble")?.addEventListener("click", restorePanel);
    byId("pi-minimize")?.addEventListener("click", () => setMinimized(true));
    byId("pi-close")?.addEventListener("click", showAbortDialog);
    byId("pi-help")?.addEventListener("click", showHelpDialog);
    byId("pi-submit")?.addEventListener("click", submit);
    byId("pi-undo")?.addEventListener("click", undoDelete);
    byId("pi-filter-all")?.addEventListener("click", () => setFilter("all"));
    byId("pi-steps-toggle")?.addEventListener("click", () => {
      stepsExpanded = !stepsExpanded;
      render();
    });
    byId("pi-context")?.addEventListener("input", (event) => {
      if (operation === "idle") draft.setContext(event.target.value);
    });
    byId("pi-etch-mode")?.addEventListener("change", (event) => {
      if (operation !== "idle") {
        event.target.checked = etchEnabled;
        return;
      }
      etchEnabled = event.target.checked;
      event.target.closest?.(".pi-etch-toggle")?.classList.toggle("recording", etchEnabled);
      if (etchEnabled && mode === "annotating") etch.start();
      else etch.stop();
    });
    byId("pi-debug-mode")?.addEventListener("change", (event) => {
      if (operation === "idle") {
        debugMode = event.target.checked;
        render();
      }
      else event.target.checked = debugMode;
    });
  }

  function resetDraft() {
    settleCaptureLifecycle();
    cleanupCaptureReturnAnimation();
    etch.reset();
    draft.purge();
    draft = createDraft({ createId: makeId });
    records.clear();
    mode = "annotating";
    operation = "idle";
    modal = "none";
    minimized = false;
    etchEnabled = false;
    debugMode = false;
    stepFilter = "all";
    stepsExpanded = false;
    activeRecordId = null;
    noteDrag = null;
    failedCapture = null;
    deliveryError = "";
    deliveryConfirmedDegraded = false;
    byId("pi-context") && (byId("pi-context").value = "");
    byId("pi-etch-mode") && (byId("pi-etch-mode").checked = false);
    byId("pi-debug-mode") && (byId("pi-debug-mode").checked = false);
    closeModal();
    render();
  }

  function deactivate({ purge = true } = {}) {
    if (!active) return;
    active = false;
    settleCaptureLifecycle();
    cleanupCaptureReturnAnimation();
    routeGuard.stop();
    if (purge) draft.purge();
    etch.reset();
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onPageClick, true);
    document.removeEventListener("wheel", onWheel, { capture: true });
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("mousemove", onDragMove, true);
    document.removeEventListener("mouseup", endBubbleDrag, true);
    document.removeEventListener("submit", onFormSubmit, true);
    document.removeEventListener("formdata", onFormData, true);
    window.removeEventListener("scroll", renderEvidence, true);
    window.removeEventListener("resize", onResize);
    livenessObserver?.disconnect();
    livenessObserver = null;
    if (livenessFrame !== null) cancelAnimationFrame(livenessFrame);
    livenessFrame = null;
    document.body.style.cursor = "";
    closeModal();
    for (const element of [styleEl, panelEl, highlightEl, connectorsEl, markersEl, notesEl]) element?.remove();
    styleEl = panelEl = highlightEl = connectorsEl = markersEl = notesEl = null;
    records.clear();
    activeRecordId = null;
    noteDrag = null;
    sessionId = null;
  }

  function freezeMetadata(element) {
    const data = {
      selector: inspect.generateSelector(element),
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      classes: Array.from(element.classList),
      text: (element.textContent || "").slice(0, TEXT_MAX_LENGTH).trim().replace(/\s+/g, " "),
      rect: inspect.getRectData(element),
      attributes: inspect.getAttrs(element),
      boxModel: inspect.getBoxModel(element),
      accessibility: inspect.getAccessibilityInfo(element),
      keyStyles: inspect.getKeyStyles(element),
    };
    if (debugMode) {
      data.computedStyles = inspect.getComputedStyles(element);
      data.parentContext = inspect.getParentContext(element);
      data.cssVariables = inspect.getCSSVariables(element);
    }
    return data;
  }

  function selectElement(sourceNode) {
    if (mode !== "annotating" || operation !== "idle" || modal !== "none") return;
    const result = draft.stageElement({
      sourceNode,
      metadata: freezeMetadata(sourceNode),
      url: window.location.href,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    });
    if (result.status === "focused") {
      render();
      focusRecord(result.id);
      return;
    }
    if (result.status !== "staged") return;
    records.set(result.id, {
      id: result.id,
      stepId: result.stepId,
      sourceNode,
      navigation: { path: [sourceNode], index: 0 },
      notePosition: null,
      noteOpen: true,
    });
    stepFilter = result.stepId;
    deliveryConfirmedDegraded = false;
    render();
    createNote(result.id);
  }

  async function captureElement(sourceNode, { retargetId = null } = {}) {
    if (mode !== "annotating" || operation !== "idle" || modal !== "none") return;
    const metadata = freezeMetadata(sourceNode);
    const clientRect = sourceNode.getBoundingClientRect();
    const cropRect = {
      x: clientRect.left,
      y: clientRect.top,
      width: clientRect.width,
      height: clientRect.height,
    };
    if (!captureLifecyclePromise) {
      captureLifecyclePromise = new Promise((resolve) => { resolveCaptureLifecycle = resolve; });
    }
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const transaction = (retargetId ? draft.beginElementCapture : draft.beginCapture)({
      ...(retargetId ? { id: retargetId } : {}),
      sourceNode,
      metadata,
      cropRect,
      url: window.location.href,
      viewport,
    });
    if (transaction.status === "busy") return;
    if (transaction.status === "focused") {
      settleCaptureLifecycle();
      render();
      focusRecord(transaction.id);
      return;
    }
    if (transaction.status === "step-closed") {
      settleCaptureLifecycle();
      render();
      return;
    }
    if (transaction.status === "target-already-annotated") {
      settleCaptureLifecycle();
      render();
      focusRecord(transaction.id);
      return;
    }
    if (transaction.status === "source-disconnected" ||
        transaction.status === "attempts-exhausted") {
      failedCapture = {
        transaction: transaction.transaction,
        sourceNode,
        metadata,
      };
      showCaptureFailure(transaction.status === "source-disconnected");
      return;
    }

    operation = "capturing";
    failedCapture = { transaction, sourceNode, metadata };
    render();
    capturePromise = performCapture(transaction);
    await capturePromise;
    capturePromise = null;
    render();
  }

  async function performCapture(transaction) {
    // Let the live-region progress state paint before temporarily removing the
    // extension chrome from the source bitmap.
    await twoFrames();
    const restore = hideChrome();
    let returnAnimationStarted = false;
    const restoreWithFlourish = () => {
      restore();
      if (returnAnimationStarted) return;
      returnAnimationStarted = true;
      playCaptureReturnAnimation();
    };
    await twoFrames();
    let viewportImage;
    let cropImage;
    try {
      const response = await chrome.runtime.sendMessage({ type: "CAPTURE_SCREENSHOT" });
      if (!response?.dataUrl) throw new Error(response?.error || "Visible viewport capture failed");
      viewportImage = capture.capturedImage(response.dataUrl);
      // The raw viewport is already frozen, so restore progress chrome while
      // the crop is decoded and validated.
      restoreWithFlourish();
      try {
        cropImage = await capture.cropToRect(response.dataUrl, {
          rect: transaction.cropRect,
          viewport: transaction.viewport,
          dpr: window.devicePixelRatio || 1,
        });
      } catch (error) {
        cropImage = capture.missingImage("crop_failure", transaction.attempt, errorMessage(error));
      }
    } catch (error) {
      viewportImage = capture.missingImage("screenshot_failure", transaction.attempt, errorMessage(error));
      cropImage = capture.missingImage("screenshot_failure", transaction.attempt, errorMessage(error));
    } finally {
      restoreWithFlourish();
    }

    const result = draft.commitCapture(transaction, { viewportImage, cropImage });
    operation = "idle";
    if (result.status === "committed") {
      finalizeCommittedCapture(result, transaction);
      return;
    }
    failedCapture = {
      transaction,
      sourceNode: transaction.sourceNode,
      images: { viewportImage, cropImage },
    };
    if (transaction.attempt >= 3) {
      const committed = draft.commitIncomplete(transaction, { viewportImage, cropImage });
      finalizeCommittedCapture(committed, transaction);
      return;
    }
    showCaptureFailure(false);
  }

  async function retryCapture() {
    if (!failedCapture || operation !== "idle") return;
    const pending = failedCapture;
    closeModal();
    if (pending.sourceNode.isConnected === false) {
      showCaptureFailure(true);
      return;
    }
    await captureElement(pending.sourceNode, {
      retargetId: pending.transaction.retargetId || null,
    });
  }

  function keepIncomplete() {
    if (!failedCapture || operation !== "idle") return;
    const transaction = failedCapture.transaction;
    const attempt = transaction.attempt;
    const disconnected = failedCapture.sourceNode.isConnected === false;
    const images = failedCapture.images || {
      viewportImage: capture.missingImage(
        disconnected ? "source_disconnected" : "screenshot_failure", attempt),
      cropImage: capture.missingImage(
        disconnected ? "source_disconnected" : "crop_failure", attempt),
    };
    const result = draft.commitIncomplete(transaction, images);
    commitRecord(result, transaction);
    selectCreatedStep(transaction, result);
    failedCapture = null;
    settleCaptureLifecycle();
    deliveryConfirmedDegraded = false;
    closeModal();
    render();
  }

  function selectCreatedStep(transaction, result) {
    if (transaction.createsStep) stepFilter = result.stepId;
  }

  function finalizeCommittedCapture(result, transaction) {
    commitRecord(result, transaction);
    selectCreatedStep(transaction, result);
    failedCapture = null;
    settleCaptureLifecycle();
    deliveryConfirmedDegraded = false;
    render();
  }

  function commitRecord(result, transaction) {
    const existing = records.get(result.id);
    if (!existing) {
      records.set(result.id, {
        id: result.id,
        stepId: result.stepId,
        sourceNode: transaction.sourceNode,
        navigation: { path: [transaction.sourceNode], index: 0 },
        notePosition: null,
        noteOpen: true,
      });
      return;
    }
    existing.sourceNode = transaction.sourceNode;
    existing.stepId = result.stepId;
  }

  function discardFailedCapture() {
    const id = failedCapture?.transaction?.id;
    if (failedCapture) draft.discardCapture(failedCapture.transaction);
    failedCapture = null;
    settleCaptureLifecycle();
    closeModal();
    render();
    if (id && records.has(id)) createNote(id);
  }

  function showCaptureFailure(disconnected) {
    const attempt = failedCapture?.transaction?.attempt || 1;
    const terminal = attempt >= 3 || disconnected;
    showModal("captureFailure", {
      title: disconnected ? "Source element is no longer available" : "Screenshot capture failed",
      description: terminal
        ? "Keep the frozen element as incomplete evidence, or discard it."
        : `Attempt ${attempt} of 3 failed. Retry captures a fresh point in time.`,
      actions: terminal
        ? [["Keep incomplete", keepIncomplete, "primary"], ["Discard", discardFailedCapture]]
        : [["Retry", retryCapture, "primary"], ["Discard", discardFailedCapture]],
    });
  }

  async function pause() {
    if (mode !== "annotating" || operation !== "idle" || modal !== "none") return;
    operation = "pausing";
    render();
    transitionPromise = (async () => {
      await finalizeEtchPeriod("Etch capture could not be finalized while pausing");
      mode = "interacting";
      operation = "idle";
      minimized = false;
      document.body.style.cursor = "";
      render();
    })();
    await transitionPromise;
    transitionPromise = null;
  }

  function activateResumeBubble() {
    if (bubbleDragged) {
      bubbleDragged = false;
      return;
    }
    resume();
  }

  function resume() {
    if (mode !== "interacting" || operation !== "idle") return;
    mode = "annotating";
    draft.armStepBoundary();
    document.body.style.cursor = "crosshair";
    if (etchEnabled) etch.start();
    render();
    byId("pi-pause")?.focus();
  }

  async function finalizeEtchPeriod(warning) {
    if (!etchEnabled) return;
    const restore = hideChrome();
    await twoFrames();
    try {
      const finalized = await etch.finalize();
      if (finalized?.changeCount > 0) draft.appendEtchCapture(finalized);
    } catch (error) {
      console.error("[pi-annotate] Etch period finalization failed:", error);
      draft.addEtchWarning(`${warning}: ${errorMessage(error)}`);
    } finally {
      restore();
    }
  }

  async function submit() {
    if (operation !== "idle" || modal !== "none") return;
    if (!sessionId) {
      setDeliveryError("No Pi annotation session is selected. Start again from the session chooser.");
      return;
    }
    draft.setContext(byId("pi-context")?.value || "");
    if (draft.hasPendingEvidence()) {
      setDeliveryError("Send every open Element annotation before submitting.");
      render();
      return;
    }
    if (draft.hasMissingEvidence() && !deliveryConfirmedDegraded) {
      const affected = missingEvidenceLabels(draft.snapshot());
      showModal("degradedDelivery", {
        title: "Some screenshots are missing",
        description: `Missing evidence: ${affected.join("; ")}. Return to the draft, or explicitly submit the incomplete evidence.`,
        actions: [
          ["Submit without screenshots", () => {
            deliveryConfirmedDegraded = true;
            closeModal();
            void submit();
          }, "primary"],
          ["Return to draft", closeModal],
        ],
      });
      return;
    }

    operation = "delivering";
    deliveryError = "";
    render();
    await finalizeEtchPeriod("Etch capture could not be finalized for submission");
    draft.refreshLiveness();
    let result;
    try {
      result = draft.toAnnotationResult({ url: window.location.href });
    } catch (error) {
      operation = "idle";
      restartEtchAfterDeliveryAttempt();
      setDeliveryError(errorMessage(error));
      render();
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: "ANNOTATIONS_COMPLETE",
        sessionId,
        result,
      });
      if (!response?.delivered) throw new Error(response?.error || "The broker did not acknowledge delivery");
      draft.purge();
      await routeGuard.deliverySettled({ acknowledged: true });
      deactivate({ purge: false });
    } catch (error) {
      operation = "idle";
      restartEtchAfterDeliveryAttempt();
      setDeliveryError(`Delivery failed: ${errorMessage(error)}`);
      render();
      await routeGuard.deliverySettled({ acknowledged: false });
    }
  }

  function restartEtchAfterDeliveryAttempt() {
    if (etchEnabled && mode === "annotating") etch.start();
  }

  function missingEvidenceLabels(snapshot) {
    const affected = [];
    snapshot.steps.forEach((step, stepIndex) => {
      if (step.viewportImage.status !== "captured") {
        affected.push(`Step ${stepIndex + 1} viewport`);
      }
      step.elements.forEach((element, elementIndex) => {
        if (element.cropImage.status !== "captured") {
          affected.push(`Step ${stepIndex + 1}, element ${elementIndex + 1} crop`);
        }
      });
    });
    return affected;
  }

  function render() {
    if (!panelEl) return;
    panelEl.classList.toggle("pi-interacting", mode === "interacting");
    panelEl.classList.toggle("pi-minimized", minimized && mode === "annotating");
    panelEl.classList.toggle("pi-busy", operation !== "idle");
    projectPanelPosition();
    const busy = operation !== "idle";
    const snapshot = draft.snapshot();
    const draftMutationBlocked = busy || snapshot.capture !== null;
    for (const id of ["pi-pause", "pi-submit", "pi-close", "pi-undo", "pi-help", "pi-minimize", "pi-steps-toggle", "pi-context", "pi-etch-mode", "pi-debug-mode"]) {
      const control = byId(id);
      if (control) control.disabled = draftMutationBlocked;
    }
    const status = byId("pi-capture-status");
    if (status) status.textContent =
      operation === "capturing" ? "Capturing element evidence…" :
      operation === "pausing" ? "Finishing captured edits…" :
      operation === "delivering" ? "Sending annotation…" :
      snapshot.etchWarnings.at(-1) || "";
    const submitButton = byId("pi-submit");
    if (submitButton) {
      submitButton.disabled = draftMutationBlocked;
      submitButton.textContent = operation === "delivering" ? "Sending…" : (deliveryError ? "Retry" : "Submit");
      submitButton.title = snapshot.hasPendingEvidence
        ? "Send every open Element annotation before submitting"
        : "";
    }
    const undo = byId("pi-undo");
    if (undo) {
      undo.hidden = !snapshot.canUndo;
      undo.disabled = draftMutationBlocked;
    }
    const bubbleCount = byId("pi-bubble-count");
    if (bubbleCount) bubbleCount.textContent = String(snapshot.steps.reduce(
      (count, step) => count + step.elements.length, 0));
    const advanced = byId("pi-advanced");
    advanced?.classList.toggle("pi-debug-enabled", debugMode);
    advanced?.querySelector?.("summary")?.setAttribute(
      "aria-label", debugMode ? "More options, Debug capture enabled" : "More options");
    panelEl.classList.toggle("pi-steps-expanded", stepsExpanded);
    byId("pi-steps-toggle")?.setAttribute("aria-expanded", String(stepsExpanded));
    panelEl.setAttribute("aria-busy", String(draftMutationBlocked));
    panelEl.querySelectorAll?.(".pi-step-filter").forEach((control) => { control.disabled = draftMutationBlocked; });
    notesEl?.querySelectorAll?.("button, textarea").forEach((control) => { control.disabled = draftMutationBlocked; });
    const error = byId("pi-delivery-error");
    if (error) {
      error.textContent = deliveryError;
      error.hidden = !deliveryError;
    }
    const evidenceVisible = mode === "annotating";
    if (connectorsEl) connectorsEl.style.display = evidenceVisible ? "" : "none";
    if (markersEl) markersEl.style.display = evidenceVisible ? "" : "none";
    if (notesEl) notesEl.style.display = evidenceVisible ? "" : "none";
    if (!evidenceVisible) hideHighlight();
    renderFilmstrip();
    renderEvidence();
  }

  function projectPanelPosition() {
    const compact = mode === "interacting" || minimized;
    if (compact && bubblePosition) {
      Object.assign(panelEl.style, {
        left: `${bubblePosition.x}px`, top: `${bubblePosition.y}px`,
        right: "auto", bottom: "auto",
      });
      return;
    }
    if (!compact) {
      for (const property of ["left", "top", "right", "bottom"]) {
        panelEl.style[property] = "";
      }
    }
  }

  function currentResult() {
    draft.refreshLiveness();
    return draft.snapshot();
  }

  function renderFilmstrip() {
    const filmstrip = byId("pi-filmstrip");
    if (!filmstrip) return;
    const result = currentResult();
    const total = result.steps.reduce((count, step) => count + step.elements.length, 0);
    filmstrip.innerHTML = `<button class="pi-step-filter ${stepFilter === "all" ? "active" : ""}"
      id="pi-filter-all" data-step="all" aria-pressed="${stepFilter === "all"}"
      aria-label="All steps, ${total} element annotations"><span>All steps</span><span>${total}</span></button>`;
    byId("pi-filter-all")?.addEventListener("click", () => setFilter("all"));
    result.steps.forEach((step, index) => {
      const button = document.createElement("button");
      button.className = `pi-step-filter ${stepFilter === step.id ? "active" : ""}`;
      button.disabled = operation !== "idle";
      button.dataset.step = step.id;
      button.setAttribute("aria-pressed", String(stepFilter === step.id));
      button.setAttribute("aria-label", `Step ${index + 1}, ${step.elements.length} element annotations`);
      const thumbnail = step.viewportImage?.status === "captured"
        ? `<img class="pi-step-thumbnail" src="${step.viewportImage.dataUrl}" alt="">`
        : step.viewportImage?.status === "missing"
          ? `<span class="pi-step-thumbnail pi-step-missing" aria-label="Viewport screenshot missing">!</span>`
          : `<span class="pi-step-thumbnail pi-step-pending" aria-label="Viewport screenshot pending">…</span>`;
      button.innerHTML = `${thumbnail}<span>Step ${index + 1}</span><span>${step.elements.length}</span>` +
        (stepFilter !== "all" && stepFilter !== step.id
          ? `<span class="pi-step-hidden" aria-label="Hidden by step filter">◉̸</span>` : "");
      button.addEventListener("click", () => setFilter(step.id));
      filmstrip.appendChild(button);
    });
  }

  function renderEvidence() {
    if (!markersEl || !notesEl) return;
    const result = currentResult();
    const visible = [];
    result.steps.forEach((step, stepIndex) => {
      if (stepFilter !== "all" && stepFilter !== step.id) return;
      step.elements.forEach((element, elementIndex) => visible.push({
        step,
        element,
        markerNumber: `${stepIndex + 1}.${elementIndex + 1}`,
      }));
    });
    markersEl.innerHTML = "";
    for (const { element, markerNumber } of visible) {
      const record = records.get(element.id);
      const source = record?.sourceNode;
      if (!source || source.isConnected === false) continue;
      const rect = source.getBoundingClientRect();
      if (element.id === activeRecordId) {
        const outline = document.createElement("div");
        outline.className = "pi-marker-outline pi-current-target-outline";
        outline.dataset.annotationId = element.id;
        outline.setAttribute("aria-label", "Current Element annotation target");
        Object.assign(outline.style, {
          left: `${rect.left}px`, top: `${rect.top}px`,
          width: `${rect.width}px`, height: `${rect.height}px`,
        });
        markersEl.appendChild(outline);
      }
      const marker = document.createElement("button");
      marker.className = "pi-marker-badge";
      marker.dataset.annotationId = element.id;
      marker.style.left = `${rect.right}px`;
      marker.style.top = `${rect.top}px`;
      marker.textContent = String(markerNumber);
      marker.setAttribute("aria-label", `Open Element annotation ${markerNumber}`);
      marker.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        createNote(element.id);
      });
      markersEl.appendChild(marker);
    }
    for (const card of Array.from(notesEl.children)) {
      const id = card.dataset?.annotationId;
      if (!visible.some((item) => item.element.id === id) || records.get(id)?.noteOpen === false) {
        card.remove();
      }
      else {
        updateNoteCard(card, visible.find((item) => item.element.id === id).element);
        const bounds = card.getBoundingClientRect();
        placeNoteCard(card, { left: bounds.left, top: bounds.top });
      }
    }
    for (const { element } of visible) {
      if (records.get(element.id)?.noteOpen !== false &&
          !notesEl.querySelector?.(`[data-annotation-id="${element.id}"]`)) {
        createNote(element.id, { focus: false });
      }
    }
    renderConnectors();
  }

  function renderConnectors() {
    if (!connectorsEl || !markersEl || !notesEl) return;
    connectorsEl.innerHTML = "";
    for (const card of notesEl.querySelectorAll?.(".pi-note-card") || []) {
      const id = card.dataset.annotationId;
      const marker = markersEl.querySelector?.(`.pi-marker-badge[data-annotation-id="${id}"]`);
      if (!marker || card.style.visibility === "hidden") continue;
      const markerBounds = marker.getBoundingClientRect();
      const cardBounds = card.getBoundingClientRect();
      const startX = markerBounds.left + markerBounds.width / 2;
      const startY = markerBounds.top + markerBounds.height / 2;
      const endX = Math.max(cardBounds.left, Math.min(startX, cardBounds.right));
      const endY = Math.max(cardBounds.top, Math.min(startY, cardBounds.bottom));
      const bendX = startX + (endX - startX) / 2;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.classList.add("pi-connector");
      path.dataset.annotationId = id;
      path.setAttribute("d", `M ${startX} ${startY} C ${bendX} ${startY}, ${bendX} ${endY}, ${endX} ${endY}`);
      connectorsEl.appendChild(path);
    }
  }

  function createNote(id, { focus = true } = {}) {
    const result = currentResult();
    const element = result.steps.flatMap((step) => step.elements).find((item) => item.id === id);
    if (!element) return;
    const record = records.get(id);
    if (record) record.noteOpen = true;
    let card = notesEl.querySelector?.(`[data-annotation-id="${id}"]`);
    if (card) {
      if (focus) activeRecordId = id;
      updateNoteCard(card, element);
      if (focus) renderEvidence();
      if (focus) card.querySelector?.(".pi-note-textarea")?.focus();
      return;
    }
    card = document.createElement("section");
    card.className = "pi-note-card";
    card.dataset.annotationId = id;
    card.innerHTML = `
      <div class="pi-note-header">
        <span class="pi-note-selector">${inspect.escapeHtml(element.metadata.selector)}</span>
        <span class="pi-historical" role="status"></span>
        <button class="pi-note-expand" aria-label="Move Element annotation to parent">▲</button>
        <button class="pi-note-contract" aria-label="Move Element annotation toward original element">▼</button>
        <button class="pi-note-close" aria-label="Delete element annotation">×</button>
      </div>
      <div class="pi-note-body">
        <textarea class="pi-note-textarea" placeholder="Describe changes for this element...">${inspect.escapeHtml(element.comment)}</textarea>
        <div class="pi-note-actions">
          <button class="pi-note-send" type="button" aria-label="Send comment">Send</button>
        </div>
      </div>`;
    const source = record?.sourceNode;
    const rect = source?.getBoundingClientRect?.() || { right: 24, top: 24 };
    card.style.visibility = "hidden";
    card.querySelector?.(".pi-note-textarea")?.addEventListener("input", (event) => {
      if (operation === "idle") draft.updateComment(id, event.target.value);
    });
    card.querySelector?.(".pi-note-close")?.addEventListener("click", () => deleteRecord(id));
    card.querySelector?.(".pi-note-send")?.addEventListener("click", () => { void sendNote(id); });
    card.querySelector?.(".pi-note-expand")?.addEventListener("click", () => moveElementTarget(id, "up"));
    card.querySelector?.(".pi-note-contract")?.addEventListener("click", () => moveElementTarget(id, "down"));
    card.querySelector?.(".pi-note-header")?.addEventListener("mousedown", (event) => {
      if (event.button !== 0 || operation !== "idle" || modal !== "none" ||
          event.target.closest?.("button")) return;
      const bounds = card.getBoundingClientRect();
      noteDrag = {
        card,
        id,
        startX: event.clientX,
        startY: event.clientY,
        startLeft: bounds.left,
        startTop: bounds.top,
      };
      card.classList.add("dragging");
      event.preventDefault();
    });
    card.addEventListener("focusin", () => {
      if (activeRecordId === id) return;
      activeRecordId = id;
      renderEvidence();
    });
    notesEl.appendChild(card);
    placeNoteCard(card, record?.notePosition || { left: rect.right + 16, top: rect.top });
    card.style.visibility = "";
    updateNoteCard(card, element);
    if (focus) {
      activeRecordId = id;
      renderEvidence();
    }
    if (focus) card.querySelector?.(".pi-note-textarea")?.focus();
  }

  function placeNoteCard(card, preferred) {
    const margin = 16;
    card.style.maxHeight = "";
    const bounds = card.getBoundingClientRect();
    const maxLeft = Math.max(margin, window.innerWidth - bounds.width - margin);
    const panelBounds = panelEl?.getBoundingClientRect?.();
    const reservesBottom = mode === "annotating" && !minimized && panelBounds?.top > margin;
    const availableBottom = reservesBottom ? panelBounds.top - 12 : window.innerHeight - margin;
    const availableHeight = Math.max(96, availableBottom - margin);
    card.style.maxHeight = `${availableHeight}px`;
    const resizedBounds = card.getBoundingClientRect();
    const maxTop = Math.max(margin, availableBottom - resizedBounds.height);
    const left = Math.min(Math.max(margin, preferred.left), maxLeft);
    const top = Math.min(Math.max(margin, preferred.top), maxTop);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    return { left, top };
  }

  function updateHistorical(card, element) {
    const status = card.querySelector?.(".pi-historical");
    if (!status) return;
    status.textContent = element.historical ? "Historical — source element no longer exists" : "";
    status.hidden = !element.historical;
  }

  function updateNoteCard(card, element) {
    updateHistorical(card, element);
    const selector = card.querySelector?.(".pi-note-selector");
    if (selector) {
      selector.textContent = element.metadata.selector;
      selector.title = element.metadata.selector;
    }
    updateNavigationControls(card, element.id);
  }

  function updateNavigationControls(card, id) {
    const record = records.get(id);
    const moveUp = card.querySelector?.(".pi-note-expand");
    const moveDown = card.querySelector?.(".pi-note-contract");
    if (!moveUp || !moveDown || !record) return;

    const currentStep = draft.isCurrentStep(id);
    const blocked = operation !== "idle" || modal !== "none";
    const sourceAvailable = record.sourceNode?.isConnected !== false;
    const parent = sourceAvailable ? record.sourceNode.parentElement : null;
    const canMoveUp = parent && parent !== document.body && parent !== document.documentElement &&
      !inspect.isPiElement(parent);
    const canMoveDown = record.navigation.index > 0 &&
      record.navigation.path[record.navigation.index - 1]?.isConnected !== false;
    const closedReason = "Element cannot be changed after its interaction step is closed";
    const unavailableReason = "The current source element is no longer available";
    const busyReason = "Wait for the current annotation operation to finish";

    moveUp.disabled = blocked || !currentStep || !sourceAvailable || !canMoveUp;
    moveDown.disabled = blocked || !currentStep || !sourceAvailable || !canMoveDown;
    moveUp.title = blocked ? busyReason :
      !currentStep ? closedReason :
      !sourceAvailable ? unavailableReason :
      !canMoveUp ? "No parent element is available" :
      "Move Element annotation to parent";
    moveDown.title = blocked ? busyReason :
      !currentStep ? closedReason :
      !sourceAvailable ? unavailableReason :
      !canMoveDown ? "Already at the original element" :
      "Move Element annotation toward original element";
  }

  function moveElementTarget(id, direction) {
    if (operation !== "idle" || modal !== "none" || !draft.canRetarget(id)) return;
    const record = records.get(id);
    if (!record?.navigation || record.sourceNode?.isConnected === false) return;

    let target;
    let targetIndex;
    let truncate = false;
    if (direction === "up") {
      target = record.sourceNode.parentElement;
      if (!target || target === document.body || target === document.documentElement || inspect.isPiElement(target)) {
        return;
      }
      targetIndex = record.navigation.index + 1;
      truncate = true;
    } else {
      targetIndex = record.navigation.index - 1;
      target = record.navigation.path[targetIndex];
      if (targetIndex < 0 || !target || target.isConnected === false) return;
    }

    const result = draft.retargetElement({
      id,
      sourceNode: target,
      metadata: freezeMetadata(target),
    });
    if (result.status !== "retargeted") return;
    record.sourceNode = target;
    record.navigation.path[targetIndex] = target;
    if (truncate) record.navigation.path.length = targetIndex + 1;
    record.navigation.index = targetIndex;
    deliveryConfirmedDegraded = false;
    renderEvidence();
  }

  function deleteRecord(id) {
    if (operation !== "idle" || modal !== "none" || !draft.softDelete(id)) return;
    if (activeRecordId === id) activeRecordId = null;
    notesEl.querySelector?.(`[data-annotation-id="${id}"]`)?.remove();
    byId("pi-undo") && (byId("pi-undo").disabled = false);
    if (!currentResult().steps.some((step) => step.id === stepFilter)) stepFilter = "all";
    deliveryConfirmedDegraded = false;
    render();
  }

  async function sendNote(id) {
    if (operation !== "idle" || modal !== "none") return;
    const record = records.get(id);
    if (!record?.sourceNode || record.sourceNode.isConnected === false) return;
    record.noteOpen = false;
    if (activeRecordId === id) activeRecordId = null;
    notesEl.querySelector?.(`[data-annotation-id="${id}"]`)?.remove();
    renderEvidence();
    await captureElement(record.sourceNode, { retargetId: id });
  }

  function undoDelete() {
    if (operation !== "idle" || modal !== "none") return;
    const restored = draft.undo();
    if (!restored) return;
    records.get(restored.id) && (records.get(restored.id).stepId = restored.stepId);
    render();
    createNote(restored.id);
  }

  function setFilter(value) {
    if (operation !== "idle" || modal !== "none") return;
    stepFilter = value;
    stepsExpanded = false;
    render();
  }

  function focusRecord(id) {
    const record = records.get(id);
    if (record) stepFilter = record.stepId;
    render();
    createNote(id);
  }

  function onMouseMove(event) {
    if (!active || mode !== "annotating" || operation !== "idle" || modal !== "none" ||
        event.target.closest?.("#pi-panel") || event.target.closest?.(".pi-note-card")) {
      hideHighlight();
      return;
    }
    const target = document.elementFromPoint?.(event.clientX, event.clientY) || event.target;
    if (!target || target === document.body || target === document.documentElement || inspect.isPiElement(target)) {
      hovered = null;
      hideHighlight();
      return;
    }
    hovered = target;
    hoverStack = [];
    let candidate = target;
    while (candidate && candidate !== document.body && candidate !== document.documentElement) {
      if (!inspect.isPiElement(candidate)) hoverStack.push(candidate);
      candidate = candidate.parentElement;
    }
    hoverIndex = 0;
    const rect = target.getBoundingClientRect();
    Object.assign(highlightEl.style, {
      display: "block", left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`,
    });
  }

  function onWheel(event) {
    if (mode !== "annotating" || operation !== "idle" || modal !== "none" ||
        !event.altKey || hoverStack.length === 0 ||
        event.target.closest?.("#pi-panel") || event.target.closest?.(".pi-note-card")) return;
    event.preventDefault();
    event.stopPropagation();
    hoverIndex = event.deltaY > 0
      ? Math.min(hoverIndex + 1, hoverStack.length - 1)
      : Math.max(hoverIndex - 1, 0);
    hovered = hoverStack[hoverIndex];
    const rect = hovered.getBoundingClientRect();
    Object.assign(highlightEl.style, {
      display: "block", left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`,
    });
  }

  function onPageClick(event) {
    if (!active || mode !== "annotating" ||
        event.target.closest?.("#pi-panel") || event.target.closest?.(".pi-note-card") ||
        event.target.closest?.("#pi-markers") ||
        event.target.closest?.(".pi-modal-backdrop") ||
        event.target.closest?.(".pi-abort-backdrop")) return;
    event.preventDefault();
    event.stopImmediatePropagation?.();
    // Annotation mode retains page-click ownership while an atomic capture,
    // Etch finalization, delivery, or modal decision is in flight. Additional
    // clicks are ignored rather than leaking through to the site.
    if (operation !== "idle" || modal !== "none") return;
    const source = hovered || event.target;
    if (source && !inspect.isPiElement(source)) selectElement(source);
  }

  function hideHighlight() {
    if (highlightEl) highlightEl.style.display = "none";
  }

  function hideChrome() {
    hideHighlight();
    etch.clearMarkers();
    const elements = [panelEl, connectorsEl, markersEl, notesEl].filter(Boolean);
    const display = elements.map((element) => [element, element.style.display]);
    elements.forEach((element) => { element.style.display = "none"; });
    return () => {
      if (!active) return;
      display.forEach(([element, value]) => {
        if (element.isConnected) element.style.display = value;
      });
    };
  }

  function playCaptureReturnAnimation() {
    cleanupCaptureReturnAnimation();
    for (const surface of [panelEl, connectorsEl, markersEl, notesEl]) {
      if (surface?.isConnected) surface.classList.add("pi-rematerializing");
    }
    captureReturnTimer = setTimeout(cleanupCaptureReturnAnimation, 800);
  }

  function cleanupCaptureReturnAnimation() {
    if (captureReturnTimer !== null) clearTimeout(captureReturnTimer);
    captureReturnTimer = null;
    for (const surface of [panelEl, connectorsEl, markersEl, notesEl]) {
      surface?.classList.remove("pi-rematerializing");
    }
  }

  function twoFrames() {
    return new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  function setMinimized(value) {
    if (mode !== "annotating" || operation !== "idle") return;
    minimized = value;
    render();
  }

  function restorePanel() {
    if (bubbleDragged) {
      bubbleDragged = false;
      return;
    }
    setMinimized(false);
  }

  function beginBubbleDrag(event) {
    if (event.button !== 0 || operation !== "idle" || (!minimized && mode !== "interacting")) return;
    const rect = panelEl.getBoundingClientRect();
    bubbleDrag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    bubbleDragged = false;
    event.preventDefault();
  }

  function onDragMove(event) {
    if (noteDrag) {
      const position = placeNoteCard(noteDrag.card, {
        left: noteDrag.startLeft + event.clientX - noteDrag.startX,
        top: noteDrag.startTop + event.clientY - noteDrag.startY,
      });
      const record = records.get(noteDrag.id);
      if (record) record.notePosition = position;
      renderConnectors();
      return;
    }
    if (!bubbleDrag || !panelEl) return;
    const dx = event.clientX - bubbleDrag.x;
    const dy = event.clientY - bubbleDrag.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) bubbleDragged = true;
    const width = panelEl.offsetWidth || 68;
    const height = panelEl.offsetHeight || 68;
    bubblePosition = {
      x: Math.max(8, Math.min(bubbleDrag.left + dx, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(bubbleDrag.top + dy, window.innerHeight - height - 8)),
    };
    Object.assign(panelEl.style, {
      left: `${bubblePosition.x}px`, top: `${bubblePosition.y}px`,
      right: "auto", bottom: "auto",
    });
  }

  function endBubbleDrag() {
    bubbleDrag = null;
    noteDrag?.card?.classList.remove("dragging");
    noteDrag = null;
  }

  function onResize() {
    if (bubblePosition) {
      bubblePosition.x = Math.max(8, Math.min(bubblePosition.x, window.innerWidth - 76));
      bubblePosition.y = Math.max(8, Math.min(bubblePosition.y, window.innerHeight - 76));
      panelEl.style.left = `${bubblePosition.x}px`;
      panelEl.style.top = `${bubblePosition.y}px`;
    }
    renderEvidence();
  }

  function onPageMutations(mutations) {
    const sources = Array.from(records.values()).flatMap((record) =>
      [record.sourceNode, ...(record.navigation?.path || [])]).filter(Boolean);
    if (sources.length === 0 || livenessFrame !== null) return;
    const affectsSource = mutations.some((mutation) =>
      [...mutation.addedNodes, ...mutation.removedNodes].some((node) =>
        sources.some((source) => node === source || node.contains?.(source))));
    if (!affectsSource) return;
    livenessFrame = requestAnimationFrame(() => {
      livenessFrame = null;
      if (active) render();
    });
  }

  function showModal(kind, { title, description, actions, returnFocus } = {}) {
    closeModal();
    modal = kind;
    lastFocusedControl = returnFocus || document.activeElement || byId("pi-pause");
    const backdrop = document.createElement("div");
    const kindClass = kind.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    backdrop.className = kind === "abort" ? "pi-abort-backdrop" : `pi-modal-backdrop pi-${kindClass}-backdrop`;
    backdrop.innerHTML = `
      <div class="pi-modal" role="dialog" aria-modal="true" aria-labelledby="pi-modal-title"
        aria-describedby="pi-modal-description">
        <h2 id="pi-modal-title">${inspect.escapeHtml(title)}</h2>
        <p id="pi-modal-description">${inspect.escapeHtml(description)}</p>
        <div class="pi-modal-actions"></div>
      </div>`;
    let actionRow = backdrop.querySelector(".pi-modal-actions");
    if (!actionRow) {
      actionRow = document.createElement("div");
      actionRow.className = "pi-modal-actions";
      backdrop.appendChild(actionRow);
    }
    for (const [label, handler, variant] of actions) {
      const button = document.createElement("button");
      if (kind === "abort" && label === "Continue annotating") button.id = "pi-abort-continue";
      if (kind === "abort" && label === "Abort annotation") button.id = "pi-abort-confirm";
      button.className = `pi-btn ${variant === "primary" ? "pi-btn-submit" : "pi-btn-cancel"}`;
      button.textContent = label;
      button.addEventListener("click", handler);
      actionRow.appendChild(button);
    }
    document.body.appendChild(backdrop);
    routeDialog = backdrop;
    actionRow.querySelector("button")?.focus();
  }

  function closeModal() {
    routeDialog?.remove();
    routeDialog = null;
    modal = "none";
    lastFocusedControl?.focus?.();
    lastFocusedControl = null;
  }

  function showAbortDialog() {
    if (operation !== "idle" || modal !== "none") return;
    showModal("abort", {
      title: "Abort annotation?",
      description: "Your interaction steps, comments, and captured edits will be discarded.",
      actions: [
        ["Continue annotating", closeModal, "primary"],
        ["Abort annotation", () => deactivate()],
      ],
      returnFocus: byId("pi-close"),
    });
  }

  function showHelpDialog() {
    if (operation !== "idle" || modal !== "none") return;
    modal = "help";
    lastFocusedControl = byId("pi-help");
    const iconUrl = chrome.runtime.getURL?.("assets/grinsekatze.svg") ||
      "assets/grinsekatze.svg";
    const backdrop = document.createElement("div");
    backdrop.className = "pi-modal-backdrop pi-help-backdrop";
    backdrop.innerHTML = `
      <section class="pi-modal pi-help-dialog" role="dialog" aria-modal="true"
        aria-labelledby="pi-help-title">
        <header class="pi-help-header">
          <img class="pi-grinsekatze-icon" src="${iconUrl}" alt="Grinsekatze">
          <div><h2 id="pi-help-title">How to annotate</h2>
            <p>Share clear visual feedback with your annotation session.</p></div>
          <button class="pi-icon-button pi-help-close" aria-label="Close help">×</button>
        </header>
        <ol class="pi-help-steps">
          <li><strong>Select an element</strong><span>Click an element and write its Element annotation.</span></li>
          <li><strong>Create interaction steps</strong><span>Use Interact with page, then Resume annotation after interacting.</span></li>
          <li><strong>Add general context and submit</strong><span>Describe the overall goal, then submit the annotation.</span></li>
        </ol>
        <p class="pi-help-tip"><strong>Etch</strong> records visible edits. Press <kbd>Escape</kbd> three times to abort.</p>
      </section>`;
    backdrop.querySelector?.(".pi-help-close")?.addEventListener("click", closeModal);
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) closeModal();
    });
    document.body.appendChild(backdrop);
    routeDialog = backdrop;
    backdrop.querySelector?.(".pi-help-close")?.focus();
  }

  function onKeyDown(event) {
    if (!active) return;
    if (mode === "interacting" && modal === "none") return;
    if (modal !== "none") {
      if (event.key === "Tab") {
        const buttons = Array.from(routeDialog?.querySelectorAll?.("button") || []);
        if (!buttons.length) return;
        const index = buttons.indexOf(document.activeElement);
        const next = event.shiftKey
          ? (index <= 0 ? buttons.length - 1 : index - 1)
          : (index >= buttons.length - 1 ? 0 : index + 1);
        event.preventDefault();
        buttons[next].focus();
      } else if (event.key === "Escape" && !["routeGuard", "captureFailure"].includes(modal)) {
        event.preventDefault();
        closeModal();
      }
      return;
    }
    if (event.key !== "Escape") {
      escapeCount = 0;
      return;
    }
    event.preventDefault();
    if (event.repeat) return;
    const activeElement = document.activeElement;
    if (activeElement?.matches?.(".pi-note-textarea, #pi-context")) {
      activeElement.blur();
    }
    escapeCount += 1;
    clearTimeout(escapeTimer);
    escapeTimer = setTimeout(() => { escapeCount = 0; }, 2000);
    if (escapeCount >= 3) {
      escapeCount = 0;
      showAbortDialog();
    }
  }

  function showRouteDecision() {
    showModal("routeGuard", {
      title: "Discard annotation and leave?",
      description: "This annotation draft exists only on the current page.",
      actions: [
        ["Stay on this page", () => {
          routeGuard.stay();
          closeModal();
        }, "primary"],
        ["Discard", async () => {
          closeModal();
          await routeGuard.discardAndReplay();
        }],
      ],
    });
  }

  let rememberedFormReplay = null;

  function onFormData(event) {
    const form = event.target;
    if (!form || !(draft.hasRecoverableWork() || etch.hasChanges?.() === true)) return;
    const target = (form.target || "").toLowerCase();
    if (target && !["_self", "_top", "_parent"].includes(target)) return;
    const descriptor = freezeFormReplayEntries(form, null, Array.from(event.formData.entries()));
    rememberedFormReplay = { at: Date.now(), replay: descriptor.replay };
  }

  function onFormSubmit(event) {
    const form = event.target;
    if (!form || !(draft.hasRecoverableWork() || etch.hasChanges?.() === true)) return;
    const submitter = event.submitter;
    const target = (
      submitter?.hasAttribute?.("formtarget") ? submitter.formTarget : form.target || ""
    ).toLowerCase();
    if (target && !["_self", "_top", "_parent"].includes(target)) return;
    const descriptor = freezeFormReplay(form, submitter);
    rememberedFormReplay = {
      at: Date.now(),
      replay: descriptor.replay,
    };

    // Chromium does not expose every form submission as a cancelable
    // Navigation event in the isolated world. The submit event is itself a
    // synchronous, exact-source seam, so retain and cancel it here.
    if (event.cancelable) {
      event.preventDefault();
      const retained = rememberedFormReplay;
      rememberedFormReplay = null;
      routeGuard.retainCanceledRoute(retained);
    }
  }

  function createFrozenFormReplay(config, entries) {
    return {
      replay: () => {
        const replayForm = document.createElement("form");
        replayForm.style.display = "none";
        replayForm.action = config.action;
        replayForm.method = config.method;
        replayForm.enctype = config.enctype;
        replayForm.target = config.target;
        for (const [name, value] of entries) {
          const isFile = typeof File !== "undefined" && value instanceof File;
          if (isFile && typeof DataTransfer !== "undefined") {
            const input = document.createElement("input");
            input.type = "file";
            input.name = name;
            const transfer = new DataTransfer();
            transfer.items.add(value);
            input.files = transfer.files;
            replayForm.appendChild(input);
          } else {
            const input = document.createElement("input");
            input.type = "hidden";
            input.name = name;
            input.value = isFile ? value.name : value;
            replayForm.appendChild(input);
          }
        }
        document.body.appendChild(replayForm);
        try {
          return HTMLFormElement.prototype.submit.call(replayForm);
        } finally {
          replayForm.remove();
        }
      },
    };
  }

  function freezeFormReplay(form, submitter) {
    return freezeFormReplayEntries(
      form,
      submitter,
      Array.from(new FormData(form, submitter).entries()),
    );
  }

  function freezeFormReplayEntries(form, submitter, entries) {
    const submitterOverride = (attribute, property, fallback) =>
      submitter?.hasAttribute?.(attribute) ? submitter[property] : fallback;
    return createFrozenFormReplay({
      action: submitterOverride("formaction", "formAction", form.action) || window.location.href,
      method: (submitterOverride("formmethod", "formMethod", form.method) || "get").toLowerCase(),
      enctype: submitterOverride("formenctype", "formEnctype", form.enctype) ||
        "application/x-www-form-urlencoded",
      target: submitterOverride("formtarget", "formTarget", form.target) || "_self",
    }, entries);
  }

  function createReplayDescriptor(event) {
    if (event.formData && rememberedFormReplay && Date.now() - rememberedFormReplay.at < 1000) {
      const descriptor = rememberedFormReplay;
      rememberedFormReplay = null;
      return descriptor;
    }
    const destination = event.destination?.url;
    if (!destination) throw new Error("The canceled route has no destination");
    if (event.formData) {
      throw new Error("The canceled POST route could not be reconstructed exactly");
    }
    const navigation = window.navigation;
    if (event.navigationType === "reload") {
      return {
        replay: () => navigation?.reload
          ? navigation.reload({ state: event.destination?.getState?.() }).finished
          : window.location.reload(),
      };
    }
    if (event.navigationType === "traverse" && event.destination?.key && navigation?.traverseTo) {
      const key = event.destination.key;
      return { replay: () => navigation.traverseTo(key).finished };
    }
    const history = event.navigationType === "replace" ? "replace" : "push";
    return {
      replay: () => {
        if (navigation?.navigate) {
          return navigation.navigate(destination, {
            history,
            state: event.destination?.getState?.(),
          }).finished;
        }
        window.location.href = destination;
      },
    };
  }

  function settleCaptureLifecycle() {
    resolveCaptureLifecycle?.();
    resolveCaptureLifecycle = null;
    captureLifecyclePromise = null;
  }

  const routeGuard = createRouteGuard({
    isDirty: () => draft.hasRecoverableWork() || etch.hasChanges?.() === true,
    getOperation: () => operation,
    settleOperation: async () => {
      if (captureLifecyclePromise) await captureLifecyclePromise;
      else if (capturePromise) await capturePromise;
      if (transitionPromise) await transitionPromise;
    },
    discardDraft: async () => {
      draft.purge();
      records.clear();
      etch.reset();
      closeModal();
      render();
    },
    showDecision: showRouteDecision,
    createReplayDescriptor,
    onReplayError: (error) => setDeliveryError(`Annotation discarded, but navigation failed: ${errorMessage(error)}`),
  });

  function setDeliveryError(message) {
    deliveryError = String(message).slice(0, 260);
    render();
  }

  function errorMessage(error) {
    return (error instanceof Error ? error.message : String(error)).slice(0, 240);
  }

  console.log("[pi-annotate] Content script ready");
})();
