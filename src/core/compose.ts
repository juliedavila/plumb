// Composition: other designs built beside this one, and the pin checks that need them.
//
// A design's own build knows other designs only through its root's shared layer: their parts at its edge are outside
// parts named and marked by the shared layer. Composition (a portfolio, or a test) hands a design the other designs
// as they are compiled, so references into them resolve and its pins can be checked:
//   core/xref-pin-stale (i)  needs the pinned design composed: the edition composed against the pinned one, and the
//                            hash of the edition under the pinned version;
//   core/xref-pin-stale (ii) needs only the design's own edition record and its root: the shared file it was checked
//                            with against the root's shipped one;
//   core/xref-no-cycle       sees loops through composed designs and two designs on one namespace (src/core/load.ts).

import type { ComposedDesign, Finding, Instance } from "../types.ts";
import { compile, type Compiled } from "./compile.ts";
import { loadInstance } from "./load.ts";
import { newestEdition, pinLoops, pinStaleFinding, sharedStaleFinding } from "./edition.ts";

/** Load and compile a design folder for composition: its working copy, or a released edition. */
export function composeDesign(dir: string, edition?: string): ComposedDesign {
  const inst = loadInstance(dir, edition !== undefined ? { edition } : {});
  const c = compile(inst);
  return {
    namespace: inst.ns?.namespace ?? inst.config.name, dir: inst.dir, title: inst.config.title,
    ...(edition !== undefined ? { edition, editionSha256: inst.edition!.sha256 } : {}),
    model: c.model, plan: c.plan, pins: inst.ns?.pins ?? [],
  };
}

/** A design folder compiled as written, without resolution: what the pin check compares between two of its editions. */
function compileAsWritten(dir: string, edition?: string): Compiled {
  const i = loadInstance(dir, edition !== undefined ? { edition } : {});
  return compile({ model: i.model, plan: i.plan, patches: i.patches });
}

/** The build-time core findings of a 0.4 design that need more than its own records: stale pins, a moved shared file. */
export function nsBuildFindings(inst: Instance, compiled: Compiled): Finding[] {
  const ns = inst.ns;
  if (!ns) return [];
  const out: Finding[] = [];
  const root = ns.root?.input;
  let ed = inst.edition;
  if (!ed) { try { ed = newestEdition(inst.dir); } catch { ed = undefined; } } // the working copy answers to its newest release
  const sf = sharedStaleFinding(ed, root, compiled.ns?.sharedNamed ?? []);
  if (sf) out.push(sf);
  // a pin inside a loop has no solution to check: core/xref-no-cycle names the loop, and nothing more follows from it
  const own = ns.namespace;
  const looped = new Set(own && ns.compose ? pinLoops([{ namespace: own, pins: ns.pins }, ...ns.compose.filter((d) => d.namespace !== own)]).filter((c) => c.includes(own)).flat() : []);
  for (const pin of ns.pins) {
    const d = ns.compose?.find((x) => x.namespace === pin.namespace);
    if (!d || looped.has(pin.namespace)) continue; // the pinned design is not composed (a design's own build cannot see it), or the pin loops
    const f = pinStaleFinding(ns.namespace ?? inst.config.name, pin, d, root, compileAsWritten);
    if (f) out.push(f);
  }
  return out;
}
