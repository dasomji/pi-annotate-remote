/**
 * Pi Annotate - Background Service Worker
 *
 * Owns broker credentials and all broker network requests. Popup and content
 * scripts communicate with the broker only through runtime messages.
 */

const STORAGE_KEYS = ["brokerEndpoint", "brokerToken", "selectedSessionId"];
const BROKER_TIMEOUT_MS = 20_000;
const MAX_ERROR_LENGTH = 300;
const MAX_SESSION_COUNT = 1_000;

// Keep the bearer token out of content-script contexts. Popup and service
// worker pages remain trusted extension contexts and can still use local storage.
chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});

function boundedMessage(value, fallback = "Broker request failed") {
  const message = typeof value === "string" && value.trim() ? value.trim() : fallback;
  return message.replace(/[\r\n\t]+/g, " ").slice(0, MAX_ERROR_LENGTH);
}

function publicError(error) {
  if (error?.name === "AbortError") return "Broker request timed out";
  return boundedMessage(error instanceof Error ? error.message : String(error));
}

function normalizeBrokerEndpoint(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Enter a broker endpoint");
  }

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a valid broker URL");
  }

  const isLocalHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !isLocalHttp) {
    throw new Error("Broker endpoint must use HTTPS (HTTP is allowed only for localhost)");
  }
  if (url.username || url.password) {
    throw new Error("Broker endpoint must not contain credentials");
  }
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash) {
    throw new Error("Broker endpoint must be an origin without a path, query, or fragment");
  }

  return url.origin;
}

function permissionOrigin(endpoint) {
  const url = new URL(normalizeBrokerEndpoint(endpoint));
  // Chrome match patterns omit ports and therefore cover every port on one host.
  return `${url.protocol}//${url.hostname}/*`;
}

function validateToken(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Enter the broker token shown by /annotate setup");
  }
  const token = value.trim();
  if (token.length > 4_096) throw new Error("Broker token is too long");
  return token;
}

function validateSessionId(value) {
  if (typeof value !== "string" || value.length < 12 || value.length > 200) {
    throw new Error("Select a valid annotation session");
  }
  return value;
}

async function getStoredConfig({ requireComplete = false } = {}) {
  const stored = await chrome.storage.local.get(STORAGE_KEYS);
  const endpoint = stored.brokerEndpoint ? normalizeBrokerEndpoint(stored.brokerEndpoint) : "";
  const token = typeof stored.brokerToken === "string" ? stored.brokerToken : "";
  const selectedSessionId = typeof stored.selectedSessionId === "string" ? stored.selectedSessionId : "";

  if (requireComplete) {
    if (!endpoint) throw new Error("Configure a broker endpoint first");
    validateToken(token);
  }

  return { endpoint, token, selectedSessionId };
}

async function saveBrokerConfig(message) {
  const endpoint = normalizeBrokerEndpoint(message.endpoint);
  const token = validateToken(message.token);
  const previous = await getStoredConfig();
  const changed = previous.endpoint !== endpoint || previous.token !== token;

  await chrome.storage.local.set({
    brokerEndpoint: endpoint,
    brokerToken: token,
    selectedSessionId: changed ? "" : previous.selectedSessionId,
  });

  if (
    previous.endpoint &&
    previous.endpoint !== endpoint &&
    permissionOrigin(previous.endpoint) !== permissionOrigin(endpoint)
  ) {
    try {
      await chrome.permissions.remove({ origins: [permissionOrigin(previous.endpoint)] });
    } catch {
      // A stale optional permission is harmless; never fail a saved config over cleanup.
    }
  }

  return { endpoint, selectedSessionId: changed ? "" : previous.selectedSessionId };
}

async function readBrokerResponse(response) {
  const text = await response.text();
  if (!text) return null;
  if (text.length > 256 * 1024) throw new Error("Broker response was too large");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Broker returned an invalid response");
  }
}

async function brokerRequest(path, options = {}) {
  const { endpoint, token } = await getStoredConfig({ requireComplete: true });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BROKER_TIMEOUT_MS);

  try {
    const response = await fetch(`${endpoint}${path}`, {
      ...options,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
    const body = await readBrokerResponse(response);
    if (!response.ok) {
      throw new Error(boundedMessage(body?.error?.message, `Broker returned HTTP ${response.status}`));
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

function sanitizeSessions(body) {
  if (!Array.isArray(body?.sessions)) throw new Error("Broker returned an invalid session list");
  if (body.sessions.length > MAX_SESSION_COUNT) throw new Error("Broker returned too many sessions");

  return body.sessions.map((session) => {
    const id = validateSessionId(session?.id);
    if (typeof session?.label !== "string" || !session.label.trim() || session.label.length > 200) {
      throw new Error("Broker returned an invalid session label");
    }
    return { id, label: session.label.trim() };
  });
}

async function listSessions() {
  const body = await brokerRequest("/v1/sessions");
  const sessions = sanitizeSessions(body);
  const config = await getStoredConfig();
  const selectedSessionId = sessions.some((session) => session.id === config.selectedSessionId)
    ? config.selectedSessionId
    : "";

  if (selectedSessionId !== config.selectedSessionId) {
    await chrome.storage.local.set({ selectedSessionId });
  }

  return { sessions, selectedSessionId };
}

function isRestrictedUrl(url) {
  if (!url) return true;
  return /^(chrome|chrome-extension|edge|about|devtools|view-source):/i.test(url);
}

async function sendToContentScript(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    await chrome.tabs.sendMessage(tabId, message);
  }
}

async function startAnnotation(requestedSessionId) {
  const config = await getStoredConfig({ requireComplete: true });
  const sessionId = validateSessionId(requestedSessionId || config.selectedSessionId);
  await chrome.storage.local.set({ selectedSessionId: sessionId });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || isRestrictedUrl(tab.url)) {
    throw new Error("Open a regular web page before starting annotation");
  }

  await sendToContentScript(tab.id, { type: "START_ANNOTATION", sessionId });
  return { started: true };
}

async function deliverAnnotations(message) {
  const sessionId = validateSessionId(message.sessionId);
  if (!message.result || typeof message.result !== "object" || message.result.success !== true) {
    throw new Error("Annotation result is invalid");
  }

  await brokerRequest(`/v1/sessions/${encodeURIComponent(sessionId)}/annotations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message.result),
  });

  return { delivered: true };
}

function captureScreenshot(sender) {
  return new Promise((resolve, reject) => {
    if (!sender.tab?.windowId) {
      reject(new Error("Cannot capture this browser window"));
      return;
    }
    chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!dataUrl) {
        reject(new Error("Screenshot capture returned no image"));
      } else {
        resolve({ dataUrl });
      }
    });
  });
}

function runMessageTask(task, sendResponse) {
  Promise.resolve()
    .then(task)
    .then(sendResponse)
    .catch((error) => sendResponse({ error: publicError(error) }));
  return true;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message?.type) {
    case "GET_BROKER_CONFIG":
      return runMessageTask(async () => {
        const config = await getStoredConfig();
        return {
          endpoint: config.endpoint,
          token: config.token,
          selectedSessionId: config.selectedSessionId,
        };
      }, sendResponse);

    case "SAVE_BROKER_CONFIG":
      return runMessageTask(() => saveBrokerConfig(message), sendResponse);

    case "LIST_SESSIONS":
      return runMessageTask(listSessions, sendResponse);

    case "SELECT_SESSION":
      return runMessageTask(async () => {
        const sessionId = validateSessionId(message.sessionId);
        await chrome.storage.local.set({ selectedSessionId: sessionId });
        return { selectedSessionId: sessionId };
      }, sendResponse);

    case "START_ANNOTATION":
      return runMessageTask(() => startAnnotation(message.sessionId), sendResponse);

    case "CAPTURE_SCREENSHOT":
      return runMessageTask(() => captureScreenshot(sender), sendResponse);

    case "ANNOTATIONS_COMPLETE":
      return runMessageTask(() => deliverAnnotations(message), sendResponse);

    case "CANCEL":
      sendResponse({ cancelled: true });
      return false;

    default:
      return false;
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-picker") return;
  startAnnotation().catch(() => {
    // The popup provides actionable setup/session errors; keep shortcut failures quiet.
  });
});
