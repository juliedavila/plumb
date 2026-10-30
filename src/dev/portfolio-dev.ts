// The live loop for a portfolio: `bun plumb.ts dev <portfolio> [--port 4317] [--out <dir>]`.
// Serves the portfolio page at / and each design's page, built inside the portfolio, at /<namespace>/, on 127.0.0.1
// only. Watches the shared root, every design and the portfolio file, rebuilds on change (debounced, with the same
// half-second poll as an instance's loop), and pushes a reload to the pages whose content changed. A design page may
// write notes and mark itself presented through its own /<namespace>/__de/ paths, as an instance's page does; the
// files written to disk stay the offline pages, without any of it. The dev build leaves portfolio.lock alone, so a
// rebuild never triggers itself.

import { existsSync, statSync, watch, type FSWatcher } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { Bundle } from "../types.ts";
import { ENGINE_ROOT } from "../core/rules.ts";
import { sha256 } from "../core/util.ts";
import { readPortfolio } from "../core/portfolio.ts";
import { portfolioPages, writePortfolioPages, type PortfolioPages } from "../site/portfolio-build.ts";
import { handleNotes, newToken, NOTES_PATH } from "./notes-api.ts";
import { handleReport, REPORT_PATH } from "./report-api.ts";
import { EVENTS_PATH, IGNORED, fileSignature, injectReload, type DevOptions, type DevServer } from "./server.ts";

const TEMP = /(^|\/)(\.|#)|~$|\.swp$/;
/** What the loop never rebuilds for: report snapshots, and the lock a release build writes. */
const SKIP = (rel: string) => IGNORED(rel) || /(^|\/)portfolio\.lock$/.test(rel) || /(^|\/)reports(\/|$)/.test(rel);

export async function startPortfolioDev(pathIn: string, opts: DevOptions = {}): Promise<DevServer> {
  const file = readPortfolio(pathIn);
  const pfDir = file.dir;
  if (!opts.outDir && !(pfDir + "/").startsWith(ENGINE_ROOT.replace(/\/$/, "") + "/"))
    throw new Error(`${pathIn} is outside this repository, so its build would overwrite build/portfolio-${file.name} here; pass --out <dir> to say where it goes`);
  const out = resolve(opts.outDir ?? join(ENGINE_ROOT, "build", `portfolio-${file.name}`));
  /** A path the build itself writes (the output folder may sit inside a watched folder): never a reason to rebuild. */
  const written = (abs: string) => abs === out || abs.startsWith(out + "/");
  const log = opts.log ?? (() => {});
  const debounce = opts.debounceMs ?? 120;
  const token = opts.token ?? newToken();
  let pages: PortfolioPages | undefined, builds = 0;
  const reportsDirty = new Set<string>(); // designs whose page marked a snapshot presented since the last build
  let ids: Record<string, string> = {};
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const enc = new TextEncoder();
  const send = (event: string, data: unknown) => {
    const msg = enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    for (const c of clients) { try { c.enqueue(msg); } catch { clients.delete(c); } }
  };
  // what the loop watches: the portfolio's folder, its root and every design (each once, the outermost kept)
  const watchedDirs = () => {
    const ds = [pfDir, resolve(pfDir, file.root), ...file.designs.map((d) => resolve(pfDir, d.from))].filter((d) => existsSync(d) && statSync(d).isDirectory());
    return [...new Set(ds)].filter((d, _i, all) => !all.some((o) => o !== d && d.startsWith(o + "/")));
  };
  const watching = watchedDirs();
  let signature = "";

  async function build(): Promise<boolean> {
    signature = sig();
    try {
      const built = new Date().toISOString();
      const p = await portfolioPages(pfDir, { built });
      writePortfolioPages(p, out, { lock: false });
      pages = p; builds++;
      // a page's id leaves out the build time it prints, so a page reloads only when what it shows changed
      const id = (html: string) => sha256(html.split(built).join(""));
      ids = { "/": id(p.html), ...Object.fromEntries(p.designs.map((d) => [`/${d.namespace}/`, id(d.html)])) };
      const e = p.data.findings.filter((f) => f.severity === "error").length;
      log(`built portfolio ${file.name}: ${p.designs.length} designs, ${p.data.findings.length} findings (${e} errors)`);
      return true;
    } catch (err) {
      const message = (err as Error).message;
      log(`build failed: ${message}`);
      send("build-error", { message });
      return false;
    }
  }
  /** Every watched file's time and size, without the files a build or Mark as presented writes. */
  const sig = () => fileSignature(watching).split("\n").filter((l) => {
    const p = l.slice(0, l.lastIndexOf(":", l.lastIndexOf(":") - 1)).replace(/\\/g, "/");
    return !/(^|\/)portfolio\.lock$/.test(p) && !/\/reports\//.test(p) && !written(p);
  }).join("\n");

  if (!(await build()) && !pages) throw new Error("the first build failed; fix the portfolio and start again");

  let timer: ReturnType<typeof setTimeout> | undefined, running = false, again = false;
  const rebuild = async () => {
    if (running) { again = true; return; }
    running = true;
    try {
      do {
        again = false;
        const before = JSON.stringify(ids);
        if (await build()) send(JSON.stringify(ids) === before ? "hello" : "reload", { pages: ids, builds });
      } while (again);
    } finally { running = false; }
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(rebuild, debounce); };
  signature = sig();
  const poll = setInterval(() => { const s = sig(); if (s !== signature) { signature = s; schedule(); } }, opts.pollMs ?? 500);
  const watchers: FSWatcher[] = watching.map((w) => watch(w, { recursive: true }, (_e, name) => {
    const n = String(name ?? "");
    if (n && (TEMP.test(n) || SKIP(n) || written(join(w, n)))) return;
    schedule();
  }));

  const designOf = (path: string): { ns: string; rest: string; bundle?: Bundle; dir?: string } | undefined => {
    const m = /^\/([^/]+)(\/.*)?$/.exec(path);
    if (!m || !pages) return undefined;
    const d = pages.designs.find((x) => x.namespace === decodeURIComponent(m[1]));
    if (!d) return undefined;
    const run = pages.run.designs.find((x) => x.namespace === d.namespace);
    return { ns: d.namespace, rest: m[2] ?? "/", bundle: d.bundle, ...(run ? { dir: run.dir } : {}) };
  };
  const html = (body: string) => new Response(body, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  const json = (body: string) => new Response(body, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

  const heartbeat = setInterval(() => { for (const c of clients) { try { c.enqueue(enc.encode(": keep-alive\n\n")); } catch { clients.delete(c); } } }, 8000);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: opts.port ?? 4317,
    idleTimeout: 30,
    fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      if (path === EVENTS_PATH) {
        let ctl: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({
          start(c) { ctl = c; clients.add(c); c.enqueue(enc.encode(`retry: 1000\nevent: hello\ndata: ${JSON.stringify({ pages: ids, builds })}\n\n`)); },
          cancel() { clients.delete(ctl); },
        });
        return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" } });
      }
      if (!pages) return new Response("not built", { status: 503 });
      if (path === "/" || path === "/index.html") return html(injectReload(pages.html, ids["/"], undefined, "/"));
      if (path === "/portfolio.json") return json(JSON.stringify(pages.data, null, 2) + "\n");
      const d = designOf(path);
      if (d && d.bundle && d.dir) {
        const key = `/${d.ns}/`;
        if (d.rest === "/" || d.rest === "/index.html") {
          if (path === `/${d.ns}`) return Response.redirect(`${url.origin}/${d.ns}/`, 302);
          const serve = () => {
            const cur = pages!.designs.find((x) => x.namespace === d.ns)!;
            // the snapshot of this build marked presented, as an instance's loop passes it (the deck's button reads it)
            const r = (cur.bundle.reports ?? []).filter((x) => x.presented && x.hash === cur.bundle.engine.hash).at(-1);
            return html(injectReload(cur.html, ids[key], { token, notes: `/${d.ns}${NOTES_PATH}`, version: cur.bundle.notes?.version ?? "none", report: `/${d.ns}${REPORT_PATH}`, ...(r ? { presented: { file: r.file, ...(r.presented ? { presented: r.presented } : {}) } } : {}) }, key));
          };
          // a snapshot marked presented since the last build: rebuild once now, so the reloaded deck compares with it
          if (reportsDirty.has(d.ns)) { reportsDirty.delete(d.ns); return build().then(serve); }
          return serve();
        }
        if (d.rest === "/bundle.json") return json(JSON.stringify(d.bundle, null, 2) + "\n");
        // a design page's notes and Mark as presented, against that design's folder
        if (d.rest === NOTES_PATH) return handleNotes(new Request(url.origin + NOTES_PATH, req), { dir: d.dir, token, port: () => server.port!, bundle: () => d.bundle, onWrite: schedule });
        if (d.rest === REPORT_PATH) return handleReport(new Request(url.origin + REPORT_PATH, req), { dir: d.dir, token, port: () => server.port!, bundle: () => d.bundle }).then((r) => { if (r.status === 200) reportsDirty.add(d.ns); return r; });
      }
      return new Response("not found", { status: 404 });
    },
  });

  log(`serving the portfolio ${file.title} (${basename(dirname(file.path))}/${basename(file.path)})`);
  return {
    url: `http://127.0.0.1:${server.port}/`, port: server.port!, watching, token,
    builds: () => builds,
    rebuild,
    close() {
      clearTimeout(timer); clearInterval(heartbeat); clearInterval(poll);
      for (const w of watchers) w.close();
      for (const c of clients) { try { c.close(); } catch { /* already closed */ } }
      clients.clear();
      server.stop(true);
    },
  };
}
