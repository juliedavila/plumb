// The fictional delivery stream with repeatable notes and a presented report.
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBundle } from "../src/core/bundle.ts";
import { makeSnapshot, saveSnapshot } from "../src/core/snapshot.ts";
export const DS_DIR = mkdtempSync(join(tmpdir(), "plumb-delivery-"));
cpSync(join(import.meta.dir, "../examples/delivery-stream"), DS_DIR, { recursive: true });
for (const x of ["reports", "diffs"]) rmSync(join(DS_DIR, x), { recursive: true, force: true });
cpSync(join(import.meta.dir, "fixtures/state/delivery-stream/notes.yaml"), join(DS_DIR, "notes.yaml"));
const inventory = join(DS_DIR, "tracker/inventory.json");
if (existsSync(inventory)) {
  const j = JSON.parse(readFileSync(inventory,"utf8"));
  if (j.source?.dir) { j.source.dir = join(import.meta.dir,"fixtures/jira-delivery"); writeFileSync(inventory, JSON.stringify(j,null,2)+"\n"); }
}
saveSnapshot(DS_DIR, makeSnapshot((await buildBundle(DS_DIR, { built: "2026-10-20T09:00:00.000Z" })).bundle, { presented: true, now: new Date("2026-10-20T09:00:00Z") }));
export const HAVE_MCP_SERVER = existsSync(join(import.meta.dir, "../src/mcp/server.ts"));
