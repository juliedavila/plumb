// Duplicate keys in a YAML file. Bun's YAML parser keeps the last of two equal keys in one mapping and drops the
// first without a word, so a second `owner:` on a unit silently replaces the first. This scanner reads the text the
// parser read and names every key that repeats inside one mapping: block mappings by indentation (a list item opens a
// mapping of its own), flow mappings by braces. It skips comments, quoted text and block scalars (`>-`, `|`). It is a
// check, not a parser: a line it cannot read as a key is left alone.

export interface DuplicateKey { key: string; line: number; first: number }

/** Text with a trailing comment removed: a `#` that starts the line or follows a space, outside quotes. */
function stripComment(s: string): string {
  let q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) { if (q === "'" && s[i + 1] === "'") { i++; continue; } q = null; } else if (c === "\\" && q === '"') i++; continue; }
    if (c === '"' || c === "'") { if (i === 0 || /[\s{\[,:]/.test(s[i - 1])) q = c; continue; }
    if (c === "#" && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i);
  }
  return s;
}

const unquote = (k: string) => {
  const t = k.trim();
  if (t.length >= 2 && t[0] === '"' && t.endsWith('"')) return t.slice(1, -1).replace(/\\(.)/g, "$1");
  if (t.length >= 2 && t[0] === "'" && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  return t;
};

/** Whether the brackets of a flow collection close in `s` (quotes respected). */
function balanced(s: string): boolean {
  let d = 0, q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; else if (c === "\\" && q === '"') i++; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === "{" || c === "[") d++;
    else if (c === "}" || c === "]") d--;
  }
  return d <= 0;
}

/** Duplicate keys inside the flow mappings of `s`, which starts on line `line`. */
function flowDuplicates(s: string, line: number, out: DuplicateKey[]): void {
  type Ctx = { map: boolean; keys: Map<string, number>; cur: string; colon: boolean; start: number };
  const stack: Ctx[] = [];
  let q: string | null = null, ln = line;
  const top = () => stack[stack.length - 1];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\n") ln++;
    const t = top();
    if (q) { if (t) t.cur += c; if (c === q) q = null; else if (c === "\\" && q === '"') { if (t) t.cur += s[i + 1] ?? ""; i++; } continue; }
    if (c === '"' || c === "'") { q = c; if (t) t.cur += c; continue; }
    if (c === "{" || c === "[") { stack.push({ map: c === "{", keys: new Map(), cur: "", colon: false, start: ln }); continue; }
    if (c === "}" || c === "]") { stack.pop(); continue; }
    if (!t) continue;
    if (c === ",") { t.cur = ""; t.colon = false; continue; }
    if (t.map && c === ":" && !t.colon && (i + 1 >= s.length || /[\s,}\]]/.test(s[i + 1]))) {
      const k = unquote(t.cur);
      t.colon = true;
      if (!k) continue;
      const first = t.keys.get(k);
      if (first !== undefined) out.push({ key: k, line: ln, first });
      else t.keys.set(k, ln);
      continue;
    }
    if (!t.colon) t.cur += c;
  }
}

const KEY = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#'"{}\[\],:][^#]*?)\s*:(?=\s|$)/;

/** Every key that repeats inside one mapping of the YAML text, with its line and the line of its first use (1-based). */
export function duplicateKeys(text: string): DuplicateKey[] {
  const out: DuplicateKey[] = [];
  const lines = text.split(/\r?\n/);
  const stack: { col: number; keys: Map<string, number> }[] = [];
  let blockCol: number | null = null;           // inside a block scalar: lines indented past this column belong to it
  let flow: { text: string; line: number } | null = null; // a flow collection still open across lines
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i], n = i + 1;
    if (flow) {
      flow.text += "\n" + stripComment(raw);
      if (balanced(flow.text)) { flowDuplicates(flow.text, flow.line, out); flow = null; }
      continue;
    }
    const indent = raw.length - raw.trimStart().length;
    if (blockCol !== null) {
      if (!raw.trim() || indent > blockCol) continue;
      blockCol = null;
    }
    const line = stripComment(raw);
    if (!line.trim()) continue;
    if (/^(---|\.\.\.)(\s|$)/.test(line)) { stack.length = 0; continue; }
    let col = indent, rest = line.slice(indent), item = false;
    while (/^-(\s|$)/.test(rest)) {
      const after = rest.slice(1), sp = after.length - after.trimStart().length;
      col += 1 + sp; rest = after.trimStart(); item = true;
    }
    if (!rest) continue;
    const m = KEY.exec(rest);
    if (!m) {
      if (rest[0] === "{" || rest[0] === "[") { if (balanced(rest)) flowDuplicates(rest, n, out); else flow = { text: rest, line: n }; }
      continue;
    }
    const key = unquote(m[1]);
    if (item) { while (stack.length && stack[stack.length - 1].col >= col) stack.pop(); stack.push({ col, keys: new Map() }); }
    else {
      while (stack.length && stack[stack.length - 1].col > col) stack.pop();
      if (!stack.length || stack[stack.length - 1].col !== col) stack.push({ col, keys: new Map() });
    }
    const map = stack[stack.length - 1].keys;
    const first = map.get(key);
    if (first !== undefined) out.push({ key, line: n, first });
    else map.set(key, n);
    const value = rest.slice(m[0].length).trim();
    if (/^[|>][-+0-9]*$/.test(value)) blockCol = col;
    else if (value[0] === "{" || value[0] === "[") { if (balanced(value)) flowDuplicates(value, n, out); else flow = { text: value, line: n }; }
  }
  return out;
}

/**
 * The lines (1-based) where `key` is written as a mapping key, in block style (`key: v`, `- key: v`) or inside a flow
 * mapping (`{ key: v }`), in document order. Comments, quoted text and block scalars are skipped, as above. Used to name
 * the line of a deprecated key and to rename it in place (src/migrate/keys.ts).
 */
export function keyLines(text: string, key: string): number[] {
  const out: number[] = [];
  const lines = text.split(/\r?\n/);
  const flowKey = (s: string, n: number) => {
    let q: string | null = null, depth = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) { if (c === q) q = null; else if (c === "\\" && q === '"') i++; continue; }
      if (c === '"' || c === "'") { q = c; continue; }
      if (c === "{" || c === "[") { depth++; continue; }
      if (c === "}" || c === "]") { depth--; continue; }
      if (depth > 0 && (s[i - 1] === "{" || s[i - 1] === "," || /\s/.test(s[i - 1] ?? "")) && s.startsWith(key, i)) {
        const after = s.slice(i + key.length);
        const before = s.slice(0, i).replace(/\s+$/, "");
        if (/^\s*:(\s|$)/.test(after) && /[{,]$/.test(before)) out.push(n);
      }
    }
  };
  let blockCol: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i], n = i + 1;
    const indent = raw.length - raw.trimStart().length;
    if (blockCol !== null) { if (!raw.trim() || indent > blockCol) continue; blockCol = null; }
    const line = stripComment(raw);
    if (!line.trim()) continue;
    let rest = line.slice(indent), col = indent;
    while (/^-(\s|$)/.test(rest)) { const after = rest.slice(1); col += 1 + (after.length - after.trimStart().length); rest = after.trimStart(); }
    const m = KEY.exec(rest);
    if (m && unquote(m[1]) === key) out.push(n);
    const value = m ? rest.slice(m[0].length).trim() : rest;
    if (m && /^[|>][-+0-9]*$/.test(value)) { blockCol = col; continue; }
    if (value.includes("{")) flowKey(value, n);
  }
  return out;
}
