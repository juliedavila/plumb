// The dev server's notes API: the token, the Host and Origin checks, payload validation, stale versions, the atomic
// write, and the round trip between the page's writes and edits made to notes.yaml by hand (or by Claude).
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { injectReload, startDev, type DevServer } from "../src/dev/server.ts";
import { checkOrigin, validatePayload } from "../src/dev/notes-api.ts";
import { notesVersion, parseNotes } from "../src/core/notes.ts";

const MINI = join(import.meta.dir, "fixtures/mini");
const inst = mkdtempSync(join(tmpdir(), "plumb-notes-api-"));
const out = mkdtempSync(join(tmpdir(), "plumb-notes-api-out-"));
cpSync(MINI, inst, { recursive: true });
const FILE = join(inst, "notes.yaml");
writeFileSync(FILE, `# kept by hand
notes:
  - id: N-1
    target: { kind: element, id: a }
    kind: question
    text: "Who owns this?"
    status: open
    author: person
    created: "2026-10-01T09:00:00Z"
    updated: "2026-10-01T09:00:00Z"
`);
let dev: DevServer;
afterAll(() => dev?.close());
const firstEl = () => (JSON.parse(readFileSync(join(out, "bundle.json"), "utf8")).model.elements[0].id as string);

async function post(body: unknown, h: Record<string, string> = {}) {
  const port = dev.port;
  const res = await fetch(`http://127.0.0.1:${port}/__de/notes`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: `http://127.0.0.1:${port}`, "x-de-token": dev.token, ...h },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as any };
}
const version = () => notesVersion(readFileSync(FILE, "utf8"));

describe("notes API", () => {
  test("the served page carries the token and the notes version; the file on disk carries neither", async () => {
    dev = await startDev(inst, { port: 0, outDir: out, debounceMs: 30 });
    const html = await (await fetch(dev.url)).text();
    expect(html).toContain(`"token":"${dev.token}"`);
    expect(html).toContain(`"version":"${version()}"`);
    expect(html.indexOf("de-dev-config")).toBeLessThan(html.indexOf('id="de-bundle"'));
    const disk = readFileSync(join(out, "index.html"), "utf8");
    expect(disk).not.toContain(dev.token);
    expect(disk).not.toContain("de-dev-config");
    expect(injectReload("<body></body>", "p")).not.toContain("de-dev-config");
  });
  test("a write without the token, or with another token, is refused and changes nothing", async () => {
    const before = readFileSync(FILE, "utf8");
    expect((await post({ op: "resolve", id: "N-1", version: version() }, { "x-de-token": "" })).status).toBe(403);
    expect((await post({ op: "resolve", id: "N-1", version: version() }, { "x-de-token": "f".repeat(48) })).body.error).toBe("token");
    expect(readFileSync(FILE, "utf8")).toBe(before);
  });
  test("a write from another origin, or with another Host, is refused", async () => {
    expect((await post({ op: "resolve", id: "N-1", version: version() }, { origin: "http://evil.example" })).body.error).toBe("origin");
    expect((await post({ op: "resolve", id: "N-1", version: version() }, { origin: "null" })).status).toBe(403);
    expect((await post({ op: "resolve", id: "N-1", version: version() }, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect(checkOrigin(new Request("http://127.0.0.1:9/x", { method: "POST", headers: { host: "attacker.example:9", origin: "http://127.0.0.1:9" } }), 9)!.status).toBe(403);
    expect(checkOrigin(new Request("http://127.0.0.1:9/x", { method: "POST", headers: { host: "localhost:9", origin: "http://localhost:9" } }), 9)).toBeUndefined();
    const g = await fetch(`http://127.0.0.1:${dev.port}/__de/notes`);
    expect(g.status).toBe(403); // reading needs the token too
  });
  test("payloads are validated: op, fields, types, lengths, targets", async () => {
    expect(validatePayload([])).toContain("JSON object");
    expect(validatePayload({ op: "drop", version: "x" })).toContain("op must be");
    expect(validatePayload({ op: "resolve", version: "x", id: "N-1", extra: 1 })).toContain("Unknown field");
    expect(validatePayload({ op: "add", version: "x", target: { kind: "element", id: "a" }, kind: "note", text: "" })).toContain("text");
    expect(validatePayload({ op: "add", version: "x", target: { kind: "planet", id: "a" }, kind: "note", text: "t" })).toContain("target.kind");
    expect(validatePayload({ op: "answer", version: "x", id: "N-1", answer: "x".repeat(10_001) })).toContain("longer");
    expect(validatePayload({ op: "resolve", version: "x", id: "../etc" })).toContain("note id");
    expect((await post("{not json")).status).toBe(400);
    expect((await post({ op: "add", version: version(), target: { kind: "element", id: "no-such-part" }, kind: "note", text: "x" })).body.message).toContain("no element no-such-part");
    const r = await fetch(`http://127.0.0.1:${dev.port}/__de/notes`, { method: "POST", headers: { "content-type": "text/plain", origin: `http://127.0.0.1:${dev.port}`, "x-de-token": dev.token }, body: "{}" });
    expect(r.status).toBe(415);
    const big = await post({ op: "add", version: version(), target: { kind: "element", id: "a" }, kind: "note", text: "x".repeat(70_000) });
    expect(big.status).toBe(413);
  });
  test("a valid add writes atomically, keeps the hand-written comment, and answers with the new version", async () => {
    const ino = statSync(FILE).ino;
    const r = await post({ op: "add", version: version(), target: { kind: "element", id: firstEl() }, kind: "question", text: "Is this still used?" });
    expect(r.status).toBe(200);
    expect(r.body.note).toMatchObject({ id: "N-2", kind: "question", status: "open", author: "person" });
    const text = readFileSync(FILE, "utf8");
    expect(text.startsWith("# kept by hand\n")).toBe(true);
    expect(r.body.version).toBe(notesVersion(text));
    expect(statSync(FILE).ino).not.toBe(ino); // renamed over, not rewritten in place
    expect(readdirSync(inst).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
  test("answer, resolve, reopen, edit and delete", async () => {
    expect((await post({ op: "answer", id: "N-1", answer: "The platform team.", version: version() })).body.note.status).toBe("answered");
    expect((await post({ op: "resolve", id: "N-1", version: version() })).body.note.status).toBe("resolved");
    expect((await post({ op: "reopen", id: "N-1", version: version() })).body.note.status).toBe("open");
    expect((await post({ op: "edit", id: "N-2", text: "Is this part still used by anyone?", version: version() })).body.note.text).toContain("anyone");
    expect((await post({ op: "delete", id: "N-2", version: version() })).body.deleted).toBe("N-2");
    expect((await post({ op: "delete", id: "N-9", version: version() })).status).toBe(404);
    const ns = parseNotes(readFileSync(FILE, "utf8")).notes;
    expect(ns.map((n) => [n.id, n.status, n.answer])).toEqual([["N-1", "open", "The platform team."]]);
  });
  test("a stale write is refused with the current version: an edit made to the file is never overwritten", async () => {
    const loaded = version();
    const edited = readFileSync(FILE, "utf8").replace('status: open', 'status: answered');
    writeFileSync(FILE, edited); // Claude answers in the file
    const r = await post({ op: "resolve", id: "N-1", version: loaded });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("stale");
    expect(r.body.version).toBe(notesVersion(edited));
    expect(readFileSync(FILE, "utf8")).toBe(edited);
  });
  test("round trip: a file edit rebuilds the page with the new notes and version; GET reads the file", async () => {
    await Bun.sleep(400); // the watcher's rebuild after the edit above
    const html = await (await fetch(dev.url)).text();
    expect(html).toContain(`"version":"${version()}"`);
    const b = JSON.parse(readFileSync(join(out, "bundle.json"), "utf8"));
    expect(b.notes.items[0].status).toBe("answered");
    const g = await (await fetch(`http://127.0.0.1:${dev.port}/__de/notes`, { headers: { "x-de-token": dev.token } })).json() as any;
    expect(g.version).toBe(version());
    expect(g.notes[0].status).toBe("answered");
  });
});
