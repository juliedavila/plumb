// The shared layer (namespace `shared`): the design records more than one design references,
// shipped byte for byte in the editions as seams.yaml. src/core/root.ts loads it for reference resolution and outside
// parts. These types also cover shape checks, marks, exceptions and the seam rule. Every record keeps the engine's
// record shape, so the generic code reads a shared part as a part.
import type { Attrs, Claim, Contract, Element, Relationship, System, Zone } from "../types.ts";

/** A capability that crosses: which design provides it and which designs require it. Units name it bare. */
export interface SharedCapability {
  id: string; name?: string;
  provided_by: string[];                 // namespaces of the designs that provide it
  required_by: string[];                 // namespaces of the designs that require it
  attrs?: Attrs;
  home?: string;                         // "shared" once it is brought into a design's compiled plan
}

/** One kind of manual work in the shared catalog: units say they relieve it with `relieves`. */
export interface ManualWork { id: string; name: string; description?: string; flow_item?: string }

/** A far-side part coding agents reach, as one side of a seam declares it, with the marks its own build gives it. */
export interface ExposureEntry { part: string; marks: Record<string, unknown> }

/**
 * A seam: between two namespaces (seams.yaml), or between a module and the rest of one design (a design's own
 * model.yaml `seams:`). A module seam names its crossings with the contracts each carries; a seam in
 * the shared layer holds its crossings whole under `crossings:` at the top of the file.
 */
export interface Seam {
  id: string;
  name?: string;
  between: string[];
  owner_role?: string;
  checks?: string[];                     // rule codes that must hold across it
  never_cross?: string[];                // contracts that must never cross it
  exposure?: Record<string, ExposureEntry[]>; // per side: the far-side parts coding agents reach
  default_exceptions?: unknown[];        // read by the seam checks
  crossings?: { id: string; carries?: string[] }[]; // a module seam's crossings, by name
  attrs?: Attrs;
  home?: string;
}

/** seams.yaml as the engine reads it. Every top-level key the engine does not read is kept in `extra`, untouched. */
export interface SharedLayer {
  file: string;                          // the file's path, relative to the root
  sha256: string;                        // the hash of its bytes
  namespace: string;                     // "shared"
  version?: string;                      // the file's own version, when it carries one
  schema?: { model?: number | string; design_engine?: string };
  systems: System[]; zones: Zone[];
  parts: Element[];                      // shared parts (the engineering system first)
  contracts: Contract[];                 // contracts that cross, each defined once
  crossings: Relationship[];             // every relationship whose ends have different homes, held whole
  capabilities: SharedCapability[];
  seams: Seam[];
  manual_work: ManualWork[];
  claims: Claim[];                       // premises about shared parts
  names: Record<string, string>;         // display names for far-side parts: "<ns>:<id>" -> name
  manualWorkFile?: { file: string; sha256: string }; // manual-work.yaml, when the catalog ships as its own file
  extra: Record<string, unknown>;
  problems: string[];                    // what the reader could not read, in words
}
