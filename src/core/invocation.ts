import { relative, resolve } from "node:path";
import { existsSync, realpathSync } from "node:fs";
/** Quote a shell argument without permitting interpolation. */
export const shellArg = (value: string): string => /^[A-Za-z0-9_./:@+-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
export const localPath = (path: string): string => relative(process.cwd(), existsSync(path) ? realpathSync(path) : resolve(path)) || ".";
export function invocation(): string {
  const script = process.argv[1];
  const packageScript = resolve(import.meta.dir, "../../plumb.ts");
  if (script && existsSync(script) && realpathSync(script) === realpathSync(packageScript)
    && process.title === "plumb") return "plumb";
  // Otherwise print the bun form: it works when pasted, linked or not.
  return `bun ${shellArg(localPath(script && /(?:^|\/)plumb\.ts$/.test(script) ? script : packageScript))}`;
}

