export async function annotate(page, targetSelector, comment) {
  await page.locator(targetSelector).click();
  const note = page.locator(".pi-note-card:has(.pi-note-textarea:focus)");
  await note.waitFor({ state: "visible" });
  await note.locator(".pi-note-textarea").fill(comment);
  return note;
}

export async function sendOpenElementAnnotations(page) {
  const allSteps = page.getByRole("button", { name: /^All steps/ });
  if (await allSteps.count()) await allSteps.click();
  const sendButtons = page.getByRole("button", { name: "Send comment" });
  while (await sendButtons.count()) {
    await sendButtons.first().click();
  }
}

export async function submitAnnotation(page) {
  await sendOpenElementAnnotations(page);
  await page.getByRole("button", { name: /^Submit/ }).click();
}
