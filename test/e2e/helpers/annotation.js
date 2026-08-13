export async function annotate(page, targetSelector, comment) {
  await page.locator(targetSelector).click();
  const note = page.locator(".pi-note-card:has(.pi-note-textarea:focus)");
  await note.waitFor({ state: "visible" });
  await note.locator(".pi-note-textarea").fill(comment);
  return note;
}

export async function sendOpenElementAnnotations(page) {
  for (let remaining = 20; remaining > 0; remaining -= 1) {
    const allSteps = page.getByRole("button", { name: /^All steps/ });
    if (await allSteps.count()) {
      if (!await allSteps.isVisible()) await page.getByRole("button", { name: /^More options/ }).click();
      await allSteps.click();
      await page.locator("#pi-advanced").evaluate((details) => { details.open = false; });
    }
    const openNote = page.locator(".pi-note-card").filter({ visible: true }).first();
    if (!await openNote.count()) return;
    const annotationId = await openNote.getAttribute("data-annotation-id");
    await openNote.getByRole("button", { name: "Send comment" }).click();
    await page.waitForFunction(() => !document.querySelector("#pi-panel")?.classList.contains("pi-busy"));
    await page.locator(`.pi-note-card[data-annotation-id="${annotationId}"]`).waitFor({ state: "detached" });
  }
  throw new Error("Too many open Element annotations to submit in one test");
}

export async function submitAnnotation(page) {
  await sendOpenElementAnnotations(page);
  await page.getByRole("button", { name: /^Submit/ }).click();
}
