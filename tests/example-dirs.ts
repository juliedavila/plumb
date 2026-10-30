// Tests reconstruct excluded working state in a temporary copy, in a checkout and a portable bundle alike.
import { cpSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const source = join(import.meta.dir, "../examples");
export const EX_DIR = existsSync(source) ? mkdtempSync(join(tmpdir(), "plumb-examples-state-")) : source;
if (existsSync(source)) {
  cpSync(source, EX_DIR, { recursive: true });
  if (!existsSync(join(EX_DIR, "shared/tracker/measures/2026-11-01.json"))) {
    const r = Bun.spawnSync([process.execPath, join(import.meta.dir, "../plumb.ts"), "tracker", "measure", join(EX_DIR, "shared"), "--today", "2026-11-02"], { stdout: "pipe", stderr: "pipe" });
    if (r.exitCode) throw new Error(`cannot prepare example tracker measure: ${r.stderr.toString()}${r.stdout.toString()}`);
  }
}
