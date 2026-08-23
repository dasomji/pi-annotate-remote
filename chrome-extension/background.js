/**
 * Pi Annotate - Background Service Worker
 *
 * Owns the in-page Session chooser, extension settings, broker credentials,
 * recommendations, and network requests. Chooser and content scripts use runtime messages.
 */

const STORAGE_KEYS = ["brokerEndpoint", "brokerToken", "selectedSessionId"];
const RECOMMENDATIONS_KEY = "sessionRecommendationsByOrigin";
const CHOOSER_STATE_KEY = "sessionChooserState";
const BROKER_TIMEOUT_MS = 20_000;
const MAX_ERROR_LENGTH = 300;
const MAX_SESSION_COUNT = 1_000;
const MAX_RECOMMENDATIONS = 100;
const PAIRING_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SCREENSHOT_RATE_WINDOW_MS = 1_050;
const SCREENSHOTS_PER_RATE_WINDOW = 2;
// Injection order matters: the annotator entry point (content.js) expects the
// module files before it to have registered themselves already.
const ANNOTATOR_SCRIPT_FILES = [
  "content-styles.js",
  "content-inspect.js",
  "content-capture.js",
  "content-draft.js",
  "content-etch.js",
  "content-route-guard.js",
  "content-navigation.js",
  "content-run.js",
  "content-dialogs.js",
  "content.js",
];
let chooserStateFallback = {};
let screenshotCaptureQueue = Promise.resolve();
let screenshotCaptureTimes = [];

// Keep the bearer token and chooser state out of content-script contexts. Settings,
// pairing, and service-worker pages remain trusted extension contexts.
chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});
chrome.storage.session?.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});

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

function pageOrigin(value) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.origin;
  } catch {
    return "";
  }
}

async function getChooserState() {
  if (!chrome.storage.session) return { ...chooserStateFallback };
  const stored = await chrome.storage.session.get([CHOOSER_STATE_KEY]);
  const state = stored[CHOOSER_STATE_KEY];
  return state && typeof state === "object" && !Array.isArray(state) ? state : {};
}

async function updateChooserState(values) {
  const state = { ...(await getChooserState()), ...values };
  chooserStateFallback = state;
  if (chrome.storage.session) {
    await chrome.storage.session.set({ [CHOOSER_STATE_KEY]: state });
  }
  return state;
}

function sanitizeRecommendations(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = [];
  for (const [origin, recommendation] of Object.entries(value)) {
    if (pageOrigin(origin) !== origin || !recommendation || typeof recommendation !== "object") continue;
    try {
      const sessionId = validateSessionId(recommendation.sessionId);
      const updatedAt = Number.isFinite(recommendation.updatedAt) ? recommendation.updatedAt : 0;
      entries.push([origin, { sessionId, updatedAt }]);
    } catch {
      // Ignore stale or malformed browser storage.
    }
  }
  return Object.fromEntries(entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, MAX_RECOMMENDATIONS));
}

async function recommendedSessionForOrigin(origin, sessions) {
  if (!origin) return "";
  const stored = await chrome.storage.local.get([RECOMMENDATIONS_KEY]);
  const recommendation = sanitizeRecommendations(stored[RECOMMENDATIONS_KEY])[origin];
  return recommendation && sessions.some((session) => session.id === recommendation.sessionId)
    ? recommendation.sessionId
    : "";
}

async function rememberSessionForOrigin(origin, sessionId) {
  if (!origin) return;
  validateSessionId(sessionId);
  const stored = await chrome.storage.local.get([RECOMMENDATIONS_KEY]);
  const recommendations = sanitizeRecommendations(stored[RECOMMENDATIONS_KEY]);
  recommendations[origin] = { sessionId, updatedAt: Date.now() };
  const bounded = Object.fromEntries(
    Object.entries(recommendations)
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(0, MAX_RECOMMENDATIONS),
  );
  await chrome.storage.local.set({ [RECOMMENDATIONS_KEY]: bounded });
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

function validatePairingCode(value) {
  if (typeof value !== "string" || !PAIRING_CODE_PATTERN.test(value)) {
    throw new Error("Pairing code is invalid or expired");
  }
  return value;
}

function pairingEndpointFromSender(sender) {
  let url;
  try {
    url = new URL(sender?.url || "");
  } catch {
    throw new Error("Pairing request did not come from a trusted broker pairing page");
  }

  const isTailnetHttps = url.protocol === "https:" && url.hostname.endsWith(".ts.net");
  const isLocalHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (
    (!isTailnetHttps && !isLocalHttp) ||
    url.pathname !== "/pair" ||
    url.username ||
    url.password ||
    url.search
  ) {
    throw new Error("Pairing request did not come from a trusted broker pairing page");
  }
  return url.origin;
}

function trustedExtensionPageUrl(sender) {
  if (sender?.id !== chrome.runtime.id || typeof sender?.url !== "string") return null;
  try {
    const url = new URL(sender.url);
    return url.protocol === "chrome-extension:" && url.host === chrome.runtime.id ? url : null;
  } catch {
    return null;
  }
}

function isTrustedPairingConfirmation(sender) {
  return trustedExtensionPageUrl(sender)?.pathname === "/pair.html";
}

async function openPairingConfirmation(message, sender) {
  const endpoint = pairingEndpointFromSender(sender);
  const code = validatePairingCode(message.code);
  const confirmationUrl = chrome.runtime.getURL("pair.html") +
    `#endpoint=${encodeURIComponent(endpoint)}&code=${encodeURIComponent(code)}`;
  await chrome.tabs.create({ url: confirmationUrl });
  return { accepted: true };
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

async function exchangePairingCode(endpointValue, codeValue) {
  const endpoint = normalizeBrokerEndpoint(endpointValue);
  const code = validatePairingCode(codeValue);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BROKER_TIMEOUT_MS);

  try {
    const response = await fetch(`${endpoint}/v1/pairings/exchange`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code }),
      signal: controller.signal,
    });
    const body = await readBrokerResponse(response);
    if (!response.ok) {
      throw new Error(boundedMessage(body?.error?.message, `Broker returned HTTP ${response.status}`));
    }
    const token = validateToken(body?.token);
    await saveBrokerConfig({ endpoint, token });
    return { connected: true, endpoint };
  } finally {
    clearTimeout(timeout);
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
  const chooserState = await getChooserState();
  const baseOrigin = pageOrigin(chooserState.baseOrigin);
  const selectedSessionId = sessions.some((session) => session.id === config.selectedSessionId)
    ? config.selectedSessionId
    : "";
  const recommendedSessionId = await recommendedSessionForOrigin(baseOrigin, sessions);

  if (selectedSessionId !== config.selectedSessionId) {
    await chrome.storage.local.set({ selectedSessionId });
  }

  return { sessions, selectedSessionId, recommendedSessionId, baseOrigin };
}

function isRestrictedUrl(url) {
  if (!url) return true;
  return /^(chrome|chrome-extension|edge|about|devtools|view-source):/i.test(url);
}

async function getLastFocusedNormalWindow() {
  try {
    return await chrome.windows.getLastFocused({ populate: true, windowTypes: ["normal"] });
  } catch {
    return null;
  }
}

function activeTabInWindow(window) {
  return Array.isArray(window?.tabs) ? window.tabs.find((tab) => tab.active) || null : null;
}

async function queryActiveTab(windowId) {
  const query = Number.isInteger(windowId)
    ? { active: true, windowId }
    : { active: true, lastFocusedWindow: true };
  const [tab] = await chrome.tabs.query(query);
  return tab || null;
}

async function resolveTargetTab(tabHint) {
  if (tabHint?.id && !isRestrictedUrl(tabHint.url)) return tabHint;

  const chooserState = await getChooserState();
  if (Number.isInteger(chooserState.targetTabId)) {
    try {
      const tab = await chrome.tabs.get(chooserState.targetTabId);
      if (tab?.id && !isRestrictedUrl(tab.url)) return tab;
    } catch {
      // The remembered target tab was closed; fall back to the active normal window.
    }
  }

  const normalWindow = await getLastFocusedNormalWindow();
  const tab = activeTabInWindow(normalWindow) || await queryActiveTab(normalWindow?.id);
  if (!tab?.id || isRestrictedUrl(tab.url)) {
    throw new Error("Open a regular web page before starting annotation");
  }
  return tab;
}

async function chooserTarget(tabHint) {
  const normalWindow = await getLastFocusedNormalWindow();
  let targetTab = tabHint?.id ? tabHint : activeTabInWindow(normalWindow);
  if (!targetTab && normalWindow?.id) targetTab = await queryActiveTab(normalWindow.id);
  return { normalWindow, targetTab };
}

async function rememberChooserTarget(targetTab, normalWindow) {
  return updateChooserState({
    targetTabId: targetTab.id,
    targetWindowId: targetTab.windowId || normalWindow?.id || null,
    baseOrigin: pageOrigin(targetTab.url),
    modalTabId: targetTab.id,
  });
}

async function sendWithAckOrInject(tabId, message, { files, ackKey, errorMessage }) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, message);
    if (response?.[ackKey] === true) return;
  } catch {
    // No script in this document has acknowledged the message yet.
  }

  await chrome.scripting.executeScript({ target: { tabId }, files });
  let response;
  try {
    response = await chrome.tabs.sendMessage(tabId, message);
  } catch {
    throw new Error(errorMessage);
  }
  if (response?.[ackKey] !== true) throw new Error(errorMessage);
}

function showChooserInTab(tabId) {
  return sendWithAckOrInject(tabId, { type: "OPEN_SESSION_CHOOSER" }, {
    files: ["session-chooser.js"],
    ackKey: "opened",
    errorMessage: "Pi Annotate could not open the in-page Session chooser",
  });
}

async function closePreviousChooserModal(state, nextTabId) {
  if (!Number.isInteger(state?.modalTabId) || state.modalTabId === nextTabId) return;
  try {
    await chrome.tabs.sendMessage(state.modalTabId, { type: "CLOSE_SESSION_CHOOSER" });
  } catch {
    // The previous page was closed or navigated.
  }
}

async function openChooser(tabHint) {
  const { normalWindow, targetTab } = await chooserTarget(tabHint);
  if (!targetTab?.id || isRestrictedUrl(targetTab.url)) {
    throw new Error("Open a regular web page before opening Pi Annotate");
  }

  const previousState = await getChooserState();
  await closePreviousChooserModal(previousState, targetTab.id);
  await rememberChooserTarget(targetTab, normalWindow);
  try {
    await showChooserInTab(targetTab.id);
  } catch (error) {
    await updateChooserState({ modalTabId: null });
    throw error;
  }
  return { tabId: targetTab.id, surface: "modal" };
}

async function openSettings(tabHint) {
  const normalWindow = await getLastFocusedNormalWindow();
  const windowId = tabHint?.windowId || normalWindow?.id;
  const created = await chrome.tabs.create({
    ...(Number.isInteger(windowId) ? { windowId } : {}),
    url: chrome.runtime.getURL("settings.html"),
    active: true,
  });
  return { opened: true, tabId: created?.id };
}

async function openShortcutSettings() {
  const normalWindow = await getLastFocusedNormalWindow();
  const created = await chrome.tabs.create({
    ...(Number.isInteger(normalWindow?.id) ? { windowId: normalWindow.id } : {}),
    url: "chrome://extensions/shortcuts",
    active: true,
  });
  if (Number.isInteger(normalWindow?.id)) {
    await chrome.windows.update(normalWindow.id, { focused: true });
  }
  return { opened: true, tabId: created?.id };
}

function startAnnotatorInTab(tabId, sessionId) {
  return sendWithAckOrInject(tabId, { type: "START_ANNOTATION", sessionId }, {
    files: ANNOTATOR_SCRIPT_FILES,
    ackKey: "started",
    errorMessage: "Pi Annotate could not start on this page",
  });
}

async function startAnnotation(requestedSessionId) {
  const config = await getStoredConfig({ requireComplete: true });
  const sessionId = validateSessionId(requestedSessionId || config.selectedSessionId);
  const tab = await resolveTargetTab();
  const baseOrigin = pageOrigin(tab.url);

  await startAnnotatorInTab(tab.id, sessionId);
  await chrome.storage.local.set({ selectedSessionId: sessionId });
  await rememberSessionForOrigin(baseOrigin, sessionId);
  return { started: true, baseOrigin };
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

async function captureScreenshotNow(sender) {
  const now = Date.now();
  screenshotCaptureTimes = screenshotCaptureTimes.filter(
    (capturedAt) => now - capturedAt < SCREENSHOT_RATE_WINDOW_MS,
  );
  if (screenshotCaptureTimes.length >= SCREENSHOTS_PER_RATE_WINDOW) {
    const waitMs = SCREENSHOT_RATE_WINDOW_MS - (now - screenshotCaptureTimes[0]);
    await new Promise((resolve) => setTimeout(resolve, Math.max(1, waitMs)));
    const resumedAt = Date.now();
    screenshotCaptureTimes = screenshotCaptureTimes.filter(
      (capturedAt) => resumedAt - capturedAt < SCREENSHOT_RATE_WINDOW_MS,
    );
  }
  screenshotCaptureTimes.push(Date.now());

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

function captureScreenshot(sender) {
  const scheduled = screenshotCaptureQueue.then(() => captureScreenshotNow(sender));
  screenshotCaptureQueue = scheduled.catch(() => {});
  return scheduled;
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
        // The bearer token stays out of content-script contexts; only trusted
        // extension pages such as settings and pairing may read stored config.
        if (!trustedExtensionPageUrl(sender)) {
          throw new Error("Broker configuration is only available to extension pages");
        }
        const config = await getStoredConfig();
        return {
          endpoint: config.endpoint,
          token: config.token,
          selectedSessionId: config.selectedSessionId,
        };
      }, sendResponse);

    case "GET_SESSION_CHOOSER_STATUS":
      return runMessageTask(async () => {
        const config = await getStoredConfig();
        return { configured: Boolean(config.endpoint && config.token) };
      }, sendResponse);

    case "SAVE_BROKER_CONFIG":
      return runMessageTask(() => saveBrokerConfig(message), sendResponse);

    case "OPEN_SHORTCUT_SETTINGS":
      return runMessageTask(openShortcutSettings, sendResponse);

    case "OPEN_SETTINGS":
      return runMessageTask(() => openSettings(sender.tab), sendResponse);

    case "SESSION_CHOOSER_CLOSED":
      return runMessageTask(async () => {
        const state = await getChooserState();
        if (sender.tab?.id === state.modalTabId) {
          await updateChooserState({ modalTabId: null });
        }
        return { closed: true };
      }, sendResponse);

    case "COMPLETE_PAIRING":
      return runMessageTask(() => {
        if (!isTrustedPairingConfirmation(sender)) {
          throw new Error("Pairing must be completed from the trusted pairing page");
        }
        return exchangePairingCode(message.endpoint, message.code);
      }, sendResponse);

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

    default:
      return false;
  }
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message?.type !== "PI_ANNOTATE_PAIR") return false;
  return runMessageTask(() => openPairingConfirmation(message, sender), sendResponse);
});

chrome.action.onClicked.addListener((tab) => {
  return openChooser(tab).catch(() => {
    // Chrome owns action errors; the next click retries from a fresh target tab.
  });
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-session-chooser") return undefined;
  return openChooser().catch(() => {
    // Keep command failures quiet; the toolbar action remains available.
  });
});
