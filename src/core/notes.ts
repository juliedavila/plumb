import { parseYaml } from "./yaml.ts";
// Notes and questions pinned to records: <instance>/notes.yaml.
//
//   notes:
//     - id: N-1
//       target: { kind: element, id: ci-pipeline }   # a finding is named pack/rule@at
//       kind: question                               # note | question
//       text: "Who owns the flaky-test budget?"
//       status: open                                 # open | answered | resolved
//       answer: "The platform team, from next sprint." # optional
//       answered_by: person                          # person | agent: who wrote the answer (Claude writes agent)
//       sources: ["bun plumb.ts premise examples/designs/premerge PM-1"]  # optional: what the answer was read from
//       author: person                               # person | agent
//       created: "2026-10-22T09:00:00Z"
//       updated: "2026-10-22T09:00:00Z"
//
// People, agents and the dev server's page all write this file. The writer here edits one note's block at a time and
// keeps every other line as it was (comments, order, spacing), so an edit from the page never rewrites what someone
// typed by hand. The version is a hash of the file's bytes: a write names the version it was based on, and a write
// against an older version is refused (src/dev/notes-api.ts).

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Note, NotesFile, NoteKind, NoteStatus, NoteTargetKind } from "../types.ts";
import { natCompare, sha256 } from "./util.ts";

export const NOTES_FILE = "notes.yaml";
export const NOTE_TARGET_KINDS: NoteTargetKind[] = ["element", "relationship", "contract", "unit", "phase", "claim", "patch", "finding", "team", "design", "portfolio", "system", "zone", "seam", "capability", "manual-work", "activity", "slowdown", "exception"];
export const NOTE_KINDS: NoteKind[] = ["note", "question"];
export const NOTE_STATUSES: NoteStatus[] = ["open", "answered", "resolved"];
export const NOTE_AUTHORS = ["person", "agent"] as const;
export const NOTE_TEXT_MAX = 10_000;

/** The version of a notes file: a short hash of its bytes, or "none" when there is no file. */
export function notesVersion(text: string | undefined): string {
  return text === undefined ? "none" : sha256(text).slice(0, 16);
}

type Raw = Record<string, unknown>;
const s = (v: unknown) => (v === undefined || v === null ? undefined : String(v));

/** Normalize one raw note; problems are pushed, and a note with no usable target or text is dropped. */
export function normNote(raw: unknown, i: number, problems: string[]): Note | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) { problems.push(`notes.yaml note ${i + 1}: not a mapping; skipped`); return undefined; }
  const r = raw as Raw;
  const id = s(r.id) ?? `N-${i + 1}`;
  const t = r.target && typeof r.target === "object" && !Array.isArray(r.target) ? (r.target as Raw) : undefined;
  const tk = s(t?.kind)?.trim().toLowerCase(), tid = s(t?.id)?.trim();
  if (!tk || !tid) { problems.push(`notes.yaml ${id}: target needs a kind and an id, like { kind: element, id: ci-pipeline }; skipped`); return undefined; }
  if (!NOTE_TARGET_KINDS.includes(tk as NoteTargetKind)) problems.push(`notes.yaml ${id}: target kind "${tk}" is not one of ${NOTE_TARGET_KINDS.join(", ")}`);
  const kind = (s(r.kind)?.trim().toLowerCase() ?? "note") as NoteKind;
  if (!NOTE_KINDS.includes(kind)) problems.push(`notes.yaml ${id}: kind "${kind}" is not note or question`);
  const status = (s(r.status)?.trim().toLowerCase() ?? (s(r.answer) ? "answered" : "open")) as NoteStatus;
  if (!NOTE_STATUSES.includes(status)) problems.push(`notes.yaml ${id}: status "${status}" is not one of ${NOTE_STATUSES.join(", ")}`);
  const author = (s(r.author)?.trim().toLowerCase() ?? "person") as Note["author"];
  const n: Note = {
    id, target: { kind: tk as NoteTargetKind, id: tid }, kind, text: s(r.text) ?? "", status,
    author: NOTE_AUTHORS.includes(author as any) ? author : "person",
    created: s(r.created) ?? "", updated: s(r.updated) ?? s(r.created) ?? "",
  };
  const answer = s(r.answer);
  if (answer !== undefined && answer !== "") n.answer = answer;
  const by = s(r.answered_by)?.trim().toLowerCase();
  if (by !== undefined && by !== "") {
    if (NOTE_AUTHORS.includes(by as any)) n.answered_by = by as Note["answered_by"];
    else problems.push(`notes.yaml ${id}: answered_by "${by}" is not person or agent`);
  }
  if (r.sources != null) {
    const src = Array.isArray(r.sources) ? r.sources.map((x) => s(x)?.trim() ?? "").filter(Boolean) : typeof r.sources === "string" ? [r.sources.trim()].filter(Boolean) : undefined;
    if (src === undefined) problems.push(`notes.yaml ${id}: sources must be a list of strings`);
    else if (src.length) n.sources = src;
  }
  return n;
}

/** Parse notes.yaml text. Never throws: a file that does not parse gives no notes and one problem. */
export function parseNotes(text: string): { notes: Note[]; problems: string[] } {
  const problems: string[] = [];
  let raw: unknown;
  try { raw = parseYaml(text,"notes.yaml"); } catch (e) { return { notes: [], problems: [`notes.yaml: YAML parse error: ${(e as Error).message}`] }; }
  if (raw === null || raw === undefined) return { notes: [], problems };
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? (raw as Raw).notes : undefined;
  if (list === undefined || list === null) return { notes: [], problems };
  if (!Array.isArray(list)) return { notes: [], problems: ["notes.yaml: `notes` must be a list"] };
  const notes: Note[] = [];
  const seen = new Set<string>();
  list.forEach((x, i) => {
    const n = normNote(x, i, problems);
    if (!n) return;
    if (seen.has(n.id)) { problems.push(`notes.yaml: two notes share the id ${n.id}; the second is skipped`); return; }
    seen.add(n.id); notes.push(n);
  });
  return { notes, problems };
}

/** Read <dir>/notes.yaml. Absent: undefined (the instance has no notes). */
export function loadNotes(dir: string): NotesFile | undefined {
  const path = join(dir, NOTES_FILE);
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, "utf8");
  return { ...parseNotes(text), version: notesVersion(text) };
}

// ---------- writing ----------

const q = (v: string) => JSON.stringify(v); // a JSON string is a valid YAML double-quoted scalar
const plainId = (v: string) => (/^[A-Za-z0-9][A-Za-z0-9._/@:-]*$/.test(v) && !/^(true|false|null|yes|no|on|off|~)$/i.test(v) && !/^[0-9.+-]+$/.test(v) ? v : q(v));

/** One note as a YAML list item, indented under `notes:`. Field order is fixed; strings are double-quoted. */
export function noteYaml(n: Note, indent = "  "): string {
  const i2 = indent + "  ";
  const lines = [
    `${indent}- id: ${plainId(n.id)}`,
    `${i2}target: { kind: ${n.target.kind}, id: ${plainId(n.target.id)} }`,
    `${i2}kind: ${n.kind}`,
    `${i2}text: ${q(n.text)}`,
    `${i2}status: ${n.status}`,
    ...(n.answer !== undefined && n.answer !== "" ? [`${i2}answer: ${q(n.answer)}`] : []),
    ...(n.answered_by ? [`${i2}answered_by: ${n.answered_by}`] : []),
    ...(n.sources?.length ? [`${i2}sources: [${n.sources.map(q).join(", ")}]`] : []),
    `${i2}author: ${n.author}`,
    `${i2}created: ${q(n.created)}`,
    `${i2}updated: ${q(n.updated)}`,
  ];
  return lines.join("\n") + "\n";
}

export const NOTES_HEADER = `# Notes and questions pinned to records of this design. People, agents and the page (under \`bun plumb.ts dev\`) all
# write here. target.kind is element, relationship, contract, unit, phase, claim, patch or finding (a finding is named
# pack/rule@at). To answer a question: set answer, set answered_by (person, or agent when Claude answers), set status
# to answered, and set updated to the current time.
notes:
`;

/** A whole file for a list of notes, used when there is no file yet or its layout cannot be edited in place. */
export function notesFileText(notes: Note[], header = NOTES_HEADER): string {
  return header + notes.map((n) => noteYaml(n)).join("");
}

/**
 * The list items under the top-level `notes:` key, as line ranges. Undefined when the file's layout is not the simple
 * one this writer edits in place (then the caller rewrites the file whole).
 */
export function noteBlocks(text: string): { start: number; end: number; indent: string }[] | undefined {
  const lines = text.split("\n");
  const k = lines.findIndex((l) => /^notes:\s*(#.*)?$/.test(l));
  if (k < 0) return undefined;
  const blocks: { start: number; end: number; indent: string }[] = [];
  let i = k + 1, indent: string | undefined;
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (/^\S/.test(l) && !/^#/.test(l)) break; // the next top-level key
    const m = /^(\s*)- /.exec(l);
    if (m && (indent === undefined || m[1] === indent)) {
      indent ??= m[1];
      if (blocks.length) blocks[blocks.length - 1].end = i;
      blocks.push({ start: i, end: i + 1, indent });
    }
  }
  if (blocks.length) {
    // the last block runs to the next top-level key, less trailing blank and comment lines
    let end = i;
    while (end > blocks[blocks.length - 1].start + 1 && /^\s*(#.*)?$/.test(lines[end - 1])) end--;
    blocks[blocks.length - 1].end = end;
  }
  return blocks;
}

export type NoteEdit =
  | { op: "add"; note: Note }
  | { op: "replace"; id: string; note: Note }
  | { op: "delete"; id: string };

/**
 * Apply one edit to the file's text, touching only the edited note's lines. Comments, order and every other note stay
 * byte for byte. Falls back to a whole rewrite (keeping the header comment) when the file's layout is unusual.
 */
export function editNotesText(text: string | undefined, edit: NoteEdit): string {
  if (text === undefined || !text.trim()) return notesFileText(edit.op === "add" ? [edit.note] : []);
  const { notes } = parseNotes(text);
  const blocks = noteBlocks(text);
  const lines = text.split("\n");
  let raw: unknown;
  try { raw = parseYaml(text,"notes.yaml"); } catch { raw = undefined; }
  const rawList = raw && typeof raw === "object" && !Array.isArray(raw) && Array.isArray((raw as Raw).notes) ? ((raw as Raw).notes as unknown[]) : undefined;
  const inPlace = blocks && rawList && blocks.length === rawList.length;
  if (!inPlace) {
    const head = text.match(/^(?:#.*\n)*/)?.[0] ?? "";
    const next = edit.op === "add" ? [...notes, edit.note] : edit.op === "delete" ? notes.filter((n) => n.id !== edit.id) : notes.map((n) => (n.id === edit.id ? edit.note : n));
    return notesFileText(next, head ? head + "notes:\n" : NOTES_HEADER);
  }
  const idOf = (j: number) => { const r = rawList![j]; return r && typeof r === "object" ? s((r as Raw).id) : undefined; };
  if (edit.op === "add") {
    const indent = blocks!.length ? blocks![blocks!.length - 1].indent : "  ";
    const at = blocks!.length ? blocks![blocks!.length - 1].end : lines.findIndex((l) => /^notes:/.test(l)) + 1;
    const ins = noteYaml(edit.note, indent).replace(/\n$/, "").split("\n");
    const head = lines.slice(0, at);
    // "notes: []" or "notes:" with nothing under it
    if (!blocks!.length) {
      const k = lines.findIndex((l) => /^notes:/.test(l));
      head[k] = "notes:";
    }
    return [...head, ...ins, ...lines.slice(at)].join("\n");
  }
  const j = rawList!.findIndex((_, x) => idOf(x) === edit.id);
  if (j < 0) throw new Error(`no note ${edit.id} in notes.yaml`);
  const b = blocks![j];
  const repl = edit.op === "delete" ? [] : noteYaml(edit.note, b.indent).replace(/\n$/, "").split("\n");
  return [...lines.slice(0, b.start), ...repl, ...lines.slice(b.end)].join("\n");
}

/** The next free note id: N-<highest number + 1>. */
export function nextNoteId(notes: Note[]): string {
  let max = 0;
  for (const n of notes) { const m = /^N-(\d+)$/.exec(n.id); if (m) max = Math.max(max, Number(m[1])); }
  return `N-${max + 1}`;
}

/** Notes in reading order: open questions first, then open notes, answered, resolved; newest first inside each. */
export function sortNotes(notes: Note[]): Note[] {
  const rank = (n: Note) => (n.status === "open" ? (n.kind === "question" ? 0 : 1) : n.status === "answered" ? 2 : 3);
  return [...notes].sort((a, b) => rank(a) - rank(b) || (b.updated || "").localeCompare(a.updated || "") || natCompare(a.id, b.id));
}

/** A finding's note id: pack/rule@at. */
export const findingNoteId = (f: { pack: string; rule: string; at: string }) => `${f.pack}/${f.rule}@${f.at}`;

/** The shared file write path for the page and generated vault annotations. */
export function writeNoteEdit(dir: string, expectedVersion: string, edit: NoteEdit): string {
  const path = join(dir, NOTES_FILE);
  const read = () => existsSync(path) ? readFileSync(path, "utf8") : undefined;
  const before = read();
  if (notesVersion(before) !== expectedVersion) throw new Error("notes.yaml changed; reload before saving");
  if (before !== undefined && parseNotes(before).problems.length) throw new Error("notes.yaml has problems; repair it before saving");
  const out = editNotesText(before, edit);
  const tmp = join(dir, `.${NOTES_FILE}.${crypto.randomUUID()}.tmp`);
  writeFileSync(tmp, out);
  if (notesVersion(read()) !== expectedVersion) throw new Error("notes.yaml changed before saving");
  renameSync(tmp, path);
  return out;
}
