// The org layer read: the organization's teams with their capacity, the
// standing activities that take a share of it, deliberate slowdowns, and the exceptions to the seam rule, each as an
// estimate-bearing record with its problems in words. The root's accepted patches are already applied (src/core/root.ts).
// The org and shared packs report what this finds; capacity calculations, tracker measures and the portfolio page read the records.
//
// Reading the records:
//   - A team's capacity is an estimate (a whole number of at least 1); one not given is "capacity not stated", which is
//     no finding. Its row owner is `row_owner`, by default its lead.
//   - An activity names its team (an org team), a type (bau, the default, or stream), an optional flow item, a share (an
//     estimate between 0 and 1), an optional kind of the shared manual-work catalog, and reliefs: `at` a unit or a
//     milestone in a design, written <namespace>:<id>; `effect` retire (to zero) or reduce (to `to`, an estimate).
//   - A slowdown is applied only when whole (org/slowdown-valid): what, activity, share_during, from, until, risk.rises,
//     accepted_by and accepted_at. It is in force from `from` until it ends: `until` passes (a date, or a milestone
//     reached, which needs the design composed), or `max_until` passes. org/slowdown-overdue warns when its ending
//     milestone's target has passed and the milestone is not reached, or `max_until` or `review_by` has passed.
//   - Exceptions, per seam: the organization's list where org.yaml declares one for the seam (it replaces the shipped
//     default; an empty list declines it), else the seam's shipped `default_exceptions`. An exception names a risk
//     acceptor, an end (a date or a milestone) and contracts its seam carries; one that does not is org/exception-valid
//     and does not apply. Past its end it stops applying, and is listed as ended.
//   - shares-exceed-capacity sums each team's activity shares as written (after patches): a relief or a slowdown only
//     lowers a share, so this is the most the standing work ever takes.
// References inside the root that resolve nowhere (an activity's team, a slowdown's activity, a catalog kind, an
// exception's shared seam) are core/xref-resolves (b); references from the root into a design are judged where that
// design is composed (src/core/resolve.ts).

import type { Activity, ComposedDesign, EstimateFacts, Estimate, OrgTeam, OrgView, Patch, Relief, RootInput, RootProblem, SeamException, Slowdown } from "../types.ts";
import { ORG, parseRef, SHARED } from "./namespace.ts";
import { ageDays, dateOf, DEFAULT_STALE_AFTER_DAYS, estimateHistory, estimateProblems, isDate, isStale, normEstimate, type EstimateKind } from "./estimate.ts";
import { natCompare } from "./util.ts";

type Raw = Record<string, unknown>;
const isMap = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);
const text = (v: unknown): string | undefined => (v === undefined || v === null ? undefined : typeof v === "string" ? (v.trim() || undefined) : v instanceof Date ? dateOf(v) : String(v));
const textList = (v: unknown): string[] => (Array.isArray(v) ? v.map(text).filter((x): x is string => !!x) : text(v) ? [text(v)!] : []);

export interface OrgReadOptions {
  today?: string;                        // the build date, YYYY-MM-DD
  staleAfterDays?: number;               // default: the root's estimates.stale_after_days, else 90
  compose?: ComposedDesign[];            // designs composed with the root: milestones reached, module seams' contracts
}

/** The root's estimates settings: engine.yaml `estimates: { stale_after_days, gap }`. */
export function estimateSettings(root: Pick<RootInput, "config">): { staleAfterDays: number; gap: { share: number; capacity: number } } {
  const e = isMap(root.config.estimates) ? root.config.estimates : {};
  const sad = Number(e.stale_after_days);
  const gap = isMap(e.gap) ? e.gap : {};
  const g = (k: string, d: number) => (typeof gap[k] === "number" && (gap[k] as number) >= 0 ? (gap[k] as number) : typeof e.gap === "number" && k === "share" ? e.gap : d);
  return { staleAfterDays: Number.isFinite(sad) && sad > 0 ? sad : DEFAULT_STALE_AFTER_DAYS, gap: { share: g("share", 0.05), capacity: g("capacity", 1) } };
}

/** A reference written in the org layer, in canonical form: a team, activity or slowdown bare or org:x is "org:x"; a design's record stays <ns>:<id>. */
export const orgRef = (s: string): string => { const r = parseRef(s); return r.ns === undefined || r.ns === ORG ? `${ORG}:${r.id}` : s; };
/** A reference to a shared record (a catalog kind, a seam, a contract), canonical: bare or shared:x is "shared:x". */
export const sharedRef = (s: string): string => { const r = parseRef(s); return r.ns === undefined || r.ns === SHARED ? `${SHARED}:${r.id}` : s; };
const bareOrg = (s: string): string => { const r = parseRef(s); return r.ns === undefined || r.ns === ORG ? r.id : s; };

/** Has this milestone of a composed design been reached (it has work, and all of it is done)? Undefined when the design is not composed. */
export function milestoneReached(ref: string, compose: ComposedDesign[] | undefined): boolean | undefined {
  const r = parseRef(ref);
  const d = r.ns ? compose?.find((x) => x.namespace === r.ns) : undefined;
  if (!d) return undefined;
  const us = d.plan.units.filter((u) => u.phase === r.id);
  return us.length > 0 && us.every((u) => u.status === "done");
}

/** A milestone's target date in a composed design, or undefined. */
export function milestoneTarget(ref: string, compose: ComposedDesign[] | undefined): string | undefined {
  const r = parseRef(ref);
  const d = r.ns ? compose?.find((x) => x.namespace === r.ns) : undefined;
  return d?.plan.phases.find((p) => p.id === r.id)?.target;
}

/** A milestone written as an end: <namespace>:<id> or <namespace>:phase/<id>. A date is not one. */
const isMilestoneRef = (s: string): boolean => { const r = parseRef(s); return !!r.ns && r.ns !== SHARED && r.ns !== ORG && (!r.kind || r.kind === "phase"); };

/**
 * Is a slowdown in force on `day`? Only a whole one is. It runs from `from` until `until` passes (a date), its ending
 * milestone is reached (known only when the design is composed; otherwise it is taken as not yet reached), or
 * `max_until` passes.
 */
export function slowdownInForce(sd: Slowdown, day: string, compose?: ComposedDesign[]): boolean {
  if (!sd.valid || !isDate(day) || !isDate(sd.from) || day < sd.from) return false;
  if (sd.max_until && isDate(sd.max_until) && day > sd.max_until) return false;
  if (isDate(sd.until)) return day <= sd.until;
  return milestoneReached(sd.until, compose) !== true;
}

/** Has an exception ended on `day`: its date has passed, or its milestone is reached (when that design is composed)? */
export function exceptionEnded(ex: Pick<SeamException, "until">, day: string | undefined, compose?: ComposedDesign[]): boolean {
  if (!ex.until) return false;
  if (isDate(ex.until)) return !!day && isDate(day) && day > ex.until;
  return milestoneReached(ex.until, compose) === true;
}

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

/** Read the org layer: typed records, the exceptions each seam takes, every estimate with its history, and the problems. */
export function readOrgView(root: RootInput, opts: OrgReadOptions = {}): OrgView | undefined {
  const org = root.org;
  const sh = root.shared;
  const problems: RootProblem[] = [];
  const settings = estimateSettings(root);
  const staleAfter = opts.staleAfterDays ?? settings.staleAfterDays;
  const today = opts.today;
  const estimates: EstimateFacts[] = [];
  const patches = root.patches ?? [], applied = root.applied ?? [], results = root.results ?? {};
  const proposed = patches.filter((p) => p.status === "proposed");

  const xref = (at: string, message: string) => problems.push({ rule: "core/xref-resolves", at, atKind: "instance", message, severity: "error" });

  /** Validate one estimate, record its facts, and return it when it is stated. */
  const estimate = (raw: unknown, kind: EstimateKind, rec: { kind: "team" | "activity" | "slowdown"; id: string; name: string; field: string; label: string; team?: string; base?: unknown; rowOwner?: string; atKind: RootProblem["atKind"]; optional?: boolean; staleChecked?: boolean }): Estimate | undefined => {
    if (raw === undefined || raw === null) {
      if (!rec.optional) problems.push({ rule: "org/estimate-valid", at: `${ORG}:${rec.id}`, atKind: rec.atKind, message: `${rec.name} (${ORG}:${rec.id}): ${rec.label} is not given; it counts as not stated` });
      return undefined;
    }
    const p = estimateProblems(raw, kind);
    const all = [...p.required, ...p.extra];
    if (all.length) problems.push({ rule: "org/estimate-valid", at: `${ORG}:${rec.id}`, atKind: rec.atKind, message: `${rec.name} (${ORG}:${rec.id}): ${rec.label} ${all.join("; ")}${p.required.length ? "; it counts as not stated" : ""}` });
    const e = normEstimate(raw, kind);
    const age = ageDays(e, today);
    const stale = rec.staleChecked !== false && isStale(e, today, staleAfter);
    if (stale) problems.push({ rule: "org/estimate-stale", at: `${ORG}:${rec.id}`, atKind: rec.atKind, message: `${rec.name} (${ORG}:${rec.id}): ${rec.label} is from ${e!.as_of}, ${age} days before the build date, older than estimates.stale_after_days (${staleAfter}); ask ${e!.source === "person" ? e!.by : "its owner"} to state it again, or refresh it from the tracker` });
    const history = rec.field.includes(".") ? (isMap(raw) ? [{ value: (raw as Raw).value as number, from: "file" as const, ...(e ? { source: e.source, by: e.by, as_of: e.as_of, confidence: e.confidence } : {}) }] : []) : estimateHistory(rec.base, kind, { kind: rec.kind, id: rec.id, field: rec.field }, patches, applied, results);
    const pending = rec.field.includes(".") ? [] : pendingFor(proposed, rec.kind, rec.id, rec.field);
    const facts: EstimateFacts = {
      record: `${ORG}:${rec.id}`, kind: rec.kind, field: rec.field, ...(rec.team ? { team: rec.team } : {}),
      ...(e ? { value: e } : {}), problems: p.required, ...(age !== undefined ? { ageDays: age } : {}), stale, history, pending,
      ...(e && e.source === "person" && rec.rowOwner ? { rowOwner: { owner: rec.rowOwner, statedByOwner: e.by.trim().toLowerCase() === rec.rowOwner.trim().toLowerCase() } } : {}),
    };
    estimates.push(facts);
    return e;
  };

  // the org layer as org.yaml writes it, before any patch: each record's base value in its history
  const written = {
    team: new Map((root.orgWritten?.teams ?? []).map((t) => [t.id, (t.attrs ?? {}) as Raw])),
    activity: new Map((root.orgWritten?.activities ?? []).map((a) => [a.id, a as Raw])),
    slowdown: new Map((root.orgWritten?.slowdowns ?? []).map((s) => [s.id, s as Raw])),
  };

  // ── teams ──
  const teams: OrgTeam[] = (org?.teams ?? []).map((t) => {
    const attrs = { ...(t.attrs ?? {}) } as Raw;
    const rowOwner = text(attrs.row_owner) ?? t.lead;
    const ot: OrgTeam = { id: t.id, name: t.name, ...(t.description ? { description: t.description } : {}), ...(t.lead ? { lead: t.lead } : {}), ...(rowOwner ? { row_owner: rowOwner } : {}) };
    const cap = estimate(attrs.capacity, "capacity", { kind: "team", id: t.id, name: t.name, field: "capacity", label: "its capacity", team: `${ORG}:${t.id}`, base: written.team.get(t.id)?.capacity, rowOwner, atKind: "team", optional: true });
    if (cap) ot.capacity = cap;
    delete attrs.row_owner; delete attrs.capacity;
    if (Object.keys(attrs).length) ot.attrs = attrs;
    return ot;
  });
  const teamIds = new Set(teams.map((t) => t.id));
  const rowOwnerOf = new Map(teams.map((t) => [t.id, t.row_owner]));
  const catalog = new Set((sh?.manual_work ?? []).map((m) => m.id));

  // ── activities ──
  const activities: Activity[] = (org?.activities ?? []).map((a) => {
    const id = String(a.id), name = text(a.name) ?? id;
    const teamW = text(a.team);
    const team = teamW ? bareOrg(teamW) : "";
    if (!teamW) xref(`${ORG}:${id}`, `activity ${id} (${name}) names no team (team: <org team>); its share counts against no one`);
    else if (parseRef(teamW).ns && parseRef(teamW).ns !== ORG) xref(`${ORG}:${id}`, `activity ${id} names ${teamW} as its team; a team of the org layer is named bare or org:<id>`);
    else if (org && !teamIds.has(team)) xref(`${ORG}:${id}`, `activity ${id} names team ${team}, which the org layer does not hold`);
    const act: Activity = { id, team: team ? `${ORG}:${team}` : "", name, type: text(a.type) === "stream" ? "stream" : "bau", relieved_by: [] };
    if (text(a.description)) act.description = text(a.description)!;
    if (text(a.flow_item)) act.flow_item = text(a.flow_item)!;
    const share = estimate(a.share, "share", { kind: "activity", id, name, field: "share", label: "its share", ...(team ? { team: `${ORG}:${team}` } : {}), base: written.activity.get(id)?.share, rowOwner: rowOwnerOf.get(team), atKind: "instance" });
    if (share) act.share = share;
    const mw = text(a.manual_work);
    if (mw) {
      act.manual_work = sharedRef(mw);
      const r = parseRef(mw);
      if (r.ns && r.ns !== SHARED) xref(`${ORG}:${id}`, `activity ${id} links ${mw} as its manual work; a kind of manual work lives in the shared catalog, named bare or shared:<id>`);
      else if (sh && !catalog.has(r.id)) xref(`${ORG}:${id}`, `activity ${id} links the manual work ${r.id}, which the shared catalog does not hold`);
    }
    const reliefs = Array.isArray(a.relieved_by) ? a.relieved_by : a.relieved_by != null ? [a.relieved_by] : [];
    reliefs.forEach((rv, i) => {
      const n = i + 1;
      if (!isMap(rv)) { problems.push({ rule: "org/estimate-valid", at: `${ORG}:${id}`, atKind: "instance", message: `${name} (${ORG}:${id}): its relief ${n} is not a mapping of at, effect and to` }); return; }
      const at = text(rv.at), effect = text(rv.effect);
      if (!at) { xref(`${ORG}:${id}`, `activity ${id}'s relief ${n} names no unit or milestone (at: <namespace>:<id>)`); return; }
      if (!parseRef(at).ns || parseRef(at).ns === SHARED || parseRef(at).ns === ORG) { xref(`${ORG}:${id}`, `activity ${id}'s relief ${n} names ${at}; a relief names a unit or a milestone in a design, written <namespace>:<id>`); return; }
      if (effect !== "retire" && effect !== "reduce") { problems.push({ rule: "org/estimate-valid", at: `${ORG}:${id}`, atKind: "instance", message: `${name} (${ORG}:${id}): its relief ${n} by ${at} has effect ${effect ? `"${effect}"` : "none"}, which is not retire or reduce; it is not applied` }); return; }
      const relief: Relief = { at, effect };
      if (effect === "reduce") {
        if (rv.to === undefined || rv.to === null) { problems.push({ rule: "org/estimate-valid", at: `${ORG}:${id}`, atKind: "instance", message: `${name} (${ORG}:${id}): its relief ${n} by ${at} reduces the share but gives no to (the share after it, an estimate); it is not applied` }); return; }
        const to = estimate(rv.to, "share", { kind: "activity", id, name, field: `relieved_by.${n}.to`, label: `the share after its relief ${n} by ${at}`, ...(team ? { team: `${ORG}:${team}` } : {}), rowOwner: rowOwnerOf.get(team), atKind: "instance" });
        if (!to) return;
        relief.to = to;
      }
      act.relieved_by.push(relief);
    });
    const known = ["id", "team", "name", "type", "flow_item", "share", "manual_work", "relieved_by", "description"];
    const rest = Object.fromEntries(Object.entries(a).filter(([k]) => !known.includes(k)));
    if (Object.keys(rest).length) act.attrs = rest;
    return act;
  });
  const actById = new Map(activities.map((a) => [a.id, a]));

  // ── shares that take all of a team's capacity ──
  for (const t of teams) {
    const mine = activities.filter((a) => a.team === `${ORG}:${t.id}` && a.share);
    const sum = mine.reduce((s, a) => s + a.share!.value, 0);
    if (mine.length && sum >= 1 - 1e-9)
      problems.push({ rule: "org/shares-exceed-capacity", at: `${ORG}:${t.id}`, atKind: "team", message: `${t.name} (${ORG}:${t.id}): its activities take ${fmt(sum)} of its capacity (${mine.map((a) => `${a.name} ${fmt(a.share!.value)}`).join(", ")}), so keeping the lights on and other streams leave nothing for design work` });
  }

  // ── slowdowns ──
  const slowdowns: Slowdown[] = (org?.slowdowns ?? []).map((s) => {
    const id = String(s.id);
    const missing: string[] = [];
    const what = text(s.what), actW = text(s.activity), from = dateOf(s.from), until = text(s.until), acceptedAt = dateOf(s.accepted_at);
    const mu = dateOf(s.max_until), rb = dateOf(s.review_by);
    const risk = isMap(s.risk) ? s.risk : undefined;
    const rises = text(risk?.rises);
    const acceptedBy = textList(s.accepted_by);
    if (!what) missing.push("does not say what it slows (what)");
    if (!actW) missing.push("names no activity");
    if (s.share_during === undefined || s.share_during === null) missing.push("gives no share_during (the share while it runs, an estimate)");
    if (!from) missing.push("has no from date");
    else if (!isDate(from)) missing.push(`has from "${from}", which is not a date (YYYY-MM-DD)`);
    if (!until) missing.push("has no end (until: a milestone or a date)");
    else if (!isDate(until) && !isMilestoneRef(until)) missing.push(`has until "${until}", which is neither a date (YYYY-MM-DD) nor a milestone (<namespace>:<id>)`);
    if (!rises) missing.push("does not say what risk rises while it runs (risk.rises)");
    if (!acceptedBy.length) missing.push("names no one who accepted it (accepted_by)");
    if (!acceptedAt) missing.push("does not say when it was accepted (accepted_at)");
    else if (!isDate(acceptedAt)) missing.push(`has accepted_at "${acceptedAt}", which is not a date (YYYY-MM-DD)`);
    for (const k of ["max_until", "review_by"] as const) { const d = dateOf(s[k]); if (s[k] != null && !isDate(d)) missing.push(`has ${k} "${d ?? ""}", which is not a date (YYYY-MM-DD)`); }
    const actId = actW ? bareOrg(actW) : "";
    const act = actById.get(actId);
    const label = `${id}${act ? ` on ${act.name}` : ""}`;
    if (actW && !act) xref(`${ORG}:${id}`, `slowdown ${id} slows the activity ${actW}, which the org layer does not hold`);
    if (missing.length) problems.push({ rule: "org/slowdown-valid", at: `${ORG}:${id}`, atKind: "instance", message: `The slowdown ${label} ${missing.join(", ")}; it is not applied` });
    const sd: Slowdown = {
      id, activity: actId ? `${ORG}:${actId}` : "", what: what ?? "", from: from ?? "", until: until ?? "",
      risk: { rises: rises ?? "", refs: textList(risk?.refs), ...(text(risk?.level) ? { level: text(risk?.level)! } : {}) },
      accepted_by: acceptedBy, accepted_at: acceptedAt ?? "", valid: false,
    };
    if (mu) sd.max_until = mu;
    if (rb) sd.review_by = rb;
    // a slowdown that has ended by its dates needs no fresh estimate
    const endedByDate = !!today && isDate(today) && ((!!until && isDate(until) && today > until) || (!!mu && isDate(mu) && today > mu));
    const during = s.share_during === undefined || s.share_during === null ? undefined : estimate(s.share_during, "share", { kind: "slowdown", id, name: `The slowdown ${label}`, field: "share_during", label: "its share while it runs", ...(act?.team ? { team: act.team } : {}), base: written.slowdown.get(id)?.share_during, rowOwner: act ? rowOwnerOf.get(bareOrg(act.team)) : undefined, atKind: "instance", staleChecked: !endedByDate });
    if (during) sd.share_during = during;
    sd.valid = !missing.length && !!during && !!act;
    const known = ["id", "activity", "what", "share_during", "from", "until", "max_until", "risk", "accepted_by", "accepted_at", "review_by"];
    const rest = Object.fromEntries(Object.entries(s).filter(([k]) => !known.includes(k)));
    if (Object.keys(rest).length) sd.attrs = rest;
    // overdue: its ending milestone's target has passed and the milestone is not reached, or max_until or review_by has passed
    if (sd.valid && today && isDate(today) && today >= sd.from) {
      const why: string[] = [];
      if (isMilestoneRef(sd.until)) {
        const target = milestoneTarget(sd.until, opts.compose), reached = milestoneReached(sd.until, opts.compose);
        if (target && isDate(target) && today > target && reached === false) why.push(`its ending milestone ${sd.until} was due ${target} and is not reached`);
      }
      if (sd.max_until && today > sd.max_until) why.push(`it ran past the latest it may run, ${sd.max_until}, so it is no longer applied`);
      if (sd.review_by && today > sd.review_by) why.push(`its review date, ${sd.review_by}, has passed`);
      if (why.length && !(isDate(sd.until) && today > sd.until))
        problems.push({ rule: "org/slowdown-overdue", at: `${ORG}:${id}`, atKind: "instance", message: `The slowdown ${label}: ${why.join("; ")}. Record its end, or review it and write a new review_by` });
    }
    return sd;
  });

  // ── exceptions, per seam ──
  const exceptions: Record<string, SeamException[]> = {};
  const declined: string[] = [];
  // a shared seam's key is its bare id (shared:<id> written out is the same seam); a module seam's is <namespace>:<seam id>
  const orgEx: Record<string, unknown[]> = {};
  for (const [k, v] of Object.entries(org?.seam_exceptions ?? {})) { const r = parseRef(k); orgEx[r.ns === SHARED ? r.id : k] = v; }
  const seamKeys = new Set<string>([...(sh?.seams ?? []).map((s) => s.id), ...Object.keys(orgEx)]);
  for (const key of [...seamKeys].sort(natCompare)) {
    const r = parseRef(key);
    const shared = r.ns === undefined || r.ns === SHARED ? sh?.seams.find((s) => s.id === r.id) : undefined;
    const module = r.ns && r.ns !== SHARED && r.ns !== ORG ? r : undefined;
    if (key in orgEx && !shared && !module) { xref(`${ORG}:${key}`, `the org layer declares exceptions for the seam ${key}, which the shared layer does not hold (a design's own module seam is named <namespace>:<seam id>)`); continue; }
    const fromOrg = key in orgEx;
    const list = fromOrg ? orgEx[key] : shared?.default_exceptions ?? [];
    if (fromOrg && !list.length && shared?.default_exceptions?.length) declined.push(key);
    const seamAt = module ? key : `${SHARED}:${r.id}`;
    const carried = module ? moduleSeamContracts(key, opts.compose) : sharedSeamContracts(root, r.id);
    exceptions[key] = list.map((x, i): SeamException => {
      const who = fromOrg ? "The organization's exception" : "The shipped default exception";
      const nth = list.length > 1 ? ` ${i + 1} of ${list.length}` : "";
      const ex: SeamException = { seam: key, source: fromOrg ? "org" : "default", index: i + 1, contracts: [], valid: false, problems: [] };
      if (!isMap(x)) ex.problems.push("is not a mapping of contracts, accepted_by, until and why");
      else {
        ex.contracts = textList(x.contracts).map((c) => (module ? (parseRef(c).ns ? c : `${module.ns}:${c}`) : sharedRef(c)));
        const by = text(x.accepted_by), until = text(x.until), why = text(x.why);
        if (by) ex.accepted_by = by;
        if (until) ex.until = until;
        if (why) ex.why = why;
        if (!by) ex.problems.push("names no risk acceptor (accepted_by)");
        if (!until) ex.problems.push(!fromOrg && x.until === null ? "awaits the organization's end date" : "has no end (until: a milestone or a date)");
        else if (!isDate(until) && !isMilestoneRef(until)) ex.problems.push(`has until "${until}", which is neither a date (YYYY-MM-DD) nor a milestone (<namespace>:<id>)`);
        if (!ex.contracts.length) ex.problems.push("names no contract, so it excepts nothing");
        if (carried) for (const c of ex.contracts) if (!carried.has(c)) ex.problems.push(`names ${c}, which its seam does not carry`);
      }
      ex.valid = !ex.problems.length;
      if (ex.problems.length) problems.push({ rule: "org/exception-valid", ...(!fromOrg && isMap(x) && x.until === null && ex.problems.length === 1 ? { severity: "warning" as const } : {}), at: seamAt, atKind: "instance", message: `${who}${nth} on the seam ${key} ${ex.problems.join(", ")}; it does not apply` });
      return ex;
    });
  }

  estimates.sort((a, b) => natCompare(a.record, b.record) || natCompare(a.field, b.field));
  if (!org && !Object.keys(exceptions).length) return undefined;
  return { teams, activities, slowdowns, exceptions, declined, estimates, problems };
}

/** Does an exception apply on `today`: it is valid and has not ended? */
export function exceptionInForce(ex: SeamException, today: string | undefined, compose?: ComposedDesign[]): boolean {
  return ex.valid && !exceptionEnded(ex, today, compose);
}

/** The contracts a seam in the shared layer carries: those the shared layer's crossings carry between its two sides, canonical. */
export function sharedSeamContracts(root: Pick<RootInput, "shared">, seamId: string): Set<string> | undefined {
  const sh = root.shared;
  const seam = sh?.seams.find((s) => s.id === seamId);
  if (!sh || !seam) return undefined;
  const out = new Set<string>();
  for (const x of sh.crossings) if (onSeam(seam.between, x.from, x.to)) for (const c of x.carries ?? []) out.add(sharedRef(c));
  return out;
}

/**
 * Does a crossing with these ends (written as in the shared layer: a design's part <ns>:<id>, a shared part bare) cross
 * a seam between these two sides? A side is a design's namespace, `shared` (any shared part) or shared:<id> (one).
 */
export function onSeam(between: string[], from: string, to: string): boolean {
  if (between.length !== 2) return false;
  const [a, b] = between;
  const m = (side: string, end: string) => {
    const s = parseRef(side), e = parseRef(end);
    const home = e.ns ?? SHARED;
    return s.ns === SHARED ? home === SHARED && e.id === s.id : side === home;
  };
  return (m(a, from) && m(b, to)) || (m(b, from) && m(a, to));
}

/** The contracts a design's module seam carries, canonical "<ns>:<name>" (or shared:<name>): its named crossings' and every edge across it. Undefined when the design is not composed. */
export function moduleSeamContracts(key: string, compose: ComposedDesign[] | undefined): Set<string> | undefined {
  const r = parseRef(key);
  const d = r.ns ? compose?.find((x) => x.namespace === r.ns) : undefined;
  const seam = d?.model.seams?.find((s) => s.id === r.id);
  if (!d || !seam) return undefined;
  const canon = (c: string) => (parseRef(c).ns ? c : `${d.namespace}:${c}`);
  const out = new Set<string>();
  for (const x of seam.crossings ?? []) for (const c of x.carries ?? []) out.add(canon(c));
  const modules = new Set(seam.between);
  const mod = new Map(d.model.elements.filter((e) => !e.home).map((e) => [e.id, typeof e.attrs?.module === "string" ? e.attrs.module as string : undefined]));
  for (const rel of d.model.relationships) {
    if (rel.home || !mod.has(rel.from) || !mod.has(rel.to)) continue;
    const a = mod.get(rel.from), b = mod.get(rel.to);
    if (a !== b && ((a && modules.has(a)) || (b && modules.has(b)))) for (const c of rel.carries ?? []) out.add(canon(c));
  }
  return out;
}

/** The proposed root patches that would change one field of one org record, with the value each would set. */
function pendingFor(proposed: Patch[], kind: string, id: string, field: string): EstimateFacts["pending"] {
  const out: EstimateFacts["pending"] = [];
  for (const p of proposed) for (const op of p.ops) {
    const o = op as unknown as Raw;
    if (!isMap(o) || o.op !== "modify" || o.kind !== kind || bareOrg(String(o.id ?? "")) !== id || !isMap(o.set) || !(field in o.set)) continue;
    out.push({ patch: p.id, title: p.title, value: o.set[field], ...(p.provenance?.author ? { author: p.provenance.author } : {}), ...(p.provenance?.agent?.name ? { agent: p.provenance.agent.name } : {}), ...(p.provenance?.created ? { created: p.provenance.created } : {}) });
  }
  return out;
}

