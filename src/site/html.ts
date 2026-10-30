// Small HTML helpers shared by the site renderer. Everything that reaches markup goes through esc().
import { count } from "./prose";

export function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Fragment for a deep link: #unit-<id>, #element-<id>, ... The id is percent-encoded. */
export function frag(prefix: string, id: string): string {
  return "#" + prefix + "-" + encodeURIComponent(id);
}

/** DOM id for a record; ids are free strings, so whitespace is replaced to keep the attribute valid. */
export function domId(prefix: string, id: string): string {
  return prefix + "-" + id.replace(/\s/g, "_");
}

export const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** "3 units", "1 unit": the count with its noun in agreement (see prose.ts). */
export function plural(n: number, one: string, many?: string): string {
  return count(n, one, many);
}

/** Inline a value as JSON inside <script type="application/json">. Escaping every "<" keeps "</script"
 *  and "<!--" from ending or confusing the script element; JSON.parse reads the escape back as "<".
 *  U+2028 and U+2029 are escaped too so the text stays valid if someone pastes it into a JS string. */
const LS = new RegExp(String.fromCharCode(0x2028), "g");
const PS = new RegExp(String.fromCharCode(0x2029), "g");
export function inlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(LS, "\\u2028")
    .replace(PS, "\\u2029");
}

/** Keep inline script text from closing its element early. */
export function inlineScript(src: string): string {
  return src.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
}
