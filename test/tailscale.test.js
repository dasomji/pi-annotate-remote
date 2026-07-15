import assert from "node:assert/strict";
import test from "node:test";
import { ensureTailscaleServe } from "../broker/tailscale.js";
import { formatSetupInstructions } from "../index.ts";

const LOCAL_ENDPOINT = "http://127.0.0.1:32179";
const DNS_NAME = "workstation.example.ts.net";
const TAILNET_ENDPOINT = `https://${DNS_NAME}:32179`;

function commandKey(args) {
  return args.join(" ");
}

function createRunner(responses) {
  const calls = [];
  const runCommand = async (command, args) => {
    calls.push({ command, args: [...args] });
    const key = commandKey(args);
    const response = responses[key];
    if (Array.isArray(response)) {
      if (response.length === 0) throw new Error(`No response left for ${key}`);
      const next = response.shift();
      if (next instanceof Error) throw next;
      return next;
    }
    if (response instanceof Error) throw response;
    if (!response) throw new Error(`Unexpected command: ${command} ${key}`);
    return response;
  };
  return { calls, runCommand };
}

function tailscaleStatus() {
  return {
    stdout: JSON.stringify({
      BackendState: "Running",
      Self: { DNSName: `${DNS_NAME}.` },
    }),
    stderr: "",
  };
}

function serveStatus(proxy = LOCAL_ENDPOINT, { allowFunnel = false } = {}) {
  const status = {
    TCP: { "32179": { HTTPS: true } },
    Web: {
      [`${DNS_NAME}:32179`]: {
        Handlers: { "/": { Proxy: proxy } },
      },
    },
  };
  if (allowFunnel) status.AllowFunnel = { [`${DNS_NAME}:32179`]: true };
  return { stdout: JSON.stringify(status), stderr: "" };
}

test("reuses an existing matching Tailscale Serve route and reports its exact endpoint", async () => {
  const runner = createRunner({
    "status --json": tailscaleStatus(),
    "serve status --json": serveStatus(),
  });

  const result = await ensureTailscaleServe({
    host: "127.0.0.1",
    port: 32179,
    runCommand: runner.runCommand,
  });

  assert.deepEqual(result, {
    endpoint: TAILNET_ENDPOINT,
    localEndpoint: LOCAL_ENDPOINT,
    active: true,
  });
  assert.deepEqual(runner.calls.map(({ args }) => commandKey(args)), [
    "status --json",
    "serve status --json",
  ]);
});

test("automatically starts Tailscale Serve on the broker port and verifies the route", async () => {
  const runner = createRunner({
    "status --json": tailscaleStatus(),
    "serve status --json": [
      { stdout: JSON.stringify({ TCP: {}, Web: {} }), stderr: "" },
      serveStatus(),
    ],
    [`serve --bg --yes --https=32179 ${LOCAL_ENDPOINT}`]: { stdout: "", stderr: "" },
  });

  const result = await ensureTailscaleServe({
    host: "127.0.0.1",
    port: 32179,
    runCommand: runner.runCommand,
  });

  assert.deepEqual(result, {
    endpoint: TAILNET_ENDPOINT,
    localEndpoint: LOCAL_ENDPOINT,
    active: true,
  });
  assert.deepEqual(runner.calls.map(({ args }) => commandKey(args)), [
    "status --json",
    "serve status --json",
    `serve --bg --yes --https=32179 ${LOCAL_ENDPOINT}`,
    "serve status --json",
  ]);
});

test("does not overwrite a different service already using the broker port", async () => {
  const runner = createRunner({
    "status --json": tailscaleStatus(),
    "serve status --json": serveStatus("http://127.0.0.1:9999"),
  });

  const result = await ensureTailscaleServe({
    host: "127.0.0.1",
    port: 32179,
    runCommand: runner.runCommand,
  });

  assert.equal(result.endpoint, null);
  assert.equal(result.localEndpoint, LOCAL_ENDPOINT);
  assert.equal(result.active, false);
  assert.match(result.warning, /already routes to http:\/\/127\.0\.0\.1:9999/);
  assert.equal(runner.calls.some(({ args }) => args.includes("--bg")), false);
});

test("refuses to reuse a matching route when Tailscale Funnel is enabled", async () => {
  const runner = createRunner({
    "status --json": tailscaleStatus(),
    "serve status --json": serveStatus(LOCAL_ENDPOINT, { allowFunnel: true }),
  });

  const result = await ensureTailscaleServe({
    host: "127.0.0.1",
    port: 32179,
    runCommand: runner.runCommand,
  });

  assert.equal(result.endpoint, null);
  assert.match(result.warning, /Funnel enabled/);
  assert.equal(runner.calls.some(({ args }) => args.includes("--bg")), false);
});

test("keeps the local broker available and returns a bounded warning when Tailscale is unavailable", async () => {
  const runner = createRunner({
    "status --json": new Error("tailscaled is not running\n" + "x".repeat(1000)),
  });

  const result = await ensureTailscaleServe({
    host: "127.0.0.1",
    port: 32179,
    runCommand: runner.runCommand,
  });

  assert.equal(result.endpoint, null);
  assert.equal(result.localEndpoint, LOCAL_ENDPOINT);
  assert.equal(result.active, false);
  assert.match(result.warning, /tailscaled is not running/);
  assert.ok(result.warning.length <= 400);
});

test("supports an explicit environment opt-out without calling Tailscale", async () => {
  const runner = createRunner({});

  const result = await ensureTailscaleServe({
    host: "127.0.0.1",
    port: 32179,
    env: { PI_ANNOTATE_TAILSCALE: "off" },
    runCommand: runner.runCommand,
  });

  assert.equal(result.endpoint, null);
  assert.match(result.warning, /disabled/);
  assert.deepEqual(runner.calls, []);
});

test("does not attempt to expose a dynamic port zero", async () => {
  const runner = createRunner({});

  const result = await ensureTailscaleServe({
    host: "127.0.0.1",
    port: 0,
    runCommand: runner.runCommand,
  });

  assert.equal(result.endpoint, null);
  assert.equal(result.localEndpoint, "http://127.0.0.1:0");
  assert.match(result.warning, /fixed broker port/);
  assert.deepEqual(runner.calls, []);
});

test("setup information prints the verified endpoint instead of a placeholder", () => {
  const output = formatSetupInstructions({
    sessionLabel: "shop (main)",
    token: "secret-token",
    serve: {
      endpoint: TAILNET_ENDPOINT,
      localEndpoint: LOCAL_ENDPOINT,
      active: true,
    },
  });

  assert.match(output, new RegExp(`Endpoint: ${TAILNET_ENDPOINT.replaceAll(".", "\\.")}`));
  assert.doesNotMatch(output, /your Tailscale Serve HTTPS URL/);
  assert.match(output, /Token: secret-token/);
});
