// Small shared helpers: natural ordering, canonical JSON, hashing.

/** Natural compare: digit runs compare numerically, everything else by code point. Total and deterministic. */
export function natCompare(a: string, b: string): number {
  if (a === b) return 0;
  const ra = a.match(/\d+|\D+/g) ?? [];
  const rb = b.match(/\d+|\D+/g) ?? [];
  const n = Math.min(ra.length, rb.length);
  let zeros = 0; // tiebreak for numerically equal runs that differ in leading zeros
  for (let i = 0; i < n; i++) {
    const x = ra[i], y = rb[i];
    const dx = /^\d/.test(x), dy = /^\d/.test(y);
    if (dx && dy) {
      const sx = x.replace(/^0+(?=\d)/, ""), sy = y.replace(/^0+(?=\d)/, "");
      if (sx.length !== sy.length) return sx.length - sy.length;
      if (sx !== sy) return sx < sy ? -1 : 1;
      if (!zeros && x.length !== y.length) zeros = x.length - y.length; // "01" after "1"
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  if (ra.length !== rb.length) return ra.length - rb.length;
  if (zeros) return zeros;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function natSort(xs: Iterable<string>): string[] {
  return [...xs].sort(natCompare);
}

export function byId<T extends { id: string }>(a: T, b: T): number {
  return natCompare(a.id, b.id);
}

/** JSON with object keys sorted recursively and undefined dropped. */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(canon(v));
}

function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : canon(x)));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = canon(x);
    }
    return out;
  }
  return v;
}

export function sha256(s: string): string {
  return new Bun.CryptoHasher("sha256").update(s).digest("hex");
}

export function clone<T>(v: T): T {
  return structuredClone(v);
}
