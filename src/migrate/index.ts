import { invocation } from "../core/invocation.ts";
// `bun plumb.ts migrate <instance> [--to 0.4] [--root <dir>] [--moved <file>] [--dry-run]`.
//
// Runs src/migrate/<from>-<to>.ts in order, from the schema the instance declares (0.3 when it declares none) up to
// --to (default: this engine's). Each step is idempotent and rewrites hand-written files in place, keeping comments;
// generated files are left to their importer. --moved rewrites the ids a split moved (src/migrate/moved.ts).
// --dry-run prints what would change and writes nothing. The changes are reviewed like a patch.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { cmpVersion, SCHEMA_NOW } from "../core/schema.ts";
import { today as todayLocal } from "../core/edition.ts";
import { step0304 } from "./0.3-0.4.ts";
import { movedEdits, readMoved } from "./moved.ts";
import { lineDiff, topValue } from "./text.ts";

export interface MigrateOptions { to?: string; root?: string; moved?: string; dryRun?: boolean; today?: string }

/** What a step reads and writes: files through an overlay, so a dry run and a real run take the same path. */
export interface Workspace {
  dir: string; opts: MigrateOptions; today: string;
  read(path: string): string | undefined;          // the overlay's text, else the file's, else undefined
  write(path: string, text: string): void;         // into the overlay; written at the end unless --dry-run
  note(s: string): void;
  pending(dir: string): string[];                  // file names the overlay adds in a folder
}

export interface MigrateStep { from: string; to: string; run(ws: Workspace): void }

/** Every step, in order. A new minor version adds one file and one entry. */
export const STEPS: MigrateStep[] = [step0304];

export interface Change { path: string; before?: string; after: string }
export interface Migration { dir: string; from: string; to: string; steps: string[]; changes: Change[]; notes: string[] }

/** Work out a migration without writing anything. Throws, in words, for a target this engine does not know. */
export function planMigration(dirIn: string, opts: MigrateOptions = {}): Migration {
  const dir = resolve(dirIn);
  const engine = join(dir, "engine.yaml");
  if (!existsSync(engine)) throw new Error(`${dirIn}: no engine.yaml, so this is not an instance directory`);
  const from = (topValue(readFileSync(engine, "utf8"), "schema") ?? "").replace(/^["']|["']$/g, "") || "0.3";
  const to = opts.to ?? SCHEMA_NOW;
  if (cmpVersion(to, SCHEMA_NOW) === undefined || cmpVersion(to, SCHEMA_NOW)! > 0) throw new Error(`--to ${to}: this engine migrates up to ${SCHEMA_NOW}`);
  if (cmpVersion(from, SCHEMA_NOW) === undefined) throw new Error(`engine.yaml declares schema "${from}", which is not a schema version`);
  if (cmpVersion(from, to)! > 0) throw new Error(`the instance is at schema ${from}, newer than --to ${to}; migrate never goes down`);
  const overlay = new Map<string, string>(), notes: string[] = [];
  const ws: Workspace = {
    dir, opts, today: opts.today ?? todayLocal(),
    read: (p) => (overlay.has(p) ? overlay.get(p) : existsSync(p) ? readFileSync(p, "utf8") : undefined),
    write: (p, t) => { overlay.set(p, t); },
    note: (s) => { notes.push(s); },
    pending: (d) => [...overlay.keys()].filter((p) => dirname(p) === d).map((p) => basename(p)),
  };
  // every step up to the target runs: each is idempotent, so a step already taken changes nothing (and --root still applies)
  const steps = STEPS.filter((s) => cmpVersion(s.to, to)! <= 0);
  for (const s of steps) s.run(ws);
  if (opts.moved) {
    const moved = readMoved(resolve(opts.moved));
    // read through the overlay, so a key rename and a moved id in one file compose
    const { edits, skipped } = movedEdits(dir, moved, (path) => ws.read(path));
    for (const e of edits) ws.write(join(dir, e.file), e.after);
    for (const f of skipped) notes.push(`${f} is generated, so its importer rewrites the moved ids`);
    notes.push(`${edits.reduce((n, e) => n + e.count, 0)} uses of ${moved.size} moved ids rewritten in ${edits.length} ${edits.length === 1 ? "file" : "files"}`);
  }
  const changes: Change[] = [];
  for (const [path, after] of [...overlay].sort(([a], [b]) => a.localeCompare(b))) {
    const before = existsSync(path) ? readFileSync(path, "utf8") : undefined;
    if (before !== after) changes.push({ path, ...(before !== undefined ? { before } : {}), after });
  }
  return { dir, from, to, steps: steps.map((s) => `${s.from}-${s.to}`), changes, notes };
}

/** Write a migration's changes. */
export function applyMigration(m: Migration): void {
  for (const c of m.changes) { mkdirSync(dirname(c.path), { recursive: true }); writeFileSync(c.path, c.after); }
}

export const MIGRATE_USAGE = `usage: ${invocation()} migrate <instance-dir> [--to 0.4] [--root <dir>] [--moved <file>] [--dry-run]`;

export function migrateCli(dir: string, args: string[]): number {
  const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  for (const k of ["--to", "--root", "--moved"]) if (args.includes(k) && !opt(k)) { process.stderr.write(`${k} needs a value\n${MIGRATE_USAGE}\n`); return 2; }
  let m: Migration;
  try { m = planMigration(dir, { to: opt("--to"), root: opt("--root"), moved: opt("--moved"), dryRun: args.includes("--dry-run") }); }
  catch (e) { process.stderr.write(`migrate: ${(e as Error).message}\n`); return 2; }
  const rel = (p: string) => relative(process.cwd(), p) || p;
  const lines = [`# Migrate ${rel(m.dir)}: schema ${m.from} to ${m.to}${args.includes("--dry-run") ? " (dry run: nothing written)" : ""}`, ""];
  if (!m.changes.length) lines.push("Nothing to change: the instance is migrated.");
  for (const c of m.changes) lines.push(`- ${rel(c.path)}${c.before === undefined ? " (new)" : ""}`);
  if (m.notes.length) lines.push("", ...m.notes.map((n) => `Note: ${n}`));
  if (args.includes("--dry-run") && m.changes.length) { lines.push(""); for (const c of m.changes) lines.push(...lineDiff(rel(c.path), c.before, c.after), ""); }
  else applyMigration(m);
  console.log(lines.join("\n"));
  return 0;
}
