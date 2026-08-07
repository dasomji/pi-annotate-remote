import { test, expect } from "./fixtures/extension.js";
import { annotate } from "./helpers/annotation.js";

test("the annotator presents a filmstrip above a focused composer", async ({ workflow }) => {
  const { page } = workflow;
  const steps = page.getByRole("navigation", { name: "Interaction steps" });
  const composer = page.getByRole("group", { name: "Annotation composer" });

  await expect(steps).toBeVisible();
  await expect(composer).toBeVisible();
  const icon = steps.getByRole("img", { name: "Grinsekatze" });
  await expect(icon).toBeVisible();
  expect(await icon.evaluate((image) => [image.naturalWidth, image.naturalHeight])).toEqual([64, 64]);
  await expect(steps.getByRole("button", { name: /All steps/ })).toHaveAttribute("aria-pressed", "true");
  await expect(steps.getByRole("button", { name: "Interact with page" })).toBeVisible();
  await expect(steps.getByRole("button", { name: "How to annotate" })).toBeVisible();
  await expect(composer.getByRole("textbox", { name: "General context" })).toHaveAttribute("rows", "2");
  await expect(composer.getByRole("checkbox", { name: "Etch" })).toBeAttached();
  await expect(composer.getByText("Etch", { exact: true })).toBeVisible();
  await expect(composer.getByRole("button", { name: "Submit" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo delete" })).toBeHidden();

  const stripBounds = await steps.boundingBox();
  const composerBounds = await composer.boundingBox();
  expect(stripBounds.y + stripBounds.height).toBeLessThanOrEqual(composerBounds.y);
});

test("help explains the workflow and dismisses without advancing abort", async ({ workflow }) => {
  const { page } = workflow;
  const help = page.getByRole("button", { name: "How to annotate" });

  await help.focus();
  await page.keyboard.press("Enter");
  let dialog = page.getByRole("dialog", { name: "How to annotate" });
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog).toContainText("Select an element");
  await expect(dialog).toContainText("Interact with page");
  await expect(dialog).toContainText("general context and submit");
  await expect(dialog).toContainText("Etch");
  await expect(dialog).toContainText("Escape");

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(help).toBeFocused();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Abort annotation?" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  const abort = page.getByRole("dialog", { name: "Abort annotation?" });
  await abort.getByRole("button", { name: "Continue annotating" }).click();

  await help.click();
  dialog = page.getByRole("dialog", { name: "How to annotate" });
  await page.locator(".pi-help-backdrop").dispatchEvent("click");
  await expect(dialog).toBeHidden();
  await help.click();
  await page.getByRole("dialog", { name: "How to annotate" })
    .getByRole("button", { name: "Close help" }).click();
  await expect(help).toBeFocused();
});

test("minimize and secondary Debug controls preserve visible draft state", async ({ workflow }) => {
  const { page } = workflow;
  await page.getByRole("textbox", { name: "General context" }).fill("Keep this context");
  await annotate(page, "#state-one", "Count this annotation");

  const more = page.getByRole("button", { name: "More options" });
  await more.click();
  await page.getByRole("checkbox", { name: "Debug capture" }).check();
  await expect(page.getByRole("button", { name: "More options, Debug capture enabled" })).toBeVisible();

  await page.getByRole("button", { name: "Minimize annotation bar" }).click();
  const restore = page.getByRole("button", { name: "Restore annotation bar" });
  await expect(restore).toContainText("1");
  await restore.click();
  await expect(page.getByRole("textbox", { name: "General context" })).toHaveValue("Keep this context");
  await expect(page.getByRole("button", { name: "More options, Debug capture enabled" })).toBeVisible();
});

test("bars, help, and Element annotation cards remain usable in a narrow short viewport", async ({ workflow }) => {
  const { page } = workflow;
  await page.setViewportSize({ width: 320, height: 320 });
  await annotate(page, "#state-one", "Narrow viewport annotation");

  const viewport = page.viewportSize();
  const surfaces = [
    page.getByRole("navigation", { name: "Interaction steps" }),
    page.getByRole("group", { name: "Annotation composer" }),
    page.locator(".pi-note-card"),
  ];
  for (const surface of surfaces) {
    const box = await surface.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  }

  const card = await page.locator(".pi-note-card").boundingBox();
  const strip = await page.getByRole("navigation", { name: "Interaction steps" }).boundingBox();
  expect(card.y + card.height).toBeLessThanOrEqual(strip.y);

  await page.getByRole("button", { name: "Interact with page" }).click();
  await page.locator("#open-transient").click();
  await page.getByRole("button", { name: "Resume annotation" }).click();
  await annotate(page, "#state-two", "Second narrow step");
  const secondStep = page.getByRole("button", { name: "Step 2, 1 element annotations" });
  await expect(secondStep).toHaveAttribute("aria-pressed", "true");
  await secondStep.focus();
  await expect(secondStep).toBeFocused();
  expect(await page.locator(".pi-step-strip").evaluate((stripElement) =>
    stripElement.scrollWidth > stripElement.clientWidth)).toBe(true);

  await page.getByRole("button", { name: "How to annotate" }).click();
  const helpBox = await page.getByRole("dialog", { name: "How to annotate" }).boundingBox();
  expect(helpBox.x).toBeGreaterThanOrEqual(0);
  expect(helpBox.y).toBeGreaterThanOrEqual(0);
  expect(helpBox.x + helpBox.width).toBeLessThanOrEqual(viewport.width);
  expect(helpBox.y + helpBox.height).toBeLessThanOrEqual(viewport.height);
});
