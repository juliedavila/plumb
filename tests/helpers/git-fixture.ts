// A small Git repository for tests: init, add the given paths, commit once. User and system Git settings are ignored.
const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

function git(root: string, args: string[]): void {
  const p = Bun.spawnSync(["git", "-C", root, ...args], { env, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr.toString().trim()}`);
}

export function gitFixture(root: string, paths: string[]): void {
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["add", "--", ...paths]);
  git(root, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "Fixture"]);
}
