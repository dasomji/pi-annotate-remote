import { test, expect } from "./fixtures/extension.js";

async function annotate(page, targetSelector, comment) {
  await page.locator(targetSelector).click();
  const note = page.locator(".pi-note-card").last();
  await expect(note).toBeVisible();
  await note.locator(".pi-note-textarea").fill(comment);
}

async function submit(page) {
  await page.getByRole("button", { name: /^Submit/ }).click();
}

test("delivers an atomic schema-v2 screenshot capture through the broker", async ({ workflow }) => {
  const { page, server } = workflow;

  await page.locator("#state-one").click();
  // Dispatch during the asynchronous screenshot transaction: it must neither
  // operate the site nor create a second provisional annotation.
  await page.locator("#mutate").dispatchEvent("click");
  const note = page.locator(".pi-note-card").last();
  await expect(note).toBeVisible();
  await note.locator(".pi-note-textarea").fill("Keep this state");
  await expect(page.locator("#mutation-log")).toBeEmpty();
  await submit(page);

  await expect.poll(() => server.state.annotations.length, {
    message: "The fixture broker never received the annotation",
  }).toBe(1);

  const [result] = server.state.annotations;
  expect(result.schemaVersion).toBe(2);
  expect(result.success).toBe(true);
  expect(result.steps).toHaveLength(1);
  expect(result.steps[0].elements).toHaveLength(1);
  expect(result.steps[0].elements[0].comment).toBe("Keep this state");
  expect(result.steps[0].viewportImage).toMatchObject({
    status: "captured",
    mediaType: "image/png",
  });
  expect(result.steps[0].elements[0].cropImage).toMatchObject({
    status: "captured",
    mediaType: "image/png",
  });
  expect(result.steps[0].viewportImage.dataUrl).toMatch(/^data:image\/png;base64,/);
  expect(result.steps[0].elements[0].cropImage.dataUrl).toMatch(/^data:image\/png;base64,/);
  expect(result.steps[0].viewport.width).toBeGreaterThan(0);
  expect(result.steps[0].viewport.height).toBeGreaterThan(0);
});

test("pause and resume return input to the page without creating empty or reordered steps", async ({ workflow }) => {
  const { page, server } = workflow;

  await annotate(page, "#state-one", "First state");
  await page.getByRole("button", { name: "Pause & interact" }).click();

  const resume = page.getByRole("button", { name: "Resume annotation" });
  await expect(resume).toBeVisible();
  await expect(page.locator("#pi-panel .pi-header")).toBeHidden();
  await expect(page.locator("#pi-panel .pi-toolbar")).toBeHidden();
  await expect(page.locator("#pi-panel .pi-context-row")).toBeHidden();
  await expect(page.locator("#pi-panel .pi-actions")).toBeHidden();
  await expect(page.locator("#pi-markers")).toBeHidden();
  await expect(page.locator(".pi-notes-container")).toBeHidden();
  await page.locator("#site-input").fill("the site owns input");
  await page.locator("#open-transient").click();
  await expect(page.getByRole("dialog", { name: "Transient site UI" })).toBeVisible();

  await resume.click();
  await expect(page.getByRole("button", { name: "Pause & interact" })).toBeVisible();
  await annotate(page, "#state-two", "Second transient state");

  // A bare pause/resume boundary must not append an empty third step.
  await page.getByRole("button", { name: "Pause & interact" }).click();
  await page.getByRole("button", { name: "Resume annotation" }).click();
  await submit(page);

  await expect.poll(() => server.state.annotations.length).toBe(1);
  const [result] = server.state.annotations;
  expect(result.steps).toHaveLength(2);
  expect(result.steps.map((step) => step.elements.map((element) => element.comment))).toEqual([
    ["First state"],
    ["Second transient state"],
  ]);
});

test("a failed delivery preserves the complete draft and Retry delivers it unchanged", async ({ workflow }) => {
  const { page, server } = workflow;
  server.state.failDeliveries = 1;

  await annotate(page, "#state-one", "Retry me unchanged");
  await submit(page);

  await expect(page.getByRole("alert")).toContainText("Intentional E2E delivery failure");
  await expect(page.getByRole("button", { name: "Retry" })).toBeEnabled();
  await page.getByRole("button", { name: "Retry" }).click();

  await expect.poll(() => server.state.annotationAttempts).toBe(2);
  expect(server.state.annotations).toHaveLength(2);
  expect(server.state.annotations[1]).toEqual(server.state.annotations[0]);
});

test("Pause and Resume expose keyboard-operable, mode-specific controls with visible focus", async ({ workflow }) => {
  const { page } = workflow;
  const pause = page.getByRole("button", { name: "Pause & interact" });

  await pause.focus();
  await expect(pause).toBeFocused();
  expect(await pause.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  await page.keyboard.press("Enter");

  const resume = page.getByRole("button", { name: "Resume annotation" });
  await expect(resume).toBeVisible();
  await resume.focus();
  await expect(resume).toBeFocused();
  expect(await resume.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  await page.keyboard.press("Space");

  await expect(pause).toBeVisible();
});

test("Etch records ordered annotation periods but excludes the paused mutation period", async ({ workflow }) => {
  const { page, server } = workflow;
  await page.locator("#pi-context").fill("Etch period acceptance");
  await page.locator("label.pi-etch-toggle").click();
  await expect(page.locator("#pi-etch-mode")).toBeChecked();

  await page.locator("#state-one").evaluate((element) => {
    element.style.color = "rgb(200, 0, 0)";
  });
  await page.getByRole("button", { name: "Pause & interact" }).click();
  await expect(page.getByRole("button", { name: "Resume annotation" })).toBeVisible();

  await page.locator("#state-one").evaluate((element) => {
    element.style.color = "rgb(0, 0, 200)";
  });
  await page.getByRole("button", { name: "Resume annotation" }).click();
  await expect(page.getByRole("button", { name: "Pause & interact" })).toBeVisible();
  await expect(page.locator("#pi-etch-mode")).toBeChecked();
  await page.locator("#state-one").evaluate((element) => {
    element.style.color = "rgb(0, 140, 0)";
  });
  await expect(page.locator("#pi-etch-count")).toHaveText(/^[1-9]\d*$/);
  await page.getByRole("button", { name: "Pause & interact" }).click();
  await expect(page.getByRole("button", { name: "Resume annotation" })).toBeVisible();
  await page.getByRole("button", { name: "Resume annotation" }).click();
  await submit(page);

  await expect.poll(() => server.state.annotations.length).toBe(1);
  const captures = server.state.annotations[0].etchCaptures;
  expect(captures).toHaveLength(2);
  expect(captures.map((capture) => capture.changeCount)).toEqual([1, 1]);
  expect(captures[0].inlineStyles[0].added).toEqual({
    color: "rgb(200, 0, 0)",
  });
  expect(captures[1].inlineStyles[0].changed).toEqual([{
    property: "color",
    from: "rgb(0, 0, 200)",
    to: "rgb(0, 140, 0)",
  }]);
});
