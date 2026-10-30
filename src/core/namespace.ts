// Namespaced references.
//
// Form: `<ns>:<id>`, or `<ns>:<kind>/<id>` where a field takes more than one kind and the id alone is ambiguous
// (`intake:phase/PH-2`). A namespace is [a-z][a-z0-9-]{0,23}; `shared` (the shared layer) and `org` (the organization's
// records) are reserved for the shared root. No id in either shipped instance holds `:`, `/`, `@` or a space, so the
// form parses without ambiguity; a prefix that is not a namespace is part of a bare id.
//
// Canonical form: a design's own records bare, everything else `<ns>:<id>`. The kind is dropped in canonical form,
// since every field the loader rewrites takes one kind; a field that takes two keeps what was written.

import type { RefKind } from "../types.ts";

export const NS_PATTERN = /^[a-z][a-z0-9-]{0,23}$/;
export const SHARED = "shared";
export const ORG = "org";
export const RESERVED = [SHARED, ORG] as const;
export const REF_KINDS: RefKind[] = ["element", "relationship", "contract", "team", "unit", "phase", "claim", "capability", "activity", "slowdown", "exception", "seam", "manual-work", "rule"];

export interface Ref { ns?: string; kind?: RefKind; id: string }

/** Parse a reference. A string with no namespace prefix is a bare id; so is one whose prefix is not a namespace. */
export function parseRef(s: string): Ref {
  const i = s.indexOf(":");
  if (i <= 0) return { id: s };
  const ns = s.slice(0, i);
  if (!NS_PATTERN.test(ns)) return { id: s };
  const rest = s.slice(i + 1);
  const j = rest.indexOf("/");
  if (j > 0) {
    const k = rest.slice(0, j) as RefKind;
    if (REF_KINDS.includes(k)) return { ns, kind: k, id: rest.slice(j + 1) };
  }
  return { ns, id: rest };
}

export function formatRef(r: Ref): string {
  return r.ns ? `${r.ns}:${r.kind ? `${r.kind}/` : ""}${r.id}` : r.id;
}

/** The namespace a reference names, or undefined for a bare id. */
export const nsOf = (s: string): string | undefined => parseRef(s).ns;

/** A reference into another design: a namespace that is neither `own`, `shared` nor `org`. */
export function isForeign(s: string, own?: string): boolean {
  const ns = parseRef(s).ns;
  return !!ns && ns !== own && ns !== SHARED && ns !== ORG;
}

/** A reference that names a namespace at all (the shared layer, the org layer or another design). */
export const isNamespaced = (s: string): boolean => parseRef(s).ns !== undefined;

/** What is wrong with a namespace as a design's own, in words, or undefined when it is fine. */
export function namespaceProblem(v: unknown): string | undefined {
  if (typeof v !== "string" || !v) return `is ${JSON.stringify(v)}, not a word of lower-case letters, digits and hyphens`;
  if (!NS_PATTERN.test(v)) return `"${v}" is not of the form [a-z][a-z0-9-]{0,23}: a lower-case letter, then up to 23 lower-case letters, digits or hyphens`;
  if ((RESERVED as readonly string[]).includes(v)) return `"${v}" is reserved for the shared root (shared: the shared layer, org: the organization's records)`;
  return undefined;
}
