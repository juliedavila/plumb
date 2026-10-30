/* Plumb site client, part 0: prose.
   The small grammar every computed sentence goes through, on the page and in the server render (src/site/prose.ts
   loads this same file), so the two never phrase a count differently. Rules:
   - Numerals for every count, with a thousands comma from 1,000; "no" instead of 0 inside a sentence (count with
     { zero: "no" }), a bare 0 only in a token line.
   - The noun agrees with the number (1 unit, 2 units, 0 units), and so does the verb (verb(n, "waits", "wait")).
   - Lists: "a", "a and b", "a, b and c"; past a cap, "a, b and 4 more".
   - A title inside a sentence is quoted (“The loop closes once”), never dropped in bare between commas, and loses
     trailing sentence punctuation so the sentence around it keeps its own.
   - sentence() trims, collapses spaces, removes space before punctuation, capitalises the first letter and ends the
     sentence exactly once. lint() is the test suite's check for broken constructions. */
var PROSE = (function () {
  function s(x) { return x == null ? "" : String(x); }
  function fmt(n) {
    n = Number(n);
    if (!isFinite(n)) return "0";
    var neg = n < 0, a = Math.abs(Math.round(n * 100) / 100), int = Math.floor(a), frac = a - int;
    var t = String(int);
    if (int >= 1000) t = t.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    if (frac) t += String(Math.round(frac * 100) / 100).slice(1);
    return (neg ? "−" : "") + t;
  }
  var IRREGULAR = { person: "people", child: "children", analysis: "analyses", criterion: "criteria", "knock-on": "knock-on" };
  /** The plural of a noun or noun phrase: the last word changes ("error check" -> "error checks", "patch" -> "patches"). */
  function pluralOf(phrase) {
    var p = s(phrase), m = /^(.*?)([A-Za-z-]+)$/.exec(p);
    if (!m) return p;
    var head = m[1], w = m[2], lw = w.toLowerCase();
    if (IRREGULAR[lw]) return head + IRREGULAR[lw];
    if (/(s|x|z|ch|sh)$/.test(lw)) return head + w + "es";
    if (/[^aeiou]y$/.test(lw)) return head + w.slice(0, -1) + "ies";
    return head + w + "s";
  }
  function noun(n, one, many) { return Number(n) === 1 ? one : (many || pluralOf(one)); }
  /** "3 units", "1 unit", "0 units"; with { zero: "no" } "no units"; with { zero: "none" } "none". */
  function count(n, one, many, opts) {
    if (many && typeof many === "object") { opts = many; many = undefined; }
    n = Number(n) || 0; opts = opts || {};
    if (n === 0 && opts.zero) return opts.zero === "none" ? "none" : opts.zero + " " + noun(0, one, many);
    return fmt(n) + " " + noun(n, one, many);
  }
  function verb(n, one, many) { return Number(n) === 1 ? one : many; }
  /** "a", "a and b", "a, b and c"; opts.max caps the list: "a, b and 4 more"; opts.conj "or". */
  function list(items, opts) {
    if (typeof opts === "string") opts = { conj: opts };
    opts = opts || {};
    var xs = (items || []).map(s).map(function (x) { return x.trim(); }).filter(Boolean);
    var conj = opts.conj || "and";
    if (opts.max && xs.length > opts.max) { var rest = xs.length - opts.max; xs = xs.slice(0, opts.max); xs.push(fmt(rest) + " " + (opts.more || "more")); }
    if (xs.length <= 1) return xs[0] || "";
    return xs.slice(0, -1).join(", ") + " " + conj + " " + xs[xs.length - 1];
  }
  /** A name or title as it sits inside a sentence: trimmed, single-spaced, without trailing . , ; : and quoted. */
  function quote(name) {
    var t = s(name).replace(/\s+/g, " ").trim().replace(/[.,;:]+$/, "").replace(/^["“”']+|["“”']+$/g, "");
    if (!t) return "";
    t = t.replace(/"([^"]*)"/g, "‘$1’").replace(/"/g, "’");
    return "“" + t + "”";
  }
  /** One sentence: trimmed, single-spaced, no space before punctuation, first letter capitalised, ended exactly once. */
  function sentence(text) {
    var t = s(text).replace(/\s+/g, " ").trim();
    if (!t) return "";
    t = t.replace(/\s+([,;:.!?])/g, "$1").replace(/([,;:])(?=[,;:.])/g, "").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");
    t = t.replace(/[,;:]+$/, "");
    t = t.charAt(0).toUpperCase() + t.slice(1);
    if (/[.!?]$/.test(t) || /[.!?][”’)]$/.test(t)) return t.replace(/\.\.$/, ".");
    return t + ".";
  }
  /** Sentences joined into a paragraph; empty parts drop out. */
  function para(parts) { return (parts || []).filter(Boolean).map(sentence).filter(Boolean).join(" "); }
  /** Capitalise the first letter (for a clause that starts a line). */
  function cap(text) { var t = s(text); return t.charAt(0).toUpperCase() + t.slice(1); }

  var NOUNS = ["unit", "part", "relationship", "team", "gate", "milestone", "view", "rule", "warning", "error", "check", "finding", "patch",
    "change", "place", "issue", "project", "neighbour", "capability", "contract", "system", "zone", "step", "layer", "node",
    "record", "element", "problem", "operation", "link type", "issue type", "item", "day", "more"];
  var SINGULAR_AFTER_MANY = new RegExp("(^|[^\\w.,−-])(0|[2-9]|[1-9]\\d+|\\d{1,3}(?:,\\d{3})+) (" + NOUNS.filter(function (x) { return x !== "more"; }).join("|") + ")(?![\\w-]| (?!is\\b|was\\b|has\\b|does\\b)[a-z-]+s\\b)", ""); // "3 error rules" is a compound, "3 unit is" is not
  var PLURAL_AFTER_ONE = new RegExp("(^|[^\\w.,−-])1 (" + NOUNS.filter(function (x) { return x !== "more"; }).map(pluralOf).join("|") + ")(?![\\w-])", "");
  /**
   * Broken constructions in generated text. Always: doubled spaces, doubled or stacked punctuation, a space before
   * punctuation, a capitalised article right after a comma or semicolon (a bare title dropped into a sentence),
   * "1 units" or "3 unit", empty quotes or brackets, leaked "undefined", "NaN" or "null". With { sentence: true }
   * also: starts with a lowercase letter or a digit, does not end with punctuation, or runs past opts.maxWords (26).
   */
  function lint(text, opts) {
    opts = opts || {};
    var t = s(text), out = [];
    var add = function (re, why) { var m = re.exec(t); if (m) out.push(why + ": …" + t.slice(Math.max(0, m.index - 12), m.index + m[0].length + 12) + "…"); };
    add(/ {2,}/, "doubled space");
    add(/([,;:])\s*[,;:.]/, "stacked punctuation");
    add(/(^|[^.])\.\s*\.(?!\.)/, "doubled full stop");
    add(/ [,;:.!?](\s|$)/, "space before punctuation");
    add(/[,;] (The|A|An) /, "bare title after a comma");
    add(/“\s*”|\(\s*\)|""/, "empty quotes or brackets");
    add(/\b(undefined|NaN|null)\b/, "leaked value");
    add(SINGULAR_AFTER_MANY, "singular noun after a count other than one");
    add(PLURAL_AFTER_ONE, "plural noun after one");
    if (opts.sentence) {
      var words = t.trim().split(/\s+/).length;
      if (/^[a-z]/.test(t.trim())) out.push("starts lowercase: " + t.slice(0, 30));
      if (/^\d/.test(t.trim())) out.push("starts with a digit: " + t.slice(0, 30));
      if (!/[.!?][”’)]?$/.test(t.trim())) out.push("no closing punctuation: …" + t.slice(-30));
      if (words > (opts.maxWords || 26)) out.push("over " + (opts.maxWords || 26) + " words (" + words + "): " + t.slice(0, 40) + "…");
    }
    return out;
  }
  return { fmt: fmt, pluralOf: pluralOf, noun: noun, count: count, verb: verb, list: list, quote: quote, sentence: sentence, para: para, cap: cap, lint: lint };
})();
