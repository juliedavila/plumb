// shared: checks on the shared layer in the shared root. They run in the
// root's own build and in a portfolio build, and read what src/core/shared.ts found (ctx.root), which holds the one
// derivation of the security marks: this pack only says what each rule is and why it matters.
import type { Finding, Rule, RuleContext, RulePack } from "../../src/types.ts";

type F = Omit<Finding, "pack" | "rule" | "severity">;
const found = (rule: string) => (ctx: RuleContext): F[] => (ctx.root?.problems ?? []).filter((p) => p.rule === `shared/${rule}`).map(({ at, atKind, message }) => ({ at, atKind, message }));

const markValid: Rule = {
  id: "mark-valid", title: "A security mark is raised with a reason and never lowered", severity: "error",
  why: "Whether a contract or crossing is security-relevant comes from the checks as a floor. A person may raise a mark, saying who and why, but never lower one, so a split or a patch can never quietly take a route out of the security rules.",
  how: "security.relevant: false on what the floor marks relevant is refused and ignored. A raise is security.raised: { by, why }. The floor is what Premerge's checks recorded in the shipped file; for what the shipped file never held, the engine's signals (agent-reachable end, untrusted content or fields, evidence into a partitioned store, an end that grants authority or sits at a model boundary).",
  check: found("mark-valid"),
};

const crossingValid: Rule = {
  id: "crossing-valid", title: "Every crossing carries contracts its seam allows", severity: "error",
  why: "A crossing is written whole in the shared layer so both designs agree on what passes between them. Each crossing carries a contract or says why none is needed, none carries what the seam says must never cross, and every contract it carries is defined once in the shared layer.",
  how: "Each crossing in seams.yaml, with the root's accepted patches: its seams are those whose two sides are its two ends' homes. Every crossing, on shipped and organization seams alike, needs a contract or a non-empty no_contract reason, written on the crossing or in its attrs.",
  check: found("crossing-valid"),
};

const fileIntact: Rule = {
  id: "file-intact", title: "The shipped shared file is as it was shipped", severity: "error",
  why: "The shared layer ships byte for byte in the editions and is pinned by hash. An edit by hand would be lost at the next upgrade and would make every design that relies on it disagree with the edition it was checked with, so the organization changes it through patches instead.",
  how: "The root's engine.yaml records shared_from.sha256 when the file is put there; seams.yaml must still have that sha256.",
  check: found("file-intact"),
};

export const pack: RulePack = {
  name: "shared",
  title: "Shared layer",
  description: "The shared layer in the shared root: its security marks, its crossings against their seams, and the shipped file left as shipped.",
  rules: [markValid, crossingValid, fileIntact],
};
export default pack;
