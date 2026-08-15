/**
 * Pi Annotate - annotation dialog presentation adapter.
 *
 * Owns dialog DOM, focus return, and focus trapping. The annotation-run module
 * remains authoritative for whether a dialog may be open.
 */

(() => {
  const modules = (window["__piAnnotateModules_" + chrome.runtime.id] ??= {});
  if (modules.dialogs) return;

  function createDialogView({ escapeHtml, assetUrl, documentTarget = document }) {
    let dialog = null;
    let returnFocus = null;

    function remove({ restoreFocus = true } = {}) {
      dialog?.remove();
      dialog = null;
      if (restoreFocus) returnFocus?.focus?.();
      returnFocus = null;
    }

    function open({ kind, title, description, actions, focusTarget }) {
      remove({ restoreFocus: false });
      returnFocus = focusTarget || documentTarget.activeElement || null;
      const backdrop = documentTarget.createElement("div");
      const kindClass = kind.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      backdrop.className = kind === "abort"
        ? "pi-abort-backdrop"
        : `pi-modal-backdrop pi-${kindClass}-backdrop`;
      backdrop.innerHTML = `
        <div class="pi-modal" role="dialog" aria-modal="true" aria-labelledby="pi-modal-title"
          aria-describedby="pi-modal-description">
          <h2 id="pi-modal-title">${escapeHtml(title)}</h2>
          <p id="pi-modal-description">${escapeHtml(description)}</p>
          <div class="pi-modal-actions"></div>
        </div>`;
      let actionRow = backdrop.querySelector(".pi-modal-actions");
      if (!actionRow) {
        actionRow = documentTarget.createElement("div");
        actionRow.className = "pi-modal-actions";
        backdrop.appendChild(actionRow);
      }
      for (const [label, handler, variant] of actions) {
        const button = documentTarget.createElement("button");
        if (kind === "abort" && label === "Continue annotating") button.id = "pi-abort-continue";
        if (kind === "abort" && label === "Abort annotation") button.id = "pi-abort-confirm";
        button.className = `pi-btn ${variant === "primary" ? "pi-btn-submit" : "pi-btn-cancel"}`;
        button.textContent = label;
        button.addEventListener("click", handler);
        actionRow.appendChild(button);
      }
      documentTarget.body.appendChild(backdrop);
      dialog = backdrop;
      actionRow.querySelector("button")?.focus();
    }

    function openHelp({ onClose, focusTarget }) {
      remove({ restoreFocus: false });
      returnFocus = focusTarget || documentTarget.activeElement || null;
      const backdrop = documentTarget.createElement("div");
      backdrop.className = "pi-modal-backdrop pi-help-backdrop";
      backdrop.innerHTML = `
        <section class="pi-modal pi-help-dialog" role="dialog" aria-modal="true"
          aria-labelledby="pi-help-title">
          <header class="pi-help-header">
            <img class="pi-grinsekatze-icon" src="${escapeHtml(assetUrl)}" alt="Grinsekatze">
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
      backdrop.querySelector(".pi-help-close")?.addEventListener("click", onClose);
      backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) onClose();
      });
      documentTarget.body.appendChild(backdrop);
      dialog = backdrop;
      backdrop.querySelector(".pi-help-close")?.focus();
    }

    function trapTab(event) {
      const buttons = Array.from(dialog?.querySelectorAll?.("button") || []);
      if (!buttons.length) return false;
      const index = buttons.indexOf(documentTarget.activeElement);
      const next = event.shiftKey
        ? (index <= 0 ? buttons.length - 1 : index - 1)
        : (index >= buttons.length - 1 ? 0 : index + 1);
      event.preventDefault();
      buttons[next].focus();
      return true;
    }

    return Object.freeze({ open, openHelp, remove, trapTab });
  }

  modules.dialogs = { createDialogView };
})();
