import { test, expect } from "./fixtures/extension.js";

async function makeDraftDirty(page) {
  await page.locator("#pi-context").fill("Protect this draft");
  await page.getByRole("button", { name: "Pause & interact" }).click();
  await expect(page.getByRole("button", { name: "Resume annotation" })).toBeVisible();
}

test("Stay preserves a draft and Discard exactly replays a fresh same-tab target once", async ({ workflow }) => {
  const { page, server } = workflow;
  await makeDraftDirty(page);

  await page.locator("#same-tab-route").click();
  await expect(page).toHaveURL(`${server.origin}/workflow`);
  const routeDialog = page.getByRole("dialog", { name: /leave|discard/i });
  await expect(routeDialog).toBeVisible();
  await routeDialog.getByRole("button", { name: "Stay on this page" }).click();
  await expect(page.locator("#pi-context")).toHaveValue("Protect this draft");

  await page.locator("#same-tab-route").evaluate((link) => {
    link.href = `${location.origin}/destination?source=fresh-attempt`;
  });
  await page.locator("#same-tab-route").click();
  await page.getByRole("dialog", { name: /leave|discard/i })
    .getByRole("button", { name: "Discard" })
    .click();

  await expect(page).toHaveURL(`${server.origin}/destination?source=fresh-attempt`);
  expect(server.state.destinationRequests).toEqual([{
    method: "GET",
    search: "?source=fresh-attempt",
    body: "",
  }]);
});

test("Discard replays a same-tab POST form with its original target and body", async ({ workflow }) => {
  const { page, server } = workflow;
  await makeDraftDirty(page);

  await page.getByRole("button", { name: "POST-form destination" }).click();
  await expect(page).toHaveURL(`${server.origin}/workflow`);
  await expect(page.getByRole("dialog", { name: /leave|discard/i })).toBeVisible();
  await page.locator("#post-route").evaluate((form) => {
    form.action = `${location.origin}/destination?source=mutated-after-cancel`;
    form.method = "get";
    form.enctype = "text/plain";
    form.elements.workflow.value = "mutated-after-cancel";
    form.elements["checked-field"].checked = false;
    const submitter = form.querySelector("button[type='submit']");
    submitter.formAction = `${location.origin}/destination?source=mutated-submitter`;
    submitter.formMethod = "get";
    submitter.formEnctype = "text/plain";
  });
  await page.getByRole("dialog", { name: /leave|discard/i })
    .getByRole("button", { name: "Discard" })
    .click();

  await expect(page).toHaveURL(`${server.origin}/destination?source=submitter-override`);
  expect(server.state.destinationRequests).toEqual([{
    method: "POST",
    search: "?source=submitter-override",
    body: "workflow=preserve-this-body&checked-field=included&intent=ship",
  }]);
});

test("Discard preserves a programmatic POST form method, encoding, and body", async ({ workflow }) => {
  const { page, server } = workflow;
  await makeDraftDirty(page);

  await page.locator("#post-route").evaluate((form) => {
    form.target = "_self";
    form.enctype = "text/plain";
    form.submit();
  });
  await page.waitForFunction(() => document.querySelector(".pi-route-guard-backdrop"));
  await page.evaluate(() => {
    const discard = [...document.querySelectorAll(".pi-route-guard-backdrop button")]
      .find((button) => button.textContent === "Discard");
    discard?.click();
  });

  await expect.poll(() => page.url()).toBe(`${server.origin}/destination?source=post-form`);
  expect(server.state.destinationRequests).toEqual([{
    method: "POST",
    search: "?source=post-form",
    body: "workflow=preserve-this-body\r\nchecked-field=included\r\n",
  }]);
});

test("a submitter new-target override opens without warning and preserves the draft", async ({ workflow, context }) => {
  const { page, server } = workflow;
  await makeDraftDirty(page);
  await page.locator("#post-route").evaluate((form) => {
    form.target = "_self";
    form.querySelector("button[type='submit']").formTarget = "_blank";
  });

  const newPagePromise = context.waitForEvent("page");
  await page.getByRole("button", { name: "POST-form destination" }).click();
  const newPage = await newPagePromise;
  await expect(newPage).toHaveURL(`${server.origin}/destination?source=submitter-override`);

  await expect(page).toHaveURL(`${server.origin}/workflow`);
  await expect(page.locator("#pi-context")).toHaveValue("Protect this draft");
  await expect(page.getByRole("dialog", { name: /leave|discard/i })).toHaveCount(0);
});

test("a new-target link opens without warning and leaves the protected draft untouched", async ({ workflow, context }) => {
  const { page, server } = workflow;
  await makeDraftDirty(page);

  const newPagePromise = context.waitForEvent("page");
  await page.locator("#new-target-route").click();
  const newPage = await newPagePromise;
  await expect(newPage).toHaveURL(`${server.origin}/destination?source=new-target`);

  await expect(page).toHaveURL(`${server.origin}/workflow`);
  await expect(page.locator("#pi-context")).toHaveValue("Protect this draft");
  await expect(page.getByRole("dialog", { name: /leave|discard/i })).toHaveCount(0);
});

test("reload uses Chromium's native beforeunload fallback for a protected draft", async ({ workflow }) => {
  const { page, server } = workflow;
  await makeDraftDirty(page);

  let dialogType = "";
  page.once("dialog", async (dialog) => {
    dialogType = dialog.type();
    await dialog.accept();
  });
  await page.reload();

  await expect(page).toHaveURL(`${server.origin}/workflow`);
  expect(dialogType).toBe("beforeunload");
  await expect(page.locator("#pi-panel")).toHaveCount(0);
});
