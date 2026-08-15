/**
 * Pi Annotate - Annotator stylesheet module
 *
 * Registers the annotator's injected CSS on the shared module namespace.
 * Injected before content.js; see ANNOTATOR_SCRIPT_FILES in background.js.
 */

(() => {
  const modules = (window["__piAnnotateModules_" + chrome.runtime.id] ??= {});
  if (modules.styles) return;

  const Z_INDEX_CONNECTORS = 2147483643;
  const Z_INDEX_MARKERS = 2147483644;
  const Z_INDEX_HIGHLIGHT = 2147483645;
  const Z_INDEX_PANEL = 2147483646;
  const Z_INDEX_TOOLTIP = 2147483647;

  const STYLES = `
    /* ═══════════════════════════════════════════════════════════════════
       CSS Custom Properties (aligned with pi interview theme)
       ═══════════════════════════════════════════════════════════════════ */
    :root {
      --pi-bg-body: #171717;
      --pi-bg-card: #212121;
      --pi-bg-elevated: #2f2f2f;
      --pi-bg-selected: #424242;
      --pi-bg-hover: #383838;
      --pi-fg: #ececec;
      --pi-fg-muted: #b4b4b4;
      --pi-fg-dim: #8f8f8f;
      --pi-accent: #10a37f;
      --pi-accent-hover: #0d8f70;
      --pi-accent-muted: rgba(16, 163, 127, 0.14);
      --pi-border: #10a37f;
      --pi-border-muted: #4a4a4a;
      --pi-border-focus: #696969;
      --pi-success: #10a37f;
      --pi-warning: #f2c94c;
      --pi-error: #ef6b6b;
      --pi-focus-ring: rgba(16, 163, 127, 0.18);
      --pi-shadow: rgba(0, 0, 0, 0.34);
      --pi-font-mono: ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, monospace;
      --pi-font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      --pi-radius: 4px;
    }

    /* Light theme */
    @media (prefers-color-scheme: light) {
      :root {
        --pi-bg-body: #f7f7f8;
        --pi-bg-card: #ffffff;
        --pi-bg-elevated: #f2f2f2;
        --pi-bg-selected: #e7e7e7;
        --pi-bg-hover: #ececec;
        --pi-fg: #0d0d0d;
        --pi-fg-muted: #5d5d5d;
        --pi-fg-dim: #8a8a8a;
        --pi-accent: #10a37f;
        --pi-accent-hover: #0d8f70;
        --pi-accent-muted: rgba(16, 163, 127, 0.10);
        --pi-border: #10a37f;
        --pi-border-muted: #dedede;
        --pi-border-focus: #b7b7b7;
        --pi-success: #10a37f;
        --pi-warning: #d7af5f;
        --pi-error: #af5f5f;
        --pi-focus-ring: rgba(16, 163, 127, 0.16);
        --pi-shadow: rgba(0, 0, 0, 0.14);
      }

      .pi-etch-toggle.recording {
        background: rgba(175, 95, 95, 0.1);
        box-shadow: 0 0 8px rgba(175, 95, 95, 0.2), inset 0 0 6px rgba(175, 95, 95, 0.04);
        color: #8b4444;
      }
    }

    /* ═══════════════════════════════════════════════════════════════════
       Highlight & Tooltip
       ═══════════════════════════════════════════════════════════════════ */
    #pi-highlight {
      position: fixed;
      pointer-events: none;
      z-index: ${Z_INDEX_HIGHLIGHT};
      background: var(--pi-accent-muted);
      border: 2px solid var(--pi-accent);
      border-radius: var(--pi-radius);
      transition: all 0.05s ease-out;
    }

    #pi-tooltip {
      position: fixed;
      pointer-events: none;
      z-index: ${Z_INDEX_TOOLTIP};
      background: var(--pi-bg-card);
      color: var(--pi-fg);
      padding: 6px 10px;
      border-radius: var(--pi-radius);
      border: 1px solid var(--pi-border-muted);
      font: 12px/1.4 var(--pi-font-mono);
      box-shadow: 0 2px 8px var(--pi-shadow);
      max-width: 400px;
    }

    #pi-tooltip .tag { color: var(--pi-error); }
    #pi-tooltip .id { color: var(--pi-warning); }
    #pi-tooltip .class { color: var(--pi-border); }
    #pi-tooltip .size { color: var(--pi-fg-dim); margin-left: 8px; }
    #pi-tooltip .hint { color: var(--pi-accent); font-size: 11px; margin-top: 4px; display: block; }

    /* ═══════════════════════════════════════════════════════════════════
       Markers & Selection
       ═══════════════════════════════════════════════════════════════════ */
    #pi-markers {
      position: fixed;
      top: 0; left: 0;
      width: 100%; height: 100%;
      pointer-events: none;
      z-index: ${Z_INDEX_MARKERS};
    }

    .pi-marker-outline {
      position: fixed;
      box-sizing: border-box;
      pointer-events: none;
      border: 2px solid var(--pi-accent);
      border-radius: var(--pi-radius);
      background: var(--pi-accent-muted);
    }

    .pi-marker-badge {
      position: fixed;
      pointer-events: auto;
      background: var(--pi-fg);
      color: var(--pi-bg-card);
      width: 34px;
      min-width: 34px;
      height: 34px;
      padding: 0;
      aspect-ratio: 1;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font: bold 13px var(--pi-font-ui);
      cursor: pointer;
      box-shadow: 0 2px 8px var(--pi-shadow);
      transform: translate(-50%, -50%);
      transition: transform 0.15s, box-shadow 0.15s;
    }

    .pi-marker-badge:hover {
      transform: translate(-50%, -50%) scale(1.1);
      background: var(--pi-fg-muted);
    }

    .pi-marker-badge.open {
      background: var(--pi-fg);
      color: var(--pi-bg-card);
      box-shadow: 0 0 0 3px var(--pi-bg-card), 0 0 0 4px var(--pi-border-focus);
    }

    /* ═══════════════════════════════════════════════════════════════════
       Connectors
       ═══════════════════════════════════════════════════════════════════ */
    .pi-connectors {
      position: fixed;
      top: 0; left: 0;
      width: 100%; height: 100%;
      pointer-events: none;
      z-index: ${Z_INDEX_CONNECTORS};
    }

    .pi-connector {
      fill: none;
      stroke: var(--pi-accent);
      stroke-opacity: 0.5;
      stroke-width: 2;
      stroke-dasharray: 6 4;
    }

    .pi-connector-dot {
      fill: var(--pi-accent);
    }

    #pi-panel.pi-rematerializing {
      animation: pi-panel-rematerialize 520ms cubic-bezier(0.16, 1, 0.3, 1) both;
    }

    #pi-markers.pi-rematerializing,
    .pi-connectors.pi-rematerializing,
    .pi-notes-container.pi-rematerializing {
      animation: pi-evidence-rematerialize 620ms 80ms cubic-bezier(0.16, 1, 0.3, 1) both;
    }

    @keyframes pi-panel-rematerialize {
      0% { opacity: 0; transform: translateY(10px) scale(0.98); filter: blur(5px); }
      70% { opacity: 1; transform: translateY(-2px) scale(1.01); filter: blur(0); }
      100% { opacity: 1; transform: none; filter: none; }
    }

    @keyframes pi-evidence-rematerialize {
      0% { opacity: 0; filter: blur(5px); }
      100% { opacity: 1; filter: none; }
    }

    @media (prefers-reduced-motion: reduce) {
      #pi-panel.pi-rematerializing,
      #pi-markers.pi-rematerializing,
      .pi-connectors.pi-rematerializing,
      .pi-notes-container.pi-rematerializing {
        animation-duration: 1ms;
        animation-delay: 0ms;
      }
    }

    /* ═══════════════════════════════════════════════════════════════════
       Note Cards
       ═══════════════════════════════════════════════════════════════════ */
    .pi-notes-container {
      position: fixed;
      top: 0; left: 0;
      width: 100%; height: 100%;
      pointer-events: none;
      z-index: ${Z_INDEX_MARKERS};
    }

    .pi-note-card {
      position: fixed;
      display: flex;
      flex-direction: column;
      width: min(280px, calc(100vw - 32px));
      max-height: calc(100vh - 32px);
      background: var(--pi-bg-card);
      border: 1px solid var(--pi-border-muted);
      border-radius: 18px;
      box-shadow: 0 12px 36px var(--pi-shadow);
      pointer-events: auto;
      font-family: var(--pi-font-ui);
      overflow: hidden;
    }

    .pi-note-card * { box-sizing: border-box; }

    .pi-note-card:hover {
      border-color: var(--pi-border-focus);
    }

    .pi-note-card.dragging {
      opacity: 0.9;
      cursor: grabbing;
    }

    .pi-note-header {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      padding: 8px 10px;
      background: var(--pi-bg-card);
      border-bottom: 1px solid var(--pi-border-muted);
      cursor: grab;
      flex-shrink: 0;
    }

    .pi-note-badge {
      background: var(--pi-fg);
      color: var(--pi-bg-card);
      width: 22px;
      height: 22px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font: bold 11px var(--pi-font-ui);
      flex-shrink: 0;
    }

    .pi-note-selector {
      display: block;
      width: 100%;
      margin-bottom: 7px;
      font: 12px var(--pi-font-mono);
      color: var(--pi-fg-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .pi-note-selector:hover {
      color: var(--pi-accent);
      text-decoration: underline;
    }

    .pi-note-screenshot,
    .pi-note-close,
    .pi-note-expand,
    .pi-note-contract {
      background: none;
      border: none;
      color: var(--pi-fg-dim);
      font-size: 14px;
      cursor: pointer;
      width: 32px;
      height: 32px;
      padding: 0;
      border-radius: var(--pi-radius);
      transition: all 0.15s;
    }

    .pi-note-expand,
    .pi-note-contract { font-size: 11px; }
    .pi-note-expand:hover,
    .pi-note-contract:hover { background: var(--pi-bg-elevated); color: var(--pi-fg-muted); }
    .pi-note-expand:disabled,
    .pi-note-contract:disabled {
      opacity: 0.32;
      cursor: not-allowed;
    }
    .pi-note-screenshot { opacity: 0.4; }
    .pi-note-screenshot:hover { background: var(--pi-bg-elevated); opacity: 0.7; }
    .pi-note-screenshot.active { opacity: 1; background: var(--pi-accent-muted); }
    .pi-note-close:hover { background: var(--pi-bg-elevated); color: var(--pi-error); }

    .pi-note-body {
      padding: 10px;
      min-height: 0;
      overflow: auto;
    }

    .pi-note-comment-row {
      display: flex;
      align-items: stretch;
      gap: 8px;
    }

    .pi-note-textarea {
      flex: 1 1 auto;
      min-width: 0;
      background: var(--pi-bg-body);
      border: 1px solid var(--pi-border-muted);
      border-radius: 6px;
      color: var(--pi-fg);
      font: 13px/1.5 var(--pi-font-ui);
      padding: 10px 12px;
      resize: none;
      min-height: 72px;
      max-height: 160px;
      transition: border-color 0.15s, box-shadow 0.15s;
    }

    .pi-note-textarea:focus {
      outline: none;
      border-color: var(--pi-accent);
      box-shadow: 0 0 0 3px var(--pi-focus-ring);
    }

    .pi-note-textarea::placeholder {
      color: var(--pi-fg-dim);
    }

    .pi-note-send {
      flex: none;
      padding: 6px 12px;
      border: 0;
      width: 34px;
      height: 34px;
      padding: 0;
      border-radius: 50%;
      background: var(--pi-fg);
      color: var(--pi-bg-card);
      cursor: pointer;
      font: 600 12px var(--pi-font-ui);
    }

    .pi-note-send:hover:not(:disabled) { background: var(--pi-accent-hover); }
    .pi-note-send:disabled { cursor: wait; opacity: 0.65; }

    /* ═══════════════════════════════════════════════════════════════════
       Bottom Panel
       ═══════════════════════════════════════════════════════════════════ */
    #pi-panel {
      position: fixed;
      bottom: 20px;
      left: 30px;
      right: 30px;
      background: var(--pi-bg-card);
      color: var(--pi-fg);
      font-family: var(--pi-font-ui);
      padding: 12px 16px;
      z-index: ${Z_INDEX_PANEL};
      box-shadow: 0 8px 32px var(--pi-shadow);
      border: 1px solid var(--pi-border-muted);
      border-radius: 14px;
    }

    #pi-panel * { box-sizing: border-box; }

    #pi-panel.pi-minimized {
      left: auto;
      right: 20px;
      bottom: 20px;
      width: 58px;
      height: 58px;
      padding: 0;
      border: 1px solid var(--pi-border-muted);
      border-radius: 50%;
      box-shadow: 0 4px 24px var(--pi-shadow);
      cursor: grab;
      user-select: none;
      touch-action: none;
    }

    #pi-panel.pi-minimized.dragging { cursor: grabbing; }
    #pi-panel.pi-minimized > :not(.pi-minimized-bubble) { display: none; }

    .pi-minimized-bubble {
      display: none;
      width: 100%;
      height: 100%;
      border-radius: 50%;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 1px;
      color: var(--pi-accent);
      font-family: var(--pi-font-ui);
    }

    #pi-panel.pi-minimized .pi-minimized-bubble { display: flex; }
    .pi-bubble-count { color: var(--pi-fg-muted); font-size: 10px; line-height: 12px; }

    .pi-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--pi-bg-elevated);
    }

    .pi-logo {
      font-size: 15px;
      font-weight: 700;
      color: var(--pi-accent);
    }
    .pi-hint { color: var(--pi-fg-dim); font-size: 11px; margin-left: auto; }

    .pi-minimize,
    .pi-close {
      background: none;
      border: none;
      color: var(--pi-fg-dim);
      cursor: pointer;
      padding: 0 4px;
      line-height: 1;
    }
    .pi-minimize { font-size: 16px; }
    .pi-close { font-size: 18px; }
    .pi-minimize:hover { color: var(--pi-accent); }
    .pi-close:hover { color: var(--pi-error); }

    .pi-toolbar {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
    }

    .pi-mode-toggle {
      display: flex;
      gap: 4px;
    }

    .pi-mode-btn {
      background: var(--pi-bg-elevated);
      border: 1px solid var(--pi-border-muted);
      border-radius: var(--pi-radius);
      padding: 5px 10px;
      font-size: 11px;
      color: var(--pi-fg-muted);
      cursor: pointer;
      transition: all 0.15s;
    }

    .pi-mode-btn:hover { background: var(--pi-bg-hover); }

    .pi-mode-btn.active {
      background: var(--pi-accent);
      border-color: var(--pi-accent);
      color: var(--pi-bg-body);
    }

    .pi-screenshot-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      background: var(--pi-bg-body);
      padding: 2px 2px 2px 8px;
      border-radius: var(--pi-radius);
    }

    .pi-toggle-label {
      font-size: 11px;
      color: var(--pi-fg-dim);
    }

    .pi-ss-btn {
      background: transparent;
      border: none;
      border-radius: 3px;
      padding: 5px 10px;
      font-size: 11px;
      color: var(--pi-fg-dim);
      cursor: pointer;
      transition: all 0.15s;
    }

    .pi-ss-btn:hover { color: var(--pi-fg-muted); }

    .pi-ss-btn.active {
      background: var(--pi-accent);
      color: var(--pi-bg-body);
    }

    .pi-spacer { flex: 1; }

    .pi-count {
      font-size: 12px;
      color: var(--pi-fg-dim);
    }

    .pi-notes-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--pi-fg-muted);
      cursor: pointer;
      user-select: none;
    }

    .pi-notes-toggle input {
      width: 14px;
      height: 14px;
      accent-color: var(--pi-accent);
      cursor: pointer;
    }

    .pi-notes-toggle:hover { color: var(--pi-fg); }

    /* ── Etch toggle: recording mode pill ── */
    .pi-etch-toggle {
      background: var(--pi-bg-elevated);
      border: 1px solid var(--pi-border-muted);
      border-radius: 16px;
      padding: 3px 10px 3px 8px;
      transition: background 0.3s, border-color 0.3s, box-shadow 0.3s, color 0.3s;
    }

    .pi-etch-toggle input { display: none; }

    .pi-etch-toggle span:first-of-type::before {
      content: "●";
      font-size: 9px;
      margin-right: 4px;
      vertical-align: 1px;
      color: var(--pi-fg-dim);
      transition: color 0.3s;
    }

    .pi-etch-toggle:hover {
      border-color: var(--pi-fg-dim);
      color: var(--pi-fg);
    }

    .pi-etch-toggle.recording {
      background: rgba(204, 102, 102, 0.15);
      border-color: var(--pi-error);
      box-shadow: 0 0 8px rgba(204, 102, 102, 0.3), inset 0 0 6px rgba(204, 102, 102, 0.06);
      color: #e0a0a0;
    }

    .pi-etch-toggle.recording:hover {
      box-shadow: 0 0 12px rgba(204, 102, 102, 0.4), inset 0 0 6px rgba(204, 102, 102, 0.08);
    }

    .pi-etch-toggle.recording span:first-of-type::before {
      color: var(--pi-error);
      animation: pi-etch-pulse 1.5s ease-in-out infinite;
    }

    @keyframes pi-etch-pulse {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 1; }
    }

    .pi-etch-badge {
      background: var(--pi-accent);
      color: var(--pi-bg-body);
      font: bold 10px var(--pi-font-ui);
      min-width: 18px;
      height: 18px;
      border-radius: 9px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0 5px;
      transition: background 0.3s;
    }

    .pi-etch-toggle.recording .pi-etch-badge { background: var(--pi-error); }

    /* Changed element indicators */
    [data-pi-changed] {
      outline: 2px dashed var(--pi-warning) !important;
      outline-offset: 2px !important;
    }

    .pi-context-row {
      margin-bottom: 8px;
    }

    .pi-context-row textarea {
      width: 100%;
      min-height: 58px;
      max-height: 160px;
      resize: vertical;
      background: var(--pi-bg-body);
      border: 1px solid var(--pi-border-muted);
      border-radius: 8px;
      color: var(--pi-fg);
      font-family: inherit;
      font-size: 13px;
      line-height: 1.45;
      padding: 9px 12px;
    }

    .pi-context-row textarea:focus {
      outline: none;
      border-color: var(--pi-accent);
      box-shadow: 0 0 0 3px var(--pi-focus-ring);
    }

    .pi-context-row textarea::placeholder { color: var(--pi-fg-dim); }

    .pi-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding-top: 8px;
      border-top: 1px solid var(--pi-bg-elevated);
    }

    .pi-delivery-error {
      min-width: 0;
      color: var(--pi-error);
      font-size: 11px;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }

    .pi-delivery-error[hidden] { display: none; }

    .pi-delivery-error.pi-warning { color: var(--pi-warning); }

    .pi-session-recovery {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 6px;
      color: var(--pi-fg-muted);
      font-size: 11px;
    }

    .pi-session-recovery label { grid-column: 1 / -1; }

    .pi-session-recovery[hidden] { display: none; }

    .pi-session-recovery select,
    .pi-session-recovery-refresh {
      border: 1px solid var(--pi-border-muted);
      border-radius: 6px;
      background: var(--pi-bg-elevated);
      color: var(--pi-fg);
      font: inherit;
      padding: 3px 6px;
    }

    .pi-session-recovery select { min-width: 0; width: 100%; }

    .pi-session-recovery-refresh { cursor: pointer; }

    .pi-buttons { display: flex; flex: none; gap: 8px; }

    .pi-btn {
      padding: 6px 14px;
      border-radius: var(--pi-radius);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      transition: all 0.15s;
    }

    .pi-btn-cancel {
      background: var(--pi-bg-elevated);
      color: var(--pi-fg-muted);
      border: 1px solid var(--pi-border-muted);
    }

    .pi-btn-cancel:hover { background: var(--pi-bg-hover); color: var(--pi-fg); }

    .pi-btn-submit {
      background: var(--pi-accent);
      color: var(--pi-bg-body);
    }

    .pi-btn-submit:hover:not(:disabled) {
      background: var(--pi-accent-hover);
    }

    .pi-btn:disabled { cursor: wait; opacity: 0.65; }

    .pi-btn-pause {
      background: var(--pi-bg-elevated);
      color: var(--pi-accent);
      border: 1px solid var(--pi-accent);
    }

    .pi-filmstrip {
      display: flex;
      align-items: stretch;
      gap: 5px;
      min-width: 0;
      overflow-x: auto;
    }

    .pi-step-filter {
      position: relative;
      display: flex;
      align-items: center;
      gap: 5px;
      flex: none;
      padding: 5px 8px;
      border: 1px solid var(--pi-border-muted);
      border-radius: var(--pi-radius);
      background: var(--pi-bg-elevated);
      color: var(--pi-fg-muted);
      cursor: pointer;
      font: 11px var(--pi-font-ui);
    }

    .pi-step-filter.active {
      border-color: var(--pi-accent);
      color: var(--pi-accent);
    }

    .pi-step-thumbnail {
      width: 34px;
      height: 22px;
      border-radius: 2px;
      object-fit: cover;
      background: var(--pi-bg-body);
    }

    .pi-step-missing {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--pi-warning);
    }

    .pi-step-hidden {
      color: var(--pi-warning);
      font-size: 12px;
    }

    .pi-capture-status {
      color: var(--pi-accent);
      font-size: 11px;
    }

    .pi-resume-bubble {
      display: none;
      width: 72px;
      height: 72px;
      border: 2px solid var(--pi-warning);
      border-radius: 50%;
      background: var(--pi-bg-card);
      color: var(--pi-warning);
      box-shadow: 0 4px 24px var(--pi-shadow);
      cursor: grab;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      font: 11px var(--pi-font-ui);
      touch-action: none;
    }

    #pi-panel.pi-interacting {
      left: auto;
      right: 20px;
      bottom: 20px;
      width: 72px;
      height: 72px;
      padding: 0;
      border: none;
      background: transparent;
      box-shadow: none;
    }

    #pi-panel.pi-interacting > :not(.pi-resume-bubble) { display: none; }
    #pi-panel.pi-interacting .pi-resume-bubble { display: flex; }
    #pi-panel.pi-busy { cursor: wait; }

    .pi-historical {
      max-width: 150px;
      color: var(--pi-warning);
      font-size: 10px;
      line-height: 1.2;
    }

    .pi-historical[hidden] { display: none; }

    .pi-modal-backdrop,
    .pi-abort-backdrop {
      position: fixed;
      inset: 0;
      z-index: ${Z_INDEX_TOOLTIP};
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: rgba(0, 0, 0, 0.55);
      font-family: var(--pi-font-ui);
    }

    .pi-modal,
    .pi-abort-dialog {
      width: min(420px, calc(100vw - 40px));
      padding: 20px;
      border: 1px solid var(--pi-border-muted);
      border-radius: 10px;
      background: var(--pi-bg-card);
      color: var(--pi-fg);
      box-shadow: 0 12px 40px var(--pi-shadow);
    }

    .pi-modal h2,
    .pi-abort-dialog h2 { margin: 0 0 8px; font-size: 17px; }
    .pi-modal p,
    .pi-abort-dialog p { margin: 0 0 18px; color: var(--pi-fg-muted); font-size: 13px; line-height: 1.5; }
    .pi-modal-actions,
    .pi-abort-actions { display: flex; justify-content: flex-end; gap: 8px; }

    /* Filmstrip + composer production layout. The controller remains rooted
       at #pi-panel so mode, capture, and delivery state stay centralized. */
    #pi-panel {
      left: 16px;
      right: 16px;
      bottom: 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
      box-shadow: none;
      pointer-events: none;
    }

    #pi-panel > * { pointer-events: auto; }

    .pi-composer {
      width: min(690px, calc(100vw - 32px));
      border: 1px solid var(--pi-border-muted);
      background: color-mix(in srgb, var(--pi-bg-card) 94%, transparent);
      color: var(--pi-fg);
      box-shadow: 0 10px 34px var(--pi-shadow);
      backdrop-filter: blur(20px);
    }

    .pi-filmstrip {
      width: 100%;
      min-width: 0;
      overflow-x: auto;
      overscroll-behavior-x: contain;
      scrollbar-width: thin;
    }

    .pi-step-filter {
      min-height: 44px;
      border-radius: 14px;
    }

    .pi-step-filter.active {
      border-color: var(--pi-border-focus);
      background: var(--pi-bg-selected);
      color: var(--pi-fg);
      box-shadow: none;
    }

    .pi-step-filter > span:not(.pi-step-thumbnail, .pi-step-hidden) {
      white-space: nowrap;
    }

    .pi-step-filter > span:last-child:not(.pi-step-hidden) {
      color: var(--pi-fg-dim);
      font-size: 10px;
    }

    .pi-icon-button,
    .pi-advanced > summary {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: 34px;
      height: 34px;
      padding: 0;
      border: 0;
      border-radius: 9px;
      background: transparent;
      color: var(--pi-fg-muted);
      cursor: pointer;
      font: 700 14px var(--pi-font-ui);
      list-style: none;
    }

    .pi-advanced > summary::-webkit-details-marker { display: none; }
    .pi-icon-button:hover,
    .pi-advanced > summary:hover { background: var(--pi-bg-hover); color: var(--pi-fg); }
    .pi-close:hover { color: var(--pi-error); }
    .pi-advanced { position: relative; flex: none; }
    .pi-advanced.pi-debug-enabled > summary {
      color: var(--pi-warning);
      box-shadow: inset 0 0 0 1px var(--pi-warning);
    }

    .pi-advanced-menu {
      position: absolute;
      right: 0;
      bottom: calc(100% + 10px);
      width: min(420px, calc(100vw - 32px));
      padding: 10px 12px;
      border: 1px solid var(--pi-border-muted);
      border-radius: 10px;
      background: var(--pi-bg-card);
      box-shadow: 0 10px 30px var(--pi-shadow);
    }

    .pi-composer {
      position: relative;
      display: flex;
      align-items: center;
      gap: 14px;
      min-height: 104px;
      padding: 11px 12px 11px 16px;
      border-radius: 22px;
    }

    .pi-composer-actions {
      display: grid;
      flex: none;
      align-self: stretch;
      align-content: center;
      gap: 7px;
    }

    .pi-utility-controls,
    .pi-primary-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 5px;
    }

    .pi-utility-controls .pi-icon-button,
    .pi-utility-controls .pi-advanced > summary {
      width: 30px;
      height: 30px;
      border-radius: 9px;
    }

    .pi-primary-actions .pi-btn {
      min-width: 88px;
      min-height: 38px;
      padding: 8px 15px;
      border: 0;
      border-radius: 11px;
      background: var(--pi-fg);
      color: var(--pi-bg-card);
      font-weight: 650;
    }

    .pi-primary-actions .pi-btn:hover:not(:disabled) {
      border: 0;
      background: var(--pi-fg-muted);
      color: var(--pi-bg-card);
    }

    .pi-advanced-steps {
      display: grid;
      gap: 7px;
      margin-bottom: 10px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--pi-border-muted);
    }

    .pi-advanced-heading {
      color: var(--pi-fg-muted);
      font: 650 11px var(--pi-font-ui);
    }

    .pi-composer textarea {
      min-width: 80px;
      flex: 1 1 auto;
      height: 62px;
      resize: none;
      padding: 11px 4px;
      border: 1px solid transparent;
      border-radius: 10px;
      background: transparent;
      color: var(--pi-fg);
      font: 14px/20px var(--pi-font-ui);
      overflow-y: auto;
      overscroll-behavior: contain;
      touch-action: pan-y;
      -webkit-overflow-scrolling: touch;
    }

    .pi-composer textarea:focus {
      outline: none;
      border-color: transparent;
      box-shadow: none;
      background: transparent;
    }

    .pi-composer-status {
      display: flex;
      flex: 0 1 180px;
      min-width: 0;
      flex-direction: column;
      justify-content: center;
    }

    .pi-composer-status:not(:has(.pi-capture-status:not(:empty), .pi-delivery-error:not([hidden]))) {
      display: none;
    }
    .pi-delivery-error { max-width: 180px; }
    .pi-composer .pi-btn-submit {
      min-width: 88px;
      min-height: 38px;
      border-radius: 11px;
      background: var(--pi-fg);
      color: var(--pi-bg-card);
      font-weight: 650;
    }
    .pi-composer .pi-btn-submit:hover:not(:disabled) { background: var(--pi-fg-muted); }
    .pi-advanced-menu .pi-etch-toggle {
      position: relative;
      justify-content: center;
      min-height: 34px;
      width: 100%;
      margin-bottom: 8px;
      border-radius: 10px;
    }

    .pi-etch-toggle input {
      display: block;
      position: absolute;
      width: 1px;
      height: 1px;
      opacity: 0;
    }

    .pi-etch-toggle:focus-within {
      outline: 3px solid var(--pi-border);
      outline-offset: 2px;
    }

    #pi-undo[hidden] { display: none; }
    #pi-panel.pi-minimized,
    #pi-panel.pi-interacting {
      display: block;
      left: auto;
      right: 20px;
      bottom: 20px;
      padding: 0;
      pointer-events: auto;
    }

    #pi-panel.pi-minimized {
      border: 0;
      background: transparent;
      box-shadow: none;
    }

    #pi-panel.pi-minimized .pi-minimized-bubble {
      border: 1px solid var(--pi-border-muted);
      background: var(--pi-bg-card);
      box-shadow: 0 4px 24px var(--pi-shadow);
    }

    .pi-help-dialog {
      box-sizing: border-box;
      max-height: calc(100vh - 40px);
      overflow: auto;
      border-radius: 16px;
    }

    .pi-help-header { display: flex; align-items: flex-start; gap: 12px; }
    .pi-help-header > div { min-width: 0; flex: 1; }
    .pi-help-header h2 { margin-top: 1px; }
    .pi-help-header p { margin-bottom: 0; }
    .pi-help-close { margin-left: auto; }
    .pi-help-steps { display: grid; gap: 8px; padding: 0; margin: 18px 0; list-style: none; }
    .pi-help-steps li {
      display: grid;
      gap: 3px;
      padding: 10px;
      border-radius: 10px;
      background: var(--pi-bg-elevated);
    }
    .pi-help-steps strong { font-size: 12px; }
    .pi-help-steps span { color: var(--pi-fg-muted); font-size: 11px; line-height: 1.45; }
    .pi-help-tip { padding-top: 12px; border-top: 1px solid var(--pi-border-muted); }
    .pi-help-tip kbd {
      padding: 2px 5px;
      border: 1px solid var(--pi-border-muted);
      border-radius: 5px;
      background: var(--pi-bg-elevated);
      font-family: var(--pi-font-mono);
    }

    @media (max-width: 640px) {
      #pi-panel { left: 8px; right: 8px; bottom: 8px; gap: 6px; }
      .pi-composer { width: calc(100vw - 16px); }
      .pi-btn-pause { padding-inline: 8px; }
      .pi-composer {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: auto auto auto auto;
        min-height: 0;
        padding: 10px;
        gap: 7px;
        border-radius: 18px;
      }
      .pi-composer textarea {
        grid-row: 2;
        width: 100%;
        min-width: 0;
        height: 66px;
        padding: 9px 7px;
        border-radius: 9px;
      }
      .pi-primary-actions .pi-btn,
      .pi-composer .pi-btn-submit { min-width: 82px; padding-inline: 12px; }
      .pi-composer-status {
        grid-row: 3;
        width: 100%;
        max-width: none;
        padding: 2px 6px 4px;
      }
      .pi-composer-status .pi-delivery-error { max-width: none; }
      .pi-composer-actions {
        display: contents;
      }
      .pi-utility-controls {
        grid-row: 1;
        width: 100%;
        justify-content: flex-end;
      }
      .pi-primary-actions {
        grid-row: 4;
        width: min(260px, 100%);
        margin-inline: auto;
        justify-content: space-around;
      }
      .pi-advanced-menu {
        position: absolute;
        left: 10px;
        right: 10px;
        bottom: calc(100% + 8px);
        width: auto;
        border-radius: 14px;
      }
      .pi-advanced { position: static; }
    }

    @media (max-width: 820px) and (orientation: portrait) {
      .pi-advanced-menu .pi-etch-toggle { justify-content: flex-start; }
    }

    #pi-panel button:focus-visible,
    #pi-panel summary:focus-visible,
    #pi-panel textarea:focus-visible,
    .pi-modal button:focus-visible,
    .pi-abort-backdrop button:focus-visible {
      outline: 3px solid var(--pi-border);
      outline-offset: 2px;
    }
  `;

  modules.styles = { STYLES };
})();
