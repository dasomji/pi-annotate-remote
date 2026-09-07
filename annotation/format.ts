import { randomUUID } from "node:crypto";
import type {
  AnnotationResult,
  AnnotationResultV1,
  AnnotationResultV2,
  ElementSelection,
  EditCapture,
  ImageCaptureResult,
} from "../types.ts";

import { MAX_SCREENSHOT_BYTES, writeTemporaryImage, type ImageWriter } from "./images.ts";

export function createAnnotationFormatter(writeImage: ImageWriter = writeTemporaryImage) {
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
      const imagePath = await writeImage(filename, buffer);
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
    const imagePath = await writeImage(filename, buffer);
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
  async function formatAnnotationResult(result: AnnotationResult): Promise<string> {
    if (result.schemaVersion === 2) return formatV2Result(result);
    return formatLegacyResult(result);
  }

  return formatAnnotationResult;
}

export const formatAnnotationResult = createAnnotationFormatter();
