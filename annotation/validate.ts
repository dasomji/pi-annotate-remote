import type {
  AnnotationResult,
  AnnotationResultV1,
  AnnotationResultV2,
  EditCapture,
  ImageCaptureResult,
} from "../types.ts";

import { MAX_SCREENSHOT_BYTES } from "./images.ts";

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
    || !isFiniteNumber(value.changeCount)
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

function isV1AnnotationResult(value: Record<string, unknown>): value is Record<string, unknown> & AnnotationResultV1 {
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

function isV2AnnotationResult(value: Record<string, unknown>): value is Record<string, unknown> & AnnotationResultV2 {
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
