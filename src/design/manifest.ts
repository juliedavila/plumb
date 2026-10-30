// Interface 1 editions are untrusted inputs until every stamped byte has been verified.
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { EditionStamp } from "../types.ts";
import { filesDigest, LABEL, normStamp } from "../core/edition.ts";
import { NS_PATTERN, RESERVED } from "../core/namespace.ts";

export const FILE_LIMIT = 32 * 1024 * 1024;
export const EDITION_LIMIT = 256 * 1024 * 1024;
export const hash = (bytes: Uint8Array | string): string => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
export const yamlText = (value: unknown): string => Bun.YAML.stringify(value, null, 2).replace(/[ \t]+$/gm, "") + "\n";
export type Raw = Record<string, any>;
export interface PlumbInterface { interface: 1; engine: string; model: string; plan: string }
export interface VerifiedEdition { stamp: EditionStamp & { plumb: PlumbInterface }; sha256: string; bytes: Map<string, Buffer>; source: string }
const fail = (file: string, why: string): never => { throw new Error(`${file}: ${why}`); };
export function mapping(bytes: Uint8Array, file: string): Raw {
  let value: unknown;
  try { value = Bun.YAML.parse(Buffer.from(bytes).toString("utf8")); }
  catch (e) { return fail(file, `YAML parse error: ${(e as Error).message}`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(file, "expected a YAML mapping");
  return value as Raw;
}
export function designId(namespace: string, version: string): void {
  if (typeof namespace !== "string" || !NS_PATTERN.test(namespace) || (RESERVED as readonly string[]).includes(namespace)) fail("edition.yaml", `invalid design namespace ${namespace}`);
  if (typeof version !== "string" || !LABEL.test(version)) fail("edition.yaml", `invalid version ${version}`);
}
/** Canonical, portable paths: aliases cannot name the same destination twice. */
export function safePath(path: unknown): asserts path is string {
  if (typeof path !== "string" || !path || /[\\:\x00-\x1f\x7f]/.test(path) || path.split("/").some(p => !p || p === "." || p === "..")) fail(String(path), "invalid relative edition path");
}

export function manifest(bytes: Uint8Array, namespace: string, version: string): VerifiedEdition["stamp"] {
  designId(namespace, version);
  const r = mapping(bytes, "edition.yaml");
  for (const [key, expected] of Object.entries({ namespace, line: namespace, version, released: true }))
    if (r[key] !== expected) fail("edition.yaml", `${key} must be ${JSON.stringify(expected)}`);
  if (r.plumb?.interface !== 1) fail("edition.yaml", "requires plumb.interface: 1");
  if (!Array.isArray(r.files) || !r.files.length) fail("edition.yaml", "files must be a non-empty manifest");
  const seen = new Set<string>(), portable = new Set<string>();
  for (const f of r.files) {
    safePath(f?.path);
    const canonical = f.path.normalize("NFC").toLowerCase();
    if (["edition.yaml","engine-import.yaml"].some(path => canonical === path || canonical.startsWith(path + "/"))) fail(f.path, "reserved manifest or adapter sidecar path");
    if (seen.has(f.path) || portable.has(canonical)) fail(f.path, "duplicate edition path");
    if (typeof f.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(f.sha256)) fail(f.path, "expected a full SHA-256");
    seen.add(f.path); portable.add(canonical);
  }
  for (const path of seen) {
    const parts = path.normalize("NFC").toLowerCase().split("/");
    for (let i=1;i<parts.length;i++) if (portable.has(parts.slice(0,i).join("/"))) fail(path, "edition path is nested beneath a listed file");
  }
  if (r.digest !== filesDigest(r.files)) fail("edition.yaml", "digest does not match filesDigest(files)");
  for (const key of ["engine", "model", "plan"]) {
    const path = r.plumb[key]; safePath(path);
    if (!seen.has(path)) fail(path, `plumb.${key} is not listed in edition.yaml files`);
  }
  for (const key of ["shared", "manual_work"]) {
    const ref = r[key];
    if (key === "manual_work" && ref === null) continue;
    if (!ref) fail("edition.yaml", `missing ${key} file reference (use null for an absent manual_work catalog)`);
    safePath(ref.path);
    const f = r.files.find((f: Raw) => f.path === ref.path);
    if (!f || f.sha256 !== ref.sha256) fail(ref.path, `${key} hash is not the hash in files`);
  }
  if (!Array.isArray(r.pins)) fail("edition.yaml", "pins must be a list");
  const pins = new Set<string>();
  for (const p of r.pins) {
    designId(p.namespace, p.version);
    if (pins.has(p.namespace)) fail("edition.yaml", `duplicate pin ${p.namespace}`);
    if (typeof p.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(p.sha256)) fail("edition.yaml", `pin ${p.namespace} needs the full edition.yaml SHA-256`);
    pins.add(p.namespace);
  }
  return normStamp(r) as VerifiedEdition["stamp"];
}

export function verifyBytes(stamp: VerifiedEdition["stamp"], bytes: Map<string, Buffer>, source: string): VerifiedEdition {
  let total = 0;
  for (const [file,b] of bytes) {
    if (b.length > FILE_LIMIT) fail(file,"file exceeds 32 MB");
    total += b.length;
    if (total > EDITION_LIMIT) fail(file,"edition exceeds 256 MB");
  }
  for (const f of stamp.files) {
    const b = bytes.get(f.path);
    if (!b || hash(b) !== f.sha256) fail(f.path, "SHA-256 mismatch with edition.yaml");
  }
  // Parse only listed interface files. Owner strings remain the design's words until workspace resolution.
  for (const kind of ["engine", "model", "plan"] as const) {
    const path = stamp.plumb[kind], r = mapping(bytes.get(path)!, path);
    if (kind === "model" && (!Array.isArray(r.teams) || r.teams.length)) fail(path, "interface 1 model must declare teams: []");
    for (const rec of [...(r.elements ?? []), ...(r.units ?? [])]) {
      const written = rec.owner_as_written ?? rec.attrs?.owner_as_written;
      if (rec.owner != null && (typeof rec.owner !== "string" || written !== rec.owner || rec.attrs?.owner_as_written != null && rec.attrs.owner_as_written !== rec.owner)) fail(path, `${rec.id}: owner and owner_as_written must contain the same design role`);
    }
  }
  return { stamp, sha256: hash(bytes.get("edition.yaml")!), bytes, source };
}

/** Reject symlinks at every component, including the source folder itself. */
export function regularFile(dir: string, path: string): Buffer {
  safePath(path);
  let p = resolve(dir);
  if (lstatSync(p).isSymbolicLink()) fail(path, "edition directory is a symbolic link");
  for (const piece of path.split("/")) {
    p = join(p, piece);
    if (!existsSync(p)) fail(path, "listed file is missing");
    if (lstatSync(p).isSymbolicLink()) fail(path, "symbolic links are not edition files");
  }
  const stat = lstatSync(p);
  if (!stat.isFile()) fail(path, "listed path is not a regular file");
  if (stat.size > FILE_LIMIT) fail(path, "file exceeds 32 MB");
  return readFileSync(p);
}

/** Shared with older, design-owned translators that verify manifests without interface 1. */
export function readManifestFiles(dir: string, stamp: EditionStamp): Map<string,Buffer> {
  if (!stamp.files.length || !stamp.digest || filesDigest(stamp.files) !== stamp.digest) fail("edition.yaml","edition files digest does not match");
  const bytes = new Map<string,Buffer>([["edition.yaml",regularFile(dir,"edition.yaml")]]);
  let total = bytes.get("edition.yaml")!.length;
  for (const file of stamp.files) {
    safePath(file.path);
    if (bytes.has(file.path)) fail(file.path,"invalid or repeated edition path");
    const b = regularFile(dir,file.path);
    if (hash(b) !== file.sha256) fail(file.path,"hash mismatch with edition.yaml");
    total += b.length;
    if (total > EDITION_LIMIT) fail(file.path,"edition exceeds 256 MB");
    bytes.set(file.path,b);
  }
  return bytes;
}
