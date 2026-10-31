import { parseYaml } from "../core/yaml.ts";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setting } from "../core/env.ts";
import { EDITION_LIMIT, FILE_LIMIT, manifest, regularFile, safePath, verifyBytes, type VerifiedEdition } from "./manifest.ts";

export interface SourceOptions { from: string; ref?: string; path?: string }
export class EditionSource {
  readonly stage = mkdtempSync(join(tmpdir(), "plumb-add-"));
  constructor(readonly options: SourceOptions) {}

  /** Find a matching local dependency for a pasteable missing-pin command. */
  pinFrom(namespace: string,version: string): string | undefined {
    if (this.options.from.startsWith("github:")) return this.options.from;
    return this.localCandidates(namespace, version, true).find(p => {
      if (!existsSync(join(p,"edition.yaml"))) return false;
      try { const r = parseYaml(regularFile(p,"edition.yaml").toString(),join(p,"edition.yaml")) as any; return r.namespace === namespace && r.version === version; } catch { return false; }
    });
  }

  private localCandidates(namespace: string, version: string, pinned: boolean): string[] {
    const root = resolve(this.options.from);
    const bases = [root, ...(pinned ? [resolve(root,".."),resolve(root,"../.."),resolve(root,"../../..")] : [])];
    return bases.flatMap(base => [base, join(base,namespace,version), join(base,"editions",namespace,version), join(base,"pins",namespace), join(base,"pins",namespace,version)]);
  }

  private async fetchFile(url: URL, file: string): Promise<Buffer> {
    const origin = url.origin;
    for (let redirects = 0; redirects <= 5; redirects++) {
      let response: Response;
      try { response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(30_000) }); }
      catch (e) { throw new Error(`${file}: fetch failed: ${(e as Error).message}`); }
      if ([301,302,303,307,308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location) throw new Error(`${file}: redirect has no location`);
        const next = new URL(location, url);
        if (next.origin !== origin) throw new Error(`${file}: refusing redirect to another host`);
        url = next; continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`${file}: fetch failed (${response.status})`); }
      if (Number(response.headers.get("content-length")) > FILE_LIMIT) { await response.body?.cancel(); throw new Error(`${file}: file exceeds 32 MB`); }
      const chunks: Uint8Array[] = []; let size = 0;
      if (response.body) {
        const reader = response.body.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read(); if (done) break;
            size += value.length;
            if (size > FILE_LIMIT) { await reader.cancel(); throw new Error(`${file}: file exceeds 32 MB`); }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
      }
      return Buffer.concat(chunks);
    }
    throw new Error(`${file}: too many redirects`);
  }

  async read(namespace: string, version: string, pinned = false): Promise<VerifiedEdition> {
    const { from } = this.options;
    let get: (file: string) => Promise<Buffer>;
    let description: string;
    if (from.startsWith("github:")) {
      const repo = from.slice(7);
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error("--from: expected github:<owner>/<repo>");
      // A ref/path override locates the requested release. Pins use their own version tags and edition paths.
      const ref = !pinned && this.options.ref ? this.options.ref : `${namespace}-v${version}`;
      const path = !pinned && this.options.path ? this.options.path : `editions/${namespace}/${version}`;
      safePath(ref); if (path !== ".") safePath(path);
      const raw = setting("GITHUB_RAW") ?? "https://raw.githubusercontent.com";
      const base = new URL(raw.endsWith("/") ? raw : raw + "/");
      if (!["http:","https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error("PLUMB_GITHUB_RAW: expected an HTTP(S) base URL");
      const prefix = [...repo.split("/"), ...ref.split("/"), ...(path === "." ? [] : path.split("/"))].map(encodeURIComponent).join("/") + "/";
      get = file => this.fetchFile(new URL(prefix + file.split("/").map(encodeURIComponent).join("/"), base), file);
      description = `${from} ${ref}/${path}`;
    } else {
      const candidates = this.localCandidates(namespace,version,pinned);
      let dir: string | undefined;
      for (const candidate of candidates) {
        if (!existsSync(join(candidate,"edition.yaml"))) continue;
        if (pinned) {
          try { const r = parseYaml(regularFile(candidate,"edition.yaml").toString(),join(candidate,"edition.yaml")) as any; if (r.namespace !== namespace || r.version !== version) continue; } catch { /* verification below reports malformed matching candidates */ }
        }
        dir = candidate; break;
      }
      if (!dir) throw new Error(`${namespace}@${version}/edition.yaml: not found under ${from}`);
      get = async file => regularFile(dir!,file);
      description = dir;
    }
    const bytes = new Map<string,Buffer>();
    const first = await get("edition.yaml");
    const stamp = manifest(first,namespace,version);
    bytes.set("edition.yaml",first);
    let size = first.length;
    const dir = join(this.stage,namespace,version);
    for (const file of stamp.files) {
      const b = await get(file.path); size += b.length;
      if (size > EDITION_LIMIT) throw new Error(`${file.path}: edition exceeds 256 MB`);
      bytes.set(file.path,b);
    }
    for (const [file,b] of bytes) { const p = join(dir,file); mkdirSync(dirname(p),{recursive:true}); writeFileSync(p,b); }
    return verifyBytes(stamp,bytes,description);
  }
}
