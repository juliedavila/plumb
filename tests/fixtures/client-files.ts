// The client's source files as text, for tests that read its string literals.
import { readdirSync, readFileSync } from "node:fs";
const dir = new URL("../../src/site/client/", import.meta.url).pathname;
export default readdirSync(dir).filter((f) => f.endsWith(".js")).sort().map((f) => readFileSync(dir + f, "utf8"));
