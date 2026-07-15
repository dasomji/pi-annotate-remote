import { execFile } from "node:child_process";

const COMMAND_TIMEOUT_MS = 15_000;
const MAX_WARNING_LENGTH = 360;

function defaultRunCommand(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      encoding: "utf8",
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function boundedText(value) {
  return String(value || "Unknown Tailscale error")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_WARNING_LENGTH);
}

function boundedWarning(error) {
  const detail = [error?.stderr, error?.message, error?.stdout]
    .find((value) => typeof value === "string" && value.trim());
  return boundedText(detail);
}

function parseJsonOutput(result, label) {
  try {
    const value = JSON.parse(result.stdout || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

function normalizeDnsName(value) {
  return typeof value === "string" ? value.trim().replace(/\.$/, "") : "";
}

function endpointFor(dnsName, port) {
  return `https://${dnsName}${port === 443 ? "" : `:${port}`}`;
}

function routeAt(status, authority) {
  return status?.Web?.[authority]?.Handlers?.["/"]?.Proxy;
}

function portIsConfigured(status, authority, port) {
  if (status?.TCP?.[String(port)]) return true;
  if (status?.Web?.[authority]) return true;
  return Object.keys(status?.Web || {}).some((key) => key.endsWith(`:${port}`));
}

function disabledByEnvironment(env) {
  return ["0", "false", "off", "no"].includes(
    String(env.PI_ANNOTATE_TAILSCALE || "").trim().toLowerCase(),
  );
}

/**
 * Idempotently exposes the local annotation broker through Tailscale Serve.
 * Existing routes are reused, while unrelated routes on the selected port are
 * never overwritten.
 */
export async function ensureTailscaleServe({
  host,
  port,
  env = process.env,
  runCommand = defaultRunCommand,
}) {
  const localEndpoint = `http://${host}:${port}`;
  const unavailable = (warning) => ({
    endpoint: null,
    localEndpoint,
    active: false,
    warning: boundedText(warning),
  });

  if (disabledByEnvironment(env)) {
    return unavailable("Automatic Tailscale Serve setup is disabled by PI_ANNOTATE_TAILSCALE");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return unavailable("Automatic Tailscale Serve setup requires a fixed broker port between 1 and 65535");
  }

  try {
    const nodeStatus = parseJsonOutput(
      await runCommand("tailscale", ["status", "--json"]),
      "tailscale status",
    );
    const dnsName = normalizeDnsName(nodeStatus?.Self?.DNSName);
    if (nodeStatus.BackendState !== "Running" || !dnsName) {
      return unavailable("Tailscale is not connected or has no MagicDNS name");
    }

    const authority = `${dnsName}:${port}`;
    const endpoint = endpointFor(dnsName, port);
    let serveStatus = parseJsonOutput(
      await runCommand("tailscale", ["serve", "status", "--json"]),
      "tailscale serve status",
    );
    const existingProxy = routeAt(serveStatus, authority);

    if (serveStatus?.AllowFunnel?.[authority] === true) {
      return unavailable(`Tailscale port ${port} has Funnel enabled; disable Funnel before using it for Pi Annotate`);
    }
    if (existingProxy === localEndpoint) {
      return { endpoint, localEndpoint, active: true };
    }
    if (existingProxy) {
      return unavailable(`Tailscale HTTPS port ${port} already routes to ${existingProxy}`);
    }
    if (portIsConfigured(serveStatus, authority, port)) {
      return unavailable(`Tailscale port ${port} already has a different Serve or Funnel configuration`);
    }

    await runCommand("tailscale", [
      "serve",
      "--bg",
      "--yes",
      `--https=${port}`,
      localEndpoint,
    ]);

    serveStatus = parseJsonOutput(
      await runCommand("tailscale", ["serve", "status", "--json"]),
      "tailscale serve status",
    );
    const configuredProxy = routeAt(serveStatus, authority);
    if (serveStatus?.AllowFunnel?.[authority] === true) {
      return unavailable(`Tailscale port ${port} has Funnel enabled; disable Funnel before using it for Pi Annotate`);
    }
    if (configuredProxy !== localEndpoint) {
      return unavailable(`Tailscale Serve did not publish ${localEndpoint} on HTTPS port ${port}`);
    }

    return { endpoint, localEndpoint, active: true };
  } catch (error) {
    return unavailable(boundedWarning(error));
  }
}
