// The dev server's notes API: the only write path the page has, and only under `bun plumb.ts dev`.
//
//   GET  /__de/notes   the current notes and the file version
//   POST /__de/notes   one edit: { op, version, ... }, answered with { ok, version, note } or { error, message }
//
// A request is accepted only when all of these hold, and refused with no change otherwise:
//   - it comes to 127.0.0.1 (the server binds nowhere else) with a Host of 127.0.0.1:<port> or localhost:<port>;
//   - a POST carries an Origin of exactly http://127.0.0.1:<port> or http://localhost:<port>, and Sec-Fetch-Site, when
//     the browser sends it, is same-origin (a page on any other site cannot write);
//   - it carries the per-run token in X-DE-Token (random at each start, injected only into the page this server sends);
//   - a POST is JSON (content-type application/json, at most 64 KB) with known fields of the right types;
//   - its `version` is the version of notes.yaml as it is now. A stale write (the file changed since the page loaded it,
//     for example because Claude edited it) is refused with 409 and the current version; the page then reloads.
// A write goes to a temporary file in the instance directory and is renamed over notes.yaml, so a reader never sees
// half a file, and it edits only the lines of the note it changes (src/core/notes.ts).

import { existsSync, readFileSync } from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import type { Bundle, Note, NoteKind, NoteTargetKind } from "../types.ts";
import { writeNoteEdit, nextNoteId, NOTE_KINDS, NOTE_TARGET_KINDS, NOTE_TEXT_MAX, NOTES_FILE, notesVersion, parseNotes, type NoteEdit } from "../core/notes.ts";
import { findingNoteId } from "../core/notes.ts";

export const NOTES_PATH = "/__de/notes";
export const TOKEN_HEADER = "x-de-token";
export const MAX_BODY = 64 * 1024;

export function newToken(): string { return randomBytes(24).toString("hex"); }

export interface NotesApiContext {
  dir: string;                        // the instance directory
  port: () => number;
  token: string;
  bundle: () => Bundle | undefined;   // the last good build, to check that a new note's target exists
  now?: () => string;                 // ISO time, injectable for tests
  onWrite?: () => void;               // schedule a rebuild
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const refuse = (status: number, error: string, message: string, extra: Record<string, unknown> = {}) => json(status, { error, message, ...extra });

function sameToken(a: string | null, b: string): boolean {
  if (!a) return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The origin and host checks. Undefined when the request may proceed; else the refusal. */
export function checkOrigin(req: Request, port: number): Response | undefined {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  const host = req.headers.get("host");
  if (!host || !hosts.includes(host)) return refuse(403, "host", `Refused: the Host header must be ${hosts.join(" or ")}.`);
  if (req.method !== "GET") {
    const origin = req.headers.get("origin");
    if (!origin || !hosts.map((h) => `http://${h}`).includes(origin)) return refuse(403, "origin", "Refused: writes are accepted only from the page this server serves (Origin did not match).");
  }
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return refuse(403, "origin", "Refused: the request did not come from this page (Sec-Fetch-Site).");
  return undefined;
}

type Raw = Record<string, unknown>;
const FIELDS: Record<string, string[]> = {
  add: ["op", "version", "target", "kind", "text", "answer"],
  edit: ["op", "version", "id", "text", "kind"],
  answer: ["op", "version", "id", "answer"],
  resolve: ["op", "version", "id"],
  reopen: ["op", "version", "id"],
  delete: ["op", "version", "id"],
};

/** Validate a payload. Returns the problem as a sentence, or undefined when it is well formed. */
export function validatePayload(p: unknown): string | undefined {
  if (!p || typeof p !== "object" || Array.isArray(p)) return "The body must be a JSON object.";
  const r = p as Raw;
  const op = r.op;
  if (typeof op !== "string" || !FIELDS[op]) return `op must be one of ${Object.keys(FIELDS).join(", ")}.`;
  const extra = Object.keys(r).filter((k) => !FIELDS[op].includes(k));
  if (extra.length) return `Unknown field${extra.length === 1 ? "" : "s"} for ${op}: ${extra.join(", ")}.`;
  if (typeof r.version !== "string" || !r.version) return "version (the notes file version the page loaded) is required.";
  const text = (k: string, required: boolean) => {
    const v = r[k];
    if (v === undefined && !required) return undefined;
    if (typeof v !== "string" || !v.trim()) return `${k} must be non-empty text.`;
    if (v.length > NOTE_TEXT_MAX) return `${k} is longer than ${NOTE_TEXT_MAX} characters.`;
    return undefined;
  };
  if (op !== "add" && (typeof r.id !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(r.id))) return "id must be a note id such as N-3.";
  if (op === "add") {
    const t = r.target as Raw | undefined;
    if (!t || typeof t !== "object" || Array.isArray(t) || Object.keys(t).some((k) => k !== "kind" && k !== "id")) return "target must be { kind, id }.";
    if (typeof t.kind !== "string" || !NOTE_TARGET_KINDS.includes(t.kind as NoteTargetKind)) return `target.kind must be one of ${NOTE_TARGET_KINDS.join(", ")}.`;
    if (typeof t.id !== "string" || !t.id.trim() || t.id.length > 300) return "target.id must be a record id.";
    if (typeof r.kind !== "string" || !NOTE_KINDS.includes(r.kind as NoteKind)) return "kind must be note or question.";
    return text("text", true) ?? text("answer", false);
  }
  if (op === "edit") {
    if (r.text === undefined && r.kind === undefined) return "edit needs text or kind.";
    if (r.kind !== undefined && (typeof r.kind !== "string" || !NOTE_KINDS.includes(r.kind as NoteKind))) return "kind must be note or question.";
    return text("text", false);
  }
  if (op === "answer") return text("answer", true);
  return undefined;
}

/** Does a target name a record of the last good build? */
export function targetKnown(b: Bundle | undefined, kind: string, id: string): boolean {
  if (!b) return true;
  switch (kind) {
    case "team": return b.model.teams.some((t) => t.id === id);
    case "design": return id === (b.instance.namespace ?? b.instance.name);
    case "element": return b.model.elements.some((e) => e.id === id);
    case "relationship": return b.model.relationships.some((r) => r.id === id);
    case "contract": return b.model.contracts.some((c) => c.name === id);
    case "unit": return b.plan.units.some((u) => u.id === id);
    case "phase": return b.plan.phases.some((p) => p.id === id);
    case "claim": return (b.model.claims ?? []).some((c) => c.id === id);
    case "patch": return b.patches.some((p) => p.id === id);
    case "finding": return b.findings.some((f) => findingNoteId(f) === id);
    default: return false;
  }
}

/** Handle a request to NOTES_PATH. */
export async function handleNotes(req: Request, ctx: NotesApiContext): Promise<Response> {
  const bad = checkOrigin(req, ctx.port());
  if (bad) return bad;
  if (!sameToken(req.headers.get(TOKEN_HEADER), ctx.token)) return refuse(403, "token", "Refused: the request did not carry this run's token. Reload the page from the dev server.");
  const path = join(ctx.dir, NOTES_FILE);
  const read = () => (existsSync(path) ? readFileSync(path, "utf8") : undefined);
  if (req.method === "GET") {
    const t = read();
    return json(200, { version: notesVersion(t), notes: t === undefined ? [] : parseNotes(t).notes });
  }
  if (req.method !== "POST") return refuse(405, "method", "Only GET and POST.");
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return refuse(415, "type", "The body must be JSON (content-type application/json).");
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_BODY) return refuse(413, "size", `The body is larger than ${MAX_BODY} bytes.`);
  const body = await req.text();
  if (body.length > MAX_BODY) return refuse(413, "size", `The body is larger than ${MAX_BODY} bytes.`);
  let p: Raw;
  try { p = JSON.parse(body); } catch { return refuse(400, "invalid", "The body is not valid JSON."); }
  const problem = validatePayload(p);
  if (problem) return refuse(400, "invalid", problem);

  const text = read();
  const version = notesVersion(text);
  if (p.version !== version) return refuse(409, "stale", "The notes changed since this page loaded them (someone else, or Claude, edited notes.yaml). Nothing was saved; the page reloads the current notes.", { version });
  const notes = text === undefined ? [] : parseNotes(text).notes;
  const now = (ctx.now ?? (() => new Date().toISOString().replace(/\.\d{3}Z$/, "Z")))();
  let edit: NoteEdit, note: Note | undefined;
  if (p.op === "add") {
    const t = p.target as { kind: NoteTargetKind; id: string };
    if (!targetKnown(ctx.bundle(), t.kind, t.id.trim())) return refuse(400, "invalid", `There is no ${t.kind} ${t.id} in this build to pin a note to.`);
    const answer = typeof p.answer === "string" ? p.answer.trim() : undefined;
    note = { id: nextNoteId(notes), target: { kind: t.kind, id: t.id.trim() }, kind: p.kind as NoteKind, text: String(p.text).trim(), status: answer ? "answered" : "open", author: "person", created: now, updated: now, ...(answer ? { answer, answered_by: "person" as const } : {}) };
    edit = { op: "add", note };
  } else {
    const cur = notes.find((n) => n.id === p.id);
    if (!cur) return refuse(404, "missing", `No note ${String(p.id)} in notes.yaml.`);
    if (p.op === "delete") edit = { op: "delete", id: cur.id };
    else {
      note = { ...cur, updated: now };
      if (p.op === "edit") { if (typeof p.text === "string") note.text = p.text.trim(); if (typeof p.kind === "string") note.kind = p.kind as NoteKind; }
      if (p.op === "answer") { note.answer = String(p.answer).trim(); note.status = "answered"; note.answered_by = "person"; delete note.sources; } // the page is a person's; the old answer's sources go with it
      if (p.op === "resolve") note.status = "resolved";
      if (p.op === "reopen") note.status = "open";
      edit = { op: "replace", id: cur.id, note };
    }
  }
  let out: string;
  try { out = writeNoteEdit(ctx.dir, version, edit); }
  catch { return refuse(409, "stale", "The notes changed before saving. Reload the notes."); }
  ctx.onWrite?.();
  return json(200, { ok: true, version: notesVersion(out), ...(note ? { note } : { deleted: p.id }) });
}
