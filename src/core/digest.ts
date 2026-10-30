// The build digest and comparison, shared by the page ("Since you last looked"), `plumb diff` and report snapshots: one
// source, src/site/client/digest.js, loaded here as text so the server side and the page never compare differently.
//
// 0.4: a 0.4 bundle (its instance declares a schema) also digests contracts, teams, milestones, systems
// and zones, and names the kinds it covers in `k`; a lone bundle's digest is as it was, so a lone reader's "since you
// last looked" is unchanged. A comparison compares only the kinds both sides cover. `recordDigest` gives one record's
// hash and its hash without its wording and owners (a milestone also without its words, date and hand-set status), so
// a reworded record never reads as a changed one, which the pin checks use (src/core/edition.ts).
//
// 0.4: a 0.4 digest also covers current-state records (`current:<part>`, with whether a person
// confirmed it), so what the investigation pod adds to current.yaml shows as added and a confirmation as a change.
import DIGEST_JS from "../site/client/digest.js" with { type: "text" };
import type { Bundle, BuildDiff, BuildDigest, ImporterVersion } from "../types.ts";

export const DIGEST: {
  digest(b: Bundle): BuildDigest;
  names(b: Bundle): Record<string, string>;
  compare(a: BuildDigest, b: BuildDigest, namesNew?: Record<string, string>, namesOld?: Record<string, string>): Omit<BuildDiff, "from" | "to">;
  isEmpty(d: Omit<BuildDiff, "from" | "to">): boolean;
  moveText(m: { name: string; from: string; to: string; override?: boolean; computed?: string }): string;
  churnText(d: Omit<BuildDiff, "from" | "to">, importer?: { from?: ImporterVersion; to?: ImporterVersion }): string;
  /** One record's hash, and its hash without its wording and owners (a milestone also without its words, date and hand-set status). */
  recordDigest(kind: string, rec: unknown): { full: string; bare: string };
} = new Function(`${DIGEST_JS}\nreturn DIGEST;`)();
