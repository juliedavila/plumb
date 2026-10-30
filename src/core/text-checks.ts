// Hand-written text checked against what the build computed: a tour caption, a decision on the deck or a speaker note
// that says a patch passes when its verdict says otherwise, or that names a milestone's status the build no longer
// shows. The build warns; it never rewrites a person's words.

import type { Bundle, PatchVerdict } from "../types.ts";

const LEVEL_WORD: Record<PatchVerdict["level"], string> = { fail: "fail (breaks a check)", caution: "caution (passes, needs review)", pass: "pass" };
/** The verdict as the decisions slide shows it beside a decision: words, never an id. */
export const VERDICT_TEXT: Record<PatchVerdict["level"], string> = { fail: "Breaks a check", caution: "Passes the checks; needs review", pass: "Passes every check" };

const CLEAN = /\bpasses (every|all)( of)?( the)? (checks?|rules?)\b|\bnothing new (is )?introduced\b|\bintroduces nothing( new)?\b|\bpasses cleanly\b/i;
const NO_BREAK = /\bbreaks no checks?\b|\bpasses the checks\b|\bno check fails\b/i;
const BREAK = /\bbreaks (a|one|two|three|four|\d+) checks?\b|\bbreaks a check\b|\bgets caught\b|\bfails (a|the|its|one) check\b/i;
const REVIEW = /\b(review|caution|amber)\b/i;

/** Does a sentence about a patch contradict its verdict? The problem in words, or undefined. */
export function verdictConflict(text: string, level: PatchVerdict["level"]): string | undefined {
  const t = text ?? "";
  if (BREAK.test(t) && level !== "fail") return `says it breaks a check, but its verdict is ${LEVEL_WORD[level]}`;
  if (CLEAN.test(t) && !REVIEW.test(t) && level !== "pass") return `says it passes every check, but its verdict is ${LEVEL_WORD[level]}`;
  if (NO_BREAK.test(t) && level === "fail") return `says it breaks no check, but its verdict is ${LEVEL_WORD[level]}`;
  return undefined;
}

const RAG = /\b(red|amber|green)\b/gi;
const sentences = (t: string) => (t ?? "").split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Sentences that name one milestone and one status that the build no longer shows for it: "“See the stream” is
 * green" while it is red, or "the current milestone is amber". A sentence that speaks of an override or the computed
 * status, or names more than one milestone or status, is left alone.
 */
export function statusConflicts(text: string, b: Bundle): string[] {
  const st = b.status;
  if (!st) return [];
  const out: string[] = [];
  const names = b.plan.phases.map((p) => ({ id: p.id, name: p.name, re: new RegExp(`(^|[^\\w])${esc(p.name)}([^\\w]|$)`, "i") }));
  for (const s of sentences(text)) {
    if (/\b(override|overridden|computed|by hand|set by|manual status|set manually)\b/i.test(s)) continue;
    const rags = [...new Set((s.match(RAG) ?? []).map((x) => x.toLowerCase()))];
    if (rags.length !== 1) continue;
    const said = rags[0];
    const named = names.filter((n) => n.re.test(s));
    const current = /\bthe current milestone\b/i.test(s) ? st.milestones.find((m) => m.current) : undefined;
    if (named.length === 1 && !current) {
      const m = st.milestones.find((x) => x.phase === named[0].id);
      if (m && !m.reached && m.status !== said) out.push(`says “${named[0].name}” is ${said}; the build shows ${m.status}`);
    } else if (!named.length && current && current.status !== said) out.push(`says the current milestone is ${said}; the build shows ${current.status}`);
  }
  return out;
}

/** Patches a text names, by id or by title. */
export function patchesNamed(text: string, b: Bundle): Bundle["patches"] {
  return b.patches.filter((p) => new RegExp(`(^|[^\\w-])${esc(p.id)}([^\\w-]|$)`).test(text) || (p.title && text.toLowerCase().includes(p.title.toLowerCase())));
}
