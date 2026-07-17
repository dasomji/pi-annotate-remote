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
      --pi-bg-body: #18181e;
      --pi-bg-card: #1e1e24;
      --pi-bg-elevated: #252530;
      --pi-bg-selected: #3a3a4a;
      --pi-bg-hover: #2b2b37;
      --pi-fg: #e0e0e0;
      --pi-fg-muted: #808080;
      --pi-fg-dim: #666666;
      --pi-accent: #8abeb7;
      --pi-accent-hover: #9dcec7;
      --pi-accent-muted: rgba(138, 190, 183, 0.15);
      --pi-border: #5f87ff;
      --pi-border-muted: #505050;
      --pi-border-focus: #7a7a8a;
      --pi-success: #b5bd68;
      --pi-warning: #f0c674;
      --pi-error: #cc6666;
      --pi-focus-ring: rgba(95, 135, 255, 0.2);
      --pi-shadow: rgba(0, 0, 0, 0.5);
      --pi-font-mono: ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, monospace;
      --pi-font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      --pi-radius: 4px;
    }

    /* Light theme */
    @media (prefers-color-scheme: light) {
      :root {
        --pi-bg-body: #f8f8f8;
        --pi-bg-card: #ffffff;
        --pi-bg-elevated: #f0f0f0;
        --pi-bg-selected: #d0d0e0;
        --pi-bg-hover: #e8e8e8;
        --pi-fg: #1a1a1a;
        --pi-fg-muted: #6c6c6c;
        --pi-fg-dim: #8a8a8a;
        --pi-accent: #5f8787;
        --pi-accent-hover: #4a7272;
        --pi-accent-muted: rgba(95, 135, 135, 0.15);
        --pi-border: #5f87af;
        --pi-border-muted: #b0b0b0;
        --pi-border-focus: #8a8a9a;
        --pi-success: #87af87;
        --pi-warning: #d7af5f;
        --pi-error: #af5f5f;
        --pi-focus-ring: rgba(95, 135, 175, 0.2);
        --pi-shadow: rgba(0, 0, 0, 0.15);
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
      pointer-events: none;
      border: 2px solid var(--pi-accent);
      border-radius: var(--pi-radius);
      background: var(--pi-accent-muted);
    }

    .pi-marker-badge {
      position: fixed;
      pointer-events: auto;
      background: var(--pi-accent);
      color: var(--pi-bg-body);
      width: 28px;
      height: 28px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font: bold 13px var(--pi-font-ui);
      cursor: pointer;
      box-shadow: 0 2px 8px var(--pi-shadow);
      transition: transform 0.15s, box-shadow 0.15s;
    }

    .pi-marker-badge:hover {
      transform: scale(1.1);
      background: var(--pi-accent-hover);
    }

    .pi-marker-badge.open {
      background: var(--pi-success);
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
      width: 280px;
      background: var(--pi-bg-card);
      border: 1px solid var(--pi-border-muted);
      border-radius: 8px;
      box-shadow: 0 4px 24px var(--pi-shadow);
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
      gap: 8px;
      padding: 8px 10px;
      background: var(--pi-bg-elevated);
      border-bottom: 1px solid var(--pi-border-muted);
      cursor: grab;
    }

    .pi-note-badge {
      background: var(--pi-accent);
      color: var(--pi-bg-body);
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
      flex: 1;
      font: 12px var(--pi-font-mono);
      color: var(--pi-fg-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: pointer;
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
      padding: 2px 4px;
      border-radius: var(--pi-radius);
      transition: all 0.15s;
    }

    .pi-note-expand,
    .pi-note-contract { font-size: 11px; }
    .pi-note-expand:hover,
    .pi-note-contract:hover { background: var(--pi-bg-elevated); color: var(--pi-fg-muted); }
    .pi-note-screenshot { opacity: 0.4; }
    .pi-note-screenshot:hover { background: var(--pi-bg-elevated); opacity: 0.7; }
    .pi-note-screenshot.active { opacity: 1; background: var(--pi-accent-muted); }
    .pi-note-close:hover { background: var(--pi-bg-elevated); color: var(--pi-error); }

    .pi-note-body {
      padding: 10px;
    }

    .pi-note-textarea {
      width: 100%;
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
    .pi-bubble-logo { font-size: 20px; font-weight: 700; line-height: 20px; }
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

    .pi-abort-dialog {
      width: min(420px, calc(100vw - 40px));
      padding: 20px;
      border: 1px solid var(--pi-border-muted);
      border-radius: 10px;
      background: var(--pi-bg-card);
      color: var(--pi-fg);
      box-shadow: 0 12px 40px var(--pi-shadow);
    }

    .pi-abort-dialog h2 { margin: 0 0 8px; font-size: 17px; }
    .pi-abort-dialog p { margin: 0 0 18px; color: var(--pi-fg-muted); font-size: 13px; line-height: 1.5; }
    .pi-abort-actions { display: flex; justify-content: flex-end; gap: 8px; }
  `;

  modules.styles = { STYLES };
})();
