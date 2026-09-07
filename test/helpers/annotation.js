export const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=";

export function metadata(overrides = {}) {
  return {
    selector: "#save",
    tag: "button",
    id: "save",
    classes: ["primary"],
    text: "Save",
    rect: { x: 10, y: 20, width: 80, height: 32 },
    attributes: { type: "button" },
    boxModel: {
      content: { width: 76, height: 28 },
      padding: { top: 2, right: 2, bottom: 2, left: 2 },
      border: { top: 0, right: 0, bottom: 0, left: 0 },
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    },
    accessibility: {
      role: "button",
      name: "Save",
      description: null,
      focusable: true,
      disabled: false,
    },
    keyStyles: { display: "inline-block" },
    ...overrides,
  };
}

export function capturedImage() {
  return {
    status: "captured",
    mediaType: "image/png",
    dataUrl: PNG_DATA_URL,
  };
}

export function v2Result(overrides = {}) {
  return {
    schemaVersion: 2,
    success: true,
    url: "https://example.test/editor",
    context: "The save state is confusing",
    steps: [{
      id: "step-a",
      url: "https://example.test/editor",
      viewport: { width: 1280, height: 720 },
      viewportImage: capturedImage(),
      elements: [{
        id: "element-a",
        historical: false,
        comment: "Clarify this action",
        metadata: metadata(),
        cropImage: capturedImage(),
      }],
    }],
    ...overrides,
  };
}
