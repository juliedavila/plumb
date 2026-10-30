// The dev server's report API: "Mark as presented" in present mode, only under `bun plumb.ts dev`.
//
//   POST /__de/report   { op: "present" }   save a snapshot of the build on screen, marked as presented
//
// The same guards as the notes API (src/dev/notes-api.ts): the Host and Origin of this server, a same-origin
// Sec-Fetch-Site when sent, this run's token, JSON of known fields. The snapshot is of the last good build, which is
// the one the page shows. It is saved once per build; the dev loop does not rebuild for it (it ignores reports/), so
// the page and its button stay put, and the next rebuild compares with what the room just saw.

import type { Bundle } from "../types.ts";
import { loadReports, makeSnapshot, saveSnapshot } from "../core/snapshot.ts";
import { checkOrigin, TOKEN_HEADER } from "./notes-api.ts";
import { timingSafeEqual } from "node:crypto";

export const REPORT_PATH = "/__de/report";

export interface ReportApiContext {
  dir: string; token: string; port: () => number;
  bundle: () => Bundle | undefined;
  now?: () => Date;
  onWrite?: () => void;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export async function handleReport(req: Request, ctx: ReportApiContext): Promise<Response> {
  const bad = checkOrigin(req, ctx.port());
  if (bad) return bad;
  const tok = req.headers.get(TOKEN_HEADER);
  const a = Buffer.from(tok ?? ""), b = Buffer.from(ctx.token);
  if (!tok || a.length !== b.length || !timingSafeEqual(a, b)) return json(403, { error: "token", message: "Refused: the request did not carry this run's token. Reload the page from the dev server." });
  if (req.method !== "POST") return json(405, { error: "method", message: "Only POST." });
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return json(415, { error: "type", message: "The body must be JSON (content-type application/json)." });
  const body = await req.text();
  if (body.length > 1024) return json(413, { error: "size", message: "The body is too large." });
  let p: unknown;
  try { p = JSON.parse(body); } catch { return json(400, { error: "invalid", message: "The body is not valid JSON." }); }
  if (!p || typeof p !== "object" || Array.isArray(p) || (p as { op?: unknown }).op !== "present" || Object.keys(p).length !== 1)
    return json(400, { error: "invalid", message: 'The body must be { "op": "present" }.' });
  const built = ctx.bundle();
  if (!built) return json(409, { error: "no-build", message: "There is no good build to mark as presented yet." });
  // Once per build: a second press for the build on screen saves nothing and says where the first one is.
  const prior = loadReports(ctx.dir).filter((r) => r.presented && r.hash === built.engine.hash).at(-1);
  if (prior) return json(200, { ok: true, already: true, file: prior.file, presented: prior.presented });
  const snap = makeSnapshot(built, { presented: true, now: ctx.now?.() });
  const file = saveSnapshot(ctx.dir, snap);
  // No rebuild: the dev loop ignores reports/, so the page stays as it is and the button keeps its answer. The deck's
  // baseline moves to this snapshot on the next rebuild, which is when there is something new to compare.
  ctx.onWrite?.();
  return json(200, { ok: true, file, presented: snap.presented });
}
