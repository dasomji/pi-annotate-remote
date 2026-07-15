import fs from "node:fs";
import net from "node:net";
import { spawn } from "node:child_process";
import { getBrokerConfig } from "./config.js";

const MAX_INCOMING_BUFFER_BYTES = 34 * 1024 * 1024;
const START_TIMEOUT_MS = 5_000;
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

export async function ensureBrokerRunning({ config = getBrokerConfig(), daemonPath, env = process.env } = {}) {
  if (!daemonPath) throw new Error("Broker daemon path is required");

  if (!(await probeSocket(config.socketPath))) {
    const child = spawn(process.execPath, [daemonPath], {
      detached: true,
      stdio: "ignore",
      env,
    });
    child.unref();

    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await probeSocket(config.socketPath)) break;
      await delay(75);
    }
    if (!(await probeSocket(config.socketPath))) {
      throw new Error(`Broker did not start within ${START_TIMEOUT_MS / 1000} seconds`);
    }
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
