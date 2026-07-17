// Pi Annotate - Centered session picker and settings

const endpointInput = document.getElementById("broker-endpoint");
const tokenInput = document.getElementById("broker-token");
const form = document.getElementById("broker-form");
const saveButton = document.getElementById("save-btn");
const toggleTokenButton = document.getElementById("toggle-token");
const refreshButton = document.getElementById("refresh-btn");
const settingsButton = document.getElementById("settings-btn");
const settingsPanel = document.getElementById("settings-panel");
const sessionList = document.getElementById("session-list");
const emptySessions = document.getElementById("empty-sessions");
const startButton = document.getElementById("start-btn");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const baseOriginText = document.getElementById("base-origin");
const shortcutKey = document.getElementById("shortcut-key");
const editShortcutButton = document.getElementById("edit-shortcut");

let configured = false;
let selectedSessionId = "";
let settingsOpen = false;
let refreshSequence = 0;

function errorMessage(error, fallback = "Something went wrong") {
  const value = error instanceof Error ? error.message : String(error || fallback);
  return value.replace(/[\r\n\t]+/g, " ").slice(0, 300);
}

function setStatus(kind, message) {
  statusDot.className = `status-dot${kind ? ` ${kind}` : ""}`;
  statusText.textContent = message;
}

function setButtonBusy(button, busy, busyText, normalText) {
  button.disabled = busy;
  button.textContent = busy ? busyText : normalText;
}

function setRefreshBusy(busy) {
  refreshButton.disabled = busy;
  refreshButton.classList.toggle("refreshing", busy);
}

function setSettingsOpen(open) {
  settingsOpen = Boolean(open);
  settingsPanel.classList.toggle("hidden", !settingsOpen);
  settingsButton.setAttribute("aria-expanded", String(settingsOpen));
}

function parseBrokerInput() {
  let url;
  try {
    url = new URL(endpointInput.value.trim());
  } catch {
    throw new Error("Enter a valid broker URL");
  }

  const isLocalHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !isLocalHttp) {
    throw new Error("Use HTTPS, or HTTP on localhost for development");
  }
  if (url.username || url.password || (url.pathname && url.pathname !== "/") || url.search || url.hash) {
    throw new Error("Enter only the broker origin, without credentials, a path, query, or fragment");
  }

  const token = tokenInput.value.trim();
  if (!token) throw new Error("Enter the token shown by /annotate setup");
  if (token.length > 4_096) throw new Error("Broker token is too long");

  return {
    endpoint: url.origin,
    // Chrome match patterns omit ports and match every port on one host.
    permissionOrigin: `${url.protocol}//${url.hostname}/*`,
    token,
  };
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
  startButton.disabled = !selectedSessionId;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "SELECT_SESSION",
      sessionId,
    });
    if (response?.error) throw new Error(response.error);
  } catch (error) {
    setStatus("error", errorMessage(error, "Could not select this session"));
  }
}

function renderSessions(sessions, storedSessionId = "", recommendedSessionId = "") {
  sessionList.replaceChildren();
  const availableIds = new Set(sessions.map((session) => session.id));
  const recommended = availableIds.has(recommendedSessionId) ? recommendedSessionId : "";
  selectedSessionId = recommended || (availableIds.has(storedSessionId) ? storedSessionId : sessions[0]?.id || "");

  if (!sessions.length) {
    emptySessions.classList.remove("hidden");
    startButton.disabled = true;
    return "";
  }

  emptySessions.classList.add("hidden");
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
    sessionList.appendChild(option);
  }

  startButton.disabled = false;
  return selectedSessionId;
}

async function refreshSessions() {
  const sequence = ++refreshSequence;
  if (!configured) {
    renderSessions([]);
    baseOriginText.textContent = "";
    setStatus("", "Connect to a broker in settings to begin.");
    return;
  }

  setRefreshBusy(true);
  setStatus("checking", "Loading available annotation sessions…");
  try {
    const response = await chrome.runtime.sendMessage({ type: "LIST_SESSIONS" });
    if (sequence !== refreshSequence) return;
    if (response?.error) throw new Error(response.error);
    const sessions = Array.isArray(response?.sessions) ? response.sessions : [];
    const renderedSessionId = renderSessions(
      sessions,
      response?.selectedSessionId || "",
      response?.recommendedSessionId || "",
    );
    baseOriginText.textContent = displayOrigin(response?.baseOrigin || "");

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
    if (sequence !== refreshSequence) return;
    renderSessions([]);
    baseOriginText.textContent = "";
    setStatus("error", errorMessage(error, "Could not reach the broker"));
  } finally {
    if (sequence === refreshSequence) setRefreshBusy(false);
  }
}

async function loadShortcut() {
  try {
    const commands = await chrome.commands.getAll();
    const command = commands.find((candidate) => candidate.name === "toggle-picker");
    const shortcut = command?.shortcut || "Not set";
    shortcutKey.textContent = shortcut;
    shortcutKey.classList.toggle("unassigned", !command?.shortcut);
  } catch {
    shortcutKey.textContent = "Open Chrome shortcut settings";
    shortcutKey.classList.add("unassigned");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  let input;
  try {
    input = parseBrokerInput();
  } catch (error) {
    setStatus("error", errorMessage(error));
    return;
  }

  setButtonBusy(saveButton, true, "Connecting…", "Save & connect");
  setStatus("checking", "Requesting access to this broker…");
  try {
    const granted = await chrome.permissions.request({ origins: [input.permissionOrigin] });
    if (!granted) throw new Error("Broker access was not granted");

    const response = await chrome.runtime.sendMessage({
      type: "SAVE_BROKER_CONFIG",
      endpoint: input.endpoint,
      token: input.token,
    });
    if (response?.error) throw new Error(response.error);

    configured = true;
    endpointInput.value = response.endpoint;
    setSettingsOpen(false);
    await refreshSessions();
  } catch (error) {
    setStatus("error", errorMessage(error, "Could not save broker configuration"));
  } finally {
    setButtonBusy(saveButton, false, "Connecting…", "Save & connect");
  }
});

toggleTokenButton.addEventListener("click", () => {
  const showing = tokenInput.type === "text";
  tokenInput.type = showing ? "password" : "text";
  toggleTokenButton.textContent = showing ? "Show" : "Hide";
  toggleTokenButton.setAttribute("aria-label", showing ? "Show broker token" : "Hide broker token");
});

settingsButton.addEventListener("click", () => setSettingsOpen(!settingsOpen));
refreshButton.addEventListener("click", refreshSessions);

editShortcutButton.addEventListener("click", async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: "OPEN_SHORTCUT_SETTINGS" });
    if (response?.error) throw new Error(response.error);
  } catch (error) {
    setStatus("error", errorMessage(error, "Could not open Chrome shortcut settings"));
  }
});

startButton.addEventListener("click", async () => {
  if (!selectedSessionId) return;
  setButtonBusy(startButton, true, "Starting…", "Start annotation");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "START_ANNOTATION",
      sessionId: selectedSessionId,
    });
    if (response?.error) throw new Error(response.error);
    if (!response?.started) throw new Error("Annotation did not start");
    window.close();
  } catch (error) {
    setStatus("error", errorMessage(error, "Could not start annotation"));
    setButtonBusy(startButton, false, "Starting…", "Start annotation");
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "PICKER_CONTEXT_UPDATED") {
    refreshSessions();
  }
  return false;
});

window.addEventListener("focus", loadShortcut);

async function initialize() {
  renderSessions([]);
  await loadShortcut();
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_BROKER_CONFIG" });
    if (response?.error) throw new Error(response.error);
    endpointInput.value = response?.endpoint || "";
    tokenInput.value = response?.token || "";
    configured = Boolean(response?.endpoint && response?.token);
    setSettingsOpen(!configured);
    if (configured) {
      await refreshSessions();
    } else {
      setStatus("", "Connect to a broker in settings to begin.");
    }
  } catch (error) {
    setSettingsOpen(true);
    setStatus("error", errorMessage(error, "Could not load broker configuration"));
  }
}

initialize();
