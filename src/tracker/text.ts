// Text helpers for matching tracker records to engine records: word tokens, title similarity, name matching.

const STOP = new Set([
  "a", "an", "the", "and", "or", "of", "to", "for", "on", "in", "at", "by", "with", "from", "it", "its", "is", "be",
  "each", "every", "per", "all", "one", "this", "that", "into", "as",
]);

/** Light stemming so "deploys" meets "deployments" and "environment" meets "environments". */
function stem(w: string): string {
  for (const suf of ["ments", "ment", "ings", "ing", "ies", "es", "s", "ed"]) {
    if (w.length - suf.length >= 4 && w.endsWith(suf)) return suf === "ies" ? w.slice(0, -3) + "y" : w.slice(0, -suf.length);
  }
  return w;
}

export function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => !STOP.has(w)).map(stem);
}

/** Dice coefficient over word tokens: 1 is the same words, 0 is nothing in common. */
export function similarity(a: string, b: string): number {
  const x = new Set(tokens(a)), y = new Set(tokens(b));
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  return (2 * common) / (x.size + y.size);
}

/** The candidate whose name is most like `name`, when it is like enough. */
export function bestMatch(name: string, candidates: string[], min = 0.5): { value: string; score: number } | undefined {
  let best: { value: string; score: number } | undefined;
  for (const c of candidates) {
    const score = c.toLowerCase() === name.toLowerCase() ? 1 : similarity(name, c);
    if (score >= min && (!best || score > best.score)) best = { value: c, score };
  }
  return best;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
