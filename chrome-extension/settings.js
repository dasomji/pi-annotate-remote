// Pi Annotate - extension-owned connection and shortcut settings.

const endpointInput = document.getElementById("broker-endpoint");
const tokenInput = document.getElementById("broker-token");
const form = document.getElementById("broker-form");
const saveButton = document.getElementById("save-btn");
const toggleTokenButton = document.getElementById("toggle-token");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const shortcutKey = document.getElementById("shortcut-key");
const editShortcutButton = document.getElementById("edit-shortcut");

function errorMessage(error, fallback = "Something went wrong") {
  const value = error instanceof Error ? error.message : String(error || fallback);
  return value.replace(/[\r\n\t]+/g, " ").slice(0, 300);
}

function setStatus(kind, message) {
  statusDot.className = `status-dot${kind ? ` ${kind}` : ""}`;
  statusText.textContent = message;
}

function setSaveBusy(busy) {
  saveButton.disabled = busy;
  saveButton.textContent = busy ? "Connecting…" : "Save & connect";
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

async function loadShortcut() {
  try {
    const commands = await chrome.commands.getAll();
    const command = commands.find((candidate) => candidate.name === "toggle-session-chooser");
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

  setSaveBusy(true);
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

    endpointInput.value = response.endpoint;
    setStatus("connected", `Connected to ${response.endpoint}.`);
  } catch (error) {
    setStatus("error", errorMessage(error, "Could not save broker configuration"));
  } finally {
    setSaveBusy(false);
  }
});

toggleTokenButton.addEventListener("click", () => {
  const showing = tokenInput.type === "text";
  tokenInput.type = showing ? "password" : "text";
  toggleTokenButton.textContent = showing ? "Show" : "Hide";
  toggleTokenButton.setAttribute("aria-label", showing ? "Show broker token" : "Hide broker token");
});

editShortcutButton.addEventListener("click", async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: "OPEN_SHORTCUT_SETTINGS" });
    if (response?.error) throw new Error(response.error);
  } catch (error) {
    setStatus("error", errorMessage(error, "Could not open Chrome shortcut settings"));
  }
});

window.addEventListener("focus", loadShortcut);

async function initialize() {
  await loadShortcut();
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_BROKER_CONFIG" });
    if (response?.error) throw new Error(response.error);
    endpointInput.value = response?.endpoint || "";
    tokenInput.value = response?.token || "";
    if (response?.endpoint && response?.token) {
      setStatus("connected", `Connected to ${response.endpoint}.`);
    } else {
      setStatus("", "Enter the manual fallback printed by /annotate setup.");
    }
  } catch (error) {
    setStatus("error", errorMessage(error, "Could not load broker configuration"));
  }
}

initialize();
