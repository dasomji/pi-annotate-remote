#!/usr/bin/env node

import fs from "node:fs";
import { createBroker } from "./server.js";
import { ensureBrokerToken, ensurePrivateDirectory, getBrokerConfig } from "./config.js";

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function acquireLock(lockPath) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      // One atomic create-and-write: a concurrent reader never sees an empty
      // lock file it would misjudge as stale.
      fs.writeFileSync(lockPath, `${process.pid}\n`, { flag: "wx", mode: 0o600 });
      return true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let ownerPid = 0;
      try {
        ownerPid = Number.parseInt(fs.readFileSync(lockPath, "utf8").trim(), 10);
      } catch {
        // Treat unreadable lock state as stale.
      }
      if (processIsAlive(ownerPid)) return false;
      fs.rmSync(lockPath, { force: true });
    }
  }
  return false;
}

const config = getBrokerConfig();
ensurePrivateDirectory(config.runtimeDir);
if (!acquireLock(config.lockPath)) process.exit(0);

let broker;
let stopping = false;

async function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  try {
    await broker?.close();
  } finally {
    try {
      const ownerPid = Number.parseInt(fs.readFileSync(config.lockPath, "utf8").trim(), 10);
      if (ownerPid === process.pid) fs.rmSync(config.lockPath, { force: true });
    } catch {}
    process.exit(exitCode);
  }
}

try {
  const token = ensureBrokerToken(config.tokenPath);
  broker = createBroker({
    host: config.host,
    port: config.port,
    socketPath: config.socketPath,
    token,
    allowedOrigins: config.allowedOrigins,
  });
  await broker.start();
} catch {
  await stop(1);
}

process.on("SIGINT", () => void stop(0));
process.on("SIGTERM", () => void stop(0));
process.on("uncaughtException", () => void stop(1));
process.on("unhandledRejection", () => void stop(1));
