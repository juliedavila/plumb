// Model facts the interface aggregates: view groups for the views rail, and the zone (or system) summary behind the
// Overview landscape and the zone matrix. Computed here so the page, the MCP server and any other reader agree.

import type { Model, ModelSummary, View } from "../types.ts";
import { nodeSize } from "./layout.ts";
import { natCompare } from "./util.ts";

/** Views by their `group`, in order of first appearance. Views without one go to "Views" (or "Other views" beside named groups). */
export function viewGroups(viewsIn: View[], sourceOrder: string[] = []): { name: string; views: string[] }[] {
  // the order the author wrote them in (compile sorts by id), with views added by patches after
  const rank = new Map(sourceOrder.map((id, i) => [id, i]));
  const views = [...viewsIn].map((v, i) => ({ v, i })).sort((a, b) => (rank.get(a.v.id) ?? 1e6 + a.i) - (rank.get(b.v.id) ?? 1e6 + b.i)).map((x) => x.v);
  const named = new Map<string, string[]>(), rest: string[] = [];
  for (const v of views) {
    if (v.group) { if (!named.has(v.group)) named.set(v.group, []); named.get(v.group)!.push(v.id); }
    else rest.push(v.id);
  }
  const out = [...named].map(([name, ids]) => ({ name, views: ids }));
  if (rest.length) out.push({ name: out.length ? "Other views" : "Views", views: rest });
  return out;
}

/**
 * One box per zone (or per system when the model has fewer than two zones), with relationship counts by kind between
 * boxes. Edges inside a box are kept with from === to, for the matrix diagonal; the layout leaves them out.
 * Undefined when the model has neither two zones nor two systems.
 */
export function modelSummary(model: Model): ModelSummary | undefined {
  const by: "zone" | "system" | undefined = model.zones.length >= 2 ? "zone" : model.systems.length >= 2 ? "system" : undefined;
  if (!by) return undefined;
  const defs = by === "zone" ? model.zones : model.systems;
  const known = new Set(defs.map((d) => d.id));
  const groupOf = (id: string) => { const e = model.elements.find((x) => x.id === id); const g = e ? (by === "zone" ? e.zone : e.system) : undefined; return g && known.has(g) ? g : ""; };
  const groups: ModelSummary["groups"] = defs.map((d) => ({ id: d.id, name: d.name, elements: [] as string[], kinds: {} as Record<string, number> }));
  const none = { id: "", name: by === "zone" ? "No zone" : "No system", elements: [] as string[], kinds: {} as Record<string, number> };
  const gById = new Map(groups.map((g) => [g.id, g]));
  for (const e of model.elements) {
    const g = gById.get(groupOf(e.id)) ?? none;
    g.elements.push(e.id);
    g.kinds[e.kind] = (g.kinds[e.kind] ?? 0) + 1;
  }
  if (none.elements.length) groups.push(none);
  for (const g of groups) {
    const set = new Set(g.elements);
    let best: { id: string; n: number; size: number } | undefined;
    for (const v of model.views) {
      const n = v.elements.filter((x) => set.has(x)).length;
      if (!n) continue;
      if (!best || n > best.n || (n === best.n && (v.elements.length < best.size || (v.elements.length === best.size && natCompare(v.id, best.id) < 0)))) best = { id: v.id, n, size: v.elements.length };
    }
    if (best) g.view = best.id;
  }
  const edges = new Map<string, ModelSummary["edges"][number]>();
  for (const r of model.relationships) {
    const a = groupOf(r.from), b = groupOf(r.to), k = `${a}>${b}`;
    if (!edges.has(k)) edges.set(k, { from: a, to: b, count: 0, kinds: {}, relationships: [] });
    const e = edges.get(k)!;
    e.count++; e.kinds[r.kind] = (e.kinds[r.kind] ?? 0) + 1; e.relationships.push(r.id);
  }
  const edgeList = [...edges.values()].sort((x, y) => natCompare(x.from, y.from) || natCompare(x.to, y.to));
  const present = groups.filter((g) => g.elements.length);
  return { by, groups: present, edges: edgeList, layout: ringLayout(present, edgeList) };
}

/**
 * The summary drawing: boxes on a ring, one straight line per pair of boxes that relationships join (both directions
 * together; the matrix keeps direction). Zones are usually joined every way round, so a layered drawing of them
 * routes a hairball of back edges; a ring with straight lines stays readable at seven boxes. Edge ids are "a~b".
 */
export function ringLayout(groups: { id: string; name: string }[], edges: { from: string; to: string }[]): import("../types.ts").ViewLayout {
  const n = groups.length;
  const sizes = groups.map((g) => { const s = nodeSize(g.name); return { w: s.w, h: s.h + 16 }; }); // room for the count line
  const maxW = Math.max(96, ...sizes.map((s) => s.w)), maxH = Math.max(40, ...sizes.map((s) => s.h));
  const rx = n <= 2 ? 160 : Math.max(200, n * 52), ry = n <= 2 ? 0 : Math.round(rx * 0.5);
  const margin = 24, cx = margin + maxW / 2 + rx, cy = margin + maxH / 2 + ry;
  const id = (g: string) => g || "__none";
  const nodes = groups.map((g, i) => {
    const a = n <= 2 ? Math.PI * (1 - i) : -Math.PI / 2 + (2 * Math.PI * i) / n;
    const x = cx + rx * Math.cos(a), y = cy + ry * Math.sin(a);
    return { id: id(g.id), x: Math.round(x - sizes[i].w / 2), y: Math.round(y - sizes[i].h / 2), w: sizes[i].w, h: sizes[i].h };
  });
  const at = new Map(nodes.map((x) => [x.id, x]));
  const clip = (b: { x: number; y: number; w: number; h: number }, dx: number, dy: number): [number, number] => {
    const hx = b.w / 2, hy = b.h / 2, t = Math.min(dx ? hx / Math.abs(dx) : Infinity, dy ? hy / Math.abs(dy) : Infinity);
    return [Math.round(b.x + hx + dx * t), Math.round(b.y + hy + dy * t)];
  };
  const seen = new Set<string>(), out: import("../types.ts").LayoutEdge[] = [];
  for (const e of edges) {
    if (e.from === e.to) continue;
    const [a, b] = [id(e.from), id(e.to)].sort(natCompare);
    const k = `${a}~${b}`;
    if (seen.has(k) || !at.has(a) || !at.has(b)) continue;
    seen.add(k);
    const A = at.get(a)!, B = at.get(b)!;
    const dx = B.x + B.w / 2 - (A.x + A.w / 2), dy = B.y + B.h / 2 - (A.y + A.h / 2);
    out.push({ id: k, from: a, to: b, points: [clip(A, dx, dy), clip(B, -dx, -dy)] });
  }
  out.sort((p, q) => natCompare(p.id, q.id));
  return { view: "__summary", width: Math.round(2 * cx), height: Math.round(2 * cy), nodes, edges: out };
}
