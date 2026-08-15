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
import type {
  AnnotationResult,
  AnnotationResultV1,
  AnnotationResultV2,
  ElementSelection,
  EditCapture,
  ImageCaptureResult,
} from "./types.js";

const MAX_SCREENSHOT_BYTES = 15 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isStringRecord(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every(item => typeof item === "string");
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isViewport(value: unknown): boolean {
  return isRecord(value)
    && isFiniteNumber(value.width) && value.width > 0
    && isFiniteNumber(value.height) && value.height > 0;
}

function isRect(value: unknown): boolean {
  return isRecord(value)
    && isFiniteNumber(value.x)
    && isFiniteNumber(value.y)
    && isFiniteNumber(value.width)
    && isFiniteNumber(value.height);
}

function isBoxEdges(value: unknown): boolean {
  return isRecord(value)
    && ["top", "right", "bottom", "left"].every(key => isFiniteNumber(value[key]));
}

function isBoxModel(value: unknown): boolean {
  return isRecord(value)
    && isRecord(value.content)
    && isFiniteNumber(value.content.width)
    && isFiniteNumber(value.content.height)
    && isBoxEdges(value.padding)
    && isBoxEdges(value.border)
    && isBoxEdges(value.margin);
}

function isAccessibility(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!(value.role === null || typeof value.role === "string")) return false;
  if (!(value.name === null || typeof value.name === "string")) return false;
  if (!(value.description === null || typeof value.description === "string")) return false;
  if (typeof value.focusable !== "boolean" || typeof value.disabled !== "boolean") return false;
  return ["expanded", "pressed", "checked", "selected"]
    .every(key => value[key] === undefined || typeof value[key] === "boolean");
}

function isParentContext(value: unknown): boolean {
  return isRecord(value)
    && typeof value.tag === "string"
    && isOptionalString(value.id)
    && Array.isArray(value.classes)
    && value.classes.every(item => typeof item === "string")
    && isStringRecord(value.styles);
}

function isElementMetadata(value: unknown, requireCompleteEvidence = false): boolean {
  if (!isRecord(value)
    || typeof value.selector !== "string"
    || typeof value.tag !== "string"
    || !(value.id === null || typeof value.id === "string")
    || !Array.isArray(value.classes)
    || !value.classes.every(item => typeof item === "string")
    || typeof value.text !== "string"
    || !isRect(value.rect)
    || !isStringRecord(value.attributes)) {
    return false;
  }
  return (!requireCompleteEvidence || value.boxModel !== undefined)
    && (!requireCompleteEvidence || value.accessibility !== undefined)
    && (!requireCompleteEvidence || value.keyStyles !== undefined)
    && (value.boxModel === undefined || isBoxModel(value.boxModel))
    && (value.accessibility === undefined || isAccessibility(value.accessibility))
    && (value.keyStyles === undefined || isStringRecord(value.keyStyles))
    && (value.computedStyles === undefined || isStringRecord(value.computedStyles))
    && (value.parentContext === undefined || isParentContext(value.parentContext))
    && (value.cssVariables === undefined || isStringRecord(value.cssVariables));
}

function isElementSelection(value: unknown): boolean {
  return isElementMetadata(value)
    && isRecord(value)
    && isOptionalString(value.comment);
}

function isStyleChange(value: unknown): boolean {
  return isRecord(value)
    && typeof value.property === "string"
    && typeof value.from === "string"
    && typeof value.to === "string";
}

function isEditCapture(value: unknown): value is EditCapture {
  if (!isRecord(value)
    || !Array.isArray(value.inlineStyles)
    || !Array.isArray(value.rules)
    || !Array.isArray(value.dom)
    || !isFiniteNumber(value.duration)
    || !Number.isInteger(value.changeCount)
    || value.changeCount < 0
    || !isOptionalString(value.beforeScreenshot)
    || !isOptionalString(value.afterScreenshot)
    || !(value.warnings === undefined
      || (Array.isArray(value.warnings) && value.warnings.every(item => typeof item === "string")))) {
    return false;
  }
  const changesAreValid = (item: unknown, selectorKey: "selector" | "ruleSelector") =>
    isRecord(item)
    && typeof item[selectorKey] === "string"
    && isStringRecord(item.added)
    && Array.isArray(item.changed)
    && item.changed.every(isStyleChange)
    && Array.isArray(item.removed)
    && item.removed.every(prop => typeof prop === "string");
  return value.inlineStyles.every(item => changesAreValid(item, "selector"))
    && value.rules.every(item => changesAreValid(item, "ruleSelector")
      && isRecord(item) && typeof item.sheet === "string")
    && value.dom.every(item => isRecord(item)
      && ["text", "attribute", "added", "removed", "structural"].includes(String(item.type))
      && typeof item.selector === "string"
      && typeof item.detail === "string");
}

function isPngDataUrl(value: unknown): value is string {
  if (typeof value !== "string" || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return false;
  }
  try {
    const bytes = Buffer.from(value.slice("data:image/png;base64,".length), "base64");
    if (bytes.length > MAX_SCREENSHOT_BYTES
      || bytes.length < 20
      || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      return false;
    }
    let offset = 8;
    let chunkIndex = 0;
    let hasImageData = false;
    while (offset + 12 <= bytes.length) {
      const dataLength = bytes.readUInt32BE(offset);
      const chunkEnd = offset + 12 + dataLength;
      if (chunkEnd > bytes.length) return false;
      const chunkType = bytes.toString("ascii", offset + 4, offset + 8);
      if (chunkIndex === 0 && !(chunkType === "IHDR" && dataLength === 13)) return false;
      if (chunkType === "IDAT") hasImageData = true;
      if (chunkType === "IEND") {
        return dataLength === 0 && hasImageData && chunkEnd === bytes.length;
      }
      offset = chunkEnd;
      chunkIndex++;
    }
    return false;
  } catch {
    return false;
  }
}

function isImageCaptureResult(value: unknown): value is ImageCaptureResult {
  if (!isRecord(value)) return false;
  if (value.status === "captured") {
    return value.mediaType === "image/png" && isPngDataUrl(value.dataUrl);
  }
  return value.status === "missing"
    && ["screenshot_failure", "crop_failure", "source_disconnected"].includes(String(value.reason))
    && [1, 2, 3].includes(value.attempts as number)
    && isOptionalString(value.message);
}

function isV1AnnotationResult(value: Record<string, unknown>): value is unknown & AnnotationResultV1 {
  if (value.schemaVersion !== undefined && value.schemaVersion !== 1) return false;
  if (typeof value.success !== "boolean") return false;
  if (!(value.elements === undefined
    || (Array.isArray(value.elements) && value.elements.every(isElementSelection)))) return false;
  if (!isOptionalString(value.screenshot)
    || !isOptionalString(value.prompt)
    || !isOptionalString(value.url)
    || !isOptionalString(value.reason)
    || !(value.viewport === undefined || isViewport(value.viewport))
    || !(value.editCapture === undefined || isEditCapture(value.editCapture))) return false;
  return value.screenshots === undefined
    || (Array.isArray(value.screenshots)
      && value.screenshots.every(shot => isRecord(shot)
        && Number.isInteger(shot.index)
        && typeof shot.dataUrl === "string"));
}

function isV2AnnotationResult(value: Record<string, unknown>): value is unknown & AnnotationResultV2 {
  if (value.schemaVersion !== 2
    || value.success !== true
    || typeof value.url !== "string"
    || !isOptionalString(value.context)
    || !Array.isArray(value.steps)
    || !(value.etchCaptures === undefined
      || (Array.isArray(value.etchCaptures)
        && value.etchCaptures.every(capture =>
          isEditCapture(capture) && capture.changeCount > 0)))
    || !(value.etchWarnings === undefined
      || (Array.isArray(value.etchWarnings)
        && value.etchWarnings.every(warning => typeof warning === "string" && warning.trim())))) {
    return false;
  }
  if (value.steps.length === 0 && !(typeof value.context === "string" && value.context.trim())) {
    return false;
  }
  const ids = new Set<string>();
  for (const step of value.steps) {
    if (!isRecord(step)
      || typeof step.id !== "string" || !step.id || ids.has(step.id)
      || typeof step.url !== "string"
      || !isViewport(step.viewport)
      || !isImageCaptureResult(step.viewportImage)
      || !Array.isArray(step.elements)
      || step.elements.length === 0) {
      return false;
    }
    ids.add(step.id);
    for (const element of step.elements) {
      if (!isRecord(element)
        || typeof element.id !== "string" || !element.id || ids.has(element.id)
        || typeof element.historical !== "boolean"
        || typeof element.comment !== "string"
        || !isElementMetadata(element.metadata, true)
        || !isImageCaptureResult(element.cropImage)) {
        return false;
      }
      ids.add(element.id);
    }
  }
  return true;
}

/** Authoritative receiving-extension validator for separate legacy-v1 and v2 paths. */
export function isAnnotationResult(value: unknown): value is AnnotationResult {
  if (!isRecord(value)) return false;
  if (value.schemaVersion === 2) return isV2AnnotationResult(value);
  if (value.schemaVersion === undefined || value.schemaVersion === 1) {
    return isV1AnnotationResult(value);
  }
  return false;
}

function formatEditCaptureMarkdown(capture: EditCapture): string {
  let output = "";
  for (const warning of capture.warnings || []) {
    output += `> **Note:** ${warning}\n`;
  }
  if (capture.warnings?.length) output += "\n";

  if (capture.inlineStyles.length) {
    output += "#### Inline Style Changes\n\n";
    for (const change of capture.inlineStyles) {
      output += `**\`${change.selector}\`**\n`;
      for (const item of change.changed) {
        output += `- \`${item.property}\`: \`${item.from}\` → \`${item.to}\`\n`;
      }
      for (const [property, value] of Object.entries(change.added)) {
        output += `- \`${property}\`: added \`${value}\`\n`;
      }
      for (const property of change.removed) output += `- \`${property}\`: removed\n`;
      output += "\n";
    }
  }
  if (capture.rules.length) {
    output += "#### CSS Rule Changes\n\n";
    for (const change of capture.rules) {
      output += `**\`${change.ruleSelector}\`** (${change.sheet})\n`;
      for (const item of change.changed) {
        output += `- \`${item.property}\`: \`${item.from}\` → \`${item.to}\`\n`;
      }
      for (const [property, value] of Object.entries(change.added)) {
        output += `- \`${property}\`: added \`${value}\`\n`;
      }
      for (const property of change.removed) output += `- \`${property}\`: removed\n`;
      output += "\n";
    }
  }
  if (capture.dom.length) {
    output += "#### DOM Changes\n\n";
    for (const change of capture.dom) {
      output += `- **\`${change.selector}\`** — ${change.detail}\n`;
    }
    output += "\n";
  }
  return output;
}

function formatFrozenMetadata(metadata: ElementSelection): string {
  let output = `- Selector: \`${metadata.selector}\`\n`;
  output += `- Tag: **${metadata.tag}**\n`;
  if (metadata.id) output += `- ID: \`${metadata.id}\`\n`;
  if (metadata.classes.length) output += `- Classes: \`${metadata.classes.join(", ")}\`\n`;
  if (metadata.text) output += `- Text: "${metadata.text}"\n`;
  output += `- Rectangle: ${metadata.rect.width}×${metadata.rect.height}px at (${metadata.rect.x}, ${metadata.rect.y})\n`;
  if (Object.keys(metadata.attributes).length) {
    output += `- Attributes: ${Object.entries(metadata.attributes)
      .map(([key, value]) => `${key}="${value}"`).join(", ")}\n`;
  }
  if (metadata.boxModel) {
    const box = metadata.boxModel;
    output += `- Box model: content ${box.content.width}×${box.content.height}, `
      + `padding ${box.padding.top} ${box.padding.right} ${box.padding.bottom} ${box.padding.left}, `
      + `border ${box.border.top} ${box.border.right} ${box.border.bottom} ${box.border.left}, `
      + `margin ${box.margin.top} ${box.margin.right} ${box.margin.bottom} ${box.margin.left}\n`;
  }
  if (metadata.accessibility) {
    const accessibility = metadata.accessibility;
    const values = [
      accessibility.role && `role=${accessibility.role}`,
      accessibility.name && `name="${accessibility.name}"`,
      `focusable=${accessibility.focusable}`,
      `disabled=${accessibility.disabled}`,
      accessibility.expanded !== undefined && `expanded=${accessibility.expanded}`,
      accessibility.pressed !== undefined && `pressed=${accessibility.pressed}`,
      accessibility.checked !== undefined && `checked=${accessibility.checked}`,
      accessibility.selected !== undefined && `selected=${accessibility.selected}`,
      accessibility.description && `description="${accessibility.description}"`,
    ].filter(Boolean);
    output += `- Accessibility: ${values.join(", ")}\n`;
  }
  if (metadata.keyStyles && Object.keys(metadata.keyStyles).length) {
    output += `- Key styles: ${Object.entries(metadata.keyStyles)
      .map(([key, value]) => `${key}: ${value}`).join(", ")}\n`;
  }
  if (metadata.computedStyles && Object.keys(metadata.computedStyles).length) {
    output += `- Computed styles: ${Object.entries(metadata.computedStyles)
      .map(([key, value]) => `${key}: ${value}`).join(", ")}\n`;
  }
  if (metadata.parentContext) {
    const parent = metadata.parentContext;
    output += `- Parent: ${parent.tag}${parent.id ? `#${parent.id}` : ""}`;
    if (parent.classes.length) output += `.${parent.classes.join(".")}`;
    output += ` (${Object.entries(parent.styles).map(([key, value]) => `${key}: ${value}`).join(", ")})\n`;
  }
  if (metadata.cssVariables && Object.keys(metadata.cssVariables).length) {
    output += `- CSS variables: ${Object.entries(metadata.cssVariables)
      .map(([key, value]) => `${key}: ${value}`).join(", ")}\n`;
  }
  return output;
}

function missingAttemptLabel(attempts: number): string {
  return `${attempts} ${attempts === 1 ? "attempt" : "attempts"}`;
}

async function formatV2Image(
  image: ImageCaptureResult,
  label: string,
  filename: string,
): Promise<string> {
  if (image.status === "missing") {
    return `> **Warning:** ${label} missing: ${image.reason} (${missingAttemptLabel(image.attempts)})`
      + `${image.message ? ` — ${image.message}` : ""}\n`;
  }
  try {
    const buffer = Buffer.from(image.dataUrl.slice("data:image/png;base64,".length), "base64");
    if (buffer.length > MAX_SCREENSHOT_BYTES) throw new Error("image exceeds local write limit");
    const imagePath = path.join(os.tmpdir(), filename);
    await fs.promises.writeFile(imagePath, buffer);
    return `**${label}:** ${imagePath}\n`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `> **Warning:** ${label} could not be written locally (${message})\n`;
  }
}

async function formatV2Result(result: AnnotationResultV2): Promise<string> {
  let output = `## Workflow Annotation: ${result.url}\n\n`;
  if (result.context) output += `**Context:** ${result.context}\n\n`;
  const fileStem = `pi-annotate-${Date.now()}-${randomUUID()}`;

  for (let stepIndex = 0; stepIndex < result.steps.length; stepIndex++) {
    const step = result.steps[stepIndex];
    const stepNumber = stepIndex + 1;
    output += `## Step ${stepNumber}\n\n`;
    output += `**URL:** ${step.url}\n\n`;
    output += `**Viewport:** ${step.viewport.width}×${step.viewport.height}\n\n`;
    output += await formatV2Image(
      step.viewportImage,
      "Viewport image",
      `${fileStem}-step${stepNumber}-viewport.png`,
    );
    output += "\n";

    for (let elementIndex = 0; elementIndex < step.elements.length; elementIndex++) {
      const element = step.elements[elementIndex];
      const elementNumber = elementIndex + 1;
      output += `### Element ${elementNumber}\n\n`;
      if (element.historical) output += "**Historical** — source element no longer exists\n\n";
      output += formatFrozenMetadata(element.metadata);
      output += `- **Comment:** ${element.comment}\n\n`;
      output += await formatV2Image(
        element.cropImage,
        "Crop image",
        `${fileStem}-step${stepNumber}-element${elementNumber}-crop.png`,
      );
      output += "\n";
    }
  }

  if (result.steps.length === 0) output += "*No interaction steps*\n\n";
  if (result.etchWarnings?.length) {
    output += "## Capture warnings\n\n";
    for (const warning of result.etchWarnings) output += `> **Warning:** ${warning}\n\n`;
  }
  if (result.etchCaptures?.length) {
    output += "## Captured edits\n\n";
    for (let index = 0; index < result.etchCaptures.length; index++) {
      const capture = result.etchCaptures[index];
      const captureNumber = index + 1;
      output += `### Capture ${captureNumber} (${capture.changeCount} changes, ${Math.round(capture.duration / 1000)}s)\n\n`;
      output += formatEditCaptureMarkdown(capture);
      for (const [label, dataUrl, suffix] of [
        ["Before", capture.beforeScreenshot, "before"],
        ["After", capture.afterScreenshot, "after"],
      ] as const) {
        if (!dataUrl) continue;
        try {
          const imagePath = await writeLegacyImage(
            dataUrl,
            `${fileStem}-capture${captureNumber}-${suffix}.png`,
          );
          output += `**${label}:** ${imagePath}\n`;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          output += `> **Warning:** ${label} captured-edit image could not be written locally (${message})\n`;
        }
      }
      output += "\n";
    }
  }
  return output;
}

function formatLegacyEditCapture(capture: EditCapture): string {
  return formatEditCaptureMarkdown(capture).replaceAll("#### ", "### ");
}

async function writeLegacyImage(dataUrl: string, filename: string): Promise<string> {
  if (!dataUrl.startsWith("data:image/")) throw new Error("Invalid screenshot data");
  const buffer = Buffer.from(dataUrl.replace(/^data:image\/\w+;base64,/, ""), "base64");
  if (buffer.length > MAX_SCREENSHOT_BYTES) throw new Error("Screenshot too large");
  const imagePath = path.join(os.tmpdir(), filename);
  await fs.promises.writeFile(imagePath, buffer);
  return imagePath;
}

async function formatLegacyResult(result: AnnotationResultV1): Promise<string> {
  if (!result.success) return `Annotation failed: ${result.reason || "Unknown error"}`;

  let output = `## Page Annotation: ${result.url || "Unknown"}\n`;
  if (result.viewport) {
    output += `**Viewport:** ${result.viewport.width}×${result.viewport.height}\n\n`;
  }
  if (result.prompt) output += `**Context:** ${result.prompt}\n\n`;

  const hasDebugData = result.elements?.some(element =>
    element.computedStyles || element.parentContext || element.cssVariables);
  if (hasDebugData) output += "**Debug Mode:** Enabled\n\n";

  if (result.elements?.length) {
    output += `### Selected Elements (${result.elements.length})\n\n`;
    result.elements.forEach((element, index) => {
      output += `${index + 1}. **${element.tag}**\n`;
      output += `   - Selector: \`${element.selector}\`\n`;
      if (element.id) output += `   - ID: \`${element.id}\`\n`;
      if (element.classes?.length) {
        output += `   - Classes: \`${element.classes.join(", ")}\`\n`;
      }
      if (element.text) output += `   - Text: "${element.text}"\n`;

      if (element.boxModel) {
        const box = element.boxModel;
        const padding = `${box.padding.top} ${box.padding.right} ${box.padding.bottom} ${box.padding.left}`;
        const border = box.border.top || box.border.right || box.border.bottom || box.border.left
          ? `${box.border.top} ${box.border.right} ${box.border.bottom} ${box.border.left}`
          : "0";
        const margin = `${box.margin.top} ${box.margin.right} ${box.margin.bottom} ${box.margin.left}`;
        output += `   - **Box Model:** ${element.rect.width}×${element.rect.height} `
          + `(content: ${box.content.width}×${box.content.height}, padding: ${padding}, `
          + `border: ${border}, margin: ${margin})\n`;
      } else {
        output += `   - Size: ${element.rect.width}×${element.rect.height}px\n`;
      }

      if (element.attributes && Object.keys(element.attributes).length) {
        output += `   - **Attributes:** ${Object.entries(element.attributes)
          .map(([key, value]) => `${key}="${value}"`).join(", ")}\n`;
      }
      if (element.accessibility) {
        const accessibility = element.accessibility;
        const parts: string[] = [];
        if (accessibility.role) parts.push(`role=${accessibility.role}`);
        if (accessibility.name) parts.push(`name="${accessibility.name}"`);
        parts.push(`focusable=${accessibility.focusable}`);
        parts.push(`disabled=${accessibility.disabled}`);
        if (accessibility.expanded !== undefined) parts.push(`expanded=${accessibility.expanded}`);
        if (accessibility.pressed !== undefined) parts.push(`pressed=${accessibility.pressed}`);
        if (accessibility.checked !== undefined) parts.push(`checked=${accessibility.checked}`);
        if (accessibility.selected !== undefined) parts.push(`selected=${accessibility.selected}`);
        if (accessibility.description) parts.push(`description="${accessibility.description}"`);
        output += `   - **Accessibility:** ${parts.join(", ")}\n`;
      }
      const hasComputedStyles = element.computedStyles
        && Object.keys(element.computedStyles).length > 0;
      if (!hasComputedStyles && element.keyStyles && Object.keys(element.keyStyles).length) {
        output += `   - **Styles:** ${Object.entries(element.keyStyles)
          .map(([key, value]) => `${key}: ${value}`).join(", ")}\n`;
      }
      if (element.comment) output += `   - **Comment:** ${element.comment}\n`;
      if (element.computedStyles && Object.keys(element.computedStyles).length) {
        output += "   - **Computed Styles:**\n";
        for (const [key, value] of Object.entries(element.computedStyles)) {
          output += `     - ${key}: ${value}\n`;
        }
      }
      if (element.parentContext) {
        const parent = element.parentContext;
        const label = parent.id
          ? `${parent.tag}#${parent.id}`
          : `${parent.tag}${parent.classes[0] ? `.${parent.classes[0]}` : ""}`;
        const styles = Object.entries(parent.styles)
          .map(([key, value]) => `${key}: ${value}`).join(", ");
        output += `   - **Parent Context:** ${label} (${styles})\n`;
      }
      if (element.cssVariables && Object.keys(element.cssVariables).length) {
        output += "   - **CSS Variables:**\n";
        for (const [name, value] of Object.entries(element.cssVariables)) {
          output += `     - ${name}: ${value}\n`;
        }
      }
      output += "\n";
    });
  } else {
    output += "*No elements selected*\n\n";
  }

  const timestamp = Date.now();
  if (result.screenshot) {
    try {
      const imagePath = await writeLegacyImage(
        result.screenshot,
        `pi-annotate-${timestamp}-full.png`,
      );
      output += `**Screenshot (visible viewport):** ${imagePath}\n`;
    } catch (error) {
      output += `*Screenshot capture failed: ${error}*\n`;
    }
  }
  if (result.screenshots?.length) {
    output += "### Screenshots\n\n";
    for (let index = 0; index < result.screenshots.length; index++) {
      const screenshot = result.screenshots[index];
      try {
        if (!screenshot) throw new Error("Invalid screenshot data");
        const safeIndex = Number.isFinite(screenshot.index)
          ? Math.max(1, Math.floor(screenshot.index))
          : index + 1;
        const imagePath = await writeLegacyImage(
          screenshot.dataUrl,
          `pi-annotate-${timestamp}-el${safeIndex}.png`,
        );
        output += `- Element ${safeIndex}: ${imagePath}\n`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        output += `- Element ${screenshot?.index ?? index + 1}: *capture failed (${message})*\n`;
      }
    }
    output += "\n";
  }

  if (result.editCapture && result.editCapture.changeCount > 0) {
    const capture = result.editCapture;
    output += `## Edit Capture (${capture.changeCount} changes, ${Math.round(capture.duration / 1000)}s)\n\n`;
    output += formatLegacyEditCapture(capture);
    if (capture.beforeScreenshot || capture.afterScreenshot) {
      output += "### Before/After Screenshots\n\n";
      for (const [label, dataUrl, suffix] of [
        ["Before", capture.beforeScreenshot, "before"],
        ["After", capture.afterScreenshot, "after"],
      ] as const) {
        if (!dataUrl) continue;
        try {
          const imagePath = await writeLegacyImage(
            dataUrl,
            `pi-annotate-${timestamp}-${suffix}.png`,
          );
          output += `- ${label}: ${imagePath}\n`;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          output += `- ${label}: *capture failed (${message})*\n`;
        }
      }
      output += "\n";
    }
  }
  return output;
}

/** Formats a validated annotation while preserving its schema-specific presentation. */
export async function formatAnnotationResult(result: AnnotationResult): Promise<string> {
  if (result.schemaVersion === 2) return formatV2Result(result);
  return formatLegacyResult(result);
}

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
          const text = await formatAnnotationResult(value);
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
            text: `Annotation session is available as ${sessionLabel}${endpointText}. Select it in the Pi Annotate Session chooser and submit the annotation.`,
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
