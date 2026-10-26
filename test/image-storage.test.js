import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, stat, symlink, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { writeTemporaryImage } from "../annotation/images.ts";

test("screenshots are private and cannot overwrite an existing file or symlink", async () => {
  const name = `pi-annotate-security-${randomUUID()}.png`;
  const target = join(tmpdir(), name);
  const linkName = `pi-annotate-security-${randomUUID()}.png`;
  const linkPath = join(tmpdir(), linkName);
  try {
    const path = await writeTemporaryImage(name, Buffer.from("original"));
    if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);
    await assert.rejects(writeTemporaryImage(name, Buffer.from("replacement")), { code: "EEXIST" });
    await symlink(target, linkPath);
    await assert.rejects(writeTemporaryImage(linkName, Buffer.from("replacement")), { code: "EEXIST" });
    assert.equal(await readFile(target, "utf8"), "original");
  } finally {
    await unlink(linkPath).catch(error => { if (error.code !== "ENOENT") throw error; });
    await unlink(target).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
});
