export async function annotate(page, targetSelector, comment) {
  await page.locator(targetSelector).click();
  const note = page.locator(".pi-note-card:has(.pi-note-textarea:focus)");
  await note.waitFor({ state: "visible" });
  await note.locator(".pi-note-textarea").fill(comment);
  return note;
}
