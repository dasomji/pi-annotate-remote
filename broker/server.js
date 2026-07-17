import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import {
  ANNOTATOR_EXTENSION_ORIGIN,
  DEFAULT_PAIRING_CODE_TTL_MS,
  PAIRING_CODE_PATTERN,
  pairingPageHtml,
} from "./pairing.js";
import { BROKER_PROTOCOL_VERSION } from "./protocol.js";

export const DEFAULT_MAX_BODY_BYTES = 32 * 1024 * 1024;
export const DEFAULT_DELIVERY_TIMEOUT_MS = 10_000;
const MAX_IPC_LINE_BYTES = 64 * 1024;
const MAX_LABEL_LENGTH = 200;
const MAX_PAIRING_BODY_BYTES = 4 * 1024;
const MAX_ACTIVE_PAIRING_CODES = 32;

class BrokerError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "BrokerError";
    this.status = status;
    this.code = code;
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function writeJson(response, status, value, extraHeaders = {}) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  response.end(body);
}

function writePairingPage(response) {
  const body = pairingPageHtml();
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function safeEqual(actual, expected) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function extractBearerToken(request) {
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return "";
  return authorization.slice(7);
}

function defaultOriginAllowed(origin, configuredOrigins) {
  if (!origin) return true;
  if (origin.startsWith("chrome-extension://")) return true;
  return configuredOrigins.includes(origin);
}

function validateRegistration(message) {
  if (!isRecord(message) || message.type !== "register") {
    throw new BrokerError(400, "invalid_registration", "First IPC message must register an annotation session");
  }
  if (typeof message.sessionId !== "string" || !/^[a-zA-Z0-9_-]{16,128}$/.test(message.sessionId)) {
    throw new BrokerError(400, "invalid_session_id", "Session ID is invalid");
  }
  if (typeof message.label !== "string" || !message.label.trim() || message.label.length > MAX_LABEL_LENGTH) {
    throw new BrokerError(400, "invalid_session_label", "Session label is invalid");
  }
  return { id: message.sessionId, label: message.label.trim() };
}

async function readJsonBody(request, maxBodyBytes) {
  const contentType = request.headers["content-type"] || "";
  if (!String(contentType).toLowerCase().startsWith("application/json")) {
    throw new BrokerError(415, "unsupported_media_type", "Content-Type must be application/json");
  }

  const declaredLength = Number.parseInt(request.headers["content-length"] || "0", 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    request.resume();
    throw new BrokerError(413, "payload_too_large", "Annotation payload is too large");
  }

  const chunks = [];
  let bytes = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBodyBytes) {
      tooLarge = true;
      continue;
    }
    chunks.push(chunk);
  }

  if (tooLarge) throw new BrokerError(413, "payload_too_large", "Annotation payload is too large");
  if (bytes === 0) throw new BrokerError(400, "invalid_json", "Request body must contain JSON");

  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!isRecord(parsed)) throw new Error("Expected an object");
    return parsed;
  } catch {
    throw new BrokerError(400, "invalid_json", "Request body contains invalid JSON");
  }
}

export function createBroker(options) {
  if (!options?.socketPath || !options?.token) {
    throw new Error("socketPath and token are required");
  }

  const host = options.host || "127.0.0.1";
  const port = options.port ?? 32179;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const deliveryTimeoutMs = options.deliveryTimeoutMs ?? DEFAULT_DELIVERY_TIMEOUT_MS;
  const pairingCodeTtlMs = options.pairingCodeTtlMs ?? DEFAULT_PAIRING_CODE_TTL_MS;
  const now = options.now || Date.now;
  const configuredOrigins = options.allowedOrigins || [];
  if (!Number.isFinite(pairingCodeTtlMs) || pairingCodeTtlMs <= 0) {
    throw new Error("pairingCodeTtlMs must be positive");
  }
  const sessions = new Map();
  const socketSessions = new Map();
  const allSockets = new Set();
  const pendingDeliveries = new Map();
  const pairingCodes = new Map();
  let started = false;

  function prunePairingCodes() {
    const currentTime = now();
    for (const [code, expiresAt] of pairingCodes) {
      if (expiresAt <= currentTime) pairingCodes.delete(code);
    }
  }

  function issuePairingCode() {
    prunePairingCodes();
    while (pairingCodes.size >= MAX_ACTIVE_PAIRING_CODES) {
      pairingCodes.delete(pairingCodes.keys().next().value);
    }

    let code;
    do {
      code = randomBytes(32).toString("base64url");
    } while (pairingCodes.has(code));
    const expiresAt = now() + pairingCodeTtlMs;
    pairingCodes.set(code, expiresAt);
    return { code, expiresAt };
  }

  function exchangePairingCode(code) {
    prunePairingCodes();
    if (typeof code !== "string" || !PAIRING_CODE_PATTERN.test(code) || !pairingCodes.has(code)) {
      throw new BrokerError(401, "invalid_pairing_code", "Pairing code is invalid or expired");
    }
    pairingCodes.delete(code);
    return options.token;
  }

  function sendIpc(socket, message) {
    if (socket.destroyed || !socket.writable) return false;
    return socket.write(`${JSON.stringify(message)}\n`);
  }

  function removeSocket(socket, reason = "Annotation session disconnected") {
    const sessionId = socketSessions.get(socket);
    socketSessions.delete(socket);
    if (sessionId && sessions.get(sessionId)?.socket === socket) sessions.delete(sessionId);

    for (const [deliveryId, pending] of pendingDeliveries) {
      if (pending.socket !== socket) continue;
      clearTimeout(pending.timeoutId);
      pendingDeliveries.delete(deliveryId);
      pending.reject(new BrokerError(503, "session_disconnected", reason));
    }
  }

  function handleIpcMessage(socket, message) {
    const currentSessionId = socketSessions.get(socket);

    if (!currentSessionId) {
      const registration = validateRegistration(message);
      const existing = sessions.get(registration.id);
      if (existing && existing.socket !== socket) {
        throw new BrokerError(409, "session_conflict", "Session ID is already registered");
      }
      sessions.set(registration.id, {
        id: registration.id,
        label: registration.label,
        socket,
        connectedAt: Date.now(),
      });
      socketSessions.set(socket, registration.id);
      sendIpc(socket, { type: "registered", sessionId: registration.id });
      return;
    }

    if (!isRecord(message) || message.type !== "ack" || typeof message.deliveryId !== "string") {
      throw new BrokerError(400, "invalid_ipc_message", "Expected an annotation acknowledgement");
    }

    const pending = pendingDeliveries.get(message.deliveryId);
    if (!pending || pending.socket !== socket) return;
    clearTimeout(pending.timeoutId);
    pendingDeliveries.delete(message.deliveryId);
    if (message.ok === true) {
      pending.resolve();
    } else {
      pending.reject(new BrokerError(502, "delivery_rejected", "Annotation session rejected the annotation"));
    }
  }

  const ipcServer = net.createServer((socket) => {
    allSockets.add(socket);
    socket.setEncoding("utf8");
    let buffer = "";

    socket.on("data", (chunk) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > MAX_IPC_LINE_BYTES) {
        sendIpc(socket, { type: "error", code: "ipc_message_too_large" });
        socket.destroy();
        return;
      }

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          handleIpcMessage(socket, JSON.parse(line));
        } catch (error) {
          const code = error instanceof BrokerError ? error.code : "invalid_json";
          sendIpc(socket, { type: "error", code });
          socket.destroy();
          return;
        }
      }
    });
    socket.on("close", () => {
      allSockets.delete(socket);
      removeSocket(socket);
    });
    socket.on("error", () => removeSocket(socket));
  });

  function deliver(sessionId, annotation) {
    const session = sessions.get(sessionId);
    if (!session || session.socket.destroyed || !session.socket.writable) {
      if (session) removeSocket(session.socket);
      return Promise.reject(new BrokerError(404, "session_not_found", "Annotation session is not connected"));
    }

    const deliveryId = randomUUID();
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        pendingDeliveries.delete(deliveryId);
        reject(new BrokerError(504, "delivery_timeout", "Annotation delivery timed out"));
      }, deliveryTimeoutMs);
      pendingDeliveries.set(deliveryId, { socket: session.socket, timeoutId, resolve, reject });

      try {
        sendIpc(session.socket, { type: "annotation", deliveryId, annotation });
      } catch {
        clearTimeout(timeoutId);
        pendingDeliveries.delete(deliveryId);
        reject(new BrokerError(503, "session_disconnected", "Annotation session disconnected"));
      }
    });
  }

  function corsHeaders(request) {
    const origin = request.headers.origin;
    if (!defaultOriginAllowed(origin, configuredOrigins)) {
      throw new BrokerError(403, "origin_not_allowed", "Request origin is not allowed");
    }
    if (!origin) return {};
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      Vary: "Origin",
    };
  }

  const httpServer = http.createServer(async (request, response) => {
    let headers = {};
    try {
      headers = corsHeaders(request);
      if (request.method === "OPTIONS") {
        response.writeHead(204, headers);
        response.end();
        return;
      }

      const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
      if (request.method === "GET" && url.pathname === "/health") {
        writeJson(response, 200, { ok: true, protocolVersion: BROKER_PROTOCOL_VERSION }, headers);
        return;
      }

      if (request.method === "GET" && url.pathname === "/pair") {
        writePairingPage(response);
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/pairings/exchange") {
        if (request.headers.origin !== ANNOTATOR_EXTENSION_ORIGIN) {
          throw new BrokerError(403, "pairing_origin_not_allowed", "Pairing must be completed by Pi Annotate");
        }
        const body = await readJsonBody(request, MAX_PAIRING_BODY_BYTES);
        const token = exchangePairingCode(body.code);
        writeJson(response, 200, { token }, headers);
        return;
      }

      if (!safeEqual(extractBearerToken(request), options.token)) {
        writeJson(response, 401, { error: { code: "unauthorized", message: "Valid bearer token required" } }, {
          ...headers,
          "WWW-Authenticate": "Bearer",
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/pairings") {
        writeJson(response, 201, issuePairingCode(), headers);
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/sessions") {
        const publicSessions = Array.from(sessions.values(), ({ id, label }) => ({ id, label }))
          .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
        writeJson(response, 200, { sessions: publicSessions }, headers);
        return;
      }

      const deliveryMatch = request.method === "POST"
        ? url.pathname.match(/^\/v1\/sessions\/([^/]+)\/annotations$/)
        : null;
      if (deliveryMatch) {
        const sessionId = decodeURIComponent(deliveryMatch[1]);
        const annotation = await readJsonBody(request, maxBodyBytes);
        await deliver(sessionId, annotation);
        writeJson(response, 202, { delivered: true }, headers);
        return;
      }

      writeJson(response, 404, { error: { code: "not_found", message: "Route not found" } }, headers);
    } catch (error) {
      const brokerError = error instanceof BrokerError
        ? error
        : new BrokerError(500, "internal_error", "Broker request failed");
      if (!response.headersSent) {
        writeJson(response, brokerError.status, {
          error: { code: brokerError.code, message: brokerError.message },
        }, headers);
      } else {
        response.destroy();
      }
    }
  });
  httpServer.requestTimeout = 35_000;
  httpServer.headersTimeout = 10_000;

  async function start() {
    if (started) return address();
    fs.mkdirSync(path.dirname(options.socketPath), { recursive: true, mode: 0o700 });
    try {
      fs.rmSync(options.socketPath, { force: true });
    } catch {
      // The listen error below provides the actionable failure.
    }

    await new Promise((resolve, reject) => {
      ipcServer.once("error", reject);
      ipcServer.listen(options.socketPath, () => {
        ipcServer.off("error", reject);
        resolve();
      });
    });
    fs.chmodSync(options.socketPath, 0o600);

    try {
      await new Promise((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(port, host, () => {
          httpServer.off("error", reject);
          resolve();
        });
      });
    } catch (error) {
      await new Promise((resolve) => ipcServer.close(resolve));
      fs.rmSync(options.socketPath, { force: true });
      throw error;
    }
    started = true;
    return address();
  }

  function address() {
    const httpAddress = httpServer.address();
    return {
      host,
      port: typeof httpAddress === "object" && httpAddress ? httpAddress.port : port,
      socketPath: options.socketPath,
    };
  }

  async function close() {
    if (!started) return;
    started = false;
    for (const socket of allSockets) socket.destroy();
    for (const pending of pendingDeliveries.values()) {
      clearTimeout(pending.timeoutId);
      pending.reject(new BrokerError(503, "broker_stopped", "Broker stopped"));
    }
    pendingDeliveries.clear();
    pairingCodes.clear();
    httpServer.closeAllConnections?.();
    await Promise.all([
      new Promise((resolve) => ipcServer.close(resolve)),
      new Promise((resolve) => httpServer.close(resolve)),
    ]);
    fs.rmSync(options.socketPath, { force: true });
  }

  return { start, close, address };
}
