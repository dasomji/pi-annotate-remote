import { test, expect } from "./fixtures/extension.js";
import { annotate } from "./helpers/annotation.js";

async function createSecondStep(page) {
  await page.getByRole("button", { name: "Interact with page" }).click();
  const resume = page.getByRole("button", { name: "Resume annotation" });
  await expect(resume).toBeVisible();
  await page.locator("#open-transient").click();
  await resume.click();
  await expect(page.getByRole("button", { name: "Interact with page" })).toBeVisible();
  return annotate(page, "#state-two", "Second-step annotation");
}

async function submit(page) {
  await page.getByRole("button", { name: /^Submit/ }).click();
}

test("consecutive selections retain accepted-click order within one step", async ({ workflow }) => {
  const { page, server } = workflow;
  await annotate(page, "#state-one", "First same-state annotation");
  await annotate(page, "#mutate", "Second same-state annotation");
  await submit(page);

  await expect.poll(() => server.state.annotations.length).toBe(1);
  const [step] = server.state.annotations[0].steps;
  expect(server.state.annotations[0].steps).toHaveLength(1);
  expect(step.elements.map((element) => element.comment)).toEqual([
    "First same-state annotation",
    "Second same-state annotation",
  ]);
  expect(step.elements.map((element) => element.metadata.id)).toEqual([
    "state-one",
    "mutate",
  ]);
});

test("Element annotation arrows retrace the exact DOM branch and deliver the retargeted evidence", async ({ workflow }) => {
  const { page, server } = workflow;
  const focusedNote = await annotate(page, "#state-one", "Keep this comment while retargeting");
  const annotationId = await focusedNote.getAttribute("data-annotation-id");
  const note = page.locator(`[data-annotation-id="${annotationId}"]`);
  const moveUp = note.getByRole("button", { name: "Move Element annotation to parent" });
  const moveDown = note.getByRole("button", { name: "Move Element annotation toward original element" });

  await expect(moveUp).toBeEnabled();
  await expect(moveDown).toBeDisabled();
  await expect(moveDown).toHaveAttribute("title", "Already at the original element");

  await moveUp.click();
  await expect(note.locator(".pi-note-selector")).toHaveText("main");
  await expect(moveDown).toBeEnabled();

  await moveDown.click();
  await expect(note.locator(".pi-note-selector")).toHaveText("#state-one");

  await moveUp.click();
  await expect(note.locator(".pi-note-selector")).toHaveText("main");
  await submit(page);

  await expect.poll(() => server.state.annotations.length).toBe(1);
  const element = server.state.annotations[0].steps[0].elements[0];
  expect(element.id).toBe(annotationId);
  expect(element.comment).toBe("Keep this comment while retargeting");
  expect(element.metadata).toMatchObject({ selector: "main", tag: "main" });
  expect(element.cropImage.status).toBe("captured");
});

test("DOM navigation remains visible but disabled after its interaction step closes", async ({ workflow }) => {
  const { page } = workflow;
  const focusedNote = await annotate(page, "#state-one", "Closed-step target");
  const annotationId = await focusedNote.getAttribute("data-annotation-id");
  const note = page.locator(`[data-annotation-id="${annotationId}"]`);
  await page.getByRole("button", { name: "Interact with page" }).click();
  await page.getByRole("button", { name: "Resume annotation" }).click();

  const moveUp = note.getByRole("button", { name: "Move Element annotation to parent" });
  const moveDown = note.getByRole("button", { name: "Move Element annotation toward original element" });
  const reason = "Element cannot be changed after its interaction step is closed";
  await expect(moveUp).toBeVisible();
  await expect(moveDown).toBeVisible();
  await expect(moveUp).toBeDisabled();
  await expect(moveDown).toBeDisabled();
  await expect(moveUp).toHaveAttribute("title", reason);
  await expect(moveDown).toHaveAttribute("title", reason);
});

test("an Element annotation card stays fully inside the viewport near the bottom edge", async ({ workflow }) => {
  const { page } = workflow;
  await page.locator("#state-one").evaluate((element) => {
    Object.assign(element.style, {
      position: "fixed",
      left: "0",
      bottom: "0",
      width: "24px",
      padding: "0",
      zIndex: "1",
    });
  });

  await page.locator("#state-one").click();
  const card = page.locator(".pi-note-card").last();
  await expect(card).toBeVisible();
  const bounds = await card.boundingBox();
  const viewport = page.viewportSize();

  expect(bounds).not.toBeNull();
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);

  await page.setViewportSize({ width: 320, height: 320 });
  await expect.poll(async () => {
    const resized = await card.boundingBox();
    return resized !== null &&
      resized.x >= 0 && resized.y >= 0 &&
      resized.x + resized.width <= 320 &&
      resized.y + resized.height <= 320;
  }).toBe(true);
});

test("step filtering defaults to the current step and preserves other evidence", async ({ workflow }) => {
  const { page } = workflow;
  await annotate(page, "#state-one", "First-step annotation");

  const stepButtons = page.locator("#pi-filmstrip .pi-step-filter[data-step]:not([data-step='all'])");
  await expect(stepButtons).toHaveCount(1);
  await expect(stepButtons.first()).toHaveAttribute("aria-pressed", "true");
  await expect(stepButtons.first()).toHaveAttribute("aria-label", "Step 1, 1 element annotations");
  expect(await stepButtons.first().locator("img").evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
  await createSecondStep(page);

  await expect(stepButtons).toHaveCount(2);
  await expect(stepButtons.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(stepButtons.nth(1)).toHaveAttribute("aria-label", "Step 2, 1 element annotations");
  await expect(page.locator("#pi-markers .pi-marker-badge")).toHaveCount(1);
  await expect(stepButtons.first().getByLabel("Hidden by step filter")).toBeVisible();

  await stepButtons.first().click();
  await expect(stepButtons.first()).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#pi-markers .pi-marker-badge")).toHaveCount(1);
  await expect(stepButtons.nth(1).getByLabel("Hidden by step filter")).toBeVisible();
  await expect(stepButtons.first().getByLabel("Hidden by step filter")).toHaveCount(0);

  await page.getByRole("button", { name: "All steps" }).click();
  await expect(page.locator("#pi-markers .pi-marker-badge")).toHaveCount(2);
  await expect(page.getByLabel("Hidden by step filter")).toHaveCount(0);
  await expect(stepButtons).toHaveCount(2);
});

test("a lookalike replacement stays historical while reinserting the exact node restores liveness", async ({ workflow }) => {
  const { page, server } = workflow;
  const note = await annotate(page, "#state-one", "Frozen historical evidence");

  await page.locator("#state-one").evaluate((source) => {
    window.__piE2EOriginalNode = source;
    const lookalike = source.cloneNode(true);
    source.replaceWith(lookalike);
    window.dispatchEvent(new Event("resize"));
  });
  await expect(note.getByRole("status")).toHaveText(
    "Historical — source element no longer exists",
  );

  // A selector-identical node must not relink the frozen annotation.
  await page.locator("#state-one").evaluate(() => {
    window.dispatchEvent(new Event("resize"));
  });
  await expect(note.getByRole("status")).toHaveText(
    "Historical — source element no longer exists",
  );

  await page.locator("#state-one").evaluate((lookalike) => {
    lookalike.replaceWith(window.__piE2EOriginalNode);
    window.dispatchEvent(new Event("resize"));
  });
  await expect(note.getByRole("status")).toBeHidden();
  await submit(page);

  await expect.poll(() => server.state.annotations.length).toBe(1);
  const element = server.state.annotations[0].steps[0].elements[0];
  expect(element.historical).toBe(false);
  expect(element.comment).toBe("Frozen historical evidence");
  expect(element.cropImage.status).toBe("captured");
});

test("a historical annotation remains visible after filtering away and back", async ({ workflow }) => {
  const { page } = workflow;
  await annotate(page, "#state-one", "Historical after filtering");
  await createSecondStep(page);
  await page.locator("#state-one").evaluate((source) => source.remove());
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));

  const stepButtons = page.locator("#pi-filmstrip .pi-step-filter[data-step]:not([data-step='all'])");
  await stepButtons.nth(1).click();
  await stepButtons.nth(0).click();

  const note = page.locator(".pi-note-card");
  await expect(note).toHaveCount(1);
  await expect(note.getByRole("status")).toHaveText(
    "Historical — source element no longer exists",
  );
  await expect(note.locator(".pi-note-textarea")).toHaveValue("Historical after filtering");
});

test("deleting a last element removes its step and Undo restores assets and original position", async ({ workflow }) => {
  const { page, server } = workflow;
  await annotate(page, "#state-one", "First-step annotation");
  const secondNote = await createSecondStep(page);

  const stepButtons = page.locator("#pi-filmstrip .pi-step-filter[data-step]:not([data-step='all'])");
  const secondThumbnail = await stepButtons.nth(1).locator("img.pi-step-thumbnail").getAttribute("src");
  await secondNote.getByRole("button", { name: "Delete element annotation" }).click();
  await expect(stepButtons).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Undo delete" })).toBeEnabled();

  await page.getByRole("button", { name: "Undo delete" }).click();
  await expect(page.getByRole("button", { name: "Undo delete" })).toBeHidden();
  await expect(stepButtons).toHaveCount(2);
  await expect(stepButtons.nth(1).locator("img.pi-step-thumbnail")).toHaveAttribute("src", secondThumbnail);
  await expect(page.locator(".pi-note-card").last().locator(".pi-note-textarea"))
    .toHaveValue("Second-step annotation");
  await submit(page);

  await expect.poll(() => server.state.annotations.length).toBe(1);
  const result = server.state.annotations[0];
  expect(result.steps.map((step) => step.elements[0].comment)).toEqual([
    "First-step annotation",
    "Second-step annotation",
  ]);
  expect(result.steps[1].viewportImage.status).toBe("captured");
  expect(result.steps[1].elements[0].cropImage.status).toBe("captured");
});

test("three screenshot failures name incomplete evidence before explicit degraded submission", async ({ workflow }) => {
  const { page, server, captureControl } = workflow;
  await captureControl.configure({ failures: 3 });

  await page.locator("#state-one").click();
  let dialog = page.getByRole("dialog", { name: "Screenshot capture failed" });
  await expect(dialog).toContainText("Attempt 1 of 3");
  await dialog.getByRole("button", { name: "Retry" }).click();
  dialog = page.getByRole("dialog", { name: "Screenshot capture failed" });
  await expect(dialog).toContainText("Attempt 2 of 3");
  await page.locator("#state-one").evaluate((source) => {
    source.textContent = "Fresh retry state";
    source.style.marginTop = "48px";
  });
  await dialog.getByRole("button", { name: "Retry" }).click();

  const note = page.locator(".pi-note-card").last();
  await expect(note).toBeVisible();
  await note.locator(".pi-note-textarea").fill("Keep incomplete evidence");
  await submit(page);

  const degraded = page.getByRole("dialog", { name: "Some screenshots are missing" });
  await expect(degraded).toContainText("Step 1 viewport");
  await expect(degraded).toContainText("Step 1, element 1 crop");
  expect(server.state.annotationAttempts).toBe(0);
  await degraded.getByRole("button", { name: "Submit without screenshots" }).click();

  await expect.poll(() => server.state.annotations.length).toBe(1);
  const result = server.state.annotations[0];
  expect(result.steps[0].viewportImage).toMatchObject({
    status: "missing",
    reason: "screenshot_failure",
    attempts: 3,
  });
  expect(result.steps[0].elements[0].cropImage).toMatchObject({
    status: "missing",
    reason: "screenshot_failure",
    attempts: 3,
  });
  expect(result.steps[0].elements[0].metadata.text).toBe("Fresh retry state");
  expect(result.steps[0].elements[0].metadata.rect.y).toBeGreaterThan(0);
});

test("Escape cannot dismiss or strand a failed capture transaction", async ({ workflow }) => {
  const { page, captureControl } = workflow;
  await captureControl.configure({ failures: 1 });

  await page.locator("#state-one").click();
  const failure = page.getByRole("dialog", { name: "Screenshot capture failed" });
  await expect(failure).toBeVisible();
  await expect(page.locator("#pi-panel")).toHaveAttribute("aria-busy", "true");
  await page.keyboard.press("Escape");

  await expect(failure).toBeVisible();
  await expect(page.getByRole("button", { name: "Interact with page" })).toBeDisabled();
  await failure.getByRole("button", { name: "Discard" }).click();
  await expect(failure).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Interact with page" })).toBeEnabled();
});

test("modal focus is trapped and returns to the invoking control", async ({ workflow }) => {
  const { page } = workflow;
  const close = page.getByRole("button", { name: "Cancel annotation" });
  await close.focus();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  const dialog = page.getByRole("dialog", { name: "Abort annotation?" });
  await expect(dialog).toBeVisible();
  const continueButton = dialog.getByRole("button", { name: "Continue annotating" });
  const abortButton = dialog.getByRole("button", { name: "Abort annotation" });
  await expect(continueButton).toBeFocused();

  await page.keyboard.press("Shift+Tab");
  await expect(abortButton).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(continueButton).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(close).toBeFocused();
});

test("a route attempted during capture waits for the atomic transaction before asking", async ({ workflow }) => {
  const { page, server, captureControl } = workflow;
  await captureControl.configure({ delayMs: 450 });

  await page.locator("#state-one").click();
  const captureStatus = page.locator("#pi-capture-status");
  await expect(captureStatus).toBeVisible();
  await expect(captureStatus).toHaveText("Capturing element evidence…");
  await page.evaluate((destination) => {
    navigation.navigate(destination);
  }, `${server.origin}/destination?source=during-capture`);
  await expect(page).toHaveURL(`${server.origin}/workflow`);

  const routeDialog = page.getByRole("dialog", { name: /leave|discard/i });
  await expect(routeDialog).toBeVisible();
  await expect(page.locator(".pi-note-card")).toHaveCount(1);
  await routeDialog.getByRole("button", { name: "Stay on this page" }).click();
  await expect(page.locator(".pi-note-card")).toHaveCount(1);
});

test("a route attempted during delivery replays automatically after acknowledgement", async ({ workflow }) => {
  const { page, server } = workflow;
  await annotate(page, "#state-one", "Deliver before leaving");
  server.state.deliveryDelayMs = 450;

  await submit(page);
  await expect(page.getByRole("button", { name: "Sending…" })).toBeDisabled();
  await page.evaluate((destination) => {
    navigation.navigate(destination);
  }, `${server.origin}/destination?source=during-delivery`);
  await expect(page).toHaveURL(`${server.origin}/workflow`);

  await expect(page).toHaveURL(`${server.origin}/destination?source=during-delivery`);
  expect(server.state.annotations).toHaveLength(1);
  expect(server.state.destinationRequests).toEqual([{
    method: "GET",
    search: "?source=during-delivery",
    body: "",
  }]);
});
