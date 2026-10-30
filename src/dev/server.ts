// The live loop: `bun plumb.ts dev <instance> [--port 4317]`.
// Serves the built page on 127.0.0.1 only, watches the instance directory (and the tracker export it names),
// rebuilds on change (debounced), and pushes a reload over server-sent events. The page reconnects quietly and
// keeps its tab, selection, view and scroll across reloads. The reload snippet is injected only into what this
// server sends: the index.html written to disk stays the single offline file that opens from file://.
// Notes: the page served here may add, edit, answer, resolve and delete notes through /__de/notes (src/dev/notes-api.ts),
// with a per-run token injected only into the served page; the offline file stays read-only.

import { existsSync, mkdirSync, readdirSync, statSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { join, resolve } from "node:path";
import { buildBundle } from "../core/bundle.ts";
import { ENGINE_ROOT } from "../core/rules.ts";
import { sha256 } from "../core/util.ts";
import { renderSite } from "../site/render.ts";
import { loadTracker, sourceDir } from "../tracker/load.ts";
import { handleNotes, newToken, NOTES_PATH } from "./notes-api.ts";
import { handleReport, REPORT_PATH } from "./report-api.ts";

export const EVENTS_PATH = "/__de/events";

/** A portfolio: a folder holding portfolio.yaml, or the file itself. */
export function isPortfolioPath(p: string): boolean {
  return /portfolio\.ya?ml$/.test(p) ? existsSync(p) : existsSync(join(p, "portfolio.yaml")) && !existsSync(join(p, "engine.yaml"));
}

/** Paths under the instance the dev loop never rebuilds for: report snapshots (Mark as presented writes them). */
export const IGNORED = (rel: string) => /^reports(\/|$)/.test(rel.replace(/\\/g, "/"));

/**
 * The client half of the live loop. `pageId` is the content hash of the page it is injected into. A server with several
 * pages (a portfolio's) sends each page's hash keyed by its path (`pageKey`); a page reloads only when its own changed.
 */
export function reloadSnippet(pageId: string, pageKey?: string): string {
  return `<script id="de-live-reload">
(function () {
  "use strict";
  var PAGE = ${JSON.stringify(pageId)}, PKEY = ${JSON.stringify(pageKey ?? null)}, KEY = "de-dev-state:" + location.pathname;
  function mine(d) { return d && d.pages && PKEY !== null ? d.pages[PKEY] : d && d.page; }
  function $(id) { return document.getElementById(id); }
  // The page exposes its own state (route, scroll, lens, hidden kinds, diagram camera, open disclosures, and a
  // summary of patches and findings): saved before a reload, restored after, and the difference announced.
  function save() {
    try {
      var st = window.DE && DE.state ? DE.state() : { hash: location.hash, x: window.scrollX, y: window.scrollY };
      sessionStorage.setItem(KEY, JSON.stringify(st));
    } catch (e) { /* storage unavailable: reload anyway */ }
  }
  function restore() {
    var s = null;
    try { s = JSON.parse(sessionStorage.getItem(KEY) || "null"); sessionStorage.removeItem(KEY); } catch (e) { s = null; }
    if (window.DE && DE.live) DE.live();
    if (!s) return;
    if (window.DE && DE.restore) DE.restore(s);
    else { if (s.hash && location.hash !== s.hash && history.replaceState) history.replaceState(null, "", s.hash); window.scrollTo(s.x || 0, s.y || 0); }
  }
  if (document.readyState === "complete") restore(); else window.addEventListener("load", restore);
  var es = null, wait = 500;
  function connect() {
    if (typeof EventSource === "undefined") return;
    es = new EventSource(${JSON.stringify(EVENTS_PATH)});
    es.addEventListener("hello", function (ev) {
      wait = 500;
      try { var h = mine(JSON.parse(ev.data)); if (h !== undefined && h !== PAGE) { save(); location.reload(); } } catch (e) { /* ignore */ }
    });
    es.addEventListener("reload", function (ev) {
      var d = null; try { d = JSON.parse(ev.data); } catch (e) { d = null; }
      if (d && d.pages && PKEY !== null && d.pages[PKEY] === PAGE) return; // another page of this server changed
      save(); location.reload();
    });
  window.__deReload = function () { save(); location.reload(); };
  // The notes write path: only this served page has it. POST one edit with this run's token; answer { status, body }.
  // Mark as presented (present mode): save a snapshot of this build as what the room saw.
  window.__deReport = function () {
    var cfg = window.DE_DEV || {};
    return fetch(cfg.report, { method: "POST", headers: { "content-type": "application/json", "x-de-token": cfg.token }, body: JSON.stringify({ op: "present" }) })
      .then(function (res) { return res.json().then(function (j) { return { status: res.status, body: j }; }, function () { return { status: res.status, body: {} }; }); });
  };
  window.__deNotes = function (payload) {
    var cfg = window.DE_DEV || {};
    return fetch(cfg.notes, { method: "POST", headers: { "content-type": "application/json", "x-de-token": cfg.token }, body: JSON.stringify(payload) })
      .then(function (res) { return res.json().then(function (j) { return { status: res.status, body: j }; }, function () { return { status: res.status, body: {} }; }); });
  };
    es.addEventListener("build-error", function (ev) {
      var b = $("de-live-error");
      if (!b) { b = document.createElement("div"); b.id = "de-live-error"; b.setAttribute("role", "status");
        b.style.cssText = "position:fixed;left:12px;right:12px;bottom:12px;z-index:50;padding:10px 12px;border-radius:8px;background:var(--danger-muted);color:var(--danger);border:1px solid var(--danger);font:13px/1.4 ui-monospace,monospace;white-space:pre-wrap";
        document.body.appendChild(b); }
      try { b.textContent = "Rebuild failed; showing the last good build.\\n" + JSON.parse(ev.data).message; } catch (e) { b.textContent = "Rebuild failed."; }
    });
    es.onerror = function () { es.close(); setTimeout(connect, wait); wait = Math.min(wait * 2, 5000); };
  }
  connect();
})();
</script>`;
}

/** What the served page needs to write notes: the run's token, the API path and the notes version it was built with. */
export interface DevConfig { token: string; notes: string; version: string; report?: string; presented?: { file: string; presented?: string } }

export function injectReload(html: string, pageId: string, dev?: DevConfig, pageKey?: string): string {
  if (dev) {
    // before the page's own script, so the page boots knowing it can write notes
    const cfg = `<script id="de-dev-config">window.DE_DEV = ${JSON.stringify(dev).replace(/</g, "\\u003c")};</script>\n`;
    const j = html.indexOf('<script type="application/json" id="de-bundle">');
    if (j >= 0) html = html.slice(0, j) + cfg + html.slice(j);
  }
  const i = html.lastIndexOf("</body>");
  const snip = reloadSnippet(pageId, pageKey);
  return i < 0 ? html + snip : html.slice(0, i) + snip + "\n" + html.slice(i);
}

export interface DevOptions { port?: number; outDir?: string; debounceMs?: number; log?: (msg: string) => void; token?: string; pollMs?: number }

const TEMP = /(^|\/)(\.|#)|~$|\.swp$/;

/**
 * Every watched file's modification time and size, one string. The file watcher misses some in-place edits (BSD
 * `sed -i` writes a hidden temporary file and renames it over the original, and the events can name only the
 * temporary), so the dev loop also compares this every half second and rebuilds when it moves.
 */
export function fileSignature(dirs: string[]): string {
  const out: string[] = [];
  const walk = (root: string, d: string, depth: number) => {
    let names: string[];
    try { names = readdirSync(d).sort(); } catch { return; }
    for (const n of names) {
      const p = d + "/" + n, rel = p.slice(root.length + 1);
      if (TEMP.test(rel) || IGNORED(rel)) continue;
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { if (depth < 4) walk(root, p, depth + 1); }
      else out.push(`${p}:${st.mtimeMs}:${st.size}`);
    }
  };
  for (const d of dirs) walk(d, d, 0);
  return out.join("\n");
}

export interface DevServer {
  url: string; port: number; watching: string[];
  token: string;                     // this run's notes token (tests read it; the page gets it injected)
  builds: () => number;
  rebuild: () => Promise<void>;
  close: () => void;
}

export async function startDev(instanceDir: string, opts: DevOptions = {}): Promise<DevServer> {
  const dir = resolve(instanceDir);
  // a portfolio (a folder holding portfolio.yaml, or the file): its page and the design pages inside it
  if (isPortfolioPath(dir)) return (await import("./portfolio-dev.ts")).startPortfolioDev(dir, opts);
  if (!existsSync(join(dir, "engine.yaml"))) throw new Error(`${instanceDir}: no engine.yaml, so this is not an instance directory`);
  // A copy of an instance kept elsewhere shares its name with the one in this repository; without --out its build
  // would overwrite build/<name> here, and the repository's page would silently become the copy's.
  if (!opts.outDir && !(dir + "/").startsWith(ENGINE_ROOT.replace(/\/$/, "") + "/"))
    throw new Error(`${instanceDir} is outside this repository, so its build would overwrite build/<name> here; pass --out <dir> to say where it goes`);
  const log = opts.log ?? (() => {});
  const debounce = opts.debounceMs ?? 120;
  let html = "", bundleJson = "", pageId = "", builds = 0, outDir = opts.outDir, notesVersion = "none";
  const token = opts.token ?? newToken();
  let previous: Awaited<ReturnType<typeof buildBundle>>["bundle"] | undefined; // seeds the layout, so a rebuild keeps node places
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const enc = new TextEncoder();
  const send = (event: string, data: unknown) => {
    const msg = enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    for (const c of clients) { try { c.enqueue(msg); } catch { clients.delete(c); } }
  };

  let signature = "", watched: string[] = [dir], reportsDirty = false, rootDir: string | undefined;
  /** The presented snapshot of the build on show, from the bundle's report list. */
  const presentedOf = () => { const r = (previous?.reports ?? []).filter((x) => x.presented && x.hash === previous?.engine.hash).at(-1); return r ? { file: r.file, ...(r.presented ? { presented: r.presented } : {}) } : undefined; };
  /** Every watched file's time and size, without the build's own output (an --out inside the instance would rebuild itself). */
  const fileSig = (dirs: string[]) => { const o = outDir ? resolve(outDir) + "/" : undefined; return o ? fileSignature(dirs).split("\n").filter((l) => !l.startsWith(o)).join("\n") : fileSignature(dirs); };
  async function build(): Promise<boolean> {
    signature = fileSig(watched); // what this build reads; the poll rebuilds only for a change after it
    try {
      const { bundle, warnings, instance } = await buildBundle(dir, { previous });
      rootDir ??= instance.ns?.root?.dir; // a 0.4 design's shared root: its build reads it, so the loop watches it
      for (const w of warnings) log(w);
      previous = bundle;
      const page = renderSite(bundle);
      outDir ??= join(ENGINE_ROOT, "build", bundle.instance.name);
      mkdirSync(outDir, { recursive: true });
      bundleJson = JSON.stringify(bundle, null, 2) + "\n";
      writeFileSync(join(outDir, "bundle.json"), bundleJson);
      writeFileSync(join(outDir, "index.html"), page); // the offline file, without the reload snippet
      html = page; pageId = sha256(page); builds++; notesVersion = bundle.notes?.version ?? "none";
      const e = bundle.findings.filter((f) => f.severity === "error").length;
      log(`built ${bundle.instance.name}: ${bundle.findings.length} findings (${e} errors)`);
      return true;
    } catch (err) {
      const message = (err as Error).message;
      log(`build failed: ${message}`);
      send("build-error", { message });
      return false;
    }
  }

  if (!(await build()) && !html) throw new Error("the first build failed; fix the instance and start again");

  let timer: ReturnType<typeof setTimeout> | undefined, running = false, again = false;
  const rebuild = async () => {
    if (running) { again = true; return; }
    running = true;
    try {
      do { again = false; const before = pageId; if (await build()) send(pageId === before ? "hello" : "reload", { page: pageId, builds }); } while (again);
    } finally { running = false; }
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(rebuild, debounce); };

  const watching = [dir];
  if (rootDir && existsSync(rootDir) && !rootDir.startsWith(dir + "/") && rootDir !== dir) watching.push(rootDir);
  const tracker = loadTracker(dir);
  const src = sourceDir(dir, tracker?.inventory);
  if (src && existsSync(src) && !src.startsWith(dir + "/")) watching.push(src);
  watched = watching;
  signature = fileSig(watched);
  // The poll: catches the in-place edits the watcher misses (BSD sed -i), and anything else that moves a file's time or size.
  const poll = setInterval(() => { const s = fileSig(watched); if (s !== signature) { signature = s; schedule(); } }, opts.pollMs ?? 500);
  const watchers: FSWatcher[] = watching.map((w) => watch(w, { recursive: true }, (_e, name) => {
    if (name && TEMP.test(String(name))) return; // editor temp files
    if (name && IGNORED(String(name))) return; // reports/: Mark as presented writes there, and a rebuild would reset the page
    if (name && outDir && (join(w, String(name)) + "/").startsWith(resolve(outDir) + "/")) return; // the build's own output, when --out sits inside the instance
    schedule();
  }));

  const heartbeat = setInterval(() => { for (const c of clients) { try { c.enqueue(enc.encode(": keep-alive\n\n")); } catch { clients.delete(c); } } }, 8000);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: opts.port ?? 4317,
    idleTimeout: 30,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === NOTES_PATH)
        return handleNotes(req, { dir, token, port: () => server.port!, bundle: () => previous, onWrite: schedule });
      if (url.pathname === REPORT_PATH)
        return handleReport(req, { dir, token, port: () => server.port!, bundle: () => previous }).then((r) => { if (r.status === 200) reportsDirty = true; return r; });
      if (url.pathname === EVENTS_PATH) {
        let ctl: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({
          start(c) { ctl = c; clients.add(c); c.enqueue(enc.encode(`retry: 1000\nevent: hello\ndata: ${JSON.stringify({ page: pageId, builds })}\n\n`)); },
          cancel() { clients.delete(ctl); },
        });
        return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" } });
      }
      if (url.pathname === "/" || url.pathname === "/index.html") {
        // a snapshot marked presented since the last build: rebuild once now, so the reloaded deck compares with it
        const serve = () => new Response(injectReload(html, pageId, { token, notes: NOTES_PATH, version: notesVersion, report: REPORT_PATH, ...(presentedOf() ? { presented: presentedOf()! } : {}) }), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
        if (reportsDirty) { reportsDirty = false; return build().then(serve); }
        return serve();
      }
      if (url.pathname === "/bundle.json")
        return new Response(bundleJson, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
      return new Response("not found", { status: 404 });
    },
  });

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
