import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { AnnotationSessionClient, ensureBrokerRunning } from "./broker/client.js";
import { getBrokerConfig } from "./broker/config.js";
import { createPairingLink } from "./broker/pairing.js";
import { ensureTailscaleServe } from "./broker/tailscale.js";
import { isAnnotationResult } from "./annotation/validate.ts";
import { formatAnnotationResult } from "./annotation/format.ts";

export { isAnnotationResult, formatAnnotationResult };

type AnnotationContext = {
  hasUI?: boolean;
  ui?: {
    notify?: (message: string, level: "info" | "error") => void;
    setStatus?: (source: string, message: string) => void;
  };
};

export function sendAnnotationToPi(
  pi: Pick<ExtensionAPI, "sendUserMessage">,
  content: string,
): void {
  // `followUp` is processed immediately while idle and queued after all current
  // tools and automatic continuations while busy. Passing it unconditionally
  // also closes the race between checking isIdle() and sending the message.
  pi.sendUserMessage(content, { deliverAs: "followUp" });
}

type TailscaleServeInfo = {
  endpoint: string | null;
  localEndpoint: string;
  active: boolean;
  warning?: string;
};

export function formatSetupInstructions({
  sessionLabel,
  token,
  serve,
  pairingLink,
  pairingWarning,
}: {
  sessionLabel: string;
  token: string;
  serve: TailscaleServeInfo;
  pairingLink?: string;
  pairingWarning?: string;
}): string {
  const lines = [
    `Annotation session available as ${sessionLabel}`,
    "",
  ];

  if (pairingLink) {
    lines.push(
      "Pairing link (expires in 5 minutes):",
      pairingLink,
      "",
      "Manual fallback:",
    );
  } else {
    lines.push("Configure the browser extension manually:");
  }
  lines.push(
    `Endpoint: ${serve.endpoint || serve.localEndpoint}`,
    `Token: ${token}`,
  );
  if (pairingWarning) lines.push(`Pairing link warning: ${pairingWarning}`);

  if (serve.active && serve.endpoint) {
    lines.push("", `Tailscale Serve: active (${serve.endpoint} → ${serve.localEndpoint})`);
  } else {
    lines.push(
      "",
      `Local broker: ${serve.localEndpoint}`,
      `Tailscale Serve warning: ${serve.warning || "automatic setup failed"}`,
      "Run `/annotate setup` to retry automatic setup.",
    );
  }

  return lines.join("\n");
}

export async function createSetupInstructions({
  sessionLabel,
  token,
  serve,
  createLink = createPairingLink,
}: {
  sessionLabel: string;
  token: string;
  serve: TailscaleServeInfo;
  createLink?: typeof createPairingLink;
}): Promise<string> {
  let pairingLink: string | undefined;
  let pairingWarning: string | undefined;
  try {
    pairingLink = await createLink({
      localEndpoint: serve.localEndpoint,
      publicEndpoint: serve.endpoint || serve.localEndpoint,
      token,
    });
  } catch (error) {
    pairingWarning = (error instanceof Error ? error.message : String(error))
      .replace(/[\r\n\t]+/g, " ")
      .slice(0, 300);
  }
  return formatSetupInstructions({ sessionLabel, token, serve, pairingLink, pairingWarning });
}

function gitBranch(cwd: string): string {
  try {
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1500,
    }).trim();
    if (branch && branch !== "HEAD") return branch;
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1500,
    }).trim() || "detached";
  } catch {
    return "no-branch";
  }
}

export function createSessionBaseLabel(cwd = process.cwd()): string {
  const project = path.basename(cwd) || "project";
  const label = `${project} (${gitBranch(cwd)})`.replace(/[\u0000-\u001f\u007f]/g, " ");
  return label.slice(0, 200);
}

export function registerPiAnnotate(pi: ExtensionAPI, {
  config = getBrokerConfig(),
  ensureBroker = ensureBrokerRunning,
  ensureServe = ensureTailscaleServe,
  formatAnnotation = formatAnnotationResult,
} = {}) {
  const brokerConfig = config;
  const daemonPath = fileURLToPath(new URL("./broker/daemon.js", import.meta.url));
  const sessionId = randomUUID();
  const sessionBaseLabel = createSessionBaseLabel();
  let annotationClient: AnnotationSessionClient | null = null;
  let brokerToken: string | null = null;
  let currentCtx: AnnotationContext | null = null;
  let setupShown = false;
  let serveInfo: TailscaleServeInfo | null = null;
  let active = true;

  function setStatus(message: string) {
    if (!active) return;
    currentCtx?.ui?.setStatus?.("pi-annotate", message);
  }

  function currentSessionLabel(): string {
    return annotationClient?.label || sessionBaseLabel;
  }

  async function enableAnnotationSession(
    ctx: AnnotationContext,
    { refreshServe = false } = {},
  ): Promise<{ token: string; serve: TailscaleServeInfo; sessionLabel: string }> {
    if (!active) throw new Error("Annotation session is shutting down");
    currentCtx = ctx;
    if (!annotationClient) {
      annotationClient = new AnnotationSessionClient({
        sessionId,
        baseLabel: sessionBaseLabel,
        socketPath: brokerConfig.socketPath,
        ensureBroker: async () => {
          const token = await ensureBroker({ config: brokerConfig, daemonPath });
          if (active) brokerToken = token;
          return token;
        },
        onStatus: setStatus,
        onAnnotation: async (value: unknown) => {
          if (!active) return;
          if (!isAnnotationResult(value)) throw new Error("Annotation payload is invalid");
          const text = await formatAnnotation(value);
          if (!active) return;
          sendAnnotationToPi(pi, text);
        },
      });
    }
    await annotationClient.enable();
    if (!active) throw new Error("Annotation session was shut down while starting");
    if (!brokerToken) {
      brokerToken = await ensureBroker({ config: brokerConfig, daemonPath });
      if (!active) throw new Error("Annotation session was shut down while starting");
    }
    if (refreshServe || !serveInfo?.active) {
      serveInfo = await ensureServe({
        host: brokerConfig.host,
        port: brokerConfig.port,
      });
      if (!active) throw new Error("Annotation session was shut down while starting");
    }
    return { token: brokerToken, serve: serveInfo, sessionLabel: currentSessionLabel() };
  }

  async function annotateHandler(args: string, ctx: AnnotationContext) {
    currentCtx = ctx;
    const action = args.trim().toLowerCase();

    if (action === "off") {
      annotationClient?.disable();
      ctx.ui?.notify?.(`Annotation session disabled: ${currentSessionLabel()}`, "info");
      return;
    }

    if (action === "status") {
      const state = annotationClient?.registered ? "available" : "unavailable";
      const endpoint = serveInfo?.endpoint ? `\nEndpoint: ${serveInfo.endpoint}` : "";
      ctx.ui?.notify?.(`Annotation session is ${state}: ${currentSessionLabel()}${endpoint}`, "info");
      return;
    }

    if (action && !["on", "setup"].includes(action)) {
      ctx.ui?.notify?.("Usage: /annotate [on|off|status|setup]", "error");
      return;
    }

    try {
      const enabled = await enableAnnotationSession(ctx, { refreshServe: action === "setup" });
      const instructions = await createSetupInstructions({
        sessionLabel: enabled.sessionLabel,
        token: enabled.token,
        serve: enabled.serve,
      });
      if (!active) return;
      ctx.ui?.notify?.(instructions, "info");
      setupShown = true;
    } catch (error) {
      if (!active) return;
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui?.notify?.(`Could not start annotation broker: ${message}`, "error");
    }
  }

  pi.registerCommand("annotate", {
    description: "Make this Pi session available for browser annotations. Use off, status, or setup as needed.",
    handler: annotateHandler,
  });

  // ─────────────────────────────────────────────────────────────────────
  // Tool Registration and Cleanup
  // ─────────────────────────────────────────────────────────────────────

  pi.registerTool({
    name: "annotate",
    label: "Annotate",
    description:
      "Make this Pi session available to receive visual browser annotations. " +
      "Use only when the user explicitly asks to annotate, visually point something out, or show UI issues. " +
      "The user selects this session in the Pi Annotate Session chooser and submits the annotation there.",
    promptSnippet:
      "Use only when the user explicitly asks for visual annotation or UI pointing. The tool makes this session available in the Session chooser.",
    parameters: Type.Object({}, { additionalProperties: false }),

    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      currentCtx = ctx;
      try {
        const enabled = await enableAnnotationSession(ctx);
        if (!setupShown && ctx.hasUI) {
          const instructions = await createSetupInstructions({
            sessionLabel: enabled.sessionLabel,
            token: enabled.token,
            serve: enabled.serve,
          });
          if (!active) throw new Error("Annotation session was shut down while starting");
          ctx.ui.notify(instructions, "info");
          setupShown = true;
        }
        const endpointText = enabled.serve.endpoint
          ? ` at ${enabled.serve.endpoint}`
          : ` locally; Tailscale Serve setup needs attention (${enabled.serve.warning || "unknown error"})`;
        return {
          content: [{
            type: "text",
            text: `Annotation session is available as ${enabled.sessionLabel}${endpointText}. Select it in the Pi Annotate Session chooser and submit the annotation.`,
          }],
          details: {
            sessionId,
            label: enabled.sessionLabel,
            endpoint: enabled.serve.endpoint,
            localEndpoint: enabled.serve.localEndpoint,
            tailscaleWarning: enabled.serve.warning,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: "text",
            text: active
              ? `Could not start annotation broker: ${message}`
              : "Annotation session shut down before setup completed.",
          }],
          details: { error: message },
        };
      }
    },
  });

  pi.on("session_shutdown", async () => {
    active = false;
    currentCtx = null;
    const client = annotationClient;
    annotationClient = null;
    client?.disable();
  });
}

export default function (pi: ExtensionAPI) {
  registerPiAnnotate(pi);
}
