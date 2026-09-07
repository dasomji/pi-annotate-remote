/** Owns annotation cards, target navigation, markers, connectors, and dragging. */
(() => {
  const modules = (window["__piAnnotateModules_" + chrome.runtime.id] ??= {});
  if (modules.evidenceView) return;

  function createEvidenceView({ inspect, readState, actions }) {
    const records = new Map();
    let activeRecordId = null;
    let noteDrag = null;
    let state;
    let connectorsEl, markersEl, notesEl;

    function render(snapshot) {
      if (!markersEl || !notesEl) return;
      state = readState(snapshot);
      const result = state.snapshot;
      const visibleIds = new Set();
      for (const step of result.steps) {
        for (const element of step.elements) {
          visibleIds.add(element.id);
          let record = records.get(element.id);
          if (!record) {
            record = { navigation: { path: [element.sourceNode], index: 0 }, notePosition: null, noteOpen: true };
            records.set(element.id, record);
          }
          record.sourceNode = element.sourceNode;
        }
      }
      if (!visibleIds.has(activeRecordId)) activeRecordId = null;
      const showing = state.mode === "annotating";
      for (const surface of surfaces()) surface.style.display = showing ? "" : "none";
      const visible = [];
      result.steps.forEach((step, stepIndex) => {
        if (state.filter !== "all" && state.filter !== step.id) return;
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
          open(element.id);
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
          open(element.id, { focus: false });
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

    function open(id, { focus = true } = {}) {
      const element = state.snapshot.steps.flatMap((step) => step.elements).find((item) => item.id === id);
      if (!element) return;
      const record = records.get(id);
      if (record) record.noteOpen = true;
      let card = notesEl.querySelector?.(`[data-annotation-id="${id}"]`);
      if (card) {
        if (focus) activeRecordId = id;
        updateNoteCard(card, element);
        if (focus) render();
        if (focus) card.querySelector?.(".pi-note-textarea")?.focus();
        return;
      }
      card = document.createElement("section");
      card.className = "pi-note-card";
      card.dataset.annotationId = id;
      card.innerHTML = `
        <div class="pi-note-header">
          <span class="pi-historical" role="status"></span>
          <button class="pi-note-expand" aria-label="Move Element annotation to parent">▲</button>
          <button class="pi-note-contract" aria-label="Move Element annotation toward original element">▼</button>
          <button class="pi-note-close" aria-label="Delete element annotation">×</button>
        </div>
        <div class="pi-note-body">
          <span class="pi-note-selector">${inspect.escapeHtml(element.metadata.selector)}</span>
          <div class="pi-note-comment-row">
            <textarea class="pi-note-textarea" placeholder="Describe changes for this element...">${inspect.escapeHtml(element.comment)}</textarea>
            <button class="pi-note-send" type="button" aria-label="Send comment">↑</button>
          </div>
        </div>`;
      const source = record?.sourceNode;
      const rect = source?.getBoundingClientRect?.() || { right: 24, top: 24 };
      card.style.visibility = "hidden";
      const commentField = card.querySelector?.(".pi-note-textarea");
      commentField?.addEventListener("input", (event) => {
        if (!state.blocked) actions.comment(id, event.target.value);
      });
      commentField?.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey) ||
            event.repeat || event.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        void actions.send(id);
      });
      card.querySelector?.(".pi-note-close")?.addEventListener("click", () => actions.delete(id));
      card.querySelector?.(".pi-note-send")?.addEventListener("click", () => { void actions.send(id); });
      card.querySelector?.(".pi-note-expand")?.addEventListener("click", () => moveElementTarget(id, "up"));
      card.querySelector?.(".pi-note-contract")?.addEventListener("click", () => moveElementTarget(id, "down"));
      card.querySelector?.(".pi-note-header")?.addEventListener("pointerdown", (event) => {
        if (!event.isPrimary || event.button !== 0 || state.blocked || event.target.closest?.("button")) return;
        const bounds = card.getBoundingClientRect();
        noteDrag = {
          card,
          id,
          pointerId: event.pointerId,
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
        render();
      });
      notesEl.appendChild(card);
      placeNoteCard(card, record?.notePosition || { left: rect.right + 16, top: rect.top });
      card.style.visibility = "";
      updateNoteCard(card, element);
      if (focus) {
        activeRecordId = id;
        render();
      }
      if (focus) card.querySelector?.(".pi-note-textarea")?.focus();
    }

    function placeNoteCard(card, preferred) {
      const margin = 16;
      card.style.maxHeight = "";
      const bounds = card.getBoundingClientRect();
      const maxLeft = Math.max(margin, window.innerWidth - bounds.width - margin);
      const availableBottom = state.reservedBottom > margin ? state.reservedBottom - 12 : window.innerHeight - margin;
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
      card.querySelectorAll("button, textarea").forEach(control => { control.disabled = state.blocked; });
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

      const currentStep = state.snapshot.steps.some(step => step.id === state.snapshot.currentStepId && step.elements.some(element => element.id === id));
      const blocked = state.blocked;
      const sourceAvailable = record.sourceNode?.isConnected !== false;
      const parent = sourceAvailable ? record.sourceNode.parentElement : null;
      const canMoveUp = parent && parent !== document.body && parent !== document.documentElement &&
        !inspect.isPiElement(parent);
      const retracedChild = record.navigation.index > 0
        ? record.navigation.path[record.navigation.index - 1]
        : null;
      const onlyChild = record.navigation.index === 0
        ? uniqueNavigableChild(record.sourceNode)
        : null;
      const canMoveDown = retracedChild?.isConnected !== false && Boolean(retracedChild) || Boolean(onlyChild);
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

    function uniqueNavigableChild(source) {
      if (!source?.children) return null;
      const children = Array.from(source.children).filter((child) => !inspect.isPiElement(child));
      return children.length === 1 ? children[0] : null;
    }

    function moveElementTarget(id, direction) {
      if (state.blocked) return;
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
        if (record.navigation.index === 0) {
          target = uniqueNavigableChild(record.sourceNode);
          if (!target || target.isConnected === false) return;
          record.navigation.path.unshift(target);
          targetIndex = 0;
        } else {
          targetIndex = record.navigation.index - 1;
          target = record.navigation.path[targetIndex];
          if (!target || target.isConnected === false) return;
        }
      }

      if (!actions.retarget(id, target)) return;
      record.sourceNode = target;
      record.navigation.path[targetIndex] = target;
      if (truncate) record.navigation.path.length = targetIndex + 1;
      record.navigation.index = targetIndex;
      render();
    }

    function onDragMove(event) {
      if (!noteDrag || event.pointerId !== noteDrag.pointerId) return;
      const position = placeNoteCard(noteDrag.card, {
        left: noteDrag.startLeft + event.clientX - noteDrag.startX,
        top: noteDrag.startTop + event.clientY - noteDrag.startY,
      });
      const record = records.get(noteDrag.id);
      if (record) record.notePosition = position;
      renderConnectors();
      event.preventDefault();
    }

    function endDrag(event) {
      if (event && noteDrag && event.pointerId !== noteDrag.pointerId) return;
      noteDrag?.card?.classList.remove("dragging");
      noteDrag = null;
    }

    function surfaces() { return [connectorsEl, markersEl, notesEl].filter(Boolean); }

    function mount() {
      connectorsEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      connectorsEl.classList.add("pi-connectors");
      connectorsEl.setAttribute("aria-hidden", "true");
      markersEl = document.createElement("div");
      markersEl.id = "pi-markers";
      notesEl = document.createElement("div");
      notesEl.className = "pi-notes-container";
      for (const surface of surfaces()) {
        for (const name of ["focusin", "focusout", "pointerdown"]) {
          surface.addEventListener(name, event => event.stopPropagation());
        }
        document.body.appendChild(surface);
      }
      document.addEventListener("pointermove", onDragMove, true);
      document.addEventListener("pointerup", endDrag, true);
      document.addEventListener("pointercancel", endDrag, true);
    }

    function reset() {
      endDrag();
      records.clear();
      activeRecordId = null;
      for (const surface of surfaces()) surface.replaceChildren();
    }

    function remove() {
      reset();
      document.removeEventListener("pointermove", onDragMove, true);
      document.removeEventListener("pointerup", endDrag, true);
      document.removeEventListener("pointercancel", endDrag, true);
      for (const surface of surfaces()) surface.remove();
      connectorsEl = markersEl = notesEl = null;
    }

    function collapse(id) {
      const record = records.get(id);
      if (record) record.noteOpen = false;
      if (activeRecordId === id) activeRecordId = null;
      notesEl?.querySelector(`[data-annotation-id="${id}"]`)?.remove();
      render();
    }

    return {
      mount, remove, reset, render, open, collapse, surfaces,
      contains: node => surfaces().some(surface => surface.contains(node)),
      sourceNodes: () => Array.from(records.values()).flatMap(record => [record.sourceNode, ...record.navigation.path]).filter(Boolean),
    };
  }
  modules.evidenceView = { createEvidenceView };
})();
