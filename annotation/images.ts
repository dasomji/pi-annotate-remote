import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const MAX_SCREENSHOT_BYTES = 15 * 1024 * 1024;
export type ImageWriter = (filename: string, bytes: Uint8Array) => Promise<string>;

export async function writeTemporaryImage(filename: string, bytes: Uint8Array): Promise<string> {
  const imagePath = join(tmpdir(), filename);
  await writeFile(imagePath, bytes);
  return imagePath;
}
