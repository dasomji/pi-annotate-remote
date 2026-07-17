const endpointElement = document.getElementById("broker-endpoint");
const connectButton = document.getElementById("connect-btn");
const closeButton = document.getElementById("close-btn");
const statusElement = document.getElementById("status");
const PAIRING_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

closeButton.hidden = true;

function setStatus(state, message) {
  statusElement.dataset.state = state;
  statusElement.textContent = message;
}

function parsePairingRequest() {
  const values = new URLSearchParams(location.hash.slice(1));
  const code = values.get("code") || "";
  const endpointValue = values.get("endpoint") || "";
  let endpoint;
  try {
    endpoint = new URL(endpointValue);
  } catch {
    throw new Error("The broker address is invalid");
  }

  const isTailnetHttps = endpoint.protocol === "https:" && endpoint.hostname.endsWith(".ts.net");
  const isLocalHttp = endpoint.protocol === "http:" && ["localhost", "127.0.0.1"].includes(endpoint.hostname);
  if (
    (!isTailnetHttps && !isLocalHttp) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== "/" ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error("The broker address is not a trusted Tailscale endpoint");
  }
  if (!PAIRING_CODE_PATTERN.test(code)) {
    throw new Error("The pairing code is invalid or expired");
  }

  return { endpoint: endpoint.origin, code };
}

function permissionOrigin(endpoint) {
  const url = new URL(endpoint);
  return `${url.protocol}//${url.hostname}/*`;
}

let pairing;
try {
  pairing = parsePairingRequest();
  endpointElement.textContent = pairing.endpoint;
} catch (error) {
  connectButton.disabled = true;
  endpointElement.textContent = "Unavailable";
  setStatus("error", error instanceof Error ? error.message : String(error));
}

connectButton.addEventListener("click", async () => {
  if (!pairing) return;
  connectButton.disabled = true;
  setStatus("working", "Requesting access to this broker…");

  try {
    const granted = await chrome.permissions.request({
      origins: [permissionOrigin(pairing.endpoint)],
    });
    if (!granted) throw new Error("Broker access was not granted");

    setStatus("working", "Exchanging the one-time pairing code…");
    const response = await chrome.runtime.sendMessage({
      type: "COMPLETE_PAIRING",
      endpoint: pairing.endpoint,
      code: pairing.code,
    });
    if (response?.error) throw new Error(response.error);
    if (response?.connected !== true) throw new Error("Pi Annotate could not confirm the connection");

    setStatus("success", `Connected to ${response.endpoint || pairing.endpoint}`);
    connectButton.hidden = true;
    closeButton.hidden = false;
  } catch (error) {
    setStatus("error", error instanceof Error ? error.message : String(error));
    connectButton.disabled = false;
  }
});

closeButton.addEventListener("click", () => window.close());
