// MCP server over a built bundle: JSON-RPC 2.0, newline-delimited, over stdio. Read-only. No SDK.
// Usage: bun src/mcp/server.ts build/<instance>/bundle.json
import type { Bundle, Element, Unit } from "../types.ts";
import { readFileSync, statSync } from "node:fs";
import { tools as toolDefs, call } from "./tools.ts";

const path = process.argv[2];
if (!path) { console.error("usage: bun src/mcp/server.ts <bundle.json>"); process.exit(2); }
let bundle: Bundle = await Bun.file(path).json();

// The bundle on change. Before each answer the server looks at the file: a rebuilt bundle is read again, and the first
// answer after it says so (with the build time), so a session never has to restart. A file that is gone, or that does
// not parse (a build still writing it), leaves the loaded build in place and every answer says which build it is.
const stamp = () => { try { const s = statSync(path); return `${s.mtimeMs}:${s.size}`; } catch { return "gone"; } };
let loadedStamp = stamp();
export function staleWarning(): string {
  const now = stamp();
  if (now === loadedStamp) return "";
  if (now !== "gone") {
    try {
      const next = JSON.parse(readFileSync(path, "utf8")) as Bundle;
      const was = bundle.engine.built;
      bundle = next; loadedStamp = now;
      return `Note: the bundle was rebuilt; this answer reads the new build (${next.engine.built}; the server had ${was}).\n\n`;
    } catch { /* still being written: answer from the loaded build, and say so */ }
  }
  return now === "gone"
    ? `Warning: the bundle file ${path} is gone since this server loaded it (build of ${bundle.engine.built}); these answers come from that build. Rebuild the instance and the next answer reads it.\n\n`
    : `Warning: the bundle file ${path} has changed but could not be read yet; these answers come from the build of ${bundle.engine.built}.\n\n`;
}

// The version we implement, and the later ones whose tools/list and tools/call are the same for a read-only server.
// A client asking for any of these gets it back; any other request gets ours, and the client decides.
const PROTOCOL = "2024-11-05";
const SUPPORTED_PROTOCOLS = ["2024-11-05", "2025-03-26", "2025-06-18"];
function send(msg: unknown) { process.stdout.write(JSON.stringify(msg) + "\n"); }

function handle(req: any) {
  if (!req || typeof req !== "object" || Array.isArray(req)) {
    return send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: `Invalid Request: expected a JSON-RPC request object, got ${req === null ? "null" : Array.isArray(req) ? "a list" : typeof req}` } });
  }
  const { id, method, params } = req;
  if (typeof method !== "string") {
    if (id === undefined) return;
    return send({ jsonrpc: "2.0", id: id ?? null, error: { code: -32600, message: "Invalid Request: method must be a string" } });
  }
  const isNotification = id === undefined || id === null;
  try {
    switch (method) {
      case "initialize":
        return send({ jsonrpc: "2.0", id, result: {
          protocolVersion: SUPPORTED_PROTOCOLS.includes(params?.protocolVersion) ? params.protocolVersion : PROTOCOL,
          capabilities: { tools: {} },
          serverInfo: { name: "plumb", version: bundle.engine.version },
          instructions: `Read-only access to the plumb instance "${bundle.instance.title}": its model, plan, checks and proposed changes. Start with overview.`,
        } });
      case "notifications/initialized": case "initialized": return;
      case "ping": return send({ jsonrpc: "2.0", id, result: {} });
      case "tools/list": return send({ jsonrpc: "2.0", id, result: { tools: toolDefs } });
      case "tools/call": {
        const note = staleWarning(); // reads a rebuilt bundle first, so the answer is the new build's
        const out = call(bundle, params?.name, params?.arguments);
        return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: note + out.text }], isError: out.isError } });
      }
      default:
        if (isNotification) return;
        return send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  } catch (e: any) {
    if (!isNotification) send({ jsonrpc: "2.0", id, error: { code: -32603, message: String(e?.message ?? e) } });
  }
}

let buf = "";
const decoder = new TextDecoder();
for await (const chunk of Bun.stdin.stream()) {
  buf += decoder.decode(chunk, { stream: true });
  let nl: number;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
    if (!line) continue;
    let req: any;
    try { req = JSON.parse(line); } catch { send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); continue; }
    if (Array.isArray(req)) {
      if (!req.length) send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request: empty batch" } });
      else req.forEach(handle);
    } else handle(req);
  }
}
