import { afterEach, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { gitFixture } from "./helpers/git-fixture.ts";
import { packageBundle } from "../src/dev/package.ts";

const root = join(import.meta.dir, ".."), temps: string[] = [];
const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", TZ: "UTC" };
function temp() { mkdirSync(join(root, "build"), { recursive: true }); const d = mkdtempSync(join(root, "build/release063-")); temps.push(d); return d; }
afterEach(() => { for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true }); });
const cli = (args: string[], cwd = root) => Bun.spawnSync([process.execPath, join(root, "plumb.ts"), ...args], { cwd, env, stdout: "pipe", stderr: "pipe" });
function files(dir: string, prefix = ""): string[] { return readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(dir, join(prefix, e.name)) : [join(prefix, e.name)]); }

test("git-ref diffs work for a nested design from the repository root and the design folder", () => {
  const repo = temp(), design = join(repo, "examples/delivery-stream");
  cpSync(join(root, "tests/fixtures/mini"), design, { recursive: true });
  gitFixture(repo, files(repo));
  for (const cwd of [repo, design]) {
    const r = cli(["diff", relative(cwd, design) || ".", "--from", "HEAD", "--json"], cwd);
    expect(r.stderr.toString()).toBe(""); expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout.toString()).changed).toEqual([]);
  }
});

test("unknown command is named even without a directory", () => {
  for (const args of [["frobnicate"], ["frobnicate", "x"]]) {
    const r = cli(args); expect(r.exitCode).toBe(2); expect(r.stderr.toString()).toContain('unknown command "frobnicate"');
  }
});

// Includes all flags in help, README, DEMO, SPEC and the skill workflows.
const documented: [string[], string[]][] = [
  [["build"], ["out", "edition", "today"]], [["site"], ["out", "edition", "today"]], [["check"], ["edition", "today"]],
  [["brief"], []], [["impact"], []], [["plan"], []], [["premise"], []], [["premises"], ["json"]],
  [["diff"], ["from", "to", "save", "json"]], [["report"], ["presented"]], [["dev"], ["port", "out"]],
  [["vault"], ["out", "packaging", "today"]], [["publish"], []], [["package"], ["with-mcp"]], [["release"], ["label"]],
  [["migrate"], ["to", "root", "moved", "dry-run"]],
  [["design", "add"], ["from", "workspace", "with-pins", "ref", "path"]],
  ...["build", "check", "impact", "brief"].map(sub => [["portfolio", sub], ["presenting", "today", ...(sub === "build" ? ["out"] : [])]] as [string[], string[]]),
  [["tracker", "discover"], ["from", "adapter"]], [["tracker", "draft-mapping"], ["force"]],
  [["tracker", "reconcile"], ["from"]], [["tracker", "export"], ["out"]],
  [["tracker", "measure"], ["from", "as-of", "portfolio", "today", "draft-patch", "agent", "tool", "model", "by", "requested-by", "limits"]],
];
for (const [command, flags] of documented) test(`${command.join(" ")} accepts its documented flags and refuses unknown flags`, () => {
  // Invalid targets stop execution before any output or network work; acceptance is option validation, not a successful build.
  for (const flag of flags) {
    const boolean = ["with-pins", "presenting", "force", "draft-patch", "limits", "save", "json", "presented", "packaging", "with-mcp", "dry-run"].includes(flag);
    const r = cli([...command, "missing-design@1.0.0", `--${flag}`, ...(boolean ? [] : ["2026-11-16"])]);
    expect(r.stderr.toString()).not.toMatch(/unknown (?:or incomplete )?option/);
  }
  for (const target of [[], ["examples/delivery-stream"]]) {
    const r = cli([...command, ...target, "--bogus-flag"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr.toString()).toContain(`unknown option --bogus-flag for ${command.join(" ")}`);
    expect(r.stderr.toString()).toMatch(new RegExp(`plumb\\.ts ${command.join("\\s+")}\\s+<`));
  }
});

test("design build and check honor --today for relative checks and repeatable bundles", () => {
  const design = join(root, "examples/delivery-stream"), out = temp();
  const args = ["build", design, "--today", "2026-11-16", "--out", out];
  expect(cli(args).exitCode).toBe(0);
  const first = readFileSync(join(out, "bundle.json"));
  expect(cli(args).exitCode).toBe(0); expect(readFileSync(join(out, "bundle.json"))).toEqual(first);
  const b = JSON.parse(first.toString()); expect(b.engine.built).toBe("2026-11-16T12:00:00.000Z");
  const early = cli(["check", design, "--today", "2026-11-16"]), late = cli(["check", design, "--today", "2027-11-16"]);
  expect(early.exitCode).toBe(0); expect(late.exitCode).toBe(0);
  expect(late.stdout.toString()).not.toBe(early.stdout.toString());
  for (const command of ["build", "check"]) expect(cli([command, design, "--today", "2026-02-30"]).exitCode).toBe(2);
});

test("root builds and checks refuse design-only date and edition options", () => {
  for (const command of ["build", "check"]) for (const flag of ["today", "edition"]) {
    const r = cli([command, "examples/shared", `--${flag}`, flag === "today" ? "2026-11-16" : "1.0.0"]);
    expect(r.exitCode).toBe(2); expect(r.stderr.toString()).toContain(`unknown option --${flag} for ${command}`);
    expect(r.stderr.toString()).toContain("<root-dir>");
  }
});

test("packaging in a nested Git work tree excludes untracked working files and ships tracked public docs", async () => {
  const repo = temp(), source = join(repo, "plumb"), out = join(repo, "package");
  mkdirSync(source); for (const file of ["plumb.ts", "package.json", "README.md", "SECURITY.md", "CONTRIBUTING.md", "LICENSE"]) cpSync(join(root, file), join(source, file));
  cpSync(join(root, "skill"), join(source, "skill"), { recursive: true });
  gitFixture(repo, files(repo));
  mkdirSync(join(source, "examples/shared/tracker"), { recursive: true }); writeFileSync(join(source, "examples/shared/tracker/mapping.draft.yaml"), "local: working\n");
  const scrub = join(repo, "scrub.txt"); writeFileSync(scrub, "");
  const r = await packageBundle(out, { root: source, scrubList: scrub }); expect(r.ok).toBe(true);
  expect(existsSync(join(out, "examples/shared/tracker/mapping.draft.yaml"))).toBe(false);
  for (const file of ["SECURITY.md", "CONTRIBUTING.md", "LICENSE"]) expect(readFileSync(join(out, file))).toEqual(readFileSync(join(source, file)));
  // A source outside any Git work tree keeps the existing walk behavior.
  const loose = mkdtempSync(join(tmpdir(), "plumb-release063-")); temps.push(loose);
  const copy = join(loose, "plumb"); cpSync(source, copy, { recursive: true });
  const other = join(loose, "package"); expect((await packageBundle(other, { root: copy, scrubList: scrub })).ok).toBe(true);
  expect(existsSync(join(other, "examples/shared/tracker/mapping.draft.yaml"))).toBe(true);
});
