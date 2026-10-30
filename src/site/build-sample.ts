// Writes build/sample/index.html from the site fixture so the site can be opened without core.
// Run: bun src/site/build-sample.ts [bundle.json] [out.html]
import { resolve } from "node:path";
import { renderSite } from "./render";

const root = resolve(import.meta.dir, "../..");
const src = process.argv[2] ?? root + "/tests/fixtures/sample-bundle.json";
const out = process.argv[3] ?? root + "/build/sample/index.html";
const html = renderSite(await Bun.file(src).json());
await Bun.write(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
