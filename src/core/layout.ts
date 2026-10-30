// Layered layout for each view, computed once in core so the site and every other consumer agree.
//
// Left to right: layers are columns. Steps (Sugiyama-style, all deterministic):
// 1. drop DFS back edges (natural order) and assign longest-path layers;
// 2. split forward edges that span several layers with dummy points;
// 3. order each layer by barycenter sweeps, keeping the ordering with the fewest crossings;
// 4. size boxes from the name length (clamped), stack each column centred vertically;
// 5. route forward edges as polylines from the right border of the source through the dummy slots to the left
//    border of the target; route back edges orthogonally through a channel under the drawing; self loops on the right.

import type { Element, Model, Relationship, View, ViewLayout, LayoutEdge, LayoutNode } from "../types.ts";
import { backEdges, edgeKey, makeAdj, topo } from "./graph.ts";
import { natCompare } from "./util.ts";

export const LAYOUT = {
  margin: 24, gapX: 72, gapY: 20, dummyH: 10,
  charW: 7, padX: 10, lineH: 16, padY: 12,
  minW: 96, maxW: 200, maxLines: 3,
  channelGap: 18, channelStep: 8,
  bandPadTop: 26, bandPadBottom: 12, bandGap: 8,
};

/** Box size for a name: width from its length (clamped), height grows by lines when it wraps (max 3 lines). */
export function nodeSize(name: string): { w: number; h: number; lines: number } {
  const L = LAYOUT;
  const w = Math.max(L.minW, Math.min(L.maxW, Math.ceil(name.length * L.charW + 2 * L.padX)));
  const perLine = Math.max(1, Math.floor((w - 2 * L.padX) / L.charW));
  const lines = Math.max(1, Math.min(L.maxLines, Math.ceil(name.length / perLine)));
  return { w, h: lines * L.lineH + 2 * L.padY, lines };
}

export function defaultView(model: Model): View {
  return { id: "all", title: "All elements", elements: model.elements.map((e) => e.id).sort(natCompare) };
}

/** The views to lay out: the model's own, or a default "all" view when it has none. */
export function viewsOf(model: Model): View[] {
  return model.views.length ? model.views : [defaultView(model)];
}

export function viewRelationships(model: Model, view: View, nodes: Set<string>): Relationship[] {
  const rels = view.relationships
    ? view.relationships.map((id) => model.relationships.find((r) => r.id === id)).filter((r): r is Relationship => !!r)
    : model.relationships;
  const seen = new Set<string>();
  return rels.filter((r) => nodes.has(r.from) && nodes.has(r.to) && !seen.has(r.id) && seen.add(r.id)).sort((a, b) => natCompare(a.id, b.id));
}

interface Slot { id: string; real: boolean; w: number; h: number; layer: number }

function countCrossings(layers: string[][], segs: [string, string][], pos: Map<string, number>, layerOf: Map<string, number>): number {
  const byLayer = new Map<number, [number, number][]>();
  for (const [a, b] of segs) {
    const l = layerOf.get(a)!;
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l)!.push([pos.get(a)!, pos.get(b)!]);
  }
  let c = 0;
  for (const s of byLayer.values()) {
    for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) {
      const [a1, b1] = s[i], [a2, b2] = s[j];
      if ((a1 - a2) * (b1 - b2) < 0) c++;
    }
  }
  return c;
}

export function layoutView(model: Model, view: View, opts: { seed?: string[][]; gapX?: number } = {}): ViewLayout {
  const L = opts.gapX ? { ...LAYOUT, gapX: opts.gapX } : LAYOUT;
  const elById = new Map<string, Element>(model.elements.map((e) => [e.id, e]));
  const ids = [...new Set(view.elements)].filter((id) => elById.has(id)).sort(natCompare);
  const nodeSet = new Set(ids);
  const rels = viewRelationships(model, view, nodeSet);

  // 1. layering over the acyclic part
  const adj = makeAdj(ids, rels.filter((r) => r.from !== r.to).map((r) => [r.from, r.to]));
  const back = backEdges(adj);
  const dag = new Map([...adj].map(([n, vs]) => [n, vs.filter((m) => !back.has(edgeKey(n, m)))]));
  const layer = new Map<string, number>(ids.map((n) => [n, 0]));
  for (const n of topo(dag)) for (const m of dag.get(n)!) layer.set(m, Math.max(layer.get(m)!, layer.get(n)! + 1));

  // 2. slots and segments
  const slots = new Map<string, Slot>();
  for (const id of ids) { const s = nodeSize(elById.get(id)!.name); slots.set(id, { id, real: true, w: s.w, h: s.h, layer: layer.get(id)! }); }
  const forward: { r: Relationship; chain: string[] }[] = [];
  const backRels: Relationship[] = [], selfRels: Relationship[] = [];
  const segs: [string, string][] = [];
  for (const r of rels) {
    if (r.from === r.to) { selfRels.push(r); continue; }
    const lf = layer.get(r.from)!, lt = layer.get(r.to)!;
    if (lt <= lf) { backRels.push(r); continue; }
    const chain = [r.from];
    for (let l = lf + 1; l < lt; l++) {
      const d = `~${r.id}~${l}`;
      slots.set(d, { id: d, real: false, w: 0, h: L.dummyH, layer: l });
      chain.push(d);
    }
    chain.push(r.to);
    for (let i = 0; i + 1 < chain.length; i++) segs.push([chain[i], chain[i + 1]]);
    forward.push({ r, chain });
  }
  const nLayers = Math.max(0, ...[...slots.values()].map((s) => s.layer + 1));
  let layers: string[][] = Array.from({ length: nLayers }, () => []);
  for (const s of slots.values()) layers[s.layer].push(s.id);
  for (const l of layers) l.sort((a, b) => Number(slots.get(a)!.real === false) - Number(slots.get(b)!.real === false) || natCompare(a, b));

  // 3. ordering. Zones first (when the view holds two or more, nodes keep to their zone band, in the model's zone
  // order), then barycenter sweeps, median sweeps and an adjacent-swap (transpose) pass, keeping the ordering with
  // the fewest crossings. A seed order (the previous build's) starts the sweep so a rebuild does not reshuffle.
  const preds = new Map<string, string[]>(), succs = new Map<string, string[]>();
  for (const id of slots.keys()) { preds.set(id, []); succs.set(id, []); }
  for (const [a, b] of segs) { succs.get(a)!.push(b); preds.get(b)!.push(a); }
  const layerOf = new Map([...slots.values()].map((s) => [s.id, s.layer]));
  const zoneRank = new Map<string, number>(model.zones.map((z, i) => [z.id, i]));
  const zoneOfReal = (id: string) => { const z = elById.get(id)?.zone; return z && zoneRank.has(z) ? z : null; };
  const zonesHere = [...new Set(ids.map(zoneOfReal))];
  const banded = zonesHere.length >= 2;
  const slotZone = new Map<string, string | null>();
  for (const id of ids) slotZone.set(id, zoneOfReal(id));
  for (const f of forward) for (const d of f.chain.slice(1, -1)) slotZone.set(d, zoneOfReal(f.r.from)); // a long edge runs in its source's band
  const rankOf = (id: string) => { const z = slotZone.get(id); return z == null ? 1e6 : zoneRank.get(z)!; };
  const zoneSort = (l: string[]) => (banded ? [...l].sort((a, b) => rankOf(a) - rankOf(b)) : l); // stable: keeps the order within a zone
  if (opts.seed) {
    const seedPos = new Map<string, number>();
    for (const l of opts.seed) l.forEach((id, i) => seedPos.set(id, i));
    for (let i = 0; i < layers.length; i++) layers[i] = [...layers[i]].sort((a, b) => (seedPos.get(a) ?? 1e6) - (seedPos.get(b) ?? 1e6) || natCompare(a, b));
  }
  layers = layers.map(zoneSort);
  const posOf = (ls: string[][]) => { const p = new Map<string, number>(); for (const l of ls) l.forEach((id, i) => p.set(id, i)); return p; };
  let pos = posOf(layers);
  let best = layers.map((l) => [...l]), bestC = countCrossings(layers, segs, pos, layerOf);
  const consider = () => { const c = countCrossings(layers, segs, pos, layerOf); if (c < bestC) { bestC = c; best = layers.map((l) => [...l]); } };
  const sweep = (it: number, score: (ns: number[], self: number) => number) => {
    const down = it % 2 === 0;
    const range = down ? [...Array(nLayers).keys()].slice(1) : [...Array(nLayers).keys()].reverse().slice(1);
    for (const li of range) {
      const nb = down ? preds : succs;
      const key = new Map<string, number>();
      for (const id of layers[li]) key.set(id, score(nb.get(id)!.map((n) => pos.get(n)!), pos.get(id)!));
      layers[li] = zoneSort([...layers[li]].sort((a, b) => key.get(a)! - key.get(b)! || pos.get(a)! - pos.get(b)!));
      layers[li].forEach((id, i) => pos.set(id, i));
    }
    consider();
  };
  const bary = (ns: number[], self: number) => (ns.length ? ns.reduce((s, n) => s + n, 0) / ns.length : self);
  const median = (ns: number[], self: number) => {
    if (!ns.length) return self;
    const v = [...ns].sort((a, b) => a - b), m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };
  for (let it = 0; it < 8 && bestC > 0; it++) sweep(it, bary);
  if (bestC > 0) { layers = best.map((l) => [...l]); pos = posOf(layers); for (let it = 0; it < 6 && bestC > 0; it++) sweep(it, median); }
  // Transpose: swap neighbours in a layer (same zone only) while that lowers the crossings.
  layers = best.map((l) => [...l]); pos = posOf(layers);
  for (let pass = 0; pass < 4 && bestC > 0; pass++) {
    let improved = false;
    for (let li = 0; li < nLayers; li++) for (let i = 0; i + 1 < layers[li].length; i++) {
      const a = layers[li][i], b = layers[li][i + 1];
      if (banded && rankOf(a) !== rankOf(b)) continue;
      const before = countCrossings(layers, segs, pos, layerOf);
      layers[li][i] = b; layers[li][i + 1] = a; pos.set(a, i + 1); pos.set(b, i);
      const after = countCrossings(layers, segs, pos, layerOf);
      if (after < before) { improved = true; if (after < bestC) { bestC = after; best = layers.map((l) => [...l]); } }
      else { layers[li][i] = a; layers[li][i + 1] = b; pos.set(a, i); pos.set(b, i + 1); }
    }
    if (!improved) break;
  }
  layers = best;
  pos = posOf(layers);

  // 4. coordinates. Without bands each column is stacked and centred. With bands, each zone gets one horizontal band
  // as tall as its tallest column stack, and each column's nodes of that zone are centred inside it.
  const colW = layers.map((l) => Math.max(0, ...l.map((id) => slots.get(id)!.w)));
  const colX: number[] = [];
  let x = L.margin;
  for (let i = 0; i < nLayers; i++) { colX.push(x); x += colW[i] + L.gapX; }
  const box = new Map<string, { x: number; y: number; w: number; h: number }>();
  const stackH = (l: string[]) => l.reduce((s, id) => s + slots.get(id)!.h, 0) + Math.max(0, l.length - 1) * L.gapY;
  const place = (l: string[], i: number, top: number, room: number) => {
    let y = top + Math.round((room - stackH(l)) / 2);
    for (const id of l) {
      const s = slots.get(id)!;
      box.set(id, { x: Math.round(colX[i] + (colW[i] - s.w) / 2), y, w: s.w, h: s.h });
      y += s.h + L.gapY;
    }
  };
  let bands: ViewLayout["bands"];
  let maxH: number;
  if (banded) {
    const order = [...new Set([...slots.keys()].map((id) => slotZone.get(id) ?? null))].sort((a, b) => (a == null ? 1e6 : zoneRank.get(a)!) - (b == null ? 1e6 : zoneRank.get(b)!));
    bands = [];
    let y = L.margin;
    for (const z of order) {
      const inner = Math.max(0, ...layers.map((l) => stackH(l.filter((id) => (slotZone.get(id) ?? null) === z))));
      const h = L.bandPadTop + inner + L.bandPadBottom;
      layers.forEach((l, i) => place(l.filter((id) => (slotZone.get(id) ?? null) === z), i, y + L.bandPadTop, inner));
      bands.push({ zone: z, y: y - L.bandGap / 2, h: h + L.bandGap });
      y += h + L.bandGap;
    }
    maxH = y - L.bandGap - L.margin;
  } else {
    maxH = Math.max(0, ...layers.map(stackH));
    layers.forEach((l, i) => place(l, i, L.margin, maxH));
  }
  const nodes: LayoutNode[] = ids.map((id) => ({ id, ...box.get(id)! }));
  let width = nLayers ? colX[nLayers - 1] + colW[nLayers - 1] + L.margin : 2 * L.margin;
  let height = maxH + 2 * L.margin;

  // 5. edges. Ports: spread a node's forward edges along its border, ordered by the y of the other end.
  const cy = (id: string) => { const b = box.get(id)!; return b.y + b.h / 2; };
  const outPorts = new Map<string, string[]>(), inPorts = new Map<string, string[]>();
  for (const f of forward) {
    (outPorts.get(f.r.from) ?? outPorts.set(f.r.from, []).get(f.r.from)!).push(f.r.id);
    (inPorts.get(f.r.to) ?? inPorts.set(f.r.to, []).get(f.r.to)!).push(f.r.id);
  }
  const fwdById = new Map(forward.map((f) => [f.r.id, f]));
  const portY = (node: string, relId: string, side: "out" | "in") => {
    const list = (side === "out" ? outPorts : inPorts).get(node)!;
    const other = (rid: string) => { const c = fwdById.get(rid)!.chain; return cy(side === "out" ? c[1] : c[c.length - 2]); };
    const sorted = [...list].sort((a, b) => other(a) - other(b) || natCompare(a, b));
    const b = box.get(node)!;
    return Math.round(b.y + (b.h * (sorted.indexOf(relId) + 1)) / (sorted.length + 1));
  };
  const edges: LayoutEdge[] = [];
  for (const f of forward) {
    const s = box.get(f.r.from)!, t = box.get(f.r.to)!;
    const pts: [number, number][] = [[s.x + s.w, portY(f.r.from, f.r.id, "out")]];
    for (const d of f.chain.slice(1, -1)) {
      const l = slots.get(d)!.layer, y = Math.round(cy(d));
      pts.push([colX[l], y], [colX[l] + colW[l], y]);
    }
    pts.push([t.x, portY(f.r.to, f.r.id, "in")]);
    edges.push({ id: f.r.id, from: f.r.from, to: f.r.to, points: pts });
  }
  const contentBottom = height - L.margin;
  backRels.forEach((r, k) => {
    const s = box.get(r.from)!, t = box.get(r.to)!;
    const ls = layer.get(r.from)!, lt = layer.get(r.to)!;
    const off = 10 + (k % 6) * 6;
    const gx1 = colX[ls] + colW[ls] + off, gx2 = colX[lt] - off;
    const ch = contentBottom + L.channelGap + k * L.channelStep;
    const sy = Math.round(s.y + s.h * 0.8), ty = Math.round(t.y + t.h * 0.8);
    edges.push({ id: r.id, from: r.from, to: r.to, points: [[s.x + s.w, sy], [gx1, sy], [gx1, ch], [gx2, ch], [gx2, ty], [t.x, ty]] });
    height = Math.max(height, ch + L.margin);
    width = Math.max(width, gx1 + L.margin);
  });
  for (const r of selfRels) {
    const b = box.get(r.from)!, m = Math.round(b.y + b.h / 2);
    edges.push({ id: r.id, from: r.from, to: r.to, points: [[b.x + b.w, m - 6], [b.x + b.w + 14, m - 6], [b.x + b.w + 14, m + 6], [b.x + b.w, m + 6]] });
    width = Math.max(width, b.x + b.w + 14 + L.margin);
  }
  edges.sort((a, b) => natCompare(a.id, b.id));
  // Back edges into the first column route left of it; shift everything right if they would leave the canvas.
  const minX = Math.min(L.margin, ...edges.flatMap((e) => e.points.map((p) => p[0])));
  const dx = minX < L.margin / 2 ? Math.ceil(L.margin / 2 - minX) : 0;
  for (const n of nodes) n.x += dx;
  for (const e of edges) e.points = e.points.map(([px, py]) => [Math.round(px + dx), Math.round(py)]);
  width += dx;
  const order = layers.map((l) => l.filter((id) => slots.get(id)!.real)).filter((l) => l.length);
  if (bands) { bands[bands.length - 1].h = Math.max(bands[bands.length - 1].h, height - bands[bands.length - 1].y); for (const bd of bands) bd.y = Math.round(bd.y), bd.h = Math.round(bd.h); }
  return { view: view.id, width: Math.round(width), height: Math.round(height), nodes, edges, ...(bands ? { bands } : {}), order };
}

/** Lay out every view. `previous` (an earlier build's layouts) seeds each view's order so unchanged nodes keep their places. */
export function layoutAll(model: Model, previous?: ViewLayout[]): ViewLayout[] {
  const prev = new Map((previous ?? []).map((l) => [l.view, l.order]));
  return viewsOf(model).map((v) => layoutView(model, v, { seed: prev.get(v.id) }));
}
