// The security marks the seam rule reads. This file derives nothing: the one mark derivation
// is computeMarks in src/core/shared.ts, which returns a mark for every contract and every crossing
// composed, keyed "shared:<id>" for the shared layer's (the patched layer, so the organization's own included) and
// "<ns>:<id>" for a design's own (undeclared edges and module crossings). A shipped security.floor is authoritative;
// where none ships, the engine's crossing signals give a provisional floor; a raise only adds; nothing lowers. A
// design's own build passes its compiled model as a one-element designs list.
//
// If the derivation fails, a build has no marks, and the seam rule counts every undeclared crossing as
// security-relevant: it fails closed, and says so.

import type { ComposedDesign, Mark, Marks, RootInput } from "../types.ts";
import { computeMarks } from "./shared.ts";

/** The marks for a root and the designs composed, or undefined when there is no root or the derivation fails. */
export function marksFor(root: RootInput | undefined, designs: ComposedDesign[]): Marks | undefined {
  if (!root) return undefined;
  try {
    return computeMarks(root, designs);
  } catch {
    return undefined;
  }
}

/** A crossing's mark as a sentence, without its full stop: "It is security-relevant (shipped: agent-input)". */
export function markSentence(m: Mark | undefined): string {
  return m ? `It is ${markPhrase(m)}` : "Its mark cannot be computed in this build, so it counts as security-relevant";
}

/** A mark as a phrase: "security-relevant (shipped: agent-input)", "not security-relevant (engine signal: none)". */
export function markPhrase(m: Mark): string {
  const floor = m.floor.length ? m.floor.join(", ") : "";
  const src = m.floor_source.startsWith("engine signal") ? m.floor_source : `${m.floor_source}${floor ? `: ${floor}` : ", empty"}`;
  const raised = m.raised ? `, raised by ${m.raised.by ?? "someone not named"}` : "";
  return `${m.relevant ? "security-relevant" : "not security-relevant"} (${src}${raised})`;
}
