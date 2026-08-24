import { test, expect } from "./fixtures/extension.js";
import { annotate } from "./helpers/annotation.js";

test("the annotator presents one composer with steps hidden in its menu", async ({ workflow }) => {
  const { page } = workflow;
  const composer = page.getByRole("group", { name: "Annotation composer" });

  await expect(composer).toBeVisible();
  await expect(page.locator("#pi-panel img")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Interaction steps" })).toHaveCount(0);
  await expect(composer.getByRole("button", { name: "Interact with page" })).toBeVisible();
  await expect(composer.getByRole("button", { name: "How to annotate" })).toBeVisible();
  await expect(composer.getByRole("textbox", { name: "General context" })).toHaveAttribute("rows", "2");
  await composer.getByRole("button", { name: "More options" }).click();
  const steps = composer.getByRole("region", { name: "Interaction steps" });
  await expect(steps.getByRole("button", { name: /All steps/ })).toHaveAttribute("aria-pressed", "true");
  await expect(composer.getByRole("checkbox", { name: "Etch" })).toBeVisible();
  await expect(composer.getByRole("button", { name: "Submit" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo delete" })).toBeHidden();
});

test("host modal traps do not steal focus from the Session chooser", async ({
  context,
  extensionWorker,
  fixtureServer,
}) => {
  const pages = context.pages();
  const page = pages[0] || await context.newPage();
  await page.goto(`${fixtureServer.origin}/workflow`);
  await extensionWorker.evaluate(async ({ endpoint, token, sessionId }) => {
    await chrome.storage.local.set({
      brokerEndpoint: endpoint,
      brokerToken: token,
      selectedSessionId: sessionId,
    });
  }, {
    endpoint: fixtureServer.origin,
    token: fixtureServer.token,
    sessionId: fixtureServer.sessionId,
  });

  await page.evaluate(() => {
    const modal = document.createElement("section");
    modal.id = "host-modal";
    modal.innerHTML = '<input id="host-modal-input">';
    document.body.prepend(modal);
    globalThis.__hostFocusRedirects = 0;
    document.addEventListener("focusin", (event) => {
      if (modal.contains(event.target)) return;
      globalThis.__hostFocusRedirects += 1;
      modal.querySelector("input").focus();
    });
    modal.querySelector("input").focus();
  });

  const targetTab = await extensionWorker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  });
  await extensionWorker.evaluate((tab) => openChooser(tab), targetTab);
  await expect(page.locator("#pi-annotate-session-chooser-host")).toBeVisible();

  expect(await page.evaluate(() => ({
    activeElementId: document.activeElement?.id,
    focusRedirects: globalThis.__hostFocusRedirects,
  }))).toEqual({
    activeElementId: "pi-annotate-session-chooser-host",
    focusRedirects: 0,
  });
});

test("host modal traps do not steal annotator focus or treat annotator clicks as outside", async ({ workflow }) => {
  const { page } = workflow;
  await page.evaluate(() => {
    const modal = document.createElement("section");
    modal.id = "host-modal";
    modal.setAttribute("role", "dialog");
    modal.innerHTML = '<label>Host modal input <input id="host-modal-input"></label>';
    Object.assign(modal.style, {
      position: "fixed",
      inset: "20px",
      zIndex: "10",
      pointerEvents: "auto",
    });
    document.body.prepend(modal);
    document.body.style.pointerEvents = "none";

    globalThis.__hostTrapState = { focusRedirects: 0, outsidePointerDowns: 0 };
    document.addEventListener("focusin", (event) => {
      if (modal.contains(event.target)) return;
      globalThis.__hostTrapState.focusRedirects += 1;
      modal.querySelector("input").focus();
    });
    document.addEventListener("pointerdown", (event) => {
      if (!modal.contains(event.target)) globalThis.__hostTrapState.outsidePointerDowns += 1;
    });
    modal.querySelector("input").focus();
  });

  const context = page.getByRole("textbox", { name: "General context" });
  await context.focus();
  await page.keyboard.type("Annotator keeps focus");
  const afterTyping = await page.evaluate(() => ({
    activeElementId: document.activeElement?.id,
    contextValue: document.querySelector("#pi-context")?.value,
  }));
  await page.getByRole("button", { name: "More options" }).click();
  await page.getByRole("button", { name: "How to annotate" }).click();
  const helpDialog = page.getByRole("dialog", { name: "How to annotate" });
  await helpDialog.getByRole("button", { name: "Close help" }).click();

  const observed = await page.evaluate((afterTyping) => ({
    afterTyping,
    moreOptionsOpen: document.querySelector("#pi-advanced")?.open,
    helpDialogOpen: Boolean(document.querySelector(".pi-help-dialog")),
    ...globalThis.__hostTrapState,
  }), afterTyping);
  expect(observed).toEqual({
    afterTyping: {
      activeElementId: "pi-context",
      contextValue: "Annotator keeps focus",
    },
    moreOptionsOpen: true,
    helpDialogOpen: false,
    focusRedirects: 0,
    outsidePointerDowns: 0,
  });
});

test("the step filmstrip stays contained inside the menu as steps accumulate", async ({ workflow }) => {
  const { page } = workflow;
  const composer = page.getByRole("group", { name: "Annotation composer" });
  await composer.getByRole("button", { name: "More options" }).click();
  const steps = composer.getByRole("region", { name: "Interaction steps" });
  const filmstrip = page.locator(".pi-filmstrip");
  await annotate(page, "#state-one", "Step one");
  for (let step = 2; step <= 7; step += 1) {
    await page.getByRole("button", { name: "Interact with page" }).click();
    await page.getByRole("button", { name: "Resume annotation" }).click();
    await annotate(page, "#state-one", `Step ${step}`);
  }
  expect(await filmstrip.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(await steps.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
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

  const note = page.locator(".pi-note-card");
  const textareaBox = await note.locator(".pi-note-textarea").boundingBox();
  const sendBox = await note.getByRole("button", { name: "Send comment" }).boundingBox();
  expect(sendBox.x).toBeGreaterThanOrEqual(textareaBox.x + textareaBox.width);
  await expect(note.locator(".pi-note-body > .pi-note-selector")).toHaveText("#state-one");
  for (const control of await note.locator(".pi-note-header button").all()) {
    const box = await control.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(32);
    expect(box.height).toBeGreaterThanOrEqual(32);
  }

  const context = page.getByRole("textbox", { name: "General context" });
  await context.fill("A long mobile note ".repeat(20));
  expect(await context.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await context.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  expect(await context.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  const viewport = page.viewportSize();
  const surfaces = [
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
  const composerBox = await page.getByRole("group", { name: "Annotation composer" }).boundingBox();
  expect(card.y + card.height).toBeLessThanOrEqual(composerBox.y);

  await page.getByRole("button", { name: "Interact with page" }).click();
  await page.locator("#open-transient").click();
  await page.getByRole("button", { name: "Resume annotation" }).click();
  await page.locator("#state-two").evaluate((element) => {
    Object.assign(element.style, {
      position: "fixed", left: "296px", top: "0", width: "20px", padding: "0", zIndex: "1",
    });
  });
  await annotate(page, "#state-two", "Second narrow step");
  await page.getByRole("button", { name: "More options" }).click();
  const secondStep = page.getByRole("button", { name: "Step 2, 1 element annotations" });
  await secondStep.click();
  await expect(secondStep).toHaveAttribute("aria-pressed", "true");
  await secondStep.focus();
  await expect(secondStep).toBeFocused();
  expect(await page.locator(".pi-filmstrip").evaluate((stripElement) =>
    stripElement.scrollWidth > stripElement.clientWidth)).toBe(true);

  await page.getByRole("button", { name: "How to annotate" }).click();
  const helpBox = await page.getByRole("dialog", { name: "How to annotate" }).boundingBox();
  expect(helpBox.x).toBeGreaterThanOrEqual(0);
  expect(helpBox.y).toBeGreaterThanOrEqual(0);
  expect(helpBox.x + helpBox.width).toBeLessThanOrEqual(viewport.width);
  expect(helpBox.y + helpBox.height).toBeLessThanOrEqual(viewport.height);
});

test("delivery feedback remains visible with the draft at narrow widths", async ({ workflow }) => {
  const { page, server } = workflow;
  server.state.failDeliveries = 1;
  await page.setViewportSize({ width: 320, height: 320 });
  const context = page.getByRole("textbox", { name: "General context" });
  await context.fill("Keep narrow delivery context");

  await page.getByRole("button", { name: "Submit" }).click();

  await expect(page.getByRole("alert")).toContainText("Intentional E2E delivery failure");
  await expect(context).toHaveValue("Keep narrow delivery context");
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});
