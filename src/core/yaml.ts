/** Bun's parse exception lacks YAML coordinates. On failure, find the first line whose prefix no longer parses. */
export function parseYaml(text: string, _file?: string): unknown {
  try { return Bun.YAML.parse(text); }
  catch (error) {
    throw new Error(`${failingLine(text)}${(error as Error).message}`);
  }
}

// Best effort and in memory: a valid YAML document's line prefixes usually parse, so the first prefix that fails
// names the line where the error starts. Returns "" when no prefix fails, so no position is claimed.
function failingLine(text: string): string {
  const lines = text.split("\n");
  const fails = (n: number) => { try { Bun.YAML.parse(lines.slice(0, n).join("\n")); return false; } catch { return true; } };
  if (!fails(lines.length)) return "";
  let lo = 1, hi = lines.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (fails(mid)) hi = mid; else lo = mid + 1; }
  return fails(lo) ? `${lo}: ` : "";
}
