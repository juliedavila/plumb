import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBundle } from "../src/core/bundle.ts";
import { call, tools } from "../src/mcp/tools.ts";

const { bundle } = await buildBundle(import.meta.dir + "/fixtures/mini", { built: "2026-01-01T00:00:00Z" });

test("every listed tool answers without error on the mini instance", () => {
  const args: Record<string, any> = {
    overview: {}, find: { query: "queue" }, element: { id: bundle.model.elements[0].id },
    unit: { id: bundle.plan.units[0].id }, what_can_start: {}, critical_path: {}, findings: {},
    impact: { patch: bundle.patches[0].id },
    path: { from: bundle.model.relationships[0].from, to: bundle.model.relationships[0].to },
  };
  for (const t of tools) {
    const out = call(bundle, t.name, args[t.name]);
    expect(out.isError ?? false).toBe(false);
    expect(out.text.length).toBeGreaterThan(0);
  }
});

test("what_can_start matches the plan frontier", () => {
  const out = call(bundle, "what_can_start", {});
  for (const id of bundle.analysis.frontier) expect(out.text).toContain(id);
});

test("unknown ids are reported as errors, not thrown", () => {
  expect(call(bundle, "element", { id: "nope" }).isError).toBe(true);
  expect(call(bundle, "unit", { id: "nope" }).isError).toBe(true);
  expect(call(bundle, "impact", { patch: "nope" }).isError).toBe(true);
  expect(call(bundle, "no-such-tool", {}).isError).toBe(true);
});

test("the stdio server answers initialize and tools/list", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "plumb-mcp-")), "bundle.json");
  await Bun.write(path, JSON.stringify(bundle));
  const s = Bun.spawn(["bun", import.meta.dir + "/../src/mcp/server.ts", path], { stdin: "pipe", stdout: "pipe" });
  s.stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');
  s.stdin.end();
  const text = await new Response(s.stdout).text();
  const lines = text.trim().split("\n").map(l => JSON.parse(l));
  expect(lines[0].result.serverInfo.name).toBe("plumb");
  expect(lines[1].result.tools.length).toBe(tools.length);
});
