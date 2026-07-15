import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DIRECTORY_MODE = 0o700;
const TOKEN_MODE = 0o600;

function userRuntimeRoot(env = process.env) {
  if (env.PI_ANNOTATE_RUNTIME_DIR) return env.PI_ANNOTATE_RUNTIME_DIR;
  if (env.XDG_RUNTIME_DIR) return path.join(env.XDG_RUNTIME_DIR, "pi-annotate");
  const uid = typeof process.getuid === "function" ? process.getuid() : "user";
  return path.join(os.tmpdir(), `pi-annotate-${uid}`);
}

function userStateRoot(env = process.env) {
  if (env.PI_ANNOTATE_STATE_DIR) return env.PI_ANNOTATE_STATE_DIR;
  const base = env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
  return path.join(base, "pi-annotate");
}

export function getBrokerConfig(env = process.env) {
  const runtimeDir = userRuntimeRoot(env);
  const stateDir = userStateRoot(env);
  const parsedPort = Number.parseInt(env.PI_ANNOTATE_PORT || "32179", 10);

  if (!Number.isInteger(parsedPort) || parsedPort < 0 || parsedPort > 65535) {
    throw new Error("PI_ANNOTATE_PORT must be an integer between 0 and 65535");
  }

  return {
    host: "127.0.0.1",
    port: parsedPort,
    runtimeDir,
    stateDir,
    socketPath: env.PI_ANNOTATE_SOCKET || path.join(runtimeDir, "broker.sock"),
    lockPath: path.join(runtimeDir, "broker.lock"),
    tokenPath: env.PI_ANNOTATE_TOKEN_FILE || path.join(stateDir, "broker-token"),
    allowedOrigins: (env.PI_ANNOTATE_ALLOWED_ORIGINS || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  };
}

export function ensurePrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: DIRECTORY_MODE });
  try {
    fs.chmodSync(directory, DIRECTORY_MODE);
  } catch {
    // Existing platform-managed XDG directories may reject chmod.
  }
}

export function ensureBrokerToken(tokenPath) {
  ensurePrivateDirectory(path.dirname(tokenPath));

  try {
    const existing = fs.readFileSync(tokenPath, "utf8").trim();
    if (existing.length >= 32) {
      try {
        fs.chmodSync(tokenPath, TOKEN_MODE);
      } catch {
        // Validation below still rejects empty or malformed state.
      }
      return existing;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const token = randomBytes(32).toString("hex");
  const temporaryPath = `${tokenPath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temporaryPath, `${token}\n`, { mode: TOKEN_MODE, flag: "wx" });
  fs.renameSync(temporaryPath, tokenPath);
  fs.chmodSync(tokenPath, TOKEN_MODE);
  return token;
}
