// Notes and questions (core): parsing notes.yaml, the in-place writer that keeps comments and order, the orphan rule
// (including notes on findings, checked after the rules run), and the read-only MCP tool.
import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBundle } from "../src/core/bundle.ts";
import { editNotesText, nextNoteId, noteBlocks, notesVersion, parseNotes, sortNotes } from "../src/core/notes.ts";
import { call } from "../src/mcp/tools.ts";
import type { Note } from "../src/types.ts";
import { DS_DIR } from "./instance-dirs.ts";

const MINI = join(import.meta.dir, "fixtures/mini");
const FILE = `# Hand-written header comment
notes:
  # the first question, about the queue
  - id: N-1
    target: { kind: element, id: q }
    kind: question
    text: "Who sets the limit?"
    status: open
    author: person
    created: "2026-10-01T09:00:00Z"
    updated: "2026-10-01T09:00:00Z"
  - id: N-2   # a trailing comment
    target: { kind: unit, id: U-1 }
    kind: note
    text: Plain scalar text, written by hand.
    status: open
    author: agent
    created: "2026-10-02T09:00:00Z"
    updated: "2026-10-02T09:00:00Z"
# a comment after the list
`;
const note = (over: Partial<Note> = {}): Note => ({ id: "N-3", target: { kind: "element", id: "q" }, kind: "note", text: "New", status: "open", author: "person", created: "2026-10-03T09:00:00Z", updated: "2026-10-03T09:00:00Z", ...over });

describe("parse", () => {
  test("reads notes with their targets, kinds and statuses", () => {
    const { notes, problems } = parseNotes(FILE);
    expect(problems).toEqual([]);
    expect(notes.map((n) => [n.id, n.target.kind, n.target.id, n.kind, n.status, n.author])).toEqual([["N-1", "element", "q", "question", "open", "person"], ["N-2", "unit", "U-1", "note", "open", "agent"]]);
  });
  test("bad notes are reported, never thrown", () => {
    expect(parseNotes("notes: [1, {id: N-9}]").problems.length).toBe(2);
    expect(parseNotes("notes: [").problems[0]).toContain("YAML parse error");
    expect(parseNotes("notes:\n  - { id: N-1, target: { kind: element, id: a }, text: x }\n  - { id: N-1, target: { kind: element, id: a }, text: y }").problems[0]).toContain("share the id");
  });
  test("an answer with no status reads as answered; open questions sort first", () => {
    const { notes } = parseNotes("notes:\n  - { id: N-1, target: { kind: element, id: a }, kind: note, text: x }\n  - { id: N-2, target: { kind: element, id: a }, kind: question, text: y, answer: z }\n  - { id: N-3, target: { kind: element, id: a }, kind: question, text: w }");
    expect(notes[1].status).toBe("answered");
    expect(sortNotes(notes).map((n) => n.id)).toEqual(["N-3", "N-1", "N-2"]);
    expect(nextNoteId(notes)).toBe("N-4");
  });
  test("the version is a hash of the bytes", () => {
    expect(notesVersion(FILE)).toBe(notesVersion(FILE));
    expect(notesVersion(FILE + " ")).not.toBe(notesVersion(FILE));
    expect(notesVersion(undefined)).toBe("none");
  });
});

describe("the in-place writer", () => {
  test("finds one block per note", () => {
    expect(noteBlocks(FILE)!.length).toBe(2);
  });
  test("replacing a note touches only its lines: comments and the other note stay byte for byte", () => {
    const n1 = parseNotes(FILE).notes[0];
    const out = editNotesText(FILE, { op: "replace", id: "N-1", note: { ...n1, status: "answered", answer: "The queue's owner.", updated: "2026-10-05T10:00:00Z" } });
    expect(out).toContain("# Hand-written header comment");
    expect(out).toContain("# the first question, about the queue");
    expect(out).toContain("  - id: N-2   # a trailing comment\n");
    expect(out).toContain("    text: Plain scalar text, written by hand.\n");
    expect(out).toContain("# a comment after the list");
    const back = parseNotes(out).notes;
    expect(back[0]).toMatchObject({ id: "N-1", status: "answered", answer: "The queue's owner." });
    expect(back[1]).toEqual(parseNotes(FILE).notes[1]);
  });
  test("adding appends after the last note; deleting removes just that block", () => {
    const added = editNotesText(FILE, { op: "add", note: note({ text: 'Quotes " and \\ and\nnewlines' }) });
    const ns = parseNotes(added).notes;
    expect(ns.map((n) => n.id)).toEqual(["N-1", "N-2", "N-3"]);
    expect(ns[2].text).toBe('Quotes " and \\ and\nnewlines');
    expect(added.endsWith("# a comment after the list\n")).toBe(true);
    const del = editNotesText(added, { op: "delete", id: "N-2" });
    expect(parseNotes(del).notes.map((n) => n.id)).toEqual(["N-1", "N-3"]);
    expect(del).toContain("# the first question, about the queue");
  });
  test("no file yet: a new file with a header; an empty list: the first note", () => {
    expect(parseNotes(editNotesText(undefined, { op: "add", note: note() })).notes).toHaveLength(1);
    expect(parseNotes(editNotesText("notes: []\n", { op: "add", note: note() })).notes).toHaveLength(1);
  });
  test("an unusual layout falls back to a whole rewrite that keeps the notes", () => {
    const flow = "# kept\nnotes: [{ id: N-1, target: { kind: element, id: q }, kind: note, text: a }]\n";
    const out = editNotesText(flow, { op: "add", note: note() });
    expect(out.startsWith("# kept\nnotes:\n")).toBe(true);
    expect(parseNotes(out).notes.map((n) => n.id)).toEqual(["N-1", "N-3"]);
  });
});

describe("in the build", async () => {
  const inst = mkdtempSync(join(tmpdir(), "plumb-notes-"));
  cpSync(DS_DIR, inst, { recursive: true });
  const { bundle: plain } = await buildBundle(inst);
  const someFinding = plain.findings.find((f) => f.pack !== "core")!;
  writeFileSync(join(inst, "notes.yaml"), `notes:
  - { id: N-1, target: { kind: element, id: ${plain.model.elements[0].id} }, kind: question, text: "Live?", status: open }
  - { id: N-2, target: { kind: element, id: gone-part }, kind: note, text: "Orphan" }
  - { id: N-3, target: { kind: finding, id: "${someFinding.pack}/${someFinding.rule}@${someFinding.at}" }, kind: note, text: "On a finding" }
  - { id: N-4, target: { kind: finding, id: "generic/nope@x" }, kind: question, text: "On a finding that no longer fires" }
  - { id: N-5, target: { kind: patch, id: ${plain.patches[0]?.id ?? "P-1"} }, kind: note, text: "On a patch" }
`);
  const { bundle, warnings } = await buildBundle(inst);
  test("the bundle carries the notes, sorted, with the file version", () => {
    expect(bundle.notes!.items.map((n) => n.id)[0]).toBe("N-1");
    expect(bundle.notes!.version).toMatch(/^[0-9a-f]{16}$/);
    expect(warnings).toEqual([]);
  });
  test("orphaned notes are warnings, on records and on findings that no longer fire", () => {
    const orphans = bundle.findings.filter((f) => f.pack === "notes").map((f) => f.at).sort();
    expect(orphans).toEqual(["N-2", "N-4"]);
    expect(bundle.instance.packs.map((p) => p.name)).toContain("notes");
  });
  test("the MCP notes tool lists and filters, read-only", () => {
    expect(call(bundle, "notes", {}).text).toContain("5 of 5 notes (2 open questions");
    expect(call(bundle, "notes", { status: "open", kind: "question" }).text.split("\n")).toHaveLength(3);
    expect(call(bundle, "notes", { target_kind: "finding" }).text).toContain("N-3");
  });
});

describe("an agent's answer carries its sources", () => {
  test("sources parse as a list, survive the writer, and show under the answer on the page", async () => {
    const { parseNotes, noteYaml } = await import("../src/core/notes.ts");
    const text = `notes:\n  - id: N-1\n    target: { kind: claim, id: PR-2 }\n    kind: question\n    text: "Which milestone tests it?"\n    status: answered\n    answer: "Its first test lands in Shorten it."\n    answered_by: agent\n    sources: ["bun plumb.ts premise examples/delivery-stream PR-2", "build/delivery-stream/bundle.json premises.PR-2.exposure"]\n    author: person\n    created: "2026-10-22T09:00:00Z"\n    updated: "2026-10-22T09:30:00Z"\n`;
    const { notes, problems } = parseNotes(text);
    expect(problems).toEqual([]);
    expect(notes[0].sources).toEqual(["bun plumb.ts premise examples/delivery-stream PR-2", "build/delivery-stream/bundle.json premises.PR-2.exposure"]);
    expect(parseNotes("notes:\n" + noteYaml(notes[0])).notes[0]).toEqual(notes[0]);
    expect(parseNotes(text.replace(/sources: \[.*\]/, "sources: { a: 1 }")).problems).toEqual(["notes.yaml N-1: sources must be a list of strings"]);
    const { CLIENT_JS } = await import("../src/site/render.ts");
    const DE = new Function(`${CLIENT_JS}; return DE;`)();
    const { buildBundle } = await import("../src/core/bundle.ts");
    const { DS_DIR } = await import("./instance-dirs.ts");
    const { bundle } = await buildBundle(DS_DIR, { built: "test" });
    bundle.notes = { version: "x", items: notes };
    const h = DE.notesBlock(DE.buildIndex(bundle), [{ kind: "claim", id: "PR-2" }], {});
    expect(h).toContain("Answered by Claude");
    expect(h).toContain('class="note-sources');
    expect(h).toContain("Sources: bun plumb.ts premise examples/delivery-stream <a class=\"ref inline-ref\" href=\"#strategy/claim/PR-2\""); // an id in a source becomes a reference
    expect(h).toContain("; build/delivery-stream/bundle.json premises.PR-2.exposure</p>");
  });
});
