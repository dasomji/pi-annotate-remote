import { test, expect } from "./fixtures/extension.js";

async function annotate(page, selector, comment) {
  const notes = page.locator(".pi-note-card");
  const previousCount = await notes.count();
  await page.locator(selector).click();
  await expect(notes).toHaveCount(previousCount + 1);
  const note = notes.last();
  await expect(note).toBeVisible();
  await note.locator(".pi-note-textarea").fill(comment);
  return note;
}

async function createSecondStep(page) {
  await page.getByRole("button", { name: "Pause & interact" }).click();
  const resume = page.getByRole("button", { name: "Resume annotation" });
  await expect(resume).toBeVisible();
  await page.locator("#open-transient").click();
  await resume.click();
  await expect(page.getByRole("button", { name: "Pause & interact" })).toBeVisible();
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

test("step filtering hides other overlays without deletion and All steps restores them", async ({ workflow }) => {
  const { page } = workflow;
  await annotate(page, "#state-one", "First-step annotation");
  await createSecondStep(page);

  const stepButtons = page.locator("#pi-filmstrip .pi-step-filter[data-step]:not([data-step='all'])");
  await expect(stepButtons).toHaveCount(2);
  await expect(page.locator("#pi-markers .pi-marker-badge")).toHaveCount(2);

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

test("modal focus is trapped and returns to the invoking control", async ({ workflow }) => {
  const { page } = workflow;
  const cancel = page.getByRole("button", { name: "Cancel", exact: true });
  await cancel.focus();
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
  await expect(cancel).toBeFocused();
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
