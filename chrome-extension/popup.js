// Pi Annotate - Broker setup and annotation-session picker

const endpointInput = document.getElementById("broker-endpoint");
const tokenInput = document.getElementById("broker-token");
const form = document.getElementById("broker-form");
const saveButton = document.getElementById("save-btn");
const toggleTokenButton = document.getElementById("toggle-token");
const refreshButton = document.getElementById("refresh-btn");
const sessionSelect = document.getElementById("session-select");
const emptySessions = document.getElementById("empty-sessions");
const startButton = document.getElementById("start-btn");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");

let configured = false;

function errorMessage(error, fallback = "Something went wrong") {
  const value = error instanceof Error ? error.message : String(error || fallback);
  return value.replace(/[\r\n\t]+/g, " ").slice(0, 300);
}

function setStatus(kind, message) {
  statusDot.className = `status-dot${kind ? ` ${kind}` : ""}`;
  statusText.textContent = message;
}

function setBusy(button, busy, busyText, normalText) {
  button.disabled = busy;
  button.textContent = busy ? busyText : normalText;
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

function renderSessions(sessions, selectedSessionId = "") {
  sessionSelect.replaceChildren();

  if (!sessions.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No sessions available";
    sessionSelect.appendChild(option);
    sessionSelect.disabled = true;
    emptySessions.classList.remove("hidden");
    startButton.disabled = true;
    return "";
  }

  for (const session of sessions) {
    const option = document.createElement("option");
    option.value = session.id;
    option.textContent = session.label;
    sessionSelect.appendChild(option);
  }

  sessionSelect.disabled = false;
  emptySessions.classList.add("hidden");
  sessionSelect.value = sessions.some((session) => session.id === selectedSessionId)
    ? selectedSessionId
    : sessions[0].id;
  startButton.disabled = false;
  return sessionSelect.value;
}

async function refreshSessions() {
  if (!configured) {
    renderSessions([]);
    setStatus("", "Save a broker endpoint and token first.");
    return;
  }

  setBusy(refreshButton, true, "Refreshing…", "Refresh");
  setStatus("checking", "Checking broker and loading sessions…");
  try {
    const response = await chrome.runtime.sendMessage({ type: "LIST_SESSIONS" });
    if (response?.error) throw new Error(response.error);
    const sessions = Array.isArray(response?.sessions) ? response.sessions : [];
    const renderedSessionId = renderSessions(sessions, response?.selectedSessionId || "");
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
    renderSessions([]);
    setStatus("error", errorMessage(error, "Could not reach the broker"));
  } finally {
    setBusy(refreshButton, false, "Refreshing…", "Refresh");
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

  setBusy(saveButton, true, "Connecting…", "Save & connect");
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
    await refreshSessions();
  } catch (error) {
    setStatus("error", errorMessage(error, "Could not save broker configuration"));
  } finally {
    setBusy(saveButton, false, "Connecting…", "Save & connect");
  }
});

toggleTokenButton.addEventListener("click", () => {
  const showing = tokenInput.type === "text";
  tokenInput.type = showing ? "password" : "text";
  toggleTokenButton.textContent = showing ? "Show" : "Hide";
  toggleTokenButton.setAttribute("aria-label", showing ? "Show broker token" : "Hide broker token");
});

refreshButton.addEventListener("click", refreshSessions);

sessionSelect.addEventListener("change", async () => {
  startButton.disabled = !sessionSelect.value;
  if (!sessionSelect.value) return;
  const response = await chrome.runtime.sendMessage({
    type: "SELECT_SESSION",
    sessionId: sessionSelect.value,
  });
  if (response?.error) setStatus("error", response.error);
});

startButton.addEventListener("click", async () => {
  if (!sessionSelect.value) return;
  setBusy(startButton, true, "Starting…", "Start annotation");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "START_ANNOTATION",
      sessionId: sessionSelect.value,
    });
    if (response?.error) throw new Error(response.error);
    if (!response?.started) throw new Error("Annotation did not start");
    window.close();
  } catch (error) {
    setStatus("error", errorMessage(error, "Could not start annotation"));
    setBusy(startButton, false, "Starting…", "Start annotation");
  }
});

const isMac = navigator.platform.toUpperCase().includes("MAC");
document.getElementById("shortcut-key").textContent = isMac ? "⌘ Shift P" : "Ctrl+Shift+P";

async function initialize() {
  renderSessions([]);
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_BROKER_CONFIG" });
    if (response?.error) throw new Error(response.error);
    endpointInput.value = response?.endpoint || "";
    tokenInput.value = response?.token || "";
    configured = Boolean(response?.endpoint && response?.token);
    if (configured) await refreshSessions();
  } catch (error) {
    setStatus("error", errorMessage(error, "Could not load broker configuration"));
  }
}

initialize();
