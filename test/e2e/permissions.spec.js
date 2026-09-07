import { test, expect } from "./fixtures/extension.js";

test.use({ productionManifest: true });

test("production settings wait for browser permission before saving broker credentials", async ({ context, extensionId, extensionWorker, fixtureServer }) => {
  const permissions = () => extensionWorker.evaluate(() => chrome.permissions.getAll());
  expect((await permissions()).origins || []).toEqual([]);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/settings.html`);
  await page.locator("#broker-endpoint").fill(fixtureServer.origin);
  await page.locator("#broker-token").fill(fixtureServer.token);
  await page.getByRole("button", { name: "Save & connect" }).click();
  // Native extension permission prompts are outside Playwright's page DOM.
  // Exercise the real pending-permission path; accept/deny responses are covered
  // by browser-settings.test.js and browser-pairing.test.js.
  await expect(page.locator("#status-text")).toContainText("Requesting access");
  await expect(page.getByRole("button", { name: "Connecting…" })).toBeDisabled();
  expect((await permissions()).origins || []).toEqual([]);
  const config = await extensionWorker.evaluate(() => chrome.storage.local.get(["brokerEndpoint", "brokerToken"]));
  expect(config).toEqual({});
});
