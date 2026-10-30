// Generates tests/fixtures/sample-bundle.json: a small-to-medium Bundle for site development.
// Layouts and analysis are computed here by hand-rolled code on fixed grid positions, independent
// of src/core, so the site can be built and tested before core lands.
// Run: bun tests/fixtures/make-sample.ts
import type {
  Bundle, Element, Relationship, Contract, View, Unit, Phase, Finding, Patch, Impact,
  ViewLayout, LayoutNode, LayoutEdge, PlanAnalysis,
} from "../../src/types";

const teams = [
  { id: "t-platform", name: "Platform engineering", description: "Owns source control, CI and developer tooling." },
  { id: "t-security", name: "Product security", description: "Owns supply-chain controls and admission policy." },
  { id: "t-release", name: "Release engineering", description: "Owns the artifact store, approvals and deploys." },
  { id: "t-sre", name: "Site reliability", description: "Owns the clusters, monitoring and on-call." },
];
const systems = [
  { id: "s-source", name: "Source control" },
  { id: "s-build", name: "Build system" },
  { id: "s-release", name: "Release system" },
  { id: "s-runtime", name: "Runtime" },
];
const zones = [
  { id: "z-dev", name: "Developer workspace", description: "Laptops and the tools engineers touch directly." },
  { id: "z-build", name: "Build zone", description: "Isolated build and signing infrastructure." },
  { id: "z-prod", name: "Production", description: "Clusters serving customers, and what admits code into them." },
  { id: "z-ext", name: "Outside the organization", description: "Third parties we do not control." },
];

type E = [string, string, string, string, string | undefined, string | undefined, string];
const E_ROWS: E[] = [
  ["engineer", "Engineer", "person", "z-dev", undefined, "t-platform", "Writes and reviews code."],
  ["workstation", "Developer workstation", "device", "z-dev", "s-source", "t-platform", "Managed laptop with the build toolchain."],
  ["repo", "Source repository", "store", "z-build", "s-source", "t-platform", "Protected branches and required reviews."],
  ["review", "Code review", "process", "z-build", "s-source", "t-platform", "Two-person review before merge."],
  ["ci", "CI runner", "service", "z-build", "s-build", "t-platform", "Ephemeral runners that build every merge."],
  ["cache", "Build cache", "store", "z-build", "s-build", "t-platform", "Shared layer cache across runners."],
  ["mirror", "Dependency mirror", "service", "z-build", "s-build", "t-security", "Pinned, scanned copies of third-party packages."],
  ["registry", "Public package registry", "external-system", "z-ext", undefined, undefined, "Upstream source of open-source packages."],
  ["sbom-gen", "SBOM generator", "service", "z-build", "s-build", "t-security", "Produces a software bill of materials per build."],
  ["scanner", "Vulnerability scanner", "service", "z-build", "s-build", "t-security", "Scans images for known vulnerabilities."],
  ["signer", "Signing service", "service", "z-build", "s-release", "t-security", "Signs artifacts and provenance with a managed key."],
  ["kms", "Key management", "store", "z-build", "s-release", "t-security", "Holds signing keys; keys never leave it."],
  ["artifacts", "Artifact store", "store", "z-build", "s-release", "t-release", "Immutable store of signed release artifacts."],
  ["attest", "Attestation store", "store", "z-build", "s-release", "t-security", "Provenance, SBOM and scan attestations by digest."],
  ["policy", "Admission policy", "service", "z-prod", "s-release", "t-security", "Decides whether an artifact may run."],
  ["approval", "Change approval", "process", "z-build", "s-release", "t-release", "Release sign-off for production changes."],
  ["deployer", "Deploy controller", "service", "z-prod", "s-release", "t-release", "Rolls artifacts out to staging and production."],
  ["staging", "Staging cluster", "service", "z-prod", "s-runtime", "t-sre", "Pre-production copy of the runtime."],
  ["prod", "Production cluster", "service", "z-prod", "s-runtime", "t-sre", "Serves customer traffic."],
  ["flags", "Feature flag service", "service", "z-prod", "s-runtime", "t-release", "Turns features on and off without a deploy."],
  ["monitor", "Runtime monitor", "service", "z-prod", "s-runtime", "t-sre", "Collects telemetry and raises alerts."],
  ["alerts", "Alert queue", "queue", "z-prod", "s-runtime", "t-sre", "Alerts waiting for a person."],
  ["oncall", "On-call engineer", "person", "z-prod", undefined, "t-sre", "Responds to pages."],
  ["tracker", "Work tracker", "ui", "z-dev", undefined, "t-platform", "Where fixes are queued and assigned."],
  ["dashboard", "Release dashboard", "ui", "z-dev", "s-release", "t-release", "Shows what is released where."],
  ["audit", "Audit log", "store", "z-prod", "s-runtime", "t-security", "Append-only record of deploys and policy decisions."],
  // added by the accepted patch-001 (no owner yet: the patch introduces a finding)
  ["prov-verify", "Provenance verifier", "service", "z-build", "s-build", undefined, "Checks upstream provenance before a package enters the mirror."],
];
const elements: Element[] = E_ROWS.map(([id, name, kind, zone, system, owner, description]) => {
  const e: Element = { id, name, kind, zone, description };
  if (system) e.system = system;
  if (owner) e.owner = owner;
  return e;
});
elements.find((e) => e.id === "oncall")!.attrs = { rotation: "weekly" };
elements.find((e) => e.id === "kms")!.attrs = { hsm_backed: true };

type R = [string, string, string, string, string, string[]?, boolean?];
const R_ROWS: R[] = [
  ["r1", "engineer", "workstation", "control", "writes code"],
  ["r2", "workstation", "repo", "data", "pushes commits"],
  ["r3", "repo", "review", "handoff", "opens change"],
  ["r4", "review", "repo", "control", "merges"],
  ["r5", "repo", "ci", "control", "triggers build"],
  ["r6", "ci", "cache", "data", "reads and writes layers"],
  ["r7", "ci", "mirror", "data", "fetches dependencies"],
  ["r8", "mirror", "registry", "data", "proxies upstream"],
  ["r9", "ci", "sbom-gen", "data", "build outputs"],
  ["r10", "sbom-gen", "attest", "data", "stores SBOM", ["sbom"]],
  ["r11", "ci", "scanner", "data", "image to scan"],
  ["r12", "scanner", "attest", "data", "stores scan", ["scan-report"]],
  ["r13", "ci", "signer", "control", "requests signature"],
  ["r14", "signer", "kms", "control", "uses key"],
  ["r15", "signer", "artifacts", "data", "publishes", ["signed-artifact"]],
  ["r16", "signer", "attest", "data", "stores provenance", ["build-provenance"]],
  ["r17", "artifacts", "approval", "handoff", "release candidate"],
  ["r18", "approval", "deployer", "control", "approved change", ["deploy-request"]],
  ["r19", "deployer", "policy", "control", "admission check", ["deploy-request"]],
  ["r20", "policy", "attest", "data", "reads attestations", ["build-provenance", "sbom"]],
  ["r21", "deployer", "staging", "control", "deploys"],
  ["r22", "deployer", "prod", "control", "promotes"],
  ["r23", "artifacts", "staging", "data", "pulls image", ["signed-artifact"]],
  ["r24", "artifacts", "prod", "data", "pulls image", ["signed-artifact"]],
  ["r25", "prod", "monitor", "data", "telemetry"],
  ["r26", "staging", "monitor", "data", "telemetry"],
  ["r27", "monitor", "alerts", "data", "raises", ["alert"]],
  ["r28", "alerts", "oncall", "handoff", "pages"],
  ["r29", "oncall", "tracker", "handoff", "files ticket"],
  ["r30", "tracker", "engineer", "feedback", "assigns fix"],
  ["r31", "flags", "prod", "control", "toggles"],
  ["r32", "policy", "audit", "data", "records decision", ["policy-decision"]],
  ["r33", "deployer", "audit", "data", "deploy record"],
  ["r34", "artifacts", "dashboard", "data", "release status", undefined, true],
  ["r35", "scanner", "tracker", "feedback", "files findings", undefined, true],
  ["r36", "oncall", "flags", "control", "kills feature", undefined, true],
  ["r37", "mirror", "prov-verify", "control", "verify before admit"],
];
const relationships: Relationship[] = R_ROWS.map(([id, from, to, kind, label, carries, optional]) => {
  const r: Relationship = { id, from, to, kind, label };
  if (carries) r.carries = carries;
  if (optional) r.optional = true;
  return r;
});

const contracts: Contract[] = [
  { name: "build-provenance", description: "Signed statement of what was built, from which source, on which runner.", produced_by: ["signer"], consumed_by: ["attest", "policy"] },
  { name: "sbom", description: "Software bill of materials in a standard format.", produced_by: ["sbom-gen"], consumed_by: ["attest", "policy"] },
  { name: "scan-report", description: "Vulnerability scan result bound to an image digest.", produced_by: ["scanner"], consumed_by: ["attest", "policy"] },
  { name: "signed-artifact", description: "Release artifact with a detached signature.", produced_by: ["signer", "artifacts"], consumed_by: ["artifacts", "staging", "prod"] },
  { name: "deploy-request", description: "Approved change naming an artifact digest and a target.", produced_by: ["approval", "deployer"], consumed_by: ["deployer", "policy"] },
  { name: "alert", description: "A condition that needs a person.", produced_by: ["monitor"], consumed_by: ["alerts"] },
  { name: "policy-decision", description: "Allow or deny, with the reasons, for one admission request.", produced_by: ["policy"] },
];

const views: View[] = [
  { id: "v-context", title: "End to end", elements: ["engineer", "workstation", "repo", "ci", "artifacts", "approval", "deployer", "prod", "monitor", "alerts", "oncall", "tracker"] },
  { id: "v-build", title: "Build and sign", elements: ["repo", "review", "ci", "cache", "mirror", "registry", "sbom-gen", "scanner", "signer", "kms", "artifacts", "attest"] },
  { id: "v-deploy", title: "Deploy and run", elements: ["artifacts", "approval", "deployer", "policy", "attest", "staging", "prod", "flags", "monitor", "alerts", "oncall", "audit"] },
];

// grid placement per view: element -> [col, row]
const GRID: Record<string, Record<string, [number, number]>> = {
  "v-context": {
    engineer: [0, 0], workstation: [1, 0], repo: [2, 0], ci: [3, 0],
    tracker: [0, 1], deployer: [1, 1], approval: [2, 1], artifacts: [3, 1],
    oncall: [0, 2], alerts: [1, 2], monitor: [2, 2], prod: [3, 2],
  },
};
GRID["v-build"] = {
  repo: [0, 0], review: [0, 1], ci: [1, 0], cache: [1, 2], mirror: [2, 2], registry: [3, 2],
  "sbom-gen": [2, 0], scanner: [2, 1], signer: [1, 1], kms: [0, 2], artifacts: [3, 0], attest: [3, 1],
};
GRID["v-deploy"] = {
  artifacts: [0, 0], approval: [1, 0], deployer: [2, 0], policy: [3, 0], attest: [4, 0],
  staging: [1, 1], prod: [2, 1], flags: [3, 1], audit: [4, 1],
  monitor: [1, 2], alerts: [2, 2], oncall: [3, 2],
};

const W = 172, H = 58, GX = 232, GY = 120, PAD = 32;

function clip(cx: number, cy: number, tx: number, ty: number, w: number, h: number): [number, number] {
  const dx = tx - cx, dy = ty - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const sx = Math.abs(dx) > 0 ? (w / 2) / Math.abs(dx) : Infinity;
  const sy = Math.abs(dy) > 0 ? (h / 2) / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return [Math.round(cx + dx * s), Math.round(cy + dy * s)];
}

function layoutView(v: View): ViewLayout {
  const g = GRID[v.id];
  const nodes: LayoutNode[] = v.elements.map((id) => {
    const [c, r] = g[id];
    return { id, x: PAD + c * GX, y: PAD + r * GY, w: W, h: H };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const inView = new Set(v.elements);
  const rels = relationships.filter((r) => inView.has(r.from) && inView.has(r.to));
  const edges: LayoutEdge[] = rels.map((r) => {
    const a = byId.get(r.from)!, b = byId.get(r.to)!;
    const acx = a.x + a.w / 2, acy = a.y + a.h / 2, bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
    // reverse pairs get a small offset so both directions stay visible
    const twin = rels.some((o) => o.from === r.to && o.to === r.from);
    const off = twin ? (r.id < relationships.find((o) => o.from === r.to && o.to === r.from)!.id ? -8 : 8) : 0;
    const horiz = Math.abs(bcx - acx) >= Math.abs(bcy - acy);
    const ox = horiz ? 0 : off, oy = horiz ? off : 0;
    const p0 = clip(acx + ox, acy + oy, bcx + ox, bcy + oy, a.w, a.h);
    const p1 = clip(bcx + ox, bcy + oy, acx + ox, acy + oy, b.w, b.h);
    return { id: r.id, from: r.from, to: r.to, points: [p0, p1] };
  });
  const width = Math.max(...nodes.map((n) => n.x + n.w)) + PAD;
  const height = Math.max(...nodes.map((n) => n.y + n.h)) + PAD;
  return { view: v.id, width, height, nodes, edges };
}

const phases: Phase[] = [
  { id: "p1", name: "Build provenance", order: 1, exit_test: "Every artifact in the store has a signed provenance attestation that a reviewer can verify from the digest alone." },
  { id: "p2", name: "Enforce at deploy", order: 2, exit_test: "Production admits only artifacts whose attestations pass policy, and every denial is logged with its reason." },
];

const units: Unit[] = [
  { id: "u01", title: "Pin dependencies through the mirror", kind: "code", phase: "p1", owner: "t-security", status: "done", feedback: "minutes",
    elements: [{ id: "mirror", from: "none", to: "existing-tool" }], provides: ["pinned-deps"],
    check: "A build with the public registry blocked at the firewall still succeeds, and the provenance verifier ran on every package." },
  { id: "u02", title: "Generate an SBOM for every build", kind: "code", phase: "p1", owner: "t-security", status: "done", feedback: "next-run",
    elements: [{ id: "sbom-gen", from: "none", to: "stand-in" }], requires: ["pinned-deps"], provides: ["sbom"],
    check: "The last ten builds each have an SBOM attestation keyed by image digest." },
  { id: "u03", title: "Stand up the attestation store", kind: "code", phase: "p1", owner: "t-security", status: "done", feedback: "minutes",
    elements: [{ id: "attest", from: "none", to: "existing-tool" }], provides: ["attestation-store"],
    check: "An attestation written by CI can be read back by digest from a production node." },
  { id: "u04", title: "Sign artifacts with a managed key", kind: "code", phase: "p1", owner: "t-security", status: "doing", feedback: "minutes",
    elements: [{ id: "signer", from: "none", to: "built" }, { id: "kms", from: "none", to: "existing-tool" }], provides: ["signing"],
    check: "A new artifact verifies against the published public key, and the private key cannot be exported." },
  { id: "u05", title: "Emit build provenance from CI", kind: "code", phase: "p1", owner: "t-platform", status: "todo", feedback: "next-run",
    elements: [{ id: "ci", from: "existing-tool", to: "built" }, { id: "cache", from: "existing-tool", to: "built" }], requires: ["signing", "attestation-store", "provenance-format"], provides: ["provenance"],
    check: "Every build on the main branch writes a signed provenance attestation naming source commit and runner." },
  { id: "u06", title: "Agree on the provenance format", kind: "agreement", phase: "p1", owner: "t-release", status: "done", feedback: "weeks",
    provides: ["provenance-format"],
    check: "Platform, security and release have signed off one format document, and it is linked from the repository." },
  { id: "u07", title: "Scan images and record results", kind: "code", phase: "p1", owner: "t-security", status: "doing", feedback: "next-run",
    elements: [{ id: "scanner", from: "existing-tool", to: "built" }], requires: ["attestation-store"], provides: ["scan-results"],
    check: "Each image in the store has a scan attestation no older than 24 hours." },
  { id: "u08", title: "Measure unsigned artifacts in the store", kind: "measurement", phase: "p1", owner: "t-release", status: "todo", feedback: "next-run",
    requires: ["signing", "decision-log"], provides: ["unsigned-baseline"],
    check: "A weekly count of unsigned artifacts by team is published, with last week's number beside it." },
  { id: "u09", title: "Write the admission policy", kind: "code", phase: "p2", owner: "t-security", status: "todo", feedback: "minutes",
    elements: [{ id: "policy", from: "none", to: "stand-in" }], requires: ["provenance", "sbom", "provenance-format"], provides: ["admission-policy"],
    check: "The policy denies a test artifact with no provenance and admits one with valid provenance and SBOM." },
  { id: "u10", title: "Run policy in audit-only mode", kind: "code", phase: "p2", owner: "t-security", status: "todo", feedback: "several-runs",
    requires: ["admission-policy"], provides: ["audit-mode"],
    check: "Two weeks of production deploys evaluated with zero blocked deploys and every would-deny recorded." },
  { id: "u11", title: "Log every policy decision", kind: "code", phase: "p2", owner: "t-sre", status: "todo", feedback: "minutes",
    elements: [{ id: "audit", from: "stand-in", to: "existing-tool" }], requires: ["admission-policy"], provides: ["decision-log"],
    check: "Each admission request has exactly one audit record with the decision and its reasons." },
  { id: "u12", title: "Agree the enforcement date with release", kind: "agreement", phase: "p2", owner: "t-release", status: "todo", feedback: "weeks",
    requires: ["audit-mode", "unsigned-baseline"], provides: ["enforcement-date"],
    check: "A dated enforcement plan is approved by release and security, with the exception process named." },
  { id: "u13", title: "Turn on enforcement in production", kind: "code", phase: "p2", owner: "t-security", status: "todo", feedback: "next-run",
    elements: [{ id: "policy", from: "stand-in", to: "built" }], requires: ["enforcement-date", "decision-log"], provides: ["enforcement"],
    check: "An unsigned test artifact is denied in production and the denial appears in the audit log." },
  { id: "u14", title: "Route policy denials to on-call", kind: "code", phase: "p2", owner: "t-sre", status: "todo", feedback: "minutes",
    elements: [{ id: "alerts", from: "none", to: "existing-tool" }], requires: ["enforcement", "exception-workflow"], provides: ["denial-routing"],
    check: "A production denial pages on-call within five minutes with the artifact digest and the failing rule." },
  { id: "u15", title: "Measure deploy lead time before and after", kind: "measurement", phase: "p2", owner: "t-release", status: "todo", feedback: "weeks",
    requires: ["decision-log"], provides: ["lead-time-report"],
    check: "Median merge-to-production time for the month before and after enforcement is published side by side." },
];

// ---------- plan analysis (hand-rolled, mirrors SPEC "Plan analysis") ----------
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
function analyze(): PlanAnalysis {
  const providers = new Map<string, string[]>();
  for (const u of units) for (const c of u.provides ?? []) providers.set(c, [...(providers.get(c) ?? []), u.id]);
  const deps: Record<string, string[]> = {}, unblocks: Record<string, string[]> = {};
  for (const u of units) { deps[u.id] = []; unblocks[u.id] = []; }
  for (const u of units) for (const c of u.requires ?? []) for (const p of providers.get(c) ?? []) if (p !== u.id && !deps[u.id].includes(p)) deps[u.id].push(p);
  for (const u of units) for (const d of deps[u.id]) unblocks[d].push(u.id);
  for (const k in deps) { deps[k].sort(natural); unblocks[k].sort(natural); }
  const done = new Set(units.filter((u) => u.status === "done").map((u) => u.id));
  const doneCaps = new Set(units.filter((u) => done.has(u.id)).flatMap((u) => u.provides ?? []));
  const open = units.filter((u) => !done.has(u.id)).map((u) => u.id).sort(natural);
  const frontier = open.filter((id) => deps[id].every((d) => done.has(d)) && (units.find((u) => u.id === id)!.requires ?? []).every((c) => providers.has(c)));
  const blocked: PlanAnalysis["blocked"] = {};
  for (const id of open) {
    if (frontier.includes(id)) continue;
    const u = units.find((x) => x.id === id)!;
    const missing = (u.requires ?? []).filter((c) => !doneCaps.has(c));
    const waitingOn = [...new Set(missing.flatMap((c) => providers.get(c) ?? []))].filter((p) => !done.has(p)).sort(natural);
    blocked[id] = { missing, waitingOn };
  }
  const layers: string[][] = [];
  const placed = new Set<string>();
  while (placed.size < open.length) {
    const layer = open.filter((id) => !placed.has(id) && deps[id].every((d) => done.has(d) || placed.has(d)));
    if (!layer.length) break;
    layers.push(layer); layer.forEach((id) => placed.add(id));
  }
  const memo = new Map<string, string[]>();
  const longest = (id: string): string[] => {
    if (memo.has(id)) return memo.get(id)!;
    let best: string[] = [];
    for (const d of deps[id]) { const p = longest(d); if (p.length > best.length) best = p; }
    const r = [...best, id]; memo.set(id, r); return r;
  };
  let critical: string[] = [];
  for (const u of [...units].sort((a, b) => natural(a.id, b.id))) { const p = longest(u.id); if (p.length > critical.length) critical = p; }
  const ph = phases.map((p) => {
    const us = units.filter((u) => u.phase === p.id);
    const d = us.filter((u) => u.status === "done").length;
    return { id: p.id, total: us.length, done: d, complete: us.length > 0 && d === us.length };
  });
  const unprovided = [...new Set(units.flatMap((u) => u.requires ?? []).filter((c) => !providers.has(c)))].sort(natural);
  return { deps, unblocks, layers, frontier, blocked, critical_path: critical, phases: ph, unprovided };
}

const F = (pack: string, rule: string, severity: "error" | "warning", at: string, atKind: Finding["atKind"], message: string): Finding => ({ pack, rule, severity, at, atKind, message });
const fOwnerVerify = F("generic", "element-owner", "error", "prov-verify", "element", "Provenance verifier has no owner team.");
const fOwnerRegistry = F("generic", "element-owner", "error", "registry", "element", "Public package registry has no owner team.");
const fContract = F("generic", "contract-ends", "error", "policy-decision", "contract", "Contract policy-decision has a producer but no consumer.");
const findings: Finding[] = [
  fOwnerRegistry, fOwnerVerify, fContract,
  F("plan", "requires-provided", "error", "u14", "unit", "Unit u14 requires exception-workflow, which no unit provides."),
  F("plan", "phase-order", "warning", "u08", "unit", "Unit u08 (Build provenance) depends on decision-log, which is only provided in Enforce at deploy."),
  F("flow", "queue-wip", "warning", "alerts", "element", "Queue Alert queue does not declare attrs.wip_limit."),
  F("flow", "person-wait", "warning", "oncall", "element", "Person step On-call engineer does not declare attrs.wait_days, so lead time cannot be summed."),
  F("flow", "max-handoffs", "warning", "r28", "relationship", "The path from Source repository to Engineer crosses 5 team handoffs; the limit is 4."),
];

const packs: Bundle["instance"]["packs"] = [
  { name: "generic", title: "Model integrity", description: "References resolve, everything has an owner, and contracts connect a producer to a consumer.", rules: [
    { id: "refs-resolve", title: "Every reference resolves", why: "A dangling id means a diagram or plan points at something that does not exist.", severity: "error" },
    { id: "element-owner", title: "Every element has an owner team", why: "Unowned parts of a system are where fixes stall.", severity: "error" },
    { id: "contract-ends", title: "Contracts have a producer and a consumer", why: "A contract nobody reads is a promise nobody checks.", severity: "error" },
    { id: "carries-connects", title: "Carried contracts connect producer to consumer", why: "A relationship that carries a contract should join someone who makes it to someone who uses it.", severity: "error" },
    { id: "view-ids", title: "Views name existing elements", why: "A view that names a missing element silently drops it from the picture.", severity: "error" },
  ] },
  { name: "plan", title: "Plan soundness", description: "Every capability the plan needs is provided, in an order that can actually run.", rules: [
    { id: "requires-provided", title: "Every required capability is provided", why: "A unit waiting on a capability nobody builds can never start.", severity: "error" },
    { id: "no-cycles", title: "No dependency cycles", why: "A cycle means none of its units can go first.", severity: "error" },
    { id: "phase-exit-test", title: "Every phase has an exit test", why: "Without a checkable exit, a phase ends when someone gets tired of it.", severity: "error" },
    { id: "ladder-upward", title: "Fidelity moves go up the ladder", why: "A unit should leave an element more real than it found it.", severity: "error" },
    { id: "unit-owner", title: "Unit owners exist", why: "Work assigned to a team that does not exist is unassigned work.", severity: "error" },
    { id: "phase-order", title: "Earlier phases do not wait on later ones", why: "If phase one needs something phase two builds, the phases are in the wrong order.", severity: "warning" },
  ] },
  { name: "flow", title: "Value stream", description: "Handoffs, queues and waiting time along the paths work takes.", rules: [
    { id: "max-handoffs", title: "Paths stay under the handoff limit", why: "Each handoff between teams adds waiting and loses context.", severity: "warning" },
    { id: "queue-wip", title: "Queues declare a WIP limit", why: "A queue with no limit grows until someone notices.", severity: "warning" },
    { id: "person-wait", title: "Person steps declare wait time", why: "Lead time is mostly waiting; if it is not recorded it cannot be summed.", severity: "warning" },
  ] },
];

const emptyImpact = (patch: string, status: Patch["status"]): Impact => ({ patch, status, added: [], removed: [], modified: [], cascade: [], findingsIntroduced: [], findingsResolved: [], unitsAffected: [], errors: [] });
const p1: Patch = {
  id: "patch-001", title: "Verify provenance at the mirror", status: "accepted", file: "patches/patch-001.yaml",
  why: "Pinning dependencies stops surprise upgrades but not a poisoned upstream. Checking upstream provenance before a package enters the mirror closes that gap.",
  ops: [
    { op: "add", kind: "element", value: { id: "prov-verify", name: "Provenance verifier", kind: "service", zone: "z-build", system: "s-build" } },
    { op: "add", kind: "relationship", value: { id: "r37", from: "mirror", to: "prov-verify", kind: "control" } },
    { op: "modify", kind: "unit", id: "u01", set: { check: "A build with the public registry blocked at the firewall still succeeds, and the provenance verifier ran on every package." } },
  ],
};
const p2: Patch = {
  id: "patch-002", title: "Retire the build cache and give policy decisions a reader", status: "proposed", file: "patches/patch-002.yaml",
  why: "The shared cache lets one build poison another, and nothing reads policy decisions today. Removing the cache trades build time for isolation; the audit log becomes the decision reader.",
  ops: [
    { op: "remove", kind: "element", id: "cache" },
    { op: "modify", kind: "contract", id: "policy-decision", set: { consumed_by: ["audit"] } },
  ],
};
const i1 = { ...emptyImpact("patch-001", "accepted"),
  added: [{ kind: "element" as const, id: "prov-verify" }, { kind: "relationship" as const, id: "r37" }],
  modified: [{ kind: "unit" as const, id: "u01", fields: ["check"] }],
  findingsIntroduced: [fOwnerVerify], unitsAffected: ["u01"] };
const i2 = { ...emptyImpact("patch-002", "proposed"),
  removed: [{ kind: "element" as const, id: "cache" }],
  modified: [{ kind: "contract" as const, id: "policy-decision", fields: ["consumed_by"] }],
  cascade: [
    { kind: "relationship" as const, id: "r6", because: "touches removed element cache" },
    { kind: "view" as const, id: "v-build", because: "listed removed element cache" },
    { kind: "unit" as const, id: "u05", because: "its element moves named removed element cache" },
  ],
  findingsResolved: [fContract], unitsAffected: ["u05"] };

const bundle: Bundle = {
  engine: { version: "0.1.0", built: "2026-10-21T12:00:00.000Z", hash: "sample-0000000000000000" },
  instance: {
    name: "release-provenance", title: "Release provenance",
    description: "A software release pipeline that signs what it builds and admits to production only what it can prove.",
    packs, ladder: ["none", "stand-in", "existing-tool", "built"],
  },
  model: { teams, systems, zones, elements, relationships, contracts, views },
  plan: { phases, units },
  findings,
  analysis: analyze(),
  patches: [{ ...p1, impact: i1 }, { ...p2, impact: i2 }],
  layouts: views.map(layoutView),
};

await Bun.write(import.meta.dir + "/sample-bundle.json", JSON.stringify(bundle, null, 2) + "\n");
console.log("wrote sample-bundle.json", bundle.analysis.frontier, bundle.analysis.critical_path);
