/**
 * Pi Annotate - Background Service Worker
 *
 * Owns the in-page session picker, compact fallback window, broker credentials,
 * recommendations, and network requests. Picker and content scripts use runtime messages.
 */

const STORAGE_KEYS = ["brokerEndpoint", "brokerToken", "selectedSessionId"];
const RECOMMENDATIONS_KEY = "sessionRecommendationsByOrigin";
const PICKER_STATE_KEY = "pickerState";
const BROKER_TIMEOUT_MS = 20_000;
const MAX_ERROR_LENGTH = 300;
const MAX_SESSION_COUNT = 1_000;
const MAX_RECOMMENDATIONS = 100;
const PICKER_WIDTH = 420;
const PICKER_HEIGHT = 560;
const PAIRING_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
// Injection order matters: the annotator entry point (content.js) expects the
// module files before it to have registered themselves already.
const ANNOTATOR_SCRIPT_FILES = [
  "content-styles.js",
  "content-inspect.js",
  "content-capture.js",
  "content-etch.js",
  "content.js",
];
let pickerStateFallback = {};

// Keep the bearer token and picker state out of content-script contexts. Picker,
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

async function getPickerState() {
  if (!chrome.storage.session) return { ...pickerStateFallback };
  const stored = await chrome.storage.session.get([PICKER_STATE_KEY]);
  const state = stored[PICKER_STATE_KEY];
  return state && typeof state === "object" && !Array.isArray(state) ? state : {};
}

async function updatePickerState(values) {
  const state = { ...(await getPickerState()), ...values };
  pickerStateFallback = state;
  if (chrome.storage.session) {
    await chrome.storage.session.set({ [PICKER_STATE_KEY]: state });
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
    throw new Error("Pairing request did not come from a trusted Tailscale pairing page");
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
    throw new Error("Pairing request did not come from a trusted Tailscale pairing page");
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
  const pickerState = await getPickerState();
  const baseOrigin = pageOrigin(pickerState.baseOrigin);
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

  const pickerState = await getPickerState();
  if (Number.isInteger(pickerState.targetTabId)) {
    try {
      const tab = await chrome.tabs.get(pickerState.targetTabId);
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

async function notifyPickerContextChanged() {
  try {
    await chrome.runtime.sendMessage({ type: "PICKER_CONTEXT_UPDATED" });
  } catch {
    // No picker page is listening yet.
  }
}

async function pickerTarget(tabHint, normalWindowHint) {
  const normalWindow = normalWindowHint || await getLastFocusedNormalWindow();
  let targetTab = tabHint?.id ? tabHint : activeTabInWindow(normalWindow);
  if (!targetTab && normalWindow?.id) targetTab = await queryActiveTab(normalWindow.id);
  return { normalWindow, targetTab };
}

async function rememberPickerTarget(targetTab, normalWindow, surface) {
  return updatePickerState({
    targetTabId: targetTab?.id || null,
    targetWindowId: targetTab?.windowId || normalWindow?.id || null,
    baseOrigin: pageOrigin(targetTab?.url),
    modalTabId: surface === "modal" ? targetTab?.id || null : null,
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

function showPickerInTab(tabId) {
  return sendWithAckOrInject(tabId, { type: "OPEN_PICKER" }, {
    files: ["picker.js"],
    ackKey: "opened",
    errorMessage: "Pi Annotate could not open the in-page picker",
  });
}

async function closePreviousPickerModal(state, nextTabId) {
  if (!Number.isInteger(state?.modalTabId) || state.modalTabId === nextTabId) return;
  try {
    await chrome.tabs.sendMessage(state.modalTabId, { type: "CLOSE_PICKER" });
  } catch {
    // The previous page was closed or navigated.
  }
}

async function closePreviousPickerWindow(state) {
  if (!Number.isInteger(state?.windowId)) return;
  try {
    await chrome.windows.remove(state.windowId);
  } catch {
    // The fallback window was already closed.
  }
}

async function openPickerWindow(tabHint, normalWindowHint, openSettings = false) {
  const { normalWindow, targetTab } = await pickerTarget(tabHint, normalWindowHint);
  const previousState = await getPickerState();
  const state = await rememberPickerTarget(targetTab, normalWindow, "window");
  const popupUrl = chrome.runtime.getURL(`popup.html${openSettings ? "?settings=1" : ""}`);

  if (Number.isInteger(state.windowId) && Number.isInteger(state.pickerTabId)) {
    try {
      const existing = await chrome.windows.get(state.windowId, { populate: true });
      const isPicker = existing?.type === "popup" &&
        existing.tabs?.some((tab) => tab.id === state.pickerTabId);
      if (isPicker) {
        await chrome.windows.update(state.windowId, { focused: true });
        await notifyPickerContextChanged();
        if (openSettings) {
          try {
            await chrome.runtime.sendMessage({ type: "OPEN_PICKER_SETTINGS_PANEL" });
          } catch {
            // The fallback page may still be loading; its query string handles first open.
          }
        }
        await closePreviousPickerModal(previousState);
        return { windowId: state.windowId, reused: true };
      }
    } catch {
      // Stale window IDs are expected after the picker is closed.
    }
  }

  const createOptions = {
    type: "popup",
    url: popupUrl,
    focused: true,
    width: PICKER_WIDTH,
    height: PICKER_HEIGHT,
  };
  if (
    Number.isFinite(normalWindow?.left) && Number.isFinite(normalWindow?.top) &&
    Number.isFinite(normalWindow?.width) && Number.isFinite(normalWindow?.height)
  ) {
    createOptions.left = Math.round(normalWindow.left + (normalWindow.width - PICKER_WIDTH) / 2);
    createOptions.top = Math.round(normalWindow.top + (normalWindow.height - PICKER_HEIGHT) / 2);
  }

  let created;
  try {
    created = await chrome.windows.create(createOptions);
  } catch (error) {
    if (!("left" in createOptions) && !("top" in createOptions)) throw error;
    const unpositionedOptions = { ...createOptions };
    delete unpositionedOptions.left;
    delete unpositionedOptions.top;
    created = await chrome.windows.create(unpositionedOptions);
  }
  if (!Number.isInteger(created?.id)) throw new Error("Chrome did not create the Pi Annotate window");
  const pickerTabId = created.tabs?.find((tab) => tab.url === popupUrl)?.id || created.tabs?.[0]?.id;
  await updatePickerState({
    modalTabId: null,
    windowId: created.id,
    pickerTabId: Number.isInteger(pickerTabId) ? pickerTabId : null,
  });
  await closePreviousPickerModal(previousState);
  return { windowId: created.id, reused: false };
}

async function openPicker(tabHint) {
  const { normalWindow, targetTab } = await pickerTarget(tabHint);
  const previousState = await getPickerState();
  await closePreviousPickerModal(previousState, targetTab?.id);

  if (targetTab?.id && !isRestrictedUrl(targetTab.url)) {
    await rememberPickerTarget(targetTab, normalWindow, "modal");
    try {
      await showPickerInTab(targetTab.id);
      await closePreviousPickerWindow(previousState);
      await updatePickerState({ modalTabId: targetTab.id, windowId: null, pickerTabId: null });
      return { tabId: targetTab.id, surface: "modal" };
    } catch {
      // Chrome-owned and otherwise uninjectable pages use the compact extension window.
    }
  }

  return openPickerWindow(targetTab, normalWindow);
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
        // The bearer token stays out of content-script contexts; only extension
        // pages (the compact fallback window) may read the stored config.
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

    case "GET_PICKER_STATUS":
      return runMessageTask(async () => {
        const config = await getStoredConfig();
        return { configured: Boolean(config.endpoint && config.token) };
      }, sendResponse);

    case "SAVE_BROKER_CONFIG":
      return runMessageTask(() => saveBrokerConfig(message), sendResponse);

    case "OPEN_SHORTCUT_SETTINGS":
      return runMessageTask(openShortcutSettings, sendResponse);

    case "OPEN_PICKER_SETTINGS":
      return runMessageTask(() => openPickerWindow(sender.tab, undefined, true), sendResponse);

    case "PICKER_CLOSED":
      return runMessageTask(async () => {
        const state = await getPickerState();
        if (sender.tab?.id === state.modalTabId) {
          await updatePickerState({ modalTabId: null });
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
  return openPicker(tab).catch(() => {
    // Chrome owns action errors; the next click retries from a fresh target tab.
  });
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-picker") return undefined;
  return openPicker().catch(() => {
    // Keep command failures quiet; the toolbar action remains available.
  });
});

chrome.windows.onRemoved.addListener((windowId) => {
  getPickerState()
    .then((state) => {
      if (state.windowId === windowId) {
        return updatePickerState({ windowId: null, pickerTabId: null });
      }
      return undefined;
    })
    .catch(() => {});
});
