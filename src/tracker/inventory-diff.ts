// Discovery compares inventories, not issue snapshots. Counts may change without requiring new mapping choices.
import type { TrackerInventory } from "../types.ts";
import { canonicalJson, natCompare } from "../core/util.ts";

type RecordValue = Record<string, unknown>;

/** Order and JSON key order do not make an inventory change. Usage counts do not change its vocabulary. */
function normalized(value: unknown, vocabulary = false): unknown {
  if (Array.isArray(value)) return value.map((v) => normalized(v, vocabulary)).sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([k]) => !vocabulary || !["count", "issues", "children"].includes(k)).map(([k, v]) => [k, normalized(v, vocabulary)]));
}

export function inventoryChanges(before: TrackerInventory | undefined, after: TrackerInventory): string[] {
  if (!before) return ["Inventory created. There is no earlier inventory to compare.", "Run tracker draft-mapping before the first reconciliation or measurement."];
  const changes: string[] = [];
  let vocabularyChanged = false;
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort(natCompare);
  for (const key of keys) {
    const prev = (before as unknown as RecordValue)[key], next = (after as unknown as RecordValue)[key];
    if (canonicalJson(normalized(prev)) === canonicalJson(normalized(next))) continue;
    if (!["source", "notes", "issues", "hierarchy"].includes(key) && canonicalJson(normalized(prev, true)) !== canonicalJson(normalized(next, true))) vocabularyChanged = true;
    if (Array.isArray(prev) && Array.isArray(next) && [...prev, ...next].every((x) => x && typeof x === "object" && ("id" in x || "key" in x || "name" in x))) {
      const identity = (x: RecordValue) => `${x.project ?? ""}:${x.id ?? x.key ?? x.name}`;
      const old = new Map(prev.map((x) => [identity(x), x as RecordValue]));
      const now = new Map(next.map((x) => [identity(x), x as RecordValue]));
      for (const id of [...new Set([...old.keys(), ...now.keys()])].sort(natCompare)) {
        const a = old.get(id), b = now.get(id), record = b ?? a!;
        const label = `${key}: ${record.name ?? record.key ?? record.id}${record.project ? ` (${record.project})` : ""}`;
        if (!a) changes.push(`Added ${label}.`);
        else if (!b) changes.push(`Removed ${label}.`);
        else if (canonicalJson(normalized(a)) !== canonicalJson(normalized(b))) {
          const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort(natCompare).filter((k) => canonicalJson(normalized(a[k])) !== canonicalJson(normalized(b[k])));
          changes.push(`Changed ${label}: ${fields.map((k) => `${k} ${JSON.stringify(a[k]) ?? "absent"} to ${JSON.stringify(b[k]) ?? "absent"}`).join(", ")}.`);
        }
      }
    } else changes.push(`Changed ${key}: ${JSON.stringify(prev) ?? "absent"} to ${JSON.stringify(next) ?? "absent"}.`);
  }
  if (!changes.length) return ["Inventory unchanged.", "No new mapping draft is needed if the existing mapping is valid."];
  return ["Inventory changed.", ...changes, vocabularyChanged
    ? "Mapping vocabulary changed. Run tracker draft-mapping and review the draft against the existing mapping."
    : "Mapping vocabulary unchanged. No new mapping draft is needed if the existing mapping is valid."];
}
