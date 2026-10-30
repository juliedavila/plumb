/** Read a Plumb setting, with an explicit notice when its former name is used. */
export function setting(name: string, env: Record<string, string | undefined> = process.env): string | undefined {
  const value = env[`PLUMB_${name}`];
  if (value) return value;
  const old = env[`DE_${name}`];
  if (old) process.stderr.write(`DE_${name} is deprecated; use PLUMB_${name}.\n`);
  return old || undefined;
}
