/**
 * Pi Annotate - Screenshot post-processing module
 *
 * Crops a captured viewport screenshot to one element, or stamps numbered
 * badges onto it for the selected elements. Registered on the shared module
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

  async function cropToElement(dataUrl, element) {
    const rect = element.getBoundingClientRect();
    const result = await cropToRect(dataUrl, {
      rect: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      dpr: window.devicePixelRatio || 1,
    });
    return result.dataUrl;
  }

  /**
   * Add numbered badges to a visible-viewport screenshot for selected elements
   * @param {string} dataUrl - Base64 screenshot data URL
   * @param {Array<{element: Element}>} elements - Selected elements with their DOM references
   * @returns {Promise<string>} Modified screenshot with badges
   */
  async function addBadgesToScreenshot(dataUrl, elements) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const dpr = window.devicePixelRatio || 1;

        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(dataUrl);
          return;
        }

        // Draw the original screenshot
        ctx.drawImage(img, 0, 0);

        // Badge styling (matches .pi-marker-badge)
        const badgeSize = 28 * dpr;
        const fontSize = 13 * dpr;
        const bgColor = "#8abeb7";     // --pi-accent (teal)
        const textColor = "#1d1f21";   // --pi-bg-body (dark)

        elements.forEach((sel, i) => {
          const element = sel.element;
          if (!element || !document.contains(element)) return;

          const rect = element.getBoundingClientRect();

          // Badge center should be at element's top-right corner (matching DOM badge positioning)
          // DOM: badge.style.left = rect.right - 14, badge.style.top = rect.top - 14
          // This puts the 28px badge's CENTER at (rect.right, rect.top)
          const centerX = rect.right * dpr;
          const centerY = rect.top * dpr;

          // Clamp to keep badge fully visible within canvas
          const badgeX = Math.max(badgeSize / 2, Math.min(centerX, canvas.width - badgeSize / 2));
          const badgeY = Math.max(badgeSize / 2, Math.min(centerY, canvas.height - badgeSize / 2));

          // Badge shadow (set before fill so it applies to the shape)
          ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
          ctx.shadowBlur = 4 * dpr;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 2 * dpr;

          // Badge background (circle)
          ctx.beginPath();
          ctx.arc(badgeX, badgeY, badgeSize / 2, 0, Math.PI * 2);
          ctx.fillStyle = bgColor;
          ctx.fill();

          // Reset shadow for text
          ctx.shadowColor = "transparent";
          ctx.shadowBlur = 0;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 0;

          // Badge number
          ctx.fillStyle = textColor;
          ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(i + 1), badgeX, badgeY);
        });

        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  modules.capture = {
    capturedImage,
    missingImage,
    cropToRect,
    cropToElement,
    addBadgesToScreenshot,
  };
})();
