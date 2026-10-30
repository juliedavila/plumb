// Test helpers: build small models and plans in code, and run one pack's rule against them.

import { buildContext, loadPacks } from "../src/core/rules.ts";
import { DEFAULT_LADDER } from "../src/core/load.ts";
import type { InstanceConfig, Model, Plan, RulePack } from "../src/types.ts";

export const MINI = new URL("./fixtures/mini", import.meta.url).pathname;

export function model(m: Partial<Model> = {}): Model {
  return { teams: [], systems: [], zones: [], elements: [], relationships: [], contracts: [], views: [], ...m };
}

export function plan(p: Partial<Plan> = {}): Plan {
  return { phases: [], units: [], ...p };
}

export function config(c: Partial<InstanceConfig> = {}): InstanceConfig {
  return { name: "t", title: "T", packs: ["generic", "plan", "flow"], ladder: DEFAULT_LADDER, ...c };
}

const packs = new Map<string, RulePack>();
export async function pack(name: string): Promise<RulePack> {
  if (!packs.has(name)) {
    const { packs: ps, errors } = await loadPacks([name]);
    if (errors.length) throw new Error(errors[0].message);
    packs.set(name, ps[0]);
  }
  return packs.get(name)!;
}

/** Findings of one rule (by id) of one pack over the given model and plan. */
export async function run(packName: string, ruleId: string, m: Model, p: Plan = plan(), c: InstanceConfig = config()) {
  const pk = await pack(packName);
  const rule = pk.rules.find((r) => r.id === ruleId);
  if (!rule) throw new Error(`no rule ${packName}/${ruleId}`);
  return rule.check(buildContext(c, m, p));
}

export const T = (id: string) => ({ id, name: id });
export const E = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, kind: "service", owner: "t1", ...extra });
export const R = (id: string, from: string, to: string, extra: Record<string, unknown> = {}) => ({ id, from, to, kind: "data", ...extra });
export const U = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, kind: "code", phase: "ph1", check: "done when done", ...extra });
export const PH = (id: string, order: number, extra: Record<string, unknown> = {}) => ({ id, name: id, exit_test: "a person can check it", order, ...extra });
