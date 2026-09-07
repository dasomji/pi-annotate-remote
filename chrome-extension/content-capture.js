/**
 * Pi Annotate - Screenshot post-processing module
 *
 * Crops a captured viewport screenshot to frozen element geometry. Registered on the shared module
 * namespace; injected before content.js.
 */

(() => {
  const modules = (window["__piAnnotateModules_" + chrome.runtime.id] ??= {});
  if (modules.capture) return;

  const SCREENSHOT_PADDING = 20;
  const MISSING_REASONS = new Set([
    "screenshot_failure",
    "crop_failure",
    "source_disconnected",
  ]);

  function capturedImage(dataUrl) {
    if (typeof dataUrl !== "string" ||
        !dataUrl.startsWith("data:image/png;base64,")) {
      throw new TypeError("Captured image must be a PNG data URL");
    }
    return { status: "captured", mediaType: "image/png", dataUrl };
  }

  function missingImage(reason, attempts, message) {
    if (!MISSING_REASONS.has(reason)) {
      throw new TypeError("Unknown missing-image reason");
    }
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > 3) {
      throw new TypeError("Missing-image attempts must be between 1 and 3");
    }
    const result = { status: "missing", reason, attempts };
    if (message !== undefined) {
      if (typeof message !== "string") {
        throw new TypeError("Missing-image message must be a string");
      }
      const sanitized = message.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 240);
      if (sanitized) result.message = sanitized;
    }
    return result;
  }

  function normalizeFrozenGeometry({ rect, viewport, dpr }) {
    const x = rect?.x ?? rect?.left;
    const y = rect?.y ?? rect?.top;
    const width = rect?.width ??
      (Number.isFinite(rect?.right) && Number.isFinite(x) ? rect.right - x : NaN);
    const height = rect?.height ??
      (Number.isFinite(rect?.bottom) && Number.isFinite(y) ? rect.bottom - y : NaN);
    const values = [x, y, width, height, viewport?.width, viewport?.height, dpr];
    if (!values.every(Number.isFinite) ||
        width <= 0 || height <= 0 ||
        viewport.width <= 0 || viewport.height <= 0 ||
        dpr <= 0) {
      throw new TypeError("Invalid frozen crop geometry");
    }

    const minX = Math.max(0, x - SCREENSHOT_PADDING);
    const minY = Math.max(0, y - SCREENSHOT_PADDING);
    const maxX = Math.min(viewport.width, x + width + SCREENSHOT_PADDING);
    const maxY = Math.min(viewport.height, y + height + SCREENSHOT_PADDING);
    if (maxX <= minX || maxY <= minY) {
      throw new RangeError("Frozen crop geometry is outside the viewport");
    }

    return {
      cropX: minX * dpr,
      cropY: minY * dpr,
      cropWidth: (maxX - minX) * dpr,
      cropHeight: (maxY - minY) * dpr,
    };
  }

  async function cropToRect(dataUrl, frozen) {
    capturedImage(dataUrl);
    const geometry = normalizeFrozenGeometry(frozen);

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          if (geometry.cropX < 0 || geometry.cropY < 0 ||
              geometry.cropX + geometry.cropWidth > img.width ||
              geometry.cropY + geometry.cropHeight > img.height) {
            throw new RangeError("Frozen crop geometry is outside the screenshot bitmap");
          }
          const canvas = document.createElement("canvas");
          canvas.width = geometry.cropWidth;
          canvas.height = geometry.cropHeight;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Canvas 2D context is unavailable");

          ctx.drawImage(
            img,
            geometry.cropX,
            geometry.cropY,
            geometry.cropWidth,
            geometry.cropHeight,
            0,
            0,
            geometry.cropWidth,
            geometry.cropHeight,
          );
          resolve(capturedImage(canvas.toDataURL("image/png")));
        } catch (error) {
          reject(error);
        }
      };
      img.onerror = () => reject(new Error("Screenshot PNG decode failed"));
      img.src = dataUrl;
    });
  }

  modules.capture = {
    capturedImage,
    missingImage,
    cropToRect,
  };
})();
