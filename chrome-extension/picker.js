(() => {
  if (globalThis.__piAnnotatePickerInstalled) return;
  globalThis.__piAnnotatePickerInstalled = true;

  const HOST_ID = "pi-annotate-picker-host";
  let host = null;
  let shadow = null;
  let previouslyFocused = null;
  let selectedSessionId = "";
  let refreshSequence = 0;

  const MARKUP = `
    <style>
      :host {
        all: initial;
        color-scheme: dark;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      *, *::before, *::after { box-sizing: border-box; }
      button, input { font: inherit; }
      button { color: inherit; }
      .backdrop {
        position: fixed;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 16px;
        background: rgba(9, 9, 11, .58);
        backdrop-filter: blur(2px);
      }
      .dialog {
        display: flex;
        width: min(420px, calc(100vw - 32px));
        max-height: min(560px, calc(100vh - 32px));
        flex-direction: column;
        overflow: hidden;
        border: 1px solid #3f3f46;
        border-radius: 16px;
        background: #18181b;
        color: #f4f4f5;
        box-shadow: 0 24px 80px rgba(0, 0, 0, .55);
      }
      .header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 16px 16px 12px;
      }
      .brand {
        display: flex;
        min-width: 0;
        align-items: center;
        gap: 9px;
        margin-right: auto;
      }
      .logo {
        color: #a5b4fc;
        font-size: 23px;
        font-weight: 750;
        line-height: 1;
      }
      .title { font-size: 15px; font-weight: 680; }
      .icon-button {
        display: inline-flex;
        width: 34px;
        height: 34px;
        flex: none;
        align-items: center;
        justify-content: center;
        padding: 0;
        border: 1px solid transparent;
        border-radius: 9px;
        background: transparent;
        color: #a1a1aa;
        cursor: pointer;
      }
      .icon-button:hover:not(:disabled) {
        border-color: #3f3f46;
        background: #27272a;
        color: white;
      }
      .icon-button:focus-visible, .primary:focus-visible, input:focus-visible {
        outline: 2px solid #818cf8;
        outline-offset: 2px;
      }
      .icon-button:disabled { cursor: wait; opacity: .45; }
      .icon-button svg { width: 18px; height: 18px; }
      .icon-button.refreshing svg { animation: spin .8s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
      .body {
        min-height: 0;
        overflow-y: auto;
        padding: 0 16px 16px;
      }
      .status-bar {
        display: flex;
        min-height: 42px;
        align-items: flex-start;
        gap: 9px;
        margin-bottom: 15px;
        padding: 11px 12px;
        border: 1px solid #303038;
        border-radius: 10px;
        background: #202023;
      }
      .status-dot {
        width: 8px;
        height: 8px;
        flex: none;
        margin-top: 4px;
        border-radius: 50%;
        background: #71717a;
      }
      .status-dot.connected { background: #22c55e; }
      .status-dot.checking { background: #eab308; animation: pulse 1s infinite; }
      .status-dot.error { background: #ef4444; }
      @keyframes pulse { 50% { opacity: .4; } }
      .status-text {
        min-width: 0;
        color: #f4f4f5;
        font-size: 12px;
        line-height: 1.5;
        overflow-wrap: anywhere;
      }
      .section-heading {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 9px;
      }
      h2 { margin: 0; color: #f4f4f5; font-size: 12px; font-weight: 680; letter-spacing: .02em; }
      .section-hint { color: #71717a; font-size: 10px; }
      .session-list {
        display: grid;
        max-height: 270px;
        gap: 7px;
        overflow-y: auto;
        padding-right: 2px;
      }
      .session-option {
        display: flex;
        align-items: center;
        gap: 11px;
        min-height: 48px;
        padding: 10px 12px;
        border: 1px solid #323238;
        border-radius: 10px;
        background: #202023;
        cursor: pointer;
      }
      .session-option:hover { border-color: #52525b; background: #242429; }
      .session-option:has(input:checked) {
        border-color: #818cf8;
        background: rgba(99, 102, 241, .12);
        box-shadow: inset 0 0 0 1px rgba(129, 140, 248, .12);
      }
      .session-option input {
        width: 16px;
        height: 16px;
        flex: none;
        margin: 0;
        accent-color: #6366f1;
        cursor: pointer;
      }
      .session-copy { min-width: 0; flex: 1; }
      .session-label {
        display: block;
        color: #e4e4e7;
        font-size: 12px;
        font-weight: 570;
        line-height: 1.35;
        overflow-wrap: anywhere;
      }
      .recommendation {
        display: inline-block;
        margin-top: 4px;
        padding: 2px 6px;
        border-radius: 999px;
        background: rgba(129, 140, 248, .16);
        color: #c7d2fe;
        font-size: 9px;
        font-weight: 650;
      }
      .empty {
        margin: 0;
        padding: 18px 16px;
        border: 1px dashed #3f3f46;
        border-radius: 10px;
        color: #a1a1aa;
        font-size: 11px;
        line-height: 1.55;
        text-align: center;
      }
      .primary, .settings-link {
        width: 100%;
        margin-top: 15px;
        padding: 11px 14px;
        border: 1px solid #6366f1;
        border-radius: 9px;
        background: #6366f1;
        color: white;
        cursor: pointer;
        font-size: 12px;
        font-weight: 650;
      }
      .primary:hover:not(:disabled), .settings-link:hover { background: #4f46e5; }
      .primary:disabled { cursor: not-allowed; opacity: .48; }
      .settings-link {
        border-color: #3f3f46;
        background: #27272a;
        color: #e4e4e7;
      }
      .settings-link:hover { background: #323238; }
      .hidden { display: none !important; }
      @media (prefers-reduced-motion: reduce) {
        .icon-button.refreshing svg, .status-dot.checking { animation: none; }
      }
    </style>
    <div class="backdrop">
      <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="picker-title" aria-describedby="status-text">
        <header class="header">
          <div class="brand">
            <span class="logo" aria-hidden="true">π</span>
            <span class="title" id="picker-title">Pi Annotate</span>
          </div>
          <button class="icon-button" id="refresh" type="button" title="Refresh annotation sessions" aria-label="Refresh annotation sessions">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5"/></svg>
          </button>
          <button class="icon-button" id="settings" type="button" title="Connection and shortcut settings" aria-label="Connection and shortcut settings">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 9 19.37a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.63 15 1.7 1.7 0 0 0 3.08 14H3v-4h.08A1.7 1.7 0 0 0 4.63 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.63 1.7 1.7 0 0 0 10 3.08V3h4v.08A1.7 1.7 0 0 0 15 4.63a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.37 9 1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15z"/></svg>
          </button>
          <button class="icon-button" id="close" type="button" title="Close" aria-label="Close Pi Annotate">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
          </button>
        </header>
        <div class="body">
          <div class="status-bar" role="status" aria-live="polite">
            <span class="status-dot checking" id="status-dot" aria-hidden="true"></span>
            <span class="status-text" id="status-text">Loading available annotation sessions…</span>
          </div>
          <section aria-labelledby="sessions-heading">
            <div class="section-heading">
              <h2 id="sessions-heading">Send annotation to</h2>
              <span class="section-hint" id="base-origin"></span>
            </div>
            <div class="session-list" id="session-list" role="radiogroup" aria-labelledby="sessions-heading"></div>
            <p class="empty hidden" id="empty">Run /annotate in the Pi session you want to target, then refresh.</p>
            <button class="settings-link hidden" id="connect" type="button">Open connection settings</button>
          </section>
          <button class="primary" id="start" type="button" disabled>Start annotation</button>
        </div>
      </section>
    </div>
  `;

  function element(id) {
    return shadow?.getElementById(id) || null;
  }

  function errorMessage(error, fallback = "Something went wrong") {
    const value = error instanceof Error ? error.message : String(error || fallback);
    return value.replace(/[\r\n\t]+/g, " ").slice(0, 300);
  }

  function setStatus(kind, message) {
    const dot = element("status-dot");
    const text = element("status-text");
    if (!dot || !text) return;
    dot.className = `status-dot${kind ? ` ${kind}` : ""}`;
    text.textContent = message;
  }

  function setRefreshBusy(busy) {
    const button = element("refresh");
    if (!button) return;
    button.disabled = busy;
    button.classList.toggle("refreshing", busy);
  }

  function displayOrigin(origin) {
    if (!origin) return "";
    try {
      return `for ${new URL(origin).host}`;
    } catch {
      return "";
    }
  }

  async function selectSession(sessionId) {
    selectedSessionId = sessionId;
    const start = element("start");
    if (start) start.disabled = !selectedSessionId;
    try {
      const response = await chrome.runtime.sendMessage({ type: "SELECT_SESSION", sessionId });
      if (response?.error) throw new Error(response.error);
    } catch (error) {
      setStatus("error", errorMessage(error, "Could not select this session"));
    }
  }

  function renderSessions(sessions, storedSessionId = "", recommendedSessionId = "") {
    const list = element("session-list");
    const empty = element("empty");
    const start = element("start");
    if (!list || !empty || !start) return "";

    list.replaceChildren();
    const availableIds = new Set(sessions.map((session) => session.id));
    const recommended = availableIds.has(recommendedSessionId) ? recommendedSessionId : "";
    selectedSessionId = recommended || (availableIds.has(storedSessionId) ? storedSessionId : sessions[0]?.id || "");

    if (!sessions.length) {
      empty.classList.remove("hidden");
      start.disabled = true;
      return "";
    }

    empty.classList.add("hidden");
    const orderedSessions = recommended
      ? [sessions.find((session) => session.id === recommended), ...sessions.filter((session) => session.id !== recommended)]
      : sessions;

    for (const session of orderedSessions) {
      const option = document.createElement("label");
      option.className = "session-option";

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "annotation-session";
      radio.value = session.id;
      radio.checked = session.id === selectedSessionId;
      radio.addEventListener("change", () => {
        if (radio.checked) selectSession(session.id);
      });

      const copy = document.createElement("span");
      copy.className = "session-copy";
      const label = document.createElement("span");
      label.className = "session-label";
      label.textContent = session.label;
      copy.appendChild(label);

      if (session.id === recommended) {
        const badge = document.createElement("span");
        badge.className = "recommendation";
        badge.textContent = "Last used for this site";
        copy.appendChild(badge);
      }

      option.appendChild(radio);
      option.appendChild(copy);
      list.appendChild(option);
    }

    start.disabled = false;
    return selectedSessionId;
  }

  async function refreshSessions() {
    const sequence = ++refreshSequence;
    setRefreshBusy(true);
    setStatus("checking", "Loading available annotation sessions…");
    try {
      const status = await chrome.runtime.sendMessage({ type: "GET_PICKER_STATUS" });
      if (sequence !== refreshSequence || !shadow) return;
      if (status?.error) throw new Error(status.error);
      const configured = status?.configured === true;
      element("connect")?.classList.toggle("hidden", configured);
      if (!configured) {
        renderSessions([]);
        element("empty").classList.add("hidden");
        element("base-origin").textContent = "";
        setStatus("error", "Connect Pi Annotate before choosing a session.");
        return;
      }

      const response = await chrome.runtime.sendMessage({ type: "LIST_SESSIONS" });
      if (sequence !== refreshSequence || !shadow) return;
      if (response?.error) throw new Error(response.error);
      const sessions = Array.isArray(response?.sessions) ? response.sessions : [];
      const renderedSessionId = renderSessions(
        sessions,
        response?.selectedSessionId || "",
        response?.recommendedSessionId || "",
      );
      element("base-origin").textContent = displayOrigin(response?.baseOrigin || "");

      if (renderedSessionId && renderedSessionId !== response?.selectedSessionId) {
        const selectionResponse = await chrome.runtime.sendMessage({
          type: "SELECT_SESSION",
          sessionId: renderedSessionId,
        });
        if (selectionResponse?.error) throw new Error(selectionResponse.error);
      }

      if (sessions.length) {
        setStatus("connected", `${sessions.length} annotation session${sessions.length === 1 ? "" : "s"} available.`);
      } else {
        setStatus("connected", "Broker connected. No Pi sessions are available yet.");
      }
    } catch (error) {
      if (sequence !== refreshSequence || !shadow) return;
      renderSessions([]);
      element("base-origin").textContent = "";
      setStatus("error", errorMessage(error, "Could not reach the broker"));
    } finally {
      if (sequence === refreshSequence && shadow) setRefreshBusy(false);
    }
  }

  function closePicker({ notify = true } = {}) {
    if (!host) return;
    const oldHost = host;
    host = null;
    shadow = null;
    refreshSequence += 1;
    oldHost.remove();
    if (previouslyFocused?.isConnected && typeof previouslyFocused.focus === "function") {
      previouslyFocused.focus({ preventScroll: true });
    }
    previouslyFocused = null;
    if (notify) chrome.runtime.sendMessage({ type: "PICKER_CLOSED" }).catch(() => {});
  }

  async function openSettings() {
    const settings = element("settings");
    const connect = element("connect");
    if (settings) settings.disabled = true;
    if (connect) connect.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({ type: "OPEN_PICKER_SETTINGS" });
      if (response?.error) throw new Error(response.error);
      closePicker({ notify: false });
    } catch (error) {
      setStatus("error", errorMessage(error, "Could not open settings"));
      if (settings) settings.disabled = false;
      if (connect) connect.disabled = false;
    }
  }

  async function startAnnotation() {
    const start = element("start");
    if (!start || !selectedSessionId) return;
    start.disabled = true;
    start.textContent = "Starting…";
    try {
      const response = await chrome.runtime.sendMessage({
        type: "START_ANNOTATION",
        sessionId: selectedSessionId,
      });
      if (response?.error) throw new Error(response.error);
      closePicker();
    } catch (error) {
      setStatus("error", errorMessage(error, "Could not start annotation"));
      if (shadow) {
        start.disabled = false;
        start.textContent = "Start annotation";
      }
    }
  }

  function focusableElements() {
    if (!shadow) return [];
    return [...shadow.querySelectorAll("button:not(:disabled), input:not(:disabled)")]
      .filter((candidate) => candidate.getClientRects().length > 0);
  }

  function onKeyDown(event) {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      closePicker();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = focusableElements();
    if (!focusable.length) return;
    const current = focusable.indexOf(shadow.activeElement);
    const next = event.shiftKey
      ? (current <= 0 ? focusable.length - 1 : current - 1)
      : (current === focusable.length - 1 ? 0 : current + 1);
    if (current === -1 || next !== current + (event.shiftKey ? -1 : 1)) {
      event.preventDefault();
      focusable[next].focus();
    }
  }

  function bindPicker() {
    element("close").addEventListener("click", () => closePicker());
    element("refresh").addEventListener("click", refreshSessions);
    element("settings").addEventListener("click", openSettings);
    element("connect").addEventListener("click", openSettings);
    element("start").addEventListener("click", startAnnotation);
    shadow.querySelector(".backdrop").addEventListener("click", (event) => {
      if (event.target.classList.contains("backdrop")) closePicker();
    });
    shadow.addEventListener("keydown", onKeyDown);
    for (const eventName of ["click", "pointerdown", "pointerup", "mousedown", "mouseup"]) {
      shadow.addEventListener(eventName, (event) => event.stopPropagation());
    }
  }

  function openPicker() {
    if (host?.isConnected && shadow) {
      element("close")?.focus({ preventScroll: true });
      refreshSessions();
      return;
    }

    previouslyFocused = document.activeElement;
    host = document.createElement("div");
    host.id = HOST_ID;
    for (const [property, value] of Object.entries({
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      display: "block",
      width: "auto",
      height: "auto",
      margin: "0",
      padding: "0",
      border: "0",
      pointerEvents: "auto",
      isolation: "isolate",
    })) {
      host.style.setProperty(property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`), value, "important");
    }
    shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = MARKUP;
    bindPicker();
    (document.documentElement || document.body).appendChild(host);
    element("close")?.focus({ preventScroll: true });
    refreshSessions();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "OPEN_PICKER") {
      openPicker();
      sendResponse({ opened: true });
      return false;
    }
    if (message?.type === "CLOSE_PICKER") {
      closePicker({ notify: false });
      sendResponse({ closed: true });
      return false;
    }
    return false;
  });
})();
