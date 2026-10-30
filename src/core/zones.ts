// The zone scene: one drawing per zone, generated from the model rather than borrowed from a curated view.
//
// A zone's scene holds the zone's parts and the relationships among them, laid out with the same layered layout as
// every view (src/core/layout.ts), plus portals: one marker per other zone that relationships cross to (on the right
// edge, "out") or come from (on the left edge, "in"), labelled with that zone and a count, so the drawing stays
// honest about what leaves it without drawing the rest of the model. Parts with no declared zone form one more scene.
// Computed in core so the page, the tests and any other reader agree on the counts.

import type { Model, View, ViewLayout, ZonePortal, ZoneScene } from "../types.ts";
import { LAYOUT, layoutView } from "./layout.ts";
import { natCompare } from "./util.ts";

const PORTAL = { h: 40, gapX: 64, gapY: 12, minW: 132, maxW: 220, charW: 7, pad: 34 };

const portalW = (name: string) => Math.max(PORTAL.minW, Math.min(PORTAL.maxW, Math.ceil(name.length * PORTAL.charW + PORTAL.pad)));

/** Stack boxes of height h at their wanted y (top), in order, with no overlap and none above `top`. */
function stack(wants: number[], h: number, gap: number, top: number): number[] {
  const out: number[] = [];
  let next = top;
  for (const w of wants) { const y = Math.max(next, w); out.push(y); next = y + h + gap; }
  return out;
}

/**
 * One scene per zone that holds parts, in the model's zone order, then the parts with no zone. `previous` (an earlier
 * build's scenes) seeds each layout's order so a rebuild does not reshuffle a zone.
 */
export function zoneScenes(model: Model, previous?: ZoneScene[]): ZoneScene[] {
  if (!model.zones.length) return [];
  const known = new Set(model.zones.map((z) => z.id));
  const zoneOf = new Map(model.elements.map((e) => [e.id, e.zone && known.has(e.zone) ? e.zone : null] as const));
  const name = (z: string | null) => (z == null ? "No zone" : model.zones.find((x) => x.id === z)?.name ?? z);
  const seeds = new Map((previous ?? []).map((s) => [s.zone ?? "", s.layout.order]));
  const groups: (string | null)[] = [...model.zones.map((z) => z.id), null];
  const out: ZoneScene[] = [];
  for (const z of groups) {
    const parts = model.elements.filter((e) => zoneOf.get(e.id) === z).map((e) => e.id);
    if (!parts.length) continue;
    const inside = new Set(parts);
    const intra = model.relationships.filter((r) => inside.has(r.from) && inside.has(r.to)).map((r) => r.id);
    const view: View = { id: `__zone:${z ?? ""}`, title: name(z), elements: parts, relationships: intra };
    const base = layoutView(model, view, { seed: seeds.get(z ?? "") });

    // the relationships that cross the zone's border, grouped by the other zone and direction
    const cross = new Map<string, { zone: string | null; dir: "out" | "in"; rels: string[]; parts: Set<string> }>();
    for (const r of model.relationships) {
      const a = inside.has(r.from), b = inside.has(r.to);
      if (a === b || !zoneOf.has(r.from) || !zoneOf.has(r.to)) continue;
      const dir: "out" | "in" = a ? "out" : "in";
      const other = zoneOf.get(a ? r.to : r.from) ?? null;
      const k = `${dir}|${other ?? ""}`;
      if (!cross.has(k)) cross.set(k, { zone: other, dir, rels: [], parts: new Set() });
      const c = cross.get(k)!;
      c.rels.push(r.id); c.parts.add(a ? r.from : r.to);
    }
    const nodeAt = new Map(base.nodes.map((n) => [n.id, n]));
    const zoneRank = (x: string | null) => (x == null ? 1e6 : model.zones.findIndex((q) => q.id === x));
    const sides = (dir: "out" | "in") => [...cross.values()].filter((c) => c.dir === dir).map((c) => {
      const ys = [...c.parts].map((p) => nodeAt.get(p)).filter(Boolean).map((n) => n!.y + n!.h / 2);
      return { c, want: ys.length ? ys.reduce((t, y) => t + y, 0) / ys.length : base.height / 2 };
    }).sort((x, y) => x.want - y.want || zoneRank(x.c.zone) - zoneRank(y.c.zone));
    const outs = sides("out"), ins = sides("in");
    const inW = ins.length ? Math.max(...ins.map((x) => portalW(name(x.c.zone)))) : 0;
    const dx = ins.length ? inW + PORTAL.gapX : 0;

    // shift the zone's own drawing right to leave room for the incoming portals
    const nodes = base.nodes.map((n) => ({ ...n, x: n.x + dx }));
    const edges = base.edges.map((e) => ({ ...e, points: e.points.map(([x, y]) => [x + dx, y] as [number, number]) }));
    const at = new Map(nodes.map((n) => [n.id, n]));
    const rightX = Math.max(base.width + dx, ...nodes.map((n) => n.x + n.w + LAYOUT.margin)) + PORTAL.gapX - LAYOUT.margin;
    const portals: ZonePortal[] = [];
    const place = (list: typeof outs, dir: "out" | "in") => {
      const ys = stack(list.map((x) => x.want - PORTAL.h / 2), PORTAL.h, PORTAL.gapY, LAYOUT.margin);
      list.forEach((x, i) => {
        const nm = name(x.c.zone), w = portalW(nm), y = Math.round(ys[i]);
        const px = dir === "out" ? Math.round(rightX) : LAYOUT.margin / 2 + (inW - w);
        const lines = [...x.c.parts].sort(natCompare).map((p) => {
          const n = at.get(p)!;
          const py = y + PORTAL.h / 2, ny = n.y + n.h / 2;
          return { part: p, points: (dir === "out" ? [[n.x + n.w, ny], [px, py]] : [[px + w, py], [n.x, ny]]) as [number, number][] };
        });
        portals.push({ zone: x.c.zone, name: nm, dir, count: x.c.rels.length, relationships: [...x.c.rels].sort(natCompare), parts: [...x.c.parts].sort(natCompare), x: Math.round(px), y, w, h: PORTAL.h, lines });
      });
    };
    place(ins, "in");
    place(outs, "out");
    const width = Math.round(Math.max(base.width + dx, ...portals.map((p) => p.x + p.w + LAYOUT.margin / 2)));
    const height = Math.round(Math.max(base.height, ...portals.map((p) => p.y + p.h + LAYOUT.margin)));
    const layout: ViewLayout = { view: view.id, width, height, nodes, edges, ...(base.order ? { order: base.order } : {}) };
    out.push({ zone: z, name: name(z), layout, portals, relationships: intra.length });
  }
  return out;
}
