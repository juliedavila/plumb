// `bun plumb.ts brief`: what changed and what needs a person, read-only, from the same bundle the page shows.
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { briefMd } from "../src/core/brief-cli.ts";
import { buildBundle } from "../src/core/bundle.ts";
import { DS_DIR } from "./instance-dirs.ts";

describe("plumb brief", () => {
  test("status, since the last report, what needs a person, and what can start now, in that order; it writes nothing", async () => {
    const before = readdirSync(DS_DIR, { recursive: true }).sort();
    const md = await briefMd(DS_DIR);
    expect(readdirSync(DS_DIR, { recursive: true }).sort()).toEqual(before);
    const heads = [...md.matchAll(/^##+ (.+)$/gm)].map((m) => m[1].replace(/ \(.*$/, ""));
    expect(heads).toEqual(["Status", "Since the last report", "Needs a person", "Open questions in notes.yaml", "Proposed patches", "Error findings", "Tracker", "Can start now"]);
    const { bundle: b } = await buildBundle(DS_DIR);
    expect(md).toContain(b.status!.overall.lead!.text);
    const open = b.notes!.items.filter((n) => n.status === "open" && n.kind === "question");
    expect(md).toContain(`### Open questions in notes.yaml (${open.length})`);
    for (const n of open) expect(md).toContain(`\`${n.id}\``);
    for (const p of b.patches.filter((x) => x.status === "proposed")) expect(md).toContain(`\`${p.id}\` `);
    expect(md).toMatch(/status disagreements/);
    expect(md).toContain(`Model hash \`${b.engine.modelHash!.slice(0, 12)}\``);
  });
});

