import fs from "node:fs";
import net from "node:net";
import { spawn } from "node:child_process";
import { getBrokerConfig } from "./config.js";
import { BROKER_PROTOCOL_VERSION } from "./protocol.js";

const MAX_INCOMING_BUFFER_BYTES = 34 * 1024 * 1024;
const START_TIMEOUT_MS = 5_000;
const STOP_TIMEOUT_MS = 3_000;
const PROTOCOL_PROBE_TIMEOUT_MS = 750;
const REGISTRATION_TIMEOUT_MS = 3_000;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function probeSocket(socketPath) {
  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath);
    const finish = (connected) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(connected);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(250, () => finish(false));
  });
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function localBrokerEndpoint(config) {
  const hostname = config.host.includes(":") ? `[${config.host}]` : config.host;
  return `http://${hostname}:${config.port}`;
}

async function probeBrokerProtocol(config) {
  if (config.port === 0) return BROKER_PROTOCOL_VERSION;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROTOCOL_PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`${localBrokerEndpoint(config)}/health`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = await response.json();
    if (body?.ok !== true) return null;
    return Number.isInteger(body.protocolVersion) ? body.protocolVersion : 1;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function stopOutdatedBroker(config) {
  let pid;
  try {
    pid = Number.parseInt(fs.readFileSync(config.lockPath, "utf8").trim(), 10);
  } catch (error) {
    throw new Error(`Outdated broker is running but its lock file cannot be read: ${error.message}`);
  }
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error("Outdated broker is running with an invalid lock file; stop it manually and retry");
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") {
      throw new Error(`Could not stop outdated broker process ${pid}: ${error.message}`);
    }
  }

  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!processIsAlive(pid)) return;
    await delay(50);
  }
  throw new Error(`Outdated broker process ${pid} did not stop; stop it manually and retry`);
}

function spawnBroker(daemonPath, env) {
  const child = spawn(process.execPath, [daemonPath], {
    detached: true,
    stdio: "ignore",
    env,
  });
  child.unref();
}

async function waitForCurrentBroker(config, daemonPath, env) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await probeSocket(config.socketPath)) {
      const protocolVersion = await probeBrokerProtocol(config);
      if (protocolVersion === BROKER_PROTOCOL_VERSION) return;
      if (protocolVersion !== null && protocolVersion > BROKER_PROTOCOL_VERSION) {
        throw new Error(`Broker protocol ${protocolVersion} is newer than this extension supports`);
      }
      if (protocolVersion !== null && protocolVersion < BROKER_PROTOCOL_VERSION) {
        // Older Pi sessions can race to restart their old daemon after the first
        // shutdown. Replace every outdated winner until the current daemon owns
        // the shared socket; old clients can then reconnect to the compatible IPC.
        await stopOutdatedBroker(config);
        spawnBroker(daemonPath, env);
        continue;
      }
    }
    await delay(75);
  }
  throw new Error(`Broker did not start with protocol ${BROKER_PROTOCOL_VERSION} within ${START_TIMEOUT_MS / 1000} seconds`);
}

export async function ensureBrokerRunning({ config = getBrokerConfig(), daemonPath, env = process.env } = {}) {
  if (!daemonPath) throw new Error("Broker daemon path is required");

  let connected = await probeSocket(config.socketPath);
  if (connected) {
    const protocolVersion = await probeBrokerProtocol(config);
    if (protocolVersion === null) {
      throw new Error("Could not verify the running annotation broker version; stop it manually and retry");
    }
    if (protocolVersion > BROKER_PROTOCOL_VERSION) {
      throw new Error(`Broker protocol ${protocolVersion} is newer than this extension supports`);
    }
    if (protocolVersion < BROKER_PROTOCOL_VERSION) {
      await stopOutdatedBroker(config);
      connected = false;
    }
  }

  if (!connected) {
    spawnBroker(daemonPath, env);
    await waitForCurrentBroker(config, daemonPath, env);
  }

  try {
    const token = fs.readFileSync(config.tokenPath, "utf8").trim();
    if (token.length < 32) throw new Error("token is invalid");
    return token;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read broker token at ${config.tokenPath}: ${message}`, { cause: error });
  }
}

export class AnnotationSessionClient {
  constructor(options) {
    this.sessionId = options.sessionId;
    this.label = options.label;
    this.socketPath = options.socketPath;
    this.ensureBroker = options.ensureBroker;
    this.onAnnotation = options.onAnnotation;
    this.onStatus = options.onStatus || (() => {});
    this.socket = null;
    this.buffer = "";
    this.enabled = false;
    this.registered = false;
    this.connecting = null;
    this.reconnectTimer = null;
    this.reconnectDelayMs = 250;
  }

  async enable() {
    this.enabled = true;
    await this.connect();
  }

  disable() {
    this.enabled = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.connecting = null;
    this.buffer = "";
    this.registered = false;
    this.socket?.destroy();
    this.socket = null;
    this.onStatus("Annotation session unavailable");
  }

  async connect() {
    if (!this.enabled) throw new Error("Annotation session is disabled");
    if (this.socket && !this.socket.destroyed) return;
    if (this.connecting) return this.connecting;

    this.connecting = this.openRegisteredSocket();
    try {
      await this.connecting;
      this.reconnectDelayMs = 250;
    } finally {
      this.connecting = null;
    }
  }

  async openRegisteredSocket() {
    await this.ensureBroker();
    if (!this.enabled) return;

    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.socketPath);
      let settled = false;
      const registrationTimeout = setTimeout(() => {
        failInitialConnection(new Error("Broker registration timed out"));
      }, REGISTRATION_TIMEOUT_MS);

      const failInitialConnection = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(registrationTimeout);
        socket.destroy();
        reject(error);
      };

      socket.setEncoding("utf8");
      socket.once("error", failInitialConnection);
      socket.once("connect", () => {
        if (!this.enabled) {
          failInitialConnection(new Error("Annotation session was disabled"));
          return;
        }
        this.socket = socket;
        socket.write(`${JSON.stringify({
          type: "register",
          sessionId: this.sessionId,
          label: this.label,
        })}\n`);
      });

      socket.on("data", (chunk) => {
        this.buffer += chunk;
        if (Buffer.byteLength(this.buffer) > MAX_INCOMING_BUFFER_BYTES) {
          this.onStatus("Broker message exceeded the annotation size limit");
          socket.destroy();
          return;
        }

        const lines = this.buffer.split("\n");
        this.buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let message;
          try {
            message = JSON.parse(line);
          } catch {
            this.onStatus("Broker sent invalid JSON");
            socket.destroy();
            return;
          }

          if (message?.type === "registered" && message.sessionId === this.sessionId) {
            if (!settled) {
              settled = true;
              clearTimeout(registrationTimeout);
              socket.off("error", failInitialConnection);
              this.registered = true;
              this.onStatus(`Available as ${this.label}`);
              resolve();
            }
          } else if (message?.type === "annotation" && typeof message.deliveryId === "string") {
            void this.handleAnnotation(socket, message);
          } else if (message?.type === "error") {
            const error = new Error(`Broker rejected session: ${message.code || "unknown error"}`);
            if (!settled) failInitialConnection(error);
            else {
              this.onStatus(error.message);
              socket.destroy();
            }
          }
        }
      });

      socket.on("error", (error) => {
        if (settled) this.onStatus(`Broker connection error: ${error.message}`);
      });
      socket.on("close", () => {
        if (this.socket === socket) {
          this.socket = null;
          this.registered = false;
        }
        this.buffer = "";
        if (!settled) {
          settled = true;
          clearTimeout(registrationTimeout);
          reject(new Error("Broker connection closed before registration"));
        }
        if (this.enabled) this.scheduleReconnect();
      });
    });
  }

  async handleAnnotation(socket, message) {
    try {
      await this.onAnnotation(message.annotation);
      if (!socket.destroyed) {
        socket.write(`${JSON.stringify({ type: "ack", deliveryId: message.deliveryId, ok: true })}\n`);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.onStatus(`Annotation rejected: ${reason}`);
      if (!socket.destroyed) {
        socket.write(`${JSON.stringify({ type: "ack", deliveryId: message.deliveryId, ok: false })}\n`);
      }
    }
  }

  scheduleReconnect() {
    if (!this.enabled || this.reconnectTimer) return;
    const wait = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 5_000);
    this.onStatus("Reconnecting annotation session…");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch((error) => {
        this.onStatus(`Could not reconnect: ${error.message}`);
        this.scheduleReconnect();
      });
    }, wait);
  }
}
