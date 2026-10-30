// What a reader sees on the decision surfaces, gathered from a bundle and from the static page (tests share it).
import type { Bundle } from "../src/types.ts";

/** The visible text of the static page: no scripts, no styles, no tags. */
export const visibleText = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;|&#\d+;/g, " ");

/** Every sentence a reader of the deck, the tours and the status sees. */
export function readerTexts(b: Bundle): string[] {
  const out: string[] = [];
  for (const u of b.plan.units) out.push(u.title);
  for (const s of b.deck?.slides ?? []) {
    out.push(s.title, s.lead ?? "", s.subtitle ?? "");
    for (const it of s.items ?? []) out.push(it.text, it.sub ?? "");
    for (const g of s.groups ?? []) { out.push(g.title, g.lead ?? ""); for (const it of g.items) out.push(it.text, it.sub ?? ""); }
    for (const m of s.milestones ?? []) out.push(m.name, m.reason, m.delivers ?? "", m.means ?? "");
    for (const r of s.rows ?? []) out.push(...r.cells);
  }
  for (const st of b.tour?.steps ?? []) out.push(st.title, st.say);
  const s = b.status;
  if (s) {
    out.push(s.overall.text, s.overall.lead?.text ?? "");
    for (const m of s.milestones) { for (const r of m.reasons) out.push(r.text, r.short ?? ""); for (const a of m.path) out.push(a.text); }
    for (const c of s.challenges) out.push(c.text);
    for (const r of s.risks) out.push(r.text);
  }
  return out.filter(Boolean);
}

/** The ids and keys a reader must not meet on a decision surface: record ids that look like ids, rule keys, config keys. */
export function leakPatterns(b: Bundle): { ids: Set<string>; keys: Set<string> } {
  const ids = new Set<string>();
  const m = b.model, p = b.plan;
  for (const x of [...m.elements, ...m.relationships, ...(m.claims ?? []), ...p.units, ...p.phases, ...b.patches, ...(b.notes?.items ?? [])]) if (/[-.\d]/.test(x.id)) ids.add(x.id);
  const keys = new Set<string>(["max_share", "load_bearing", "max_handoffs", "wip_limit", "wait_days", "partitioned_by", "owner_team", "tested_by", "rests_on", "role_map", "pairs_attr"]);
  for (const pk of b.instance.packs) for (const r of pk.rules) keys.add(`${pk.name}/${r.id}`);
  for (const c of new Set(p.units.flatMap((u) => [...(u.provides ?? []), ...(u.requires ?? [])]))) if (/[._-]/.test(c)) keys.add(c);
  return { ids, keys };
}

/** Every id or key the text shows, as words (an id inside a longer word does not count). */
export function leaks(text: string, pat: { ids: Set<string>; keys: Set<string> }): string[] {
  const out = new Set<string>();
  for (const w of text.split(/[\s,;:()“”"'‘’!?<>[\]{}·…]+/)) {
    const t = w.replace(/^[.]+|[.]+$/g, "");
    if (pat.ids.has(t) || pat.keys.has(t)) out.add(t);
  }
  return [...out];
}

/** One page's section of the static site. */
export function pageOf(html: string, id: string): string {
  const i = html.indexOf(`data-page="${id}"`);
  const j = html.indexOf('<section class="page"', i + 10);
  return html.slice(i, j > 0 ? j : undefined);
}

/** Visible text with the places ids may live removed: "How this is checked" disclosures and a record page's head. */
export function surfaceText(html: string): string {
  return visibleText(html.replace(/<details class="how"[\s\S]*?<\/details>/g, " ").replace(/<div class="insp-head">[\s\S]*?<\/h2>/g, " "));
}
