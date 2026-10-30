// The prose helpers for the server render. One source: this loads src/site/client/prose.js, the same file the page's
// script carries, so a count or a list reads the same in the static markup and in what the client draws later.
import PROSE_JS from "./client/prose.js" with { type: "text" };

interface Prose {
  fmt(n: number): string;
  pluralOf(phrase: string): string;
  noun(n: number, one: string, many?: string): string;
  count(n: number, one: string, many?: string | { zero?: "no" | "none" }, opts?: { zero?: "no" | "none" }): string;
  verb(n: number, one: string, many: string): string;
  list(items: string[], opts?: string | { conj?: string; max?: number; more?: string }): string;
  quote(name: string | undefined): string;
  sentence(text: string): string;
  para(parts: (string | undefined | false)[]): string;
  cap(text: string): string;
  lint(text: string, opts?: { sentence?: boolean; maxWords?: number }): string[];
}

export const PROSE: Prose = new Function(`${PROSE_JS}\nreturn PROSE;`)();
export const { fmt, pluralOf, noun, count, verb, list, quote, sentence, para, cap, lint } = PROSE;
export { PROSE_JS };
