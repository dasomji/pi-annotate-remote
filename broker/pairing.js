export const ANNOTATOR_EXTENSION_ID = "bpeadifabilnfpephegaodjbcjjfjghk";
export const ANNOTATOR_EXTENSION_ORIGIN = `chrome-extension://${ANNOTATOR_EXTENSION_ID}`;
export const DEFAULT_PAIRING_CODE_TTL_MS = 5 * 60 * 1_000;
export const PAIRING_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PAIRING_REQUEST_TIMEOUT_MS = 5_000;
const MAX_PAIRING_RESPONSE_BYTES = 16 * 1024;

function endpointOrigin(value, { requireTailnet = false } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Pairing endpoint is invalid");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Pairing endpoint must be an origin");
  }
  if (requireTailnet && (url.protocol !== "https:" || !url.hostname.endsWith(".ts.net"))) {
    throw new Error("Public pairing endpoint must use Tailscale HTTPS");
  }
  if (!requireTailnet && !["http:", "https:"].includes(url.protocol)) {
    throw new Error("Local pairing endpoint must use HTTP or HTTPS");
  }
  return url.origin;
}

export async function createPairingLink({
  localEndpoint,
  publicEndpoint,
  token,
  fetchImpl = fetch,
  timeoutMs = PAIRING_REQUEST_TIMEOUT_MS,
}) {
  const localOrigin = endpointOrigin(localEndpoint);
  const publicOrigin = endpointOrigin(publicEndpoint, { requireTailnet: true });
  if (typeof token !== "string" || !token.trim() || token.length > 4_096) {
    throw new Error("Broker token is invalid");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${localOrigin}/v1/pairings`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });
    const text = await response.text();
    if (text.length > MAX_PAIRING_RESPONSE_BYTES) throw new Error("Broker pairing response was too large");
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error("Broker returned an invalid pairing response");
    }
    if (!response.ok) {
      throw new Error(body?.error?.message || `Broker returned HTTP ${response.status}`);
    }
    if (!PAIRING_CODE_PATTERN.test(body?.code) || !Number.isFinite(body?.expiresAt)) {
      throw new Error("Broker returned an invalid pairing code");
    }

    const link = new URL("/pair", publicOrigin);
    link.hash = body.code;
    return link.href;
  } finally {
    clearTimeout(timeout);
  }
}

export function pairingPageHtml() {
  const extensionId = JSON.stringify(ANNOTATOR_EXTENSION_ID);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Connect Pi Annotate</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: #09090b; color: #e4e4e7; }
    main { width: min(440px, calc(100vw - 40px)); padding: 28px; border: 1px solid #27272a; border-radius: 14px; background: #18181b; box-shadow: 0 20px 60px rgba(0,0,0,.35); }
    h1 { margin: 0 0 10px; font-size: 22px; }
    p { margin: 8px 0; color: #a1a1aa; line-height: 1.5; }
    #status[data-state="success"] { color: #86efac; }
    #status[data-state="error"] { color: #fca5a5; }
    code { color: #c4b5fd; }
  </style>
</head>
<body>
  <main>
    <h1>Connect Pi Annotate</h1>
    <p id="status">Contacting the browser extension…</p>
    <p id="help" hidden>If Pi Annotate is installed, reload it from <code>chrome://extensions</code> and open this link again. Chrome on iOS and Android does not support desktop Chrome extensions.</p>
  </main>
  <script>
    (() => {
      const extensionId = ${extensionId};
      const status = document.getElementById("status");
      const help = document.getElementById("help");
      const code = location.hash.slice(1);
      history.replaceState(null, "", location.pathname);

      const fail = (message) => {
        status.textContent = message;
        status.dataset.state = "error";
        help.hidden = false;
      };

      if (!/^[A-Za-z0-9_-]{43}$/.test(code)) {
        fail("This pairing link is invalid or incomplete.");
        return;
      }
      if (!globalThis.chrome?.runtime?.sendMessage) {
        fail("Pi Annotate was not found in this browser.");
        return;
      }

      chrome.runtime.sendMessage(extensionId, { type: "PI_ANNOTATE_PAIR", code }, (response) => {
        if (chrome.runtime.lastError || response?.accepted !== true) {
          fail("Pi Annotate did not accept the pairing request.");
          return;
        }
        status.textContent = "Pairing request opened in Pi Annotate. Confirm the broker address there to finish connecting.";
        status.dataset.state = "success";
      });
    })();
  </script>
</body>
</html>`;
}
