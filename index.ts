import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import { AnnotationSessionClient, ensureBrokerRunning } from "./broker/client.js";
import { getBrokerConfig } from "./broker/config.js";
import { createPairingLink } from "./broker/pairing.js";
import { ensureTailscaleServe } from "./broker/tailscale.js";
import type { AnnotationResult, ElementSelection, EditCapture } from "./types.js";

const MAX_SCREENSHOT_BYTES = 15 * 1024 * 1024;

type AnnotationContext = {
  hasUI?: boolean;
  isIdle?: () => boolean;
  ui?: {
    notify?: (message: string, level: "info" | "error") => void;
    setStatus?: (source: string, message: string) => void;
  };
};

export function sendAnnotationToPi(
  pi: Pick<ExtensionAPI, "sendUserMessage">,
  content: string,
  ctx: Pick<AnnotationContext, "isIdle">,
): "queued" | "delivered" {
  const disposition = ctx.isIdle?.() === false ? "queued" : "delivered";
  // `followUp` is processed immediately while idle and queued after all current
  // tools and automatic continuations while busy. Passing it unconditionally
  // also closes the race between checking isIdle() and sending the message.
  pi.sendUserMessage(content, { deliverAs: "followUp" });
  return disposition;
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
    `Endpoint: ${serve.endpoint || "unavailable"}`,
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
  if (serve.active && serve.endpoint) {
    try {
      pairingLink = await createLink({
        localEndpoint: serve.localEndpoint,
        publicEndpoint: serve.endpoint,
        token,
      });
    } catch (error) {
      pairingWarning = (error instanceof Error ? error.message : String(error))
        .replace(/[\r\n\t]+/g, " ")
        .slice(0, 300);
    }
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

function createSessionLabel(cwd = process.cwd()): string {
  const project = path.basename(cwd) || "project";
  const label = `${project} (${gitBranch(cwd)})`.replace(/[\u0000-\u001f\u007f]/g, " ");
  return label.slice(0, 200);
}

export default function (pi: ExtensionAPI) {
  const brokerConfig = getBrokerConfig();
  const daemonPath = fileURLToPath(new URL("./broker/daemon.js", import.meta.url));
  const sessionId = randomUUID();
  const sessionLabel = createSessionLabel();
  let annotationClient: AnnotationSessionClient | null = null;
  let brokerToken: string | null = null;
  let currentCtx: AnnotationContext | null = null;
  let setupShown = false;
  let serveInfo: TailscaleServeInfo | null = null;

  function setStatus(message: string) {
    currentCtx?.ui?.setStatus?.("pi-annotate", message);
  }

  async function enableAnnotationSession(
    ctx: AnnotationContext,
    { refreshServe = false } = {},
  ): Promise<{ token: string; serve: TailscaleServeInfo }> {
    currentCtx = ctx;
    if (!annotationClient) {
      annotationClient = new AnnotationSessionClient({
        sessionId,
        label: sessionLabel,
        socketPath: brokerConfig.socketPath,
        ensureBroker: async () => {
          brokerToken = await ensureBrokerRunning({ config: brokerConfig, daemonPath });
          return brokerToken;
        },
        onStatus: setStatus,
        onAnnotation: async (value: unknown) => {
          if (!isAnnotationResult(value)) throw new Error("Annotation payload is invalid");
          const text = await formatResult(value);
          const disposition = sendAnnotationToPi(pi, text, currentCtx || {});
          setStatus(disposition === "queued" ? "Annotation queued as follow-up" : "Annotation delivered");
        },
      });
    }
    await annotationClient.enable();
    if (!brokerToken) {
      brokerToken = await ensureBrokerRunning({ config: brokerConfig, daemonPath });
    }
    if (refreshServe || !serveInfo?.active) {
      serveInfo = await ensureTailscaleServe({
        host: brokerConfig.host,
        port: brokerConfig.port,
      });
    }
    return { token: brokerToken, serve: serveInfo };
  }

  async function annotateHandler(args: string, ctx: AnnotationContext) {
    currentCtx = ctx;
    const action = args.trim().toLowerCase();

    if (action === "off") {
      annotationClient?.disable();
      ctx.ui?.notify?.(`Annotation session disabled: ${sessionLabel}`, "info");
      return;
    }

    if (action === "status") {
      const state = annotationClient?.registered ? "available" : "unavailable";
      const endpoint = serveInfo?.endpoint ? `\nEndpoint: ${serveInfo.endpoint}` : "";
      ctx.ui?.notify?.(`Annotation session is ${state}: ${sessionLabel}${endpoint}`, "info");
      return;
    }

    if (action && !["on", "setup"].includes(action)) {
      ctx.ui?.notify?.("Usage: /annotate [on|off|status|setup]", "error");
      return;
    }

    try {
      const enabled = await enableAnnotationSession(ctx, { refreshServe: action === "setup" });
      ctx.ui?.notify?.(await createSetupInstructions({
        sessionLabel,
        token: enabled.token,
        serve: enabled.serve,
      }), "info");
      setupShown = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui?.notify?.(`Could not start annotation broker: ${message}`, "error");
    }
  }

  pi.registerCommand("annotate", {
    description: "Make this Pi session available for browser annotations. Use off, status, or setup as needed.",
    handler: annotateHandler,
  });

  function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function isAnnotationResult(value: unknown): value is AnnotationResult {
    return isRecord(value) && typeof value.success === "boolean";
  }

  // ─────────────────────────────────────────────────────────────────────
  // Format Result
  // ─────────────────────────────────────────────────────────────────────

  function formatEditCapture(capture: EditCapture): string {
    let output = "";

    if (capture.warnings?.length) {
      for (const w of capture.warnings) {
        output += `> **Note:** ${w}\n`;
      }
      output += "\n";
    }

    // Inline style changes
    if (capture.inlineStyles.length > 0) {
      output += `### Inline Style Changes\n\n`;
      for (const change of capture.inlineStyles) {
        output += `**\`${change.selector}\`**\n`;
        for (const c of change.changed) {
          output += `- \`${c.property}\`: \`${c.from}\` → \`${c.to}\`\n`;
        }
        for (const [prop, value] of Object.entries(change.added)) {
          output += `- \`${prop}\`: added \`${value}\`\n`;
        }
        for (const prop of change.removed) {
          output += `- \`${prop}\`: removed\n`;
        }
        output += "\n";
      }
    }

    // Stylesheet rule changes
    if (capture.rules.length > 0) {
      output += `### CSS Rule Changes\n\n`;
      for (const change of capture.rules) {
        output += `**\`${change.ruleSelector}\`** (${change.sheet})\n`;
        for (const c of change.changed) {
          output += `- \`${c.property}\`: \`${c.from}\` → \`${c.to}\`\n`;
        }
        for (const [prop, value] of Object.entries(change.added)) {
          output += `- \`${prop}\`: added \`${value}\`\n`;
        }
        for (const prop of change.removed) {
          output += `- \`${prop}\`: removed\n`;
        }
        output += "\n";
      }
    }

    // DOM changes
    if (capture.dom.length > 0) {
      output += `### DOM Changes\n\n`;
      for (const change of capture.dom) {
        output += `- **\`${change.selector}\`** — ${change.detail}\n`;
      }
      output += "\n";
    }

    return output;
  }
  
  async function formatResult(result: AnnotationResult): Promise<string> {
    if (!result.success) {
      if (result.cancelled) {
        if (result.reason?.includes("Another terminal")) {
          return `Annotation session ended: ${result.reason}`;
        }
        if (result.reason && result.reason !== "user") {
          return `Annotation cancelled: ${result.reason}`;
        }
        return "Annotation cancelled by user.";
      }
      return `Annotation failed: ${result.reason || "Unknown error"}`;
    }
    
    let output = `## Page Annotation: ${result.url || "Unknown"}\n`;
    if (result.viewport) {
      output += `**Viewport:** ${result.viewport.width}×${result.viewport.height}\n\n`;
    }
    
    // Show overall context if provided (uses existing 'prompt' field for backwards compat)
    if (result.prompt) {
      output += `**Context:** ${result.prompt}\n\n`;
    }
    
    // Check if any element has debug data (to show header)
    const hasDebugData = result.elements?.some(el => el.computedStyles || el.parentContext || el.cssVariables);
    if (hasDebugData) {
      output += `**Debug Mode:** Enabled\n\n`;
    }
    
    if (result.elements && result.elements.length > 0) {
      output += `### Selected Elements (${result.elements.length})\n\n`;
      result.elements.forEach((el: ElementSelection, i: number) => {
        output += `${i + 1}. **${el.tag}**\n`;
        output += `   - Selector: \`${el.selector}\`\n`;
        if (el.id) output += `   - ID: \`${el.id}\`\n`;
        if (el.classes?.length) output += `   - Classes: \`${el.classes.join(", ")}\`\n`;
        if (el.text) {
          output += `   - Text: "${el.text}"\n`;
        }
        
        // Box model (v0.3.0) - compact format
        if (el.boxModel) {
          const bm = el.boxModel;
          const padStr = `${bm.padding.top} ${bm.padding.right} ${bm.padding.bottom} ${bm.padding.left}`;
          const borderStr = bm.border.top || bm.border.right || bm.border.bottom || bm.border.left
            ? `${bm.border.top} ${bm.border.right} ${bm.border.bottom} ${bm.border.left}` : "0";
          const marginStr = `${bm.margin.top} ${bm.margin.right} ${bm.margin.bottom} ${bm.margin.left}`;
          output += `   - **Box Model:** ${el.rect.width}×${el.rect.height} (content: ${bm.content.width}×${bm.content.height}, padding: ${padStr}, border: ${borderStr}, margin: ${marginStr})\n`;
        } else {
          output += `   - Size: ${el.rect.width}×${el.rect.height}px\n`;
        }
        
        // Attributes (v0.3.0) - fix: was captured but never output
        if (el.attributes && Object.keys(el.attributes).length > 0) {
          const attrStr = Object.entries(el.attributes)
            .map(([k, v]) => `${k}="${v}"`)
            .join(", ");
          output += `   - **Attributes:** ${attrStr}\n`;
        }
        
        // Accessibility (v0.3.0) - compact format, omit undefined booleans
        if (el.accessibility) {
          const a11y = el.accessibility;
          const parts: string[] = [];
          if (a11y.role) parts.push(`role=${a11y.role}`);
          if (a11y.name) parts.push(`name="${a11y.name}"`);
          parts.push(`focusable=${a11y.focusable}`);
          parts.push(`disabled=${a11y.disabled}`);
          if (a11y.expanded !== undefined) parts.push(`expanded=${a11y.expanded}`);
          if (a11y.pressed !== undefined) parts.push(`pressed=${a11y.pressed}`);
          if (a11y.checked !== undefined) parts.push(`checked=${a11y.checked}`);
          if (a11y.selected !== undefined) parts.push(`selected=${a11y.selected}`);
          if (a11y.description) parts.push(`description="${a11y.description}"`);
          output += `   - **Accessibility:** ${parts.join(", ")}\n`;
        }
        
        // Key styles - compact format (suppressed when full computedStyles is present)
        const hasComputedStyles = el.computedStyles && Object.keys(el.computedStyles).length > 0;
        if (!hasComputedStyles && el.keyStyles && Object.keys(el.keyStyles).length > 0) {
          const styleStr = Object.entries(el.keyStyles).map(([k, v]) => `${k}: ${v}`).join(", ");
          output += `   - **Styles:** ${styleStr}\n`;
        }
        
        // Comment
        if (el.comment) {
          output += `   - **Comment:** ${el.comment}\n`;
        }
        
        // Debug mode data (v0.3.0) - verbose format
        if (el.computedStyles && Object.keys(el.computedStyles).length > 0) {
          output += `   - **Computed Styles:**\n`;
          for (const [key, value] of Object.entries(el.computedStyles)) {
            output += `     - ${key}: ${value}\n`;
          }
        }
        
        if (el.parentContext) {
          const pc = el.parentContext;
          const pcLabel = pc.id ? `${pc.tag}#${pc.id}` : `${pc.tag}${pc.classes[0] ? "." + pc.classes[0] : ""}`;
          const pcStyles = Object.entries(pc.styles).map(([k, v]) => `${k}: ${v}`).join(", ");
          output += `   - **Parent Context:** ${pcLabel} (${pcStyles})\n`;
        }
        
        if (el.cssVariables && Object.keys(el.cssVariables).length > 0) {
          output += `   - **CSS Variables:**\n`;
          for (const [name, value] of Object.entries(el.cssVariables)) {
            output += `     - ${name}: ${value}\n`;
          }
        }
        
        output += `\n`;
      });
    } else {
      output += "*No elements selected*\n\n";
    }
    
    // Handle screenshots
    const timestamp = Date.now();
    
    if (result.screenshot) {
      // Visible viewport screenshot
      try {
        if (!result.screenshot.startsWith("data:image/")) throw new Error("Invalid screenshot data");
        const screenshotPath = path.join(os.tmpdir(), `pi-annotate-${timestamp}-full.png`);
        const base64Data = result.screenshot.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, "base64");
        if (buffer.length > MAX_SCREENSHOT_BYTES) throw new Error("Screenshot too large");
        await fs.promises.writeFile(screenshotPath, buffer);
        output += `**Screenshot (visible viewport):** ${screenshotPath}\n`;
      } catch (err) {
        output += `*Screenshot capture failed: ${err}*\n`;
      }
    }
    
    if (result.screenshots && result.screenshots.length > 0) {
      // Individual element screenshots
      output += `### Screenshots\n\n`;
      for (let i = 0; i < result.screenshots.length; i++) {
        const shot = result.screenshots[i];
        try {
          if (!shot?.dataUrl?.startsWith("data:image/")) throw new Error("Invalid screenshot data");
          const safeIndex = Number.isFinite(shot.index) ? Math.max(1, Math.floor(shot.index)) : i + 1;
          const screenshotPath = path.join(os.tmpdir(), `pi-annotate-${timestamp}-el${safeIndex}.png`);
          const base64Data = shot.dataUrl.replace(/^data:image\/\w+;base64,/, "");
          const buffer = Buffer.from(base64Data, "base64");
          if (buffer.length > MAX_SCREENSHOT_BYTES) throw new Error("Screenshot too large");
          await fs.promises.writeFile(screenshotPath, buffer);
          output += `- Element ${safeIndex}: ${screenshotPath}\n`;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          output += `- Element ${shot?.index ?? i + 1}: *capture failed (${message})*\n`;
        }
      }
      output += "\n";
    }

    if (result.editCapture && result.editCapture.changeCount > 0) {
      const ec = result.editCapture;
      output += `## Edit Capture (${ec.changeCount} changes, ${Math.round(ec.duration / 1000)}s)\n\n`;
      output += formatEditCapture(ec);

      // Before/after screenshots
      if (ec.beforeScreenshot || ec.afterScreenshot) {
        output += `### Before/After Screenshots\n\n`;
        if (ec.beforeScreenshot) {
          try {
            const p = path.join(os.tmpdir(), `pi-annotate-${timestamp}-before.png`);
            const buf = Buffer.from(ec.beforeScreenshot.replace(/^data:image\/\w+;base64,/, ""), "base64");
            if (buf.length > MAX_SCREENSHOT_BYTES) throw new Error("Screenshot too large");
            await fs.promises.writeFile(p, buf);
            output += `- Before: ${p}\n`;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            output += `- Before: *capture failed (${message})*\n`;
          }
        }
        if (ec.afterScreenshot) {
          try {
            const p = path.join(os.tmpdir(), `pi-annotate-${timestamp}-after.png`);
            const buf = Buffer.from(ec.afterScreenshot.replace(/^data:image\/\w+;base64,/, ""), "base64");
            if (buf.length > MAX_SCREENSHOT_BYTES) throw new Error("Screenshot too large");
            await fs.promises.writeFile(p, buf);
            output += `- After: ${p}\n`;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            output += `- After: *capture failed (${message})*\n`;
          }
        }
        output += "\n";
      }
    }
    
    return output;
  }
  
  // ─────────────────────────────────────────────────────────────────────
  // Tool Registration and Cleanup
  // ─────────────────────────────────────────────────────────────────────

  pi.registerTool({
    name: "annotate",
    label: "Annotate",
    description:
      "Make this Pi session available to receive visual browser annotations. " +
      "Use only when the user explicitly asks to annotate, visually point something out, or show UI issues. " +
      "The user selects this session in the Pi Annotate browser popup and submits the annotation there.",
    promptSnippet:
      "Use only when the user explicitly asks for visual annotation or UI pointing. The tool makes this session available in the browser popup.",
    parameters: Type.Object({}, { additionalProperties: false }),

    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      currentCtx = ctx;
      try {
        const enabled = await enableAnnotationSession(ctx);
        if (!setupShown && ctx.hasUI) {
          ctx.ui.notify(await createSetupInstructions({
            sessionLabel,
            token: enabled.token,
            serve: enabled.serve,
          }), "info");
          setupShown = true;
        }
        const endpointText = enabled.serve.endpoint
          ? ` at ${enabled.serve.endpoint}`
          : ` locally; Tailscale Serve setup needs attention (${enabled.serve.warning || "unknown error"})`;
        return {
          content: [{
            type: "text",
            text: `Annotation session is available as ${sessionLabel}${endpointText}. Select it in the Pi Annotate browser popup and submit the annotation.`,
          }],
          details: {
            sessionId,
            label: sessionLabel,
            endpoint: enabled.serve.endpoint,
            localEndpoint: enabled.serve.localEndpoint,
            tailscaleWarning: enabled.serve.warning,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Could not start annotation broker: ${message}` }],
          details: { error: message },
        };
      }
    },
  });

  pi.on("session_shutdown", async () => {
    annotationClient?.disable();
    annotationClient = null;
  });
}
