/**
 * Pi Annotate - Annotator entry point
 *
 * DevTools-like element picker with inline note cards:
 * - Hover to highlight elements
 * - Alt/Option+scroll to cycle through parent elements
 * - Click to select (shift+click for multi)
 * - Per-element floating note cards with comments
 * - Bottom panel for overall context
 *
 * Injected last, after the module files that register styles, element
 * inspection, screenshot post-processing, and etch capture on the shared
 * namespace (see ANNOTATOR_SCRIPT_FILES in background.js).
 */

(() => {
  // Prevent double-injection (unique per-extension key to avoid conflicts)
  const LOADED_KEY = "__piAnnotate_" + chrome.runtime.id;
  if (window[LOADED_KEY]) return;
  window[LOADED_KEY] = true;

  const modules = window["__piAnnotateModules_" + chrome.runtime.id];
  const { STYLES } = modules.styles;
  const {
    escapeHtml,
    isPiElement,
    generateSelector,
    getAttrs,
    getRectData,
    getBoxModel,
    getAccessibilityInfo,
    getKeyStyles,
    getComputedStyles,
    getParentContext,
    getCSSVariables,
    resetCSSVarCache,
  } = modules.inspect;
  const { cropToElement, addBadgesToScreenshot } = modules.capture;
  const etch = modules.etch;

  // ─────────────────────────────────────────────────────────────────────
  // Constants
  // ─────────────────────────────────────────────────────────────────────

  const TEXT_MAX_LENGTH = 500;
  const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
  const ALT_KEY_LABEL = IS_MAC ? "⌥" : "Alt";

  // Update note card's displayed selector label
  function updateNoteCardLabel(index) {
    const sel = selectedElements[index];
    if (!sel) return;
    const card = notesContainer?.querySelector(`[data-index="${index}"]`);
    if (!card) return;
    const label = sel.id ? `#${sel.id}` : `${sel.tag}${sel.classes[0] ? "." + sel.classes[0] : ""}`;
    const selectorEl = card.querySelector(".pi-note-selector");
    if (selectorEl) {
      selectorEl.textContent = label;
      selectorEl.title = sel.selector;
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────────────────────────────

  let isActive = false;
  let sessionId = null;
  let deliveryPending = false;
  let multiSelectMode = true;
  let screenshotMode = "each"; // "each" | "full" | "none"
  let panelMinimized = false;
  let bubblePosition = null;
  let bubbleDragState = null;
  let bubbleWasDragged = false;
  let escapeCount = 0;
  let escapeResetTimer = null;
  let abortDialogEl = null;

  // Element picker state
  let elementStack = [];
  let stackIndex = 0;
  let selectedElements = [];
  let elementScreenshots = new Map(); // index → boolean

  // Note card state
  let notesContainer = null;
  let connectorsEl = null;
  let elementComments = new Map(); // index → comment string
  let openNotes = new Set();       // indices of currently open notes
  let notePositions = new Map();   // index → {x, y} manual position overrides
  let dragState = null;            // { card, startX, startY, startLeft, startTop }

  // Debug mode state
  let debugMode = false;

  // DOM elements
  let highlightEl = null;
  let tooltipEl = null;
  let panelEl = null;
  let markersContainer = null;
  let styleEl = null;

  // ─────────────────────────────────────────────────────────────────────
  // Message Handling
  // ─────────────────────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    console.log("[pi-annotate] Received:", msg.type);

    if (msg.type === "START_ANNOTATION") {
      sessionId = typeof msg.sessionId === "string" ? msg.sessionId : null;
      activate();
      sendResponse({ started: true });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // Activation
  // ─────────────────────────────────────────────────────────────────────

  function activate() {
    if (isActive) {
      console.log("[pi-annotate] Restarting session (new request)");
      resetState();
      return;
    }
    isActive = true;

    // Inject styles
    styleEl = document.createElement("style");
    styleEl.id = "pi-styles";
    styleEl.textContent = STYLES;
    (document.head || document.documentElement).appendChild(styleEl);

    // Create UI
    createHighlight();
    createTooltip();
    createMarkers();
    createNotesContainer();
    createPanel();

    // Add listeners
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("wheel", onWheel, { passive: false, capture: true });
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleResize);
    initDragHandlers();

    document.body.style.cursor = "crosshair";
    console.log("[pi-annotate] Activated");
  }

  function resetState() {
    deliveryPending = false;
    elementStack = [];
    stackIndex = 0;
    selectedElements = [];
    elementScreenshots = new Map();
    elementComments = new Map();
    openNotes = new Set();
    notePositions = new Map();
    dragState = null;
    bubbleDragState = null;
    bubbleWasDragged = false;
    multiSelectMode = true;
    screenshotMode = "each";
    setPanelMinimized(false);
    resetEscapeSequence();
    closeAbortDialog();
    debugMode = false;
    resetCSSVarCache();
    etch.reset();

    // Reset UI elements
    if (markersContainer) markersContainer.innerHTML = "";
    if (notesContainer) notesContainer.innerHTML = "";
    if (connectorsEl) connectorsEl.innerHTML = "";
    hideHighlight();
    hideTooltip();

    // Reset mode toggle buttons
    const singleBtn = document.getElementById("pi-mode-single");
    const multiBtn = document.getElementById("pi-mode-multi");
    if (singleBtn && multiBtn) {
      singleBtn.classList.remove("active");
      multiBtn.classList.add("active");
    }

    // Reset screenshot mode buttons
    const eachBtn = document.getElementById("pi-ss-each");
    const fullBtn = document.getElementById("pi-ss-full");
    const noneBtn = document.getElementById("pi-ss-none");
    if (eachBtn && fullBtn && noneBtn) {
      eachBtn.classList.add("active");
      fullBtn.classList.remove("active");
      noneBtn.classList.remove("active");
    }

    // Clear context input
    const contextEl = document.getElementById("pi-context");
    if (contextEl) contextEl.value = "";
    setDeliveryState(false);

    // Reset debug mode checkbox
    const debugCheckbox = document.getElementById("pi-debug-mode");
    if (debugCheckbox) debugCheckbox.checked = false;

    const etchCheckbox = document.getElementById("pi-etch-mode");
    if (etchCheckbox) etchCheckbox.checked = false;
    const etchToggle = etchCheckbox?.closest(".pi-etch-toggle");
    if (etchToggle) etchToggle.classList.remove("recording");

    // Update count
    updateSelectionCount();

    console.log("[pi-annotate] State reset for new session");
  }

  function deactivate() {
    if (!isActive) return;
    isActive = false;

    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("wheel", onWheel, { capture: true });
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("scroll", handleScroll, true);
    window.removeEventListener("resize", handleResize);
    cleanupDragHandlers();

    document.body.style.cursor = "";

    etch.reset();
    resetEscapeSequence();
    closeAbortDialog();

    styleEl?.remove();
    highlightEl?.remove();
    tooltipEl?.remove();
    panelEl?.remove();
    markersContainer?.remove();
    notesContainer?.remove();
    connectorsEl?.remove();

    styleEl = highlightEl = tooltipEl = panelEl = markersContainer = null;
    notesContainer = connectorsEl = null;
    elementStack = [];
    stackIndex = 0;
    selectedElements = [];
    elementScreenshots = new Map();
    elementComments = new Map();
    openNotes = new Set();
    notePositions = new Map();
    dragState = null;
    bubbleDragState = null;
    bubbleWasDragged = false;
    sessionId = null;
    deliveryPending = false;
    multiSelectMode = true;
    screenshotMode = "each";
    panelMinimized = false;
    debugMode = false;
    resetCSSVarCache();

    console.log("[pi-annotate] Deactivated");
  }

  // ─────────────────────────────────────────────────────────────────────
  // UI Creation
  // ─────────────────────────────────────────────────────────────────────

  function createHighlight() {
    highlightEl = document.createElement("div");
    highlightEl.id = "pi-highlight";
    highlightEl.style.display = "none";
    document.body.appendChild(highlightEl);
  }

  function createTooltip() {
    tooltipEl = document.createElement("div");
    tooltipEl.id = "pi-tooltip";
    tooltipEl.style.display = "none";
    document.body.appendChild(tooltipEl);
  }

  function createMarkers() {
    markersContainer = document.createElement("div");
    markersContainer.id = "pi-markers";
    document.body.appendChild(markersContainer);
  }

  function createNotesContainer() {
    notesContainer = document.createElement("div");
    notesContainer.className = "pi-notes-container";
    document.body.appendChild(notesContainer);

    connectorsEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    connectorsEl.setAttribute("class", "pi-connectors");
    document.body.appendChild(connectorsEl);
  }

  function createPanel() {
    panelEl = document.createElement("div");
    panelEl.id = "pi-panel";
    panelEl.innerHTML = `
      <div class="pi-minimized-bubble" id="pi-minimized-bubble" role="button" tabindex="0" aria-label="Restore annotation bar">
        <span class="pi-bubble-logo">π</span>
        <span class="pi-bubble-count" id="pi-bubble-count">0</span>
      </div>
      <div class="pi-header">
        <span class="pi-logo">π Annotate</span>
        <span class="pi-hint">Click elements • ${ALT_KEY_LABEL}+scroll cycles parents • ESC ×3 to abort</span>
        <button class="pi-minimize" id="pi-minimize" title="Minimize annotation bar" aria-label="Minimize annotation bar">−</button>
        <button class="pi-close" id="pi-close" title="Cancel annotation" aria-label="Cancel annotation">×</button>
      </div>
      <div class="pi-toolbar">
        <div class="pi-mode-toggle">
          <button class="pi-mode-btn" id="pi-mode-single" title="Click replaces selection">Single</button>
          <button class="pi-mode-btn active" id="pi-mode-multi" title="Click adds to selection">Multi</button>
        </div>
        <div class="pi-screenshot-toggle">
          <span class="pi-toggle-label">Screenshot</span>
          <button class="pi-ss-btn active" id="pi-ss-each" title="Crop screenshot to each element">Crop</button>
          <button class="pi-ss-btn" id="pi-ss-full" title="Capture entire viewport">Full</button>
          <button class="pi-ss-btn" id="pi-ss-none" title="No screenshots">None</button>
        </div>
        <div class="pi-spacer"></div>
        <span class="pi-count" id="pi-count">0 selected</span>
        <label class="pi-notes-toggle" title="Show or hide floating element notes; comments stay attached">
          <input type="checkbox" id="pi-notes-visible" checked />
          <span>Notes</span>
        </label>
        <label class="pi-notes-toggle" title="Include computed CSS, parent layout, and CSS variables">
          <input type="checkbox" id="pi-debug-mode" />
          <span>Debug</span>
        </label>
        <label class="pi-notes-toggle pi-etch-toggle" title="Record page DOM and CSS edits with before/after screenshots">
          <input type="checkbox" id="pi-etch-mode" />
          <span>Etch</span>
          <span class="pi-etch-badge" id="pi-etch-count" style="display:none"></span>
        </label>
      </div>
      <div class="pi-context-row">
        <textarea id="pi-context" rows="2" placeholder="General context (optional)..."></textarea>
      </div>
      <div class="pi-actions">
        <div class="pi-delivery-error" id="pi-delivery-error" role="alert" aria-live="assertive" hidden></div>
        <div class="pi-buttons">
          <button class="pi-btn pi-btn-cancel" id="pi-cancel">Cancel</button>
          <button class="pi-btn pi-btn-submit" id="pi-submit" title="If Pi is busy, this annotation is queued as a follow-up">Submit</button>
        </div>
      </div>
    `;
    document.body.appendChild(panelEl);

    document.getElementById("pi-close").addEventListener("click", handleCancel);
    document.getElementById("pi-cancel").addEventListener("click", handleCancel);
    document.getElementById("pi-submit").addEventListener("click", handleSubmit);
    document.getElementById("pi-minimize").addEventListener("click", () => setPanelMinimized(true));

    const minimizedBubble = document.getElementById("pi-minimized-bubble");
    minimizedBubble.addEventListener("mousedown", startBubbleDrag);
    minimizedBubble.addEventListener("click", () => {
      if (bubbleWasDragged) {
        bubbleWasDragged = false;
        return;
      }
      setPanelMinimized(false);
    });
    minimizedBubble.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setPanelMinimized(false);
      }
    });

    // Mode toggle
    document.getElementById("pi-mode-single").addEventListener("click", () => setMultiMode(false));
    document.getElementById("pi-mode-multi").addEventListener("click", () => setMultiMode(true));

    // Screenshot mode toggle
    document.getElementById("pi-ss-each").addEventListener("click", () => setScreenshotMode("each"));
    document.getElementById("pi-ss-full").addEventListener("click", () => setScreenshotMode("full"));
    document.getElementById("pi-ss-none").addEventListener("click", () => setScreenshotMode("none"));

    // Notes visibility toggle
    document.getElementById("pi-notes-visible").addEventListener("change", (e) => {
      if (e.target.checked) {
        expandAllNotes();
      } else {
        collapseAllNotes();
      }
    });

    // Debug mode toggle
    document.getElementById("pi-debug-mode").addEventListener("change", (e) => {
      debugMode = e.target.checked;
    });

    document.getElementById("pi-etch-mode").addEventListener("change", (e) => {
      const toggle = e.target.closest(".pi-etch-toggle");
      if (e.target.checked) {
        etch.start();
        if (toggle) toggle.classList.add("recording");
      } else {
        etch.stop();
        if (toggle) toggle.classList.remove("recording");
      }
    });

    // Stop events from reaching the page
    panelEl.addEventListener("mousemove", e => e.stopPropagation(), true);
    panelEl.addEventListener("click", e => {
      const target = e.target;
      if (
        target.closest?.("#pi-minimized-bubble") ||
        target.tagName === "BUTTON" ||
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA"
      ) {
        return;
      }
      e.stopPropagation();
    }, true);
  }

  function getPanelReservedHeight() {
    if (!panelEl || panelMinimized) return 0;
    return (panelEl.offsetHeight || 96) + 20;
  }

  function setPanelMinimized(minimized) {
    panelMinimized = minimized;
    if (!panelEl) return;

    panelEl.classList.toggle("pi-minimized", minimized);
    panelEl.classList.remove("dragging");
    bubbleDragState = null;

    if (minimized) {
      if (bubblePosition) {
        panelEl.style.left = `${bubblePosition.x}px`;
        panelEl.style.top = `${bubblePosition.y}px`;
        panelEl.style.right = "auto";
        panelEl.style.bottom = "auto";
      }
    } else {
      panelEl.style.left = "";
      panelEl.style.top = "";
      panelEl.style.right = "";
      panelEl.style.bottom = "";
    }

    handleResize();
    updateConnectors();
  }

  function startBubbleDrag(event) {
    if (!panelMinimized || !panelEl || event.button !== 0) return;
    const rect = panelEl.getBoundingClientRect();
    bubbleWasDragged = false;
    bubbleDragState = {
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
    };
    panelEl.classList.add("dragging");
    event.preventDefault();
  }

  function setMultiMode(isMulti) {
    multiSelectMode = isMulti;
    const singleBtn = document.getElementById("pi-mode-single");
    const multiBtn = document.getElementById("pi-mode-multi");
    if (singleBtn && multiBtn) {
      singleBtn.classList.toggle("active", !isMulti);
      multiBtn.classList.toggle("active", isMulti);
    }
  }

  function setScreenshotMode(mode) {
    screenshotMode = mode;
    const eachBtn = document.getElementById("pi-ss-each");
    const fullBtn = document.getElementById("pi-ss-full");
    const noneBtn = document.getElementById("pi-ss-none");
    if (eachBtn && fullBtn && noneBtn) {
      eachBtn.classList.toggle("active", mode === "each");
      fullBtn.classList.toggle("active", mode === "full");
      noneBtn.classList.toggle("active", mode === "none");
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Note Card Functions
  // ─────────────────────────────────────────────────────────────────────

  function calculateNotePosition(element, cardWidth = 280, cardHeight = 150) {
    const rect = element.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const panelHeight = getPanelReservedHeight();
    const margin = 16;

    // Try right side first
    if (rect.right + margin + cardWidth < vw) {
      return { x: rect.right + margin, y: Math.max(margin, rect.top) };
    }
    // Try left side
    if (rect.left - margin - cardWidth > 0) {
      return { x: rect.left - margin - cardWidth, y: Math.max(margin, rect.top) };
    }
    // Try below
    if (rect.bottom + margin + cardHeight < vh - panelHeight) {
      return { x: Math.max(margin, rect.left), y: rect.bottom + margin };
    }
    // Try above
    if (rect.top - margin - cardHeight > 0) {
      return { x: Math.max(margin, rect.left), y: rect.top - margin - cardHeight };
    }
    // Fallback: offset from element
    return { x: Math.min(rect.right + margin, vw - cardWidth - margin), y: Math.max(margin, rect.top) };
  }

  function hasOverlap(rect1, rect2, margin = 8) {
    return !(
      rect1.right + margin < rect2.left ||
      rect1.left > rect2.right + margin ||
      rect1.bottom + margin < rect2.top ||
      rect1.top > rect2.bottom + margin
    );
  }

  function adjustForCollisions(position, cardSize, existingCards) {
    const myRect = {
      left: position.x,
      top: position.y,
      right: position.x + cardSize.width,
      bottom: position.y + cardSize.height
    };

    let adjusted = { ...position };
    let attempts = 0;

    while (attempts < 10) {
      let collision = false;

      for (const card of existingCards) {
        const cardRect = card.getBoundingClientRect();
        if (hasOverlap(myRect, cardRect)) {
          adjusted.y = cardRect.bottom + 12;
          myRect.top = adjusted.y;
          myRect.bottom = adjusted.y + cardSize.height;
          collision = true;
          break;
        }
      }

      if (!collision) break;
      attempts++;
    }

    // Clamp to viewport
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const panelHeight = getPanelReservedHeight();
    adjusted.x = Math.max(16, Math.min(adjusted.x, vw - cardSize.width - 16));
    adjusted.y = Math.max(16, Math.min(adjusted.y, vh - cardSize.height - panelHeight - 16));

    return adjusted;
  }

  function createNoteCard(index) {
    const sel = selectedElements[index];
    if (!sel || !sel.element || !document.contains(sel.element)) return null;

    // Guard against duplicate cards
    if (openNotes.has(index)) {
      return notesContainer.querySelector(`[data-index="${index}"]`);
    }

    // Use stored position if user previously dragged, otherwise calculate
    let adjustedPos;
    if (notePositions.has(index)) {
      adjustedPos = notePositions.get(index);
    } else {
      const position = calculateNotePosition(sel.element);
      adjustedPos = adjustForCollisions(
        position,
        { width: 280, height: 150 },
        notesContainer.querySelectorAll(".pi-note-card")
      );
    }

    const label = sel.id ? `#${sel.id}` : `${sel.tag}${sel.classes[0] ? "." + sel.classes[0] : ""}`;
    const hasScreenshot = elementScreenshots.get(index) !== false;
    const comment = elementComments.get(index) || "";

    const card = document.createElement("div");
    card.className = "pi-note-card";
    card.dataset.index = index;
    card.style.left = `${adjustedPos.x}px`;
    card.style.top = `${adjustedPos.y}px`;

    card.innerHTML = `
      <div class="pi-note-header">
        <span class="pi-note-badge">${index + 1}</span>
        <span class="pi-note-selector" title="${escapeHtml(sel.selector)}">${escapeHtml(label)}</span>
        <button class="pi-note-expand" title="Expand to parent">▲</button>
        <button class="pi-note-contract" title="Contract to child">▼</button>
        <button class="pi-note-screenshot ${hasScreenshot ? "active" : ""}" title="Toggle screenshot">📷</button>
        <button class="pi-note-close" title="Remove element">×</button>
      </div>
      <div class="pi-note-body">
        <textarea class="pi-note-textarea" placeholder="Describe changes for this element...">${escapeHtml(comment)}</textarea>
      </div>
    `;

    // Helper to get current index from DOM (survives reindexing)
    const getIndex = () => parseInt(card.dataset.index, 10);

    // Event listeners
    const textarea = card.querySelector(".pi-note-textarea");
    textarea.addEventListener("input", () => {
      elementComments.set(getIndex(), textarea.value);
      autoResizeTextarea(textarea);
    });

    const screenshotBtn = card.querySelector(".pi-note-screenshot");
    screenshotBtn.addEventListener("click", () => {
      const idx = getIndex();
      const current = elementScreenshots.get(idx) !== false;
      elementScreenshots.set(idx, !current);
      screenshotBtn.classList.toggle("active", !current);
    });

    const closeBtn = card.querySelector(".pi-note-close");
    closeBtn.addEventListener("click", () => removeElement(getIndex()));

    const expandBtn = card.querySelector(".pi-note-expand");
    expandBtn.addEventListener("click", () => expandElement(getIndex()));

    const contractBtn = card.querySelector(".pi-note-contract");
    contractBtn.addEventListener("click", () => contractElement(getIndex()));

    const selectorEl = card.querySelector(".pi-note-selector");
    selectorEl.addEventListener("click", () => {
      const idx = getIndex();
      const currentSel = selectedElements[idx];
      if (currentSel?.element) scrollToElement(currentSel.element);
    });

    // Drag to reposition
    setupDrag(card);

    notesContainer.appendChild(card);
    openNotes.add(index);

    // Focus textarea
    textarea.focus();

    return card;
  }

  function toggleNote(index) {
    if (openNotes.has(index)) {
      // Close note
      const card = notesContainer.querySelector(`[data-index="${index}"]`);
      if (card) card.remove();
      openNotes.delete(index);
    } else {
      // Open note
      createNoteCard(index);
    }
    updateBadges();
    updateConnectors();
  }

  function autoResizeTextarea(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(160, Math.max(72, textarea.scrollHeight)) + "px";
  }

  // ─────────────────────────────────────────────────────────────────────
  // Drag Handling
  // ─────────────────────────────────────────────────────────────────────

  function initDragHandlers() {
    document.addEventListener("mousemove", handleDragMove, true);
    document.addEventListener("mouseup", handleDragEnd, true);
  }

  function cleanupDragHandlers() {
    document.removeEventListener("mousemove", handleDragMove, true);
    document.removeEventListener("mouseup", handleDragEnd, true);
  }

  function handleDragMove(e) {
    if (bubbleDragState && panelEl) {
      const { startX, startY, startLeft, startTop } = bubbleDragState;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) bubbleWasDragged = true;

      const width = panelEl.offsetWidth || 58;
      const height = panelEl.offsetHeight || 58;
      const newX = Math.max(8, Math.min(startLeft + dx, window.innerWidth - width - 8));
      const newY = Math.max(8, Math.min(startTop + dy, window.innerHeight - height - 8));
      panelEl.style.left = `${newX}px`;
      panelEl.style.top = `${newY}px`;
      panelEl.style.right = "auto";
      panelEl.style.bottom = "auto";
      bubblePosition = { x: newX, y: newY };
      return;
    }

    if (!dragState) return;
    const { card, startX, startY, startLeft, startTop } = dragState;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const newX = startLeft + dx;
    const newY = startTop + dy;
    card.style.left = `${newX}px`;
    card.style.top = `${newY}px`;
    const index = parseInt(card.dataset.index, 10);
    notePositions.set(index, { x: newX, y: newY });
    updateConnectors();
  }

  function handleDragEnd() {
    if (bubbleDragState) {
      panelEl?.classList.remove("dragging");
      bubbleDragState = null;
    }
    if (dragState) {
      dragState.card.classList.remove("dragging");
      dragState = null;
    }
  }

  function setupDrag(card) {
    const header = card.querySelector(".pi-note-header");

    header.addEventListener("mousedown", (e) => {
      if (e.target.tagName === "BUTTON" || e.target.tagName === "SPAN") return;
      dragState = {
        card,
        startX: e.clientX,
        startY: e.clientY,
        startLeft: card.offsetLeft,
        startTop: card.offsetTop
      };
      card.classList.add("dragging");
      e.preventDefault();
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // Element Management
  // ─────────────────────────────────────────────────────────────────────

  function removeElement(index) {
    selectedElements.splice(index, 1);

    // Close and remove the note card if open
    if (openNotes.has(index)) {
      const card = notesContainer.querySelector(`[data-index="${index}"]`);
      if (card) card.remove();
      openNotes.delete(index);
    }

    // Reindex all state Maps and Sets
    const reindexMap = (map) => {
      const newMap = new Map();
      map.forEach((v, k) => {
        if (k < index) newMap.set(k, v);
        else if (k > index) newMap.set(k - 1, v);
      });
      return newMap;
    };

    const reindexSet = (set) => {
      const newSet = new Set();
      set.forEach(k => {
        if (k < index) newSet.add(k);
        else if (k > index) newSet.add(k - 1);
      });
      return newSet;
    };

    elementScreenshots = reindexMap(elementScreenshots);
    elementComments = reindexMap(elementComments);
    notePositions = reindexMap(notePositions);
    openNotes = reindexSet(openNotes);

    // Update data-index attributes on remaining note cards
    notesContainer.querySelectorAll(".pi-note-card").forEach(card => {
      const cardIndex = parseInt(card.dataset.index, 10);
      if (cardIndex > index) {
        const newIndex = cardIndex - 1;
        card.dataset.index = newIndex;
        const badge = card.querySelector(".pi-note-badge");
        if (badge) badge.textContent = newIndex + 1;
      }
    });

    updateBadges();
    updateConnectors();
  }

  function expandElement(index) {
    const sel = selectedElements[index];
    if (!sel?.element || !document.contains(sel.element)) return;

    const parent = sel.element.parentElement;
    if (parent && parent !== document.body && parent !== document.documentElement) {
      if (isPiElement(parent)) {
        console.log("[pi-annotate] Cannot expand to pi-annotate UI element");
        return;
      }

      console.log("[pi-annotate] Expanding to parent:", parent.tagName);
      selectedElements[index] = createSelectionData(parent);
      updateNoteCardLabel(index);
      updateBadges();
      updateConnectors();
    } else {
      console.log("[pi-annotate] Already at root - no valid parent");
    }
  }

  function contractElement(index) {
    const sel = selectedElements[index];
    if (!sel?.element || !document.contains(sel.element)) return;

    const children = Array.from(sel.element.children).filter(c =>
      c.nodeType === 1 && !isPiElement(c)
    );

    if (children.length > 0) {
      console.log("[pi-annotate] Contracting to child:", children[0].tagName);
      selectedElements[index] = createSelectionData(children[0]);
      updateNoteCardLabel(index);
      updateBadges();
      updateConnectors();
    } else {
      console.log("[pi-annotate] No children to contract to");
    }
  }

  function scrollToElement(element) {
    if (!element || !document.contains(element)) return;

    element.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "center"
    });

    // Flash highlight effect after scroll
    setTimeout(() => {
      if (!element || !document.contains(element)) return;

      const rect = element.getBoundingClientRect();
      highlightEl.style.display = "";
      highlightEl.style.left = rect.left + "px";
      highlightEl.style.top = rect.top + "px";
      highlightEl.style.width = rect.width + "px";
      highlightEl.style.height = rect.height + "px";
      highlightEl.style.transition = "opacity 0.3s";
      highlightEl.style.opacity = "1";

      setTimeout(() => {
        highlightEl.style.opacity = "0";
        setTimeout(() => {
          highlightEl.style.display = "none";
          highlightEl.style.transition = "";
          highlightEl.style.opacity = "";
        }, 300);
      }, 500);
    }, 400);
  }

  function expandAllNotes() {
    selectedElements.forEach((_, i) => {
      if (!openNotes.has(i)) {
        createNoteCard(i);
      }
    });
    updateBadges();
    updateConnectors();
  }

  function collapseAllNotes() {
    openNotes.forEach(i => {
      const card = notesContainer.querySelector(`[data-index="${i}"]`);
      if (card) card.remove();
    });
    openNotes.clear();
    updateBadges();
    updateConnectors();
  }

  // ─────────────────────────────────────────────────────────────────────
  // UI Updates
  // ─────────────────────────────────────────────────────────────────────

  function updateSelectionCount() {
    const countEl = document.getElementById("pi-count");
    if (countEl) countEl.textContent = `${selectedElements.length} selected`;
    const bubbleCountEl = document.getElementById("pi-bubble-count");
    if (bubbleCountEl) bubbleCountEl.textContent = String(selectedElements.length);
  }

  function updateBadges() {
    if (!markersContainer) return;
    markersContainer.innerHTML = "";

    selectedElements.forEach((sel, i) => {
      if (!sel.element || !document.contains(sel.element)) return;

      const rect = sel.element.getBoundingClientRect();

      // Create outline box around selected element
      const outline = document.createElement("div");
      outline.className = "pi-marker-outline";
      outline.style.left = `${rect.left}px`;
      outline.style.top = `${rect.top}px`;
      outline.style.width = `${rect.width}px`;
      outline.style.height = `${rect.height}px`;
      markersContainer.appendChild(outline);

      // Create numbered badge
      const badge = document.createElement("div");
      badge.className = `pi-marker-badge ${openNotes.has(i) ? "open" : ""}`;
      badge.dataset.index = i;
      badge.textContent = i + 1;
      badge.style.left = `${rect.right - 14}px`;
      badge.style.top = `${rect.top - 14}px`;

      badge.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleNote(i);
      });

      markersContainer.appendChild(badge);
    });

    updateSelectionCount();
  }

  function updateConnectors() {
    if (!connectorsEl) return;
    connectorsEl.innerHTML = "";

    selectedElements.forEach((sel, i) => {
      if (!openNotes.has(i)) return;

      const card = notesContainer.querySelector(`[data-index="${i}"]`);
      if (!card || !sel.element || !document.contains(sel.element)) return;

      const elemRect = sel.element.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();

      const elemCenter = {
        x: elemRect.left + elemRect.width / 2,
        y: elemRect.top + elemRect.height / 2
      };

      let cardAnchor;
      if (cardRect.left > elemRect.right) {
        cardAnchor = { x: cardRect.left, y: cardRect.top + 20 };
      } else if (cardRect.right < elemRect.left) {
        cardAnchor = { x: cardRect.right, y: cardRect.top + 20 };
      } else if (cardRect.top > elemRect.bottom) {
        cardAnchor = { x: cardRect.left + 20, y: cardRect.top };
      } else if (cardRect.bottom < elemRect.top) {
        cardAnchor = { x: cardRect.left + 20, y: cardRect.bottom };
      } else {
        return; // Card overlaps element
      }

      const midX = (elemCenter.x + cardAnchor.x) / 2;
      const midY = (elemCenter.y + cardAnchor.y) / 2;

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("class", "pi-connector");
      path.setAttribute("d", `M ${elemCenter.x},${elemCenter.y} Q ${midX},${midY} ${cardAnchor.x},${cardAnchor.y}`);
      connectorsEl.appendChild(path);

      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("class", "pi-connector-dot");
      dot.setAttribute("cx", elemCenter.x);
      dot.setAttribute("cy", elemCenter.y);
      dot.setAttribute("r", 4);
      connectorsEl.appendChild(dot);
    });
  }

  function updateHighlight() {
    const el = elementStack[stackIndex];
    if (!el) return hideHighlight();

    const rect = el.getBoundingClientRect();
    Object.assign(highlightEl.style, {
      display: "",
      left: rect.left + "px",
      top: rect.top + "px",
      width: rect.width + "px",
      height: rect.height + "px",
    });
  }

  function hideHighlight() {
    if (highlightEl) highlightEl.style.display = "none";
  }

  function updateTooltip(mx, my) {
    const el = elementStack[stackIndex];
    if (!el) return hideTooltip();

    const rect = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    const id = el.id;
    const classes = Array.from(el.classList).slice(0, 3);

    let html = `<span class="tag">${escapeHtml(tag)}</span>`;
    if (id) html += `<span class="id">#${escapeHtml(id)}</span>`;
    if (classes.length) html += `<span class="class">.${escapeHtml(classes.join("."))}</span>`;
    html += `<span class="size">${Math.round(rect.width)}×${Math.round(rect.height)}</span>`;
    if (elementStack.length > 1) {
      html += `<span class="hint">${ALT_KEY_LABEL}+▲▼ ${stackIndex + 1}/${elementStack.length}</span>`;
    }

    tooltipEl.innerHTML = html;
    tooltipEl.style.display = "";

    let tx = mx + 15, ty = my + 15;
    const tr = tooltipEl.getBoundingClientRect();
    if (tx + tr.width > window.innerWidth - 10) tx = mx - tr.width - 10;
    if (ty + tr.height > window.innerHeight - 100) ty = my - tr.height - 10;

    tooltipEl.style.left = tx + "px";
    tooltipEl.style.top = ty + "px";
  }

  function hideTooltip() {
    if (tooltipEl) tooltipEl.style.display = "none";
  }

  // ─────────────────────────────────────────────────────────────────────
  // Event Handlers
  // ─────────────────────────────────────────────────────────────────────

  function onMouseMove(e) {
    if (!isActive || e.target.closest("#pi-panel") || e.target.closest(".pi-note-card")) {
      hideHighlight();
      hideTooltip();
      return;
    }

    highlightEl.style.display = "none";
    tooltipEl.style.display = "none";
    const el = document.elementFromPoint(e.clientX, e.clientY);
    highlightEl.style.display = "";

    if (!el || el === document.body || el === document.documentElement || isPiElement(el)) {
      hideHighlight();
      hideTooltip();
      return;
    }

    // Build parent chain
    elementStack = [];
    let current = el;
    while (current && current !== document.body && current !== document.documentElement) {
      if (!isPiElement(current)) {
        elementStack.push(current);
      }
      current = current.parentElement;
    }
    stackIndex = 0;

    updateHighlight();
    updateTooltip(e.clientX, e.clientY);
  }

  function onWheel(e) {
    if (!isActive || !elementStack.length || e.target.closest("#pi-panel") || e.target.closest(".pi-note-card")) return;

    if (!e.altKey) return;

    e.preventDefault();
    e.stopPropagation();

    stackIndex = e.deltaY > 0
      ? Math.min(stackIndex + 1, elementStack.length - 1)
      : Math.max(stackIndex - 1, 0);

    updateHighlight();
    updateTooltip(e.clientX, e.clientY);
  }

  function onClick(e) {
    if (!isActive || e.target.closest("#pi-panel") || e.target.closest(".pi-note-card")) return;

    e.preventDefault();
    e.stopPropagation();

    const el = elementStack[stackIndex];
    if (!el) return;

    const idx = selectedElements.findIndex(s => s.element === el);

    if (idx >= 0) {
      // Already selected - deselect it
      removeElement(idx);
      return;
    }

    // Not selected - add it
    const addToExisting = multiSelectMode || e.shiftKey;
    if (!addToExisting) {
      // Clear existing selections
      collapseAllNotes();
      selectedElements = [];
      elementScreenshots = new Map();
      elementComments = new Map();
      notePositions = new Map();
    }
    selectElement(el);

    // Auto-open note for the newly selected element
    const newIndex = selectedElements.length - 1;
    createNoteCard(newIndex);

    updateBadges();
    updateConnectors();
  }

  function resetEscapeSequence() {
    escapeCount = 0;
    if (escapeResetTimer) {
      clearTimeout(escapeResetTimer);
      escapeResetTimer = null;
    }
  }

  function closeAbortDialog() {
    abortDialogEl?.remove();
    abortDialogEl = null;
  }

  function showAbortDialog() {
    if (abortDialogEl) return;

    abortDialogEl = document.createElement("div");
    abortDialogEl.className = "pi-abort-backdrop";
    abortDialogEl.innerHTML = `
      <div class="pi-abort-dialog" role="dialog" aria-modal="true" aria-labelledby="pi-abort-title" aria-describedby="pi-abort-description">
        <h2 id="pi-abort-title">Abort annotation?</h2>
        <p id="pi-abort-description">Your selected elements and comments will be discarded.</p>
        <div class="pi-abort-actions">
          <button class="pi-btn pi-btn-cancel" id="pi-abort-continue">Continue annotating</button>
          <button class="pi-btn pi-btn-submit" id="pi-abort-confirm">Abort annotation</button>
        </div>
      </div>
    `;
    document.body.appendChild(abortDialogEl);

    const continueButton = abortDialogEl.querySelector("#pi-abort-continue");
    const abortButton = abortDialogEl.querySelector("#pi-abort-confirm");
    continueButton.addEventListener("click", closeAbortDialog);
    abortButton.addEventListener("click", () => {
      closeAbortDialog();
      handleCancel();
    });
    abortDialogEl.addEventListener("click", (event) => {
      if (event.target === abortDialogEl) closeAbortDialog();
    });
    continueButton.focus();
  }

  function onKeyDown(e) {
    if (!isActive) return;

    if (abortDialogEl) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!e.repeat) {
          closeAbortDialog();
          resetEscapeSequence();
        }
        return;
      }

      if (e.key === "Tab") {
        const buttons = Array.from(abortDialogEl.querySelectorAll("button"));
        const currentIndex = buttons.indexOf(document.activeElement);
        const nextIndex = e.shiftKey
          ? (currentIndex <= 0 ? buttons.length - 1 : currentIndex - 1)
          : (currentIndex >= buttons.length - 1 ? 0 : currentIndex + 1);
        e.preventDefault();
        buttons[nextIndex]?.focus();
      }
      return;
    }

    if (e.key !== "Escape") {
      resetEscapeSequence();
      return;
    }

    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return;

    const activeElement = document.activeElement;
    if (activeElement?.matches?.(".pi-note-textarea, #pi-context")) {
      activeElement.blur();
    }

    escapeCount += 1;
    if (escapeResetTimer) clearTimeout(escapeResetTimer);
    escapeResetTimer = setTimeout(resetEscapeSequence, 2000);

    if (escapeCount >= 3) {
      resetEscapeSequence();
      showAbortDialog();
    }
  }

  function handleScroll() {
    updateBadges();
    updateConnectors();
  }

  function handleResize() {
    updateBadges();
    const panelHeight = getPanelReservedHeight();

    if (panelMinimized && panelEl && bubblePosition) {
      const width = panelEl.offsetWidth || 58;
      const height = panelEl.offsetHeight || 58;
      bubblePosition = {
        x: Math.max(8, Math.min(bubblePosition.x, window.innerWidth - width - 8)),
        y: Math.max(8, Math.min(bubblePosition.y, window.innerHeight - height - 8)),
      };
      panelEl.style.left = `${bubblePosition.x}px`;
      panelEl.style.top = `${bubblePosition.y}px`;
    }

    openNotes.forEach(index => {
      const card = notesContainer.querySelector(`[data-index="${index}"]`);
      if (!card) return;

      const rect = card.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      let newX = card.offsetLeft;
      let newY = card.offsetTop;
      let moved = false;

      if (rect.right > vw - 16) {
        newX = vw - rect.width - 16;
        moved = true;
      }
      if (rect.bottom > vh - panelHeight - 16) {
        newY = vh - rect.height - panelHeight - 16;
        moved = true;
      }

      if (moved) {
        card.style.left = `${newX}px`;
        card.style.top = `${newY}px`;
        // Update stored position so rebuild uses correct location
        notePositions.set(index, { x: newX, y: newY });
      }
    });
    updateConnectors();
  }

  // ─────────────────────────────────────────────────────────────────────
  // Selection
  // ─────────────────────────────────────────────────────────────────────

  function selectElement(el) {
    selectedElements.push(createSelectionData(el));
  }

  function createSelectionData(el) {
    const data = {
      element: el,
      selector: generateSelector(el),
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      classes: Array.from(el.classList),
      text: (el.textContent || "").slice(0, TEXT_MAX_LENGTH).trim().replace(/\s+/g, " "),
      rect: getRectData(el),
      attributes: getAttrs(el),
      boxModel: getBoxModel(el),
      accessibility: getAccessibilityInfo(el),
      keyStyles: getKeyStyles(el),
    };

    if (debugMode) {
      data.computedStyles = getComputedStyles(el);
      data.parentContext = getParentContext(el);
      data.cssVariables = getCSSVariables(el);
    }

    return data;
  }

  function pruneStaleSelections() {
    if (!selectedElements.length) return;

    const nextSelections = [];
    const nextScreenshots = new Map();
    const nextComments = new Map();
    const nextPositions = new Map();
    const nextOpenNotes = new Set();

    selectedElements.forEach((sel, i) => {
      if (sel?.element && document.contains(sel.element)) {
        const nextIndex = nextSelections.length;
        nextSelections.push(sel);

        if (elementScreenshots.has(i)) {
          nextScreenshots.set(nextIndex, elementScreenshots.get(i));
        }
        if (elementComments.has(i)) {
          nextComments.set(nextIndex, elementComments.get(i));
        }
        if (notePositions.has(i)) {
          nextPositions.set(nextIndex, notePositions.get(i));
        }
        if (openNotes.has(i)) {
          nextOpenNotes.add(nextIndex);
        }
      } else if (openNotes.has(i)) {
        const card = notesContainer?.querySelector(`[data-index="${i}"]`);
        if (card) card.remove();
      }
    });

    if (nextSelections.length !== selectedElements.length) {
      selectedElements = nextSelections;
      elementScreenshots = nextScreenshots;
      elementComments = nextComments;
      notePositions = nextPositions;

      notesContainer.innerHTML = "";
      openNotes = new Set();
      nextOpenNotes.forEach(i => createNoteCard(i));

      updateBadges();
      updateConnectors();
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Submit / Cancel
  // ─────────────────────────────────────────────────────────────────────

  function setDeliveryState(pending, error = "") {
    deliveryPending = pending;
    const submitButton = document.getElementById("pi-submit");
    const cancelButton = document.getElementById("pi-cancel");
    const closeButton = document.getElementById("pi-close");
    const errorElement = document.getElementById("pi-delivery-error");

    if (submitButton) {
      submitButton.disabled = pending;
      submitButton.textContent = pending ? "Sending…" : (error ? "Retry" : "Submit");
    }
    if (cancelButton) cancelButton.disabled = pending;
    if (closeButton) closeButton.disabled = pending;
    if (errorElement) {
      errorElement.textContent = error;
      errorElement.hidden = !error;
    }
  }

  function hideAnnotationUiForCapture() {
    hideHighlight();
    hideTooltip();
    const elements = [markersContainer, notesContainer, connectorsEl, panelEl].filter(Boolean);
    const previousDisplays = elements.map((element) => [element, element.style.display]);
    for (const element of elements) element.style.display = "none";
    etch.clearMarkers();

    return () => {
      if (!isActive) return;
      for (const [element, display] of previousDisplays) {
        if (element.isConnected) element.style.display = display;
      }
    };
  }

  async function handleSubmit() {
    if (deliveryPending) return;
    if (!sessionId) {
      setDeliveryState(false, "No Pi annotation session is selected. Start again from the extension picker.");
      return;
    }

    const targetSessionId = sessionId;
    setDeliveryState(true);
    const context = document.getElementById("pi-context")?.value?.trim() || "";

    // Re-capture debug data for all elements if debug mode is on at submit time
    // (handles elements selected before debug was enabled)
    pruneStaleSelections();
    if (debugMode) {
      selectedElements.forEach(sel => {
        if (sel.element && document.contains(sel.element)) {
          sel.computedStyles = getComputedStyles(sel.element);
          sel.parentContext = getParentContext(sel.element);
          sel.cssVariables = getCSSVariables(sel.element);
        }
      });
    }

    const elements = selectedElements.map((sel, i) => {
      const { element, ...rest } = sel;
      return {
        ...rest,
        comment: elementComments.get(i) || ""
      };
    });

    // Hide UI for screenshot capture. Keep the prior display state so a
    // delivery failure can restore the annotation instead of discarding it.
    const restoreAnnotationUi = hideAnnotationUiForCapture();

    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    let screenshot = null;
    let screenshots = [];

    if (screenshotMode !== "none") {
      try {
        const resp = await chrome.runtime.sendMessage({ type: "CAPTURE_SCREENSHOT" });
        if (resp?.dataUrl) {
          const fullScreenshot = resp.dataUrl;

          if (screenshotMode === "full") {
            // Add numbered badges to the viewport screenshot so elements can be identified
            screenshot = await addBadgesToScreenshot(fullScreenshot, selectedElements);
          } else {
            for (let i = 0; i < selectedElements.length; i++) {
              const hasScreenshot = elementScreenshots.get(i) !== false;
              const element = selectedElements[i].element;
              if (hasScreenshot && element && document.contains(element)) {
                const cropped = await cropToElement(fullScreenshot, element);
                screenshots.push({ index: i + 1, dataUrl: cropped });
              }
            }
          }
        }
      } catch (err) {
        console.error("[pi-annotate] Screenshot failed:", err);
      }
    }

    // Edit capture (the annotation UI is already hidden for screenshots)
    const editCapture = await etch.collect();

    try {
      const response = await chrome.runtime.sendMessage({
        type: "ANNOTATIONS_COMPLETE",
        sessionId: targetSessionId,
        result: {
          success: true,
          elements,
          screenshot,
          screenshots,
          prompt: context,
          url: window.location.href,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          editCapture,
        },
      });
      if (!response?.delivered) {
        throw new Error(response?.error || "The broker did not acknowledge delivery");
      }
      deactivate();
    } catch (error) {
      restoreAnnotationUi();
      const message = error instanceof Error ? error.message : String(error);
      setDeliveryState(false, `Delivery failed: ${message.slice(0, 240)}`);
    }
  }

  function handleCancel() {
    if (deliveryPending) return;
    deactivate();
  }

  console.log("[pi-annotate] Content script ready");
})();
