// A stream view's drawing: its path in reading order, left to right, wrapped into rows so the whole stream fits the
// width of the canvas (four steps to a row for a long stream), each row's last step joined to the next row's first
// through the gap under the row. Parts off the path sit in a lane under the path step they connect to. Every other
// relationship (data, feedback, a jump between rows) runs orthogonally through the gaps between rows and columns, so
// no line crosses a box. Laid out here, in core, so the site and any other reader agree.

import type { Model, View, ViewLayout } from "../types.ts";
import { natCompare } from "./util.ts";
import { viewRelationships } from "./layout.ts";

export const STREAM = { colW: 124, gapX: 80, top: 24, left: 12, badge: 12, badgeLine: 18, laneGap: 22, channel: 30, nameLine: 15, padY: 12, teamLine: 13, charW: 6.7 };

/** A box tall enough for the name (up to three lines at the box width) and the owner team's line. */
function boxH(name: string, badges = 0): number {
  const per = Math.max(4, Math.floor((STREAM.colW - 16) / STREAM.charW));
  const words = name.split(/\s+/).filter(Boolean);
  let lines = 1, cur = 0;
  for (const w of words) { if (cur && cur + 1 + w.length > per) { lines++; cur = w.length; } else cur += (cur ? 1 : 0) + w.length; }
  return Math.min(3, lines) * STREAM.nameLine + STREAM.teamLine + badges * STREAM.badgeLine + 2 * STREAM.padY;
}

export function perRow(n: number): number {
  return n <= 5 ? Math.max(1, n) : Math.min(6, Math.max(3, Math.ceil(Math.sqrt(n))));
}

type Pt = [number, number];

/** `badges(id)`: how many flow badge lines the part's box holds (its wait, the tracker's measure, its WIP limit). */
export function streamLayout(model: Model, view: View, path: string[], badges: (id: string) => number = () => 0): ViewLayout {
  const S = STREAM;
  const el = new Map(model.elements.map((e) => [e.id, e]));
  const ids = view.elements.filter((id) => el.has(id));
  const onPath = path.filter((id) => ids.includes(id));
  const cols = perRow(onPath.length);
  const rels = viewRelationships(model, view, new Set(ids));
  const pos = new Map<string, { row: number; col: number; lane: boolean }>();
  onPath.forEach((id, i) => pos.set(id, { row: Math.floor(i / cols), col: i % cols, lane: false }));
  const rows = Math.max(1, Math.ceil(onPath.length / cols));
  // Off the path: under the first path step it connects to (sender first), in the nearest free column of that row's lane.
  const laneTaken = new Map<number, Set<number>>();
  const off = ids.filter((id) => !pos.has(id)).sort(natCompare);
  for (const id of off) {
    const nb = rels.filter((r) => r.to === id && pos.get(r.from) && !pos.get(r.from)!.lane).map((r) => r.from)
      .concat(rels.filter((r) => r.from === id && pos.get(r.to) && !pos.get(r.to)!.lane).map((r) => r.to))[0];
    const at = nb ? pos.get(nb)! : { row: rows - 1, col: 0, lane: false };
    const taken = laneTaken.get(at.row) ?? new Set<number>();
    let col = at.col;
    for (let d = 0; d < cols * 2; d++) { const c = at.col + (d % 2 ? -Math.ceil(d / 2) : Math.ceil(d / 2)); if (c >= 0 && c < cols && !taken.has(c)) { col = c; break; } }
    taken.add(col); laneTaken.set(at.row, taken);
    pos.set(id, { row: at.row, col, lane: true });
  }
  // Rows: each row's boxes share a height; a lane (when the row has one) sits under the badges; a channel under all.
  const h = new Map(ids.map((id) => [id, boxH(el.get(id)!.name, badges(id))]));
  const rowH: number[] = [], laneH: number[] = [], rowY: number[] = [], laneY: number[] = [], chanY: number[] = [];
  let y = S.top;
  for (let r = 0; r < rows; r++) {
    const inRow = ids.filter((id) => pos.get(id)!.row === r && !pos.get(id)!.lane);
    const inLane = ids.filter((id) => pos.get(id)!.row === r && pos.get(id)!.lane);
    rowH[r] = Math.max(48, ...inRow.map((id) => h.get(id)!));
    laneH[r] = inLane.length ? Math.max(48, ...inLane.map((id) => h.get(id)!)) : 0;
    rowY[r] = y;
    y += rowH[r] + S.badge;
    laneY[r] = y + (laneH[r] ? S.laneGap : 0);
    if (laneH[r]) y = laneY[r] + laneH[r] + S.badge;
    chanY[r] = y + S.channel / 2;
    y += S.channel;
  }
  const colX = (c: number) => S.left + c * (S.colW + S.gapX);
  const nodes = ids.map((id) => {
    const p = pos.get(id)!;
    return { id, x: colX(p.col), y: p.lane ? laneY[p.row] : rowY[p.row], w: S.colW, h: h.get(id)! };
  });
  const box = new Map(nodes.map((n) => [n.id, n]));
  const width = S.left * 2 + cols * S.colW + (cols - 1) * S.gapX;
  const height = y + 4;
  // Edges. Consecutive steps in one row: straight across. A step and the part in the lane under it: straight down.
  // Everything else leaves through the bottom (or the top, going back), runs along the channel under a row, climbs or
  // drops through the gap between two columns, and enters its target from the channel side; where a lane box sits under
  // a step, the line leaves or enters by the step's side instead, so no line crosses a box.
  const used = new Map<string, number>(); // channel or gap key -> runs so far, to spread parallel runs apart
  const slot = (key: string) => { const n = used.get(key) ?? 0; used.set(key, n + 1); return ((n % 5) - 2) * 5; };
  const pathNext = new Map(onPath.slice(1).map((id, i) => [onPath[i], id]));
  const cx = (n: { x: number; w: number }) => n.x + n.w / 2;
  const laneAt = (row: number, col: number) => ids.some((id) => { const q = pos.get(id)!; return q.lane && q.row === row && q.col === col; });
  const chanAbove = (r: number) => (r > 0 ? chanY[r - 1] : rowY[0] - 14);
  type B = { x: number; y: number; w: number; h: number };
  const exitDown = (A: B, pa: { row: number; col: number; lane: boolean }, ch: number, off: number): Pt[] =>
    !pa.lane && laneAt(pa.row, pa.col)
      ? [[A.x + A.w, A.y + A.h - 12], [A.x + A.w + S.gapX / 2 + off * 0.6, A.y + A.h - 12], [A.x + A.w + S.gapX / 2 + off * 0.6, ch]]
      : [[cx(A) + off, A.y + A.h], [cx(A) + off, ch]];
  const enterUp = (Bx: B, pb: { row: number; col: number; lane: boolean }, ch: number, off: number): Pt[] =>
    !pb.lane && laneAt(pb.row, pb.col)
      ? [[Bx.x - S.gapX / 2 + off * 0.6, ch], [Bx.x - S.gapX / 2 + off * 0.6, Bx.y + Bx.h - 12], [Bx.x, Bx.y + Bx.h - 12]]
      : [[cx(Bx) + off, ch], [cx(Bx) + off, Bx.y + Bx.h]];
  const exitUp = (A: B, pa: { lane: boolean }, ch: number, off: number): Pt[] =>
    pa.lane ? [[A.x, A.y + 12], [A.x - S.gapX / 2 + off * 0.6, A.y + 12], [A.x - S.gapX / 2 + off * 0.6, ch]] : [[cx(A) + off, A.y], [cx(A) + off, ch]];
  const enterDown = (Bx: B, pb: { lane: boolean }, ch: number, off: number): Pt[] =>
    pb.lane ? [[Bx.x + Bx.w + S.gapX / 2 + off * 0.6, ch], [Bx.x + Bx.w + S.gapX / 2 + off * 0.6, Bx.y + 12], [Bx.x + Bx.w, Bx.y + 12]] : [[cx(Bx) + off, ch], [cx(Bx) + off, Bx.y]];
  const edges = rels.map((rel) => {
    const A = box.get(rel.from)!, Bx = box.get(rel.to)!;
    const pa = pos.get(rel.from)!, pb = pos.get(rel.to)!;
    const off = rel.kind === "feedback" ? -8 : 8;
    let pts: Pt[];
    if (pathNext.get(rel.from) === rel.to && pa.row === pb.row && !pa.lane && !pb.lane && rel.kind !== "feedback") {
      const yy = A.y + Math.min(A.h, Bx.h) / 2;
      pts = [[A.x + A.w, yy], [Bx.x, yy]];
    } else if (pa.row === pb.row && pa.col === pb.col && pa.lane !== pb.lane) {
      const dx = slot(`v${pa.row}:${pa.col}`) * 0.6;
      pts = !pa.lane ? [[cx(A) + dx, A.y + A.h], [cx(Bx) + dx, Bx.y]] : [[cx(A) + dx, A.y], [cx(Bx) + dx, Bx.y + Bx.h]];
    } else if (pb.row === pa.row) {
      const ch = chanY[pa.row] + slot(`c${pa.row}`);
      pts = [...exitDown(A, pa, ch, off), ...enterUp(Bx, pb, ch, -off)];
    } else if (pb.row > pa.row) {
      const ch = chanY[pa.row] + slot(`c${pa.row}`);
      if (pb.row === pa.row + 1) pts = [...exitDown(A, pa, ch, off), ...enterDown(Bx, pb, ch, off)];
      else {
        const gx = colX(pb.col) - S.gapX / 2 + slot(`g${pb.col}`) * 0.6, ch2 = chanY[pb.row - 1] + slot(`c${pb.row - 1}`);
        pts = [...exitDown(A, pa, ch, off), [gx, ch], [gx, ch2], ...enterDown(Bx, pb, ch2, off)];
      }
    } else {
      const up = chanAbove(pa.row) + slot(`c${pa.row - 1}`);
      if (pb.row === pa.row - 1) pts = [...exitUp(A, pa, up, off), ...enterUp(Bx, pb, up, off)];
      else {
        const gx = colX(pb.col) + S.colW + S.gapX / 2 + slot(`g${pb.col + 1}`) * 0.6, ch2 = chanY[pb.row] + slot(`c${pb.row}`);
        pts = [...exitUp(A, pa, up, off), [gx, up], [gx, ch2], ...enterUp(Bx, pb, ch2, off)];
      }
    }
    // drop repeated points and points in the middle of a straight run
    const clean: Pt[] = [];
    for (const q of pts) { const l = clean[clean.length - 1]; if (!l || l[0] !== q[0] || l[1] !== q[1]) clean.push(q); }
    return { id: rel.id, from: rel.from, to: rel.to, points: clean.map(([x, yy]) => [Math.round(x * 10) / 10, Math.round(yy * 10) / 10] as Pt) };
  });
  return { view: view.id, width, height, nodes, edges, stream: { path: onPath, perRow: cols } };
}
