import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const EXTENSION_ID = "bpeadifabilnfpephegaodjbcjjfjghk";
const manifest = JSON.parse(readFileSync(new URL("../chrome-extension/manifest.json", import.meta.url), "utf8"));
const pairingSource = readFileSync(new URL("../chrome-extension/pair.js", import.meta.url), "utf8");

function extensionIdFromKey(key) {
  const digest = createHash("sha256").update(Buffer.from(key, "base64")).digest().subarray(0, 16);
  return Array.from(digest, (byte) => [byte >> 4, byte & 15])
    .flat()
    .map((nibble) => String.fromCharCode("a".charCodeAt(0) + nibble))
    .join("");
}

class PairingElement {
  constructor() {
    this.textContent = "";
    this.disabled = false;
    this.hidden = false;
    this.listeners = new Map();
    this.dataset = {};
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  async trigger(type) { return this.listeners.get(type)?.({ preventDefault() {} }); }
}

function createPairingHarness({ permissionGranted = true, runtimeResponse } = {}) {
  const ids = ["broker-endpoint", "connect-btn", "close-btn", "status"];
  const elements = new Map(ids.map((id) => [id, new PairingElement()]));
  const permissionRequests = [];
  const messages = [];
  const code = "c".repeat(43);
  let closed = false;

  const chrome = {
    permissions: {
      async request(request) {
        permissionRequests.push(JSON.parse(JSON.stringify(request)));
        return permissionGranted;
      },
    },
    runtime: {
      async sendMessage(message) {
        messages.push(JSON.parse(JSON.stringify(message)));
        return runtimeResponse || {
          connected: true,
          endpoint: "https://workstation.example.ts.net:8443",
        };
      },
    },
  };
  const document = {
    getElementById(id) { return elements.get(id) || null; },
  };
  const location = {
    hash: `#endpoint=${encodeURIComponent("https://workstation.example.ts.net:8443")}&code=${code}`,
  };
  const window = { close() { closed = true; } };

  vm.runInContext(pairingSource, vm.createContext({
    URL,
    URLSearchParams,
    chrome,
    console,
    document,
    location,
    window,
  }), { filename: "pair.js" });

  return {
    code,
    elements,
    messages,
    permissionRequests,
    wasClosed() { return closed; },
  };
}

test("manifest pins a stable extension ID and accepts pairing messages only from tailnet pages", () => {
  assert.equal(extensionIdFromKey(manifest.key), EXTENSION_ID);
  assert.deepEqual(manifest.externally_connectable, {
    matches: [
      "https://*.ts.net/*",
      "http://localhost/*",
      "http://127.0.0.1/*",
    ],
  });
  assert.equal(manifest.action.default_popup, undefined);
  assert.match(manifest.commands["toggle-picker"].description, /Open the Pi Annotate session picker/);
});

test("pairing confirmation requests access to only the broker host and completes pairing", async () => {
  const harness = createPairingHarness();
  assert.equal(
    harness.elements.get("broker-endpoint").textContent,
    "https://workstation.example.ts.net:8443",
  );

  await harness.elements.get("connect-btn").trigger("click");

  assert.deepEqual(harness.permissionRequests, [{
    origins: ["https://workstation.example.ts.net/*"],
  }]);
  assert.deepEqual(harness.messages, [{
    type: "COMPLETE_PAIRING",
    endpoint: "https://workstation.example.ts.net:8443",
    code: harness.code,
  }]);
  assert.equal(harness.elements.get("status").dataset.state, "success");
  assert.match(harness.elements.get("status").textContent, /Connected/);
  assert.equal(harness.elements.get("connect-btn").hidden, true);
  assert.equal(harness.elements.get("close-btn").hidden, false);

  await harness.elements.get("close-btn").trigger("click");
  assert.equal(harness.wasClosed(), true);
});

test("pairing confirmation does not exchange the code when broker access is denied", async () => {
  const harness = createPairingHarness({ permissionGranted: false });

  await harness.elements.get("connect-btn").trigger("click");

  assert.deepEqual(harness.messages, []);
  assert.equal(harness.elements.get("status").dataset.state, "error");
  assert.match(harness.elements.get("status").textContent, /not granted/);
});
