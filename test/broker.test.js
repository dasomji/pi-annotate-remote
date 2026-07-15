import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { AnnotationSessionClient, ensureBrokerRunning } from "../broker/client.js";
import { getBrokerConfig } from "../broker/config.js";
import { createBroker } from "../broker/server.js";

const TOKEN = "test-token-with-enough-entropy-for-comparison";

async function startBroker(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pi-annotate-test-"));
  const broker = createBroker({
    host: "127.0.0.1",
    port: 0,
    socketPath: path.join(directory, "broker.sock"),
    token: TOKEN,
    deliveryTimeoutMs: 200,
    ...overrides,
  });
  const address = await broker.start();
  const baseUrl = `http://${address.host}:${address.port}`;
  t.after(async () => {
    await broker.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { broker, address, baseUrl };
}

function createLineClient(socketPath) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    const queued = [];
    const waiters = [];
    let buffer = "";

    socket.setEncoding("utf8");
    socket.once("error", reject);
    socket.once("connect", () => {
      socket.off("error", reject);
      socket.on("data", (chunk) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const message = JSON.parse(line);
          const waiter = waiters.shift();
          if (waiter) waiter.resolve(message);
          else queued.push(message);
        }
      });
      resolve({
        socket,
        send(message) {
          socket.write(`${JSON.stringify(message)}\n`);
        },
        next(timeoutMs = 500) {
          if (queued.length) return Promise.resolve(queued.shift());
          return new Promise((resolveMessage, rejectMessage) => {
            const waiter = {
              resolve(message) {
                clearTimeout(timeoutId);
                resolveMessage(message);
              },
            };
            const timeoutId = setTimeout(() => {
              const index = waiters.indexOf(waiter);
              if (index >= 0) waiters.splice(index, 1);
              rejectMessage(new Error("Timed out waiting for IPC message"));
            }, timeoutMs);
            waiters.push(waiter);
          });
        },
        close() {
          return new Promise((resolveClose) => {
            if (socket.destroyed) return resolveClose();
            socket.once("close", resolveClose);
            socket.destroy();
          });
        },
      });
    });
  });
}

async function registerSession(socketPath, sessionId, label) {
  const client = await createLineClient(socketPath);
  client.send({ type: "register", sessionId, label });
  assert.deepEqual(await client.next(), { type: "registered", sessionId });
  return client;
}

function authorizedHeaders(extra = {}) {
  return { Authorization: `Bearer ${TOKEN}`, ...extra };
}

async function responseJson(response) {
  const body = await response.json();
  return { status: response.status, body };
}

test("auto-starts a detached broker and creates a private bearer token", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pi-annotate-daemon-test-"));
  const env = {
    ...process.env,
    PI_ANNOTATE_RUNTIME_DIR: path.join(directory, "runtime"),
    PI_ANNOTATE_STATE_DIR: path.join(directory, "state"),
    PI_ANNOTATE_PORT: "0",
  };
  const config = getBrokerConfig(env);
  const daemonPath = fileURLToPath(new URL("../broker/daemon.js", import.meta.url));

  t.after(async () => {
    try {
      const pid = Number.parseInt(fs.readFileSync(config.lockPath, "utf8").trim(), 10);
      process.kill(pid, "SIGTERM");
      const deadline = Date.now() + 1000;
      while (Date.now() < deadline && fs.existsSync(config.lockPath)) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    } catch {}
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const token = await ensureBrokerRunning({ config, daemonPath, env });
  assert.equal(token.length, 64);
  assert.equal(fs.statSync(config.tokenPath).mode & 0o777, 0o600);
  assert.equal(await new Promise((resolve) => {
    const socket = net.createConnection(config.socketPath);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
  }), true);
});

test("health is public while annotation sessions require bearer authentication", async (t) => {
  const { baseUrl } = await startBroker(t);

  assert.deepEqual(await responseJson(await fetch(`${baseUrl}/health`)), {
    status: 200,
    body: { ok: true },
  });
  assert.deepEqual(await responseJson(await fetch(`${baseUrl}/v1/sessions`)), {
    status: 401,
    body: { error: { code: "unauthorized", message: "Valid bearer token required" } },
  });
});

test("lists multiple live annotation sessions without private metadata", async (t) => {
  const { address, baseUrl } = await startBroker(t);
  const first = await registerSession(address.socketPath, "session_abcdefghijkl", "alpha (main)");
  const second = await registerSession(address.socketPath, "session_mnopqrstuvwx", "beta (feature)");
  t.after(() => Promise.all([first.close(), second.close()]));

  assert.deepEqual(await responseJson(await fetch(`${baseUrl}/v1/sessions`, {
    headers: authorizedHeaders(),
  })), {
    status: 200,
    body: {
      sessions: [
        { id: "session_abcdefghijkl", label: "alpha (main)" },
        { id: "session_mnopqrstuvwx", label: "beta (feature)" },
      ],
    },
  });
});

test("routes an annotation to exactly one session and waits for its acknowledgement", async (t) => {
  const { address, baseUrl } = await startBroker(t);
  const target = await registerSession(address.socketPath, "session_abcdefghijkl", "alpha (main)");
  const other = await registerSession(address.socketPath, "session_mnopqrstuvwx", "beta (main)");
  t.after(() => Promise.all([target.close(), other.close()]));

  const annotation = { success: true, url: "https://example.test", elements: [] };
  const deliveryResponse = fetch(`${baseUrl}/v1/sessions/session_abcdefghijkl/annotations`, {
    method: "POST",
    headers: authorizedHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(annotation),
  });

  const delivered = await target.next();
  assert.equal(delivered.type, "annotation");
  assert.deepEqual(delivered.annotation, annotation);
  await assert.rejects(other.next(30), /Timed out/);

  target.send({ type: "ack", deliveryId: delivered.deliveryId, ok: true });
  assert.deepEqual(await responseJson(await deliveryResponse), {
    status: 202,
    body: { delivered: true },
  });
});

test("returns bounded errors for unknown and disconnected sessions", async (t) => {
  const { address, baseUrl } = await startBroker(t);
  const client = await registerSession(address.socketPath, "session_abcdefghijkl", "alpha (main)");
  await client.close();

  for (const sessionId of ["does_not_exist_1234", "session_abcdefghijkl"]) {
    const response = await fetch(`${baseUrl}/v1/sessions/${sessionId}/annotations`, {
      method: "POST",
      headers: authorizedHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ success: true }),
    });
    const result = await responseJson(response);
    assert.equal(result.status, 404);
    assert.equal(result.body.error.code, "session_not_found");
  }
});

test("times out when the target does not acknowledge delivery", async (t) => {
  const { address, baseUrl } = await startBroker(t, { deliveryTimeoutMs: 30 });
  const client = await registerSession(address.socketPath, "session_abcdefghijkl", "alpha (main)");
  t.after(() => client.close());

  const responsePromise = fetch(`${baseUrl}/v1/sessions/session_abcdefghijkl/annotations`, {
    method: "POST",
    headers: authorizedHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ success: true }),
  });
  assert.equal((await client.next()).type, "annotation");

  assert.deepEqual(await responseJson(await responsePromise), {
    status: 504,
    body: { error: { code: "delivery_timeout", message: "Annotation delivery timed out" } },
  });
});

test("rejects malformed and oversized annotation bodies", async (t) => {
  const { baseUrl } = await startBroker(t, { maxBodyBytes: 32 });
  const endpoint = `${baseUrl}/v1/sessions/does_not_exist_1234/annotations`;

  const malformed = await fetch(endpoint, {
    method: "POST",
    headers: authorizedHeaders({ "Content-Type": "application/json" }),
    body: "{not json",
  });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, "invalid_json");

  const oversized = await fetch(endpoint, {
    method: "POST",
    headers: authorizedHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ payload: "x".repeat(64) }),
  });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error.code, "payload_too_large");
});

test("Pi client acknowledges only after handling an annotation and unregisters on disable", async (t) => {
  const { address, baseUrl } = await startBroker(t);
  const received = [];
  const client = new AnnotationSessionClient({
    sessionId: "session_abcdefghijkl",
    label: "alpha (main)",
    socketPath: address.socketPath,
    ensureBroker: async () => TOKEN,
    onAnnotation: async (annotation) => {
      received.push(annotation);
    },
  });
  t.after(() => client.disable());
  await client.enable();

  const annotation = { success: true, url: "https://example.test", elements: [] };
  const response = await fetch(`${baseUrl}/v1/sessions/session_abcdefghijkl/annotations`, {
    method: "POST",
    headers: authorizedHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(annotation),
  });
  assert.equal(response.status, 202);
  assert.deepEqual(received, [annotation]);

  client.disable();
  await new Promise((resolve) => setTimeout(resolve, 10));
  const sessions = await fetch(`${baseUrl}/v1/sessions`, { headers: authorizedHeaders() });
  assert.deepEqual(await sessions.json(), { sessions: [] });
});

test("Pi client rejects delivery when annotation handling fails", async (t) => {
  const { address, baseUrl } = await startBroker(t);
  const client = new AnnotationSessionClient({
    sessionId: "session_abcdefghijkl",
    label: "alpha (main)",
    socketPath: address.socketPath,
    ensureBroker: async () => TOKEN,
    onAnnotation: async () => {
      throw new Error("invalid annotation");
    },
  });
  t.after(() => client.disable());
  await client.enable();

  const response = await fetch(`${baseUrl}/v1/sessions/session_abcdefghijkl/annotations`, {
    method: "POST",
    headers: authorizedHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ success: true }),
  });
  assert.deepEqual(await responseJson(response), {
    status: 502,
    body: { error: { code: "delivery_rejected", message: "Annotation session rejected the annotation" } },
  });
});

test("Pi client reconnects and re-registers after its broker socket closes", async (t) => {
  const { address, baseUrl } = await startBroker(t);
  const client = new AnnotationSessionClient({
    sessionId: "session_abcdefghijkl",
    label: "alpha (main)",
    socketPath: address.socketPath,
    ensureBroker: async () => TOKEN,
    onAnnotation: async () => {},
  });
  t.after(() => client.disable());
  await client.enable();
  const originalSocket = client.socket;
  originalSocket.destroy();

  const deadline = Date.now() + 1500;
  while (
    Date.now() < deadline &&
    (!client.socket || client.socket === originalSocket || client.socket.destroyed)
  ) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.notEqual(client.socket, originalSocket);
  assert.equal(client.socket?.destroyed, false);

  const response = await fetch(`${baseUrl}/v1/sessions`, { headers: authorizedHeaders() });
  assert.deepEqual(await response.json(), {
    sessions: [{ id: "session_abcdefghijkl", label: "alpha (main)" }],
  });
});

test("rejects web-page origins while allowing extension origins", async (t) => {
  const { baseUrl } = await startBroker(t);

  const denied = await fetch(`${baseUrl}/v1/sessions`, {
    headers: authorizedHeaders({ Origin: "https://malicious.example" }),
  });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error.code, "origin_not_allowed");

  const allowedOrigin = "chrome-extension://abcdefghijklmnop";
  const allowed = await fetch(`${baseUrl}/v1/sessions`, {
    headers: authorizedHeaders({ Origin: allowedOrigin }),
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("access-control-allow-origin"), allowedOrigin);
});
