// The site's stylesheet. A raw palette is never referenced by
// components; functional roles (--bg, --fg, --accent, --danger ...) are used everywhere; a few component tokens
// (node, edge, halo) sit on top. Literal colours appear only in the :root token blocks. Contrast ratios were computed
// for the palette; recompute them after any token change.

const LIGHT = `
  --bg: #F7F7F5; --bg-surface: #FFFFFF; --bg-sunken: #F0F0ED;
  --border: #E3E3DF; --border-strong: #C4C4BE; --border-control: #8A8B85;
  --fg: #18191C; --fg-2: #4B4E56; --fg-3: #646872;
  --accent: #2756C7; --accent-muted: #EAF0FC;
  --danger: #B3261E; --danger-muted: #FCEDEB;
  --warning: #935400; --warning-muted: #FCF1DF;
  --success: #1D7337; --success-muted: #E7F4EA;
  --focus: #2756C7; --edge: #7C808A; --scrim: rgb(24 25 28 / 0.40);
  --z1: #4B9DCB; --z1-fill: #E9F3F9; --z2: #9E962C; --z2-fill: #F3F2E6; --z3: #CC6677; --z3-fill: #F9EDEF;
  --z4: #332288; --z4-fill: #E7E4F1; --z5: #117733; --z5-fill: #E2EFE7; --z6: #882255; --z6-fill: #F1E4EB;
  --z0: #6B7079; --z0-fill: #EDEEEF;
  --shadow-pop: 0 1px 2px rgb(0 0 0 / 0.06), 0 8px 24px rgb(0 0 0 / 0.10);
  color-scheme: light;`;

const DARK = `
  --bg: #111214; --bg-surface: #18191C; --bg-sunken: #0C0D0E;
  --border: #2A2C31; --border-strong: #41444B; --border-control: #6E727A;
  --fg: #ECEDEF; --fg-2: #B3B6BD; --fg-3: #8E929B;
  --accent: #86A8FF; --accent-muted: #1C2A4D;
  --danger: #FF8A80; --danger-muted: #3A1A18;
  --warning: #F0B44C; --warning-muted: #352610;
  --success: #6BCB8B; --success-muted: #14301D;
  --focus: #86A8FF; --edge: #6E727A; --scrim: rgb(0 0 0 / 0.55);
  --z1: #56B4E9; --z1-fill: #243845; --z2: #F0E442; --z2-fill: #434224; --z3: #CC6677; --z3-fill: #3C282E;
  --z4: #685BA7; --z4-fill: #282638; --z5: #117733; --z5-fill: #172C21; --z6: #9D4A74; --z6-fill: #33232E;
  --z0: #9AA0AA; --z0-fill: #323438;
  --shadow-pop: 0 1px 2px rgb(0 0 0 / 0.4), 0 8px 24px rgb(0 0 0 / 0.5);
  color-scheme: dark;`;

export const CSS = `
:root {
  --font-ui: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  --fs-xs: 12px; --lh-xs: 16px; --fs-sm: 13px; --lh-sm: 18px; --fs-md: 14px; --lh-md: 20px;
  --fs-lg: 16px; --lh-lg: 24px; --fs-xl: 20px; --lh-xl: 28px; --fs-2xl: 24px; --lh-2xl: 32px; --fs-3xl: 30px; --lh-3xl: 36px;
  --fw-regular: 400; --fw-medium: 500; --fw-semibold: 600;
  --tracking-tight: -0.011em; --tracking-tighter: -0.019em;
  --sp-0: 2px; --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 24px; --sp-6: 32px; --sp-7: 48px; --sp-8: 64px;
  --gutter: 16px; --content-max: 1360px;
  --row-h: 32px; --control-h: 32px; --control-h-lg: 40px; --target-min: 24px;
  --radius-sm: 4px; --radius-md: 6px; --radius-lg: 8px; --radius-pill: 999px;
  --hairline: 1px;
  --node-stroke: 1.5px; --edge-width: 1.25px; --edge-width-hi: 1.75px; --dim-opacity: 0.18;
  --t-fast: 120ms; --t-panel: 180ms; --t-camera: 240ms;
  --ease-in: cubic-bezier(0.2, 0, 0, 1); --ease-out: cubic-bezier(0.4, 0, 1, 1);
  --header-h: 48px; --nav-h: 40px; --chip-h: 44px; --bars-h: calc(var(--nav-h) + var(--chip-h));
${LIGHT}
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {${DARK}
} }
:root[data-theme="dark"] {${DARK}
}
@media (min-width: 720px) { :root { --gutter: 24px; } }
@media (min-width: 1200px) { :root { --gutter: 32px; } }
@media (prefers-reduced-motion: reduce) { :root { --t-fast: 0ms; --t-panel: 0ms; --t-camera: 0ms; } }

*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--fg); font: var(--fw-regular) var(--fs-md)/var(--lh-md) var(--font-ui); overflow-x: hidden; }
:root { --halo: var(--accent-muted); --halo: color-mix(in srgb, var(--accent) 25%, transparent); }
h1, h2, h3, h4 { margin: 0; font-weight: var(--fw-semibold); }
h1 { font-size: var(--fs-2xl); line-height: var(--lh-2xl); letter-spacing: var(--tracking-tighter); }
h2 { font-size: var(--fs-xl); line-height: var(--lh-xl); letter-spacing: var(--tracking-tight); }
h3 { font-size: var(--fs-lg); line-height: var(--lh-lg); }
h4 { font-size: var(--fs-md); line-height: var(--lh-md); }
p { margin: 0; }
a { color: var(--accent); text-decoration: none; text-underline-offset: 2px; }
a:hover, a:focus-visible { text-decoration: underline; }
p a, .prose a { text-decoration: underline; }
code, .mono { font-family: var(--font-mono); font-size: var(--fs-sm); }
.num, td.n, .count { font-variant-numeric: tabular-nums; }
ul, ol { margin: 0; padding: 0; }
button, input, select { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
h1[tabindex="-1"]:focus, h2[tabindex="-1"]:focus { outline: none; } /* headings take focus on a route change; they are not controls */
[id], [data-gate-panel], [data-team-plans], .rule { scroll-margin-top: calc(var(--header-h) + var(--bars-h) + 12px); } /* a deep link lands below the sticky header and chip bar */
[hidden] { display: none !important; }
.sr-only { position: absolute !important; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.skip { position: absolute; left: 8px; top: -48px; z-index: 100; padding: 8px 12px; background: var(--bg-surface); border: 1px solid var(--border-control); border-radius: var(--radius-md); }
.skip:focus { top: 8px; }
.muted { color: var(--fg-3); }
.fg2 { color: var(--fg-2); }
.small { font-size: var(--fs-sm); line-height: var(--lh-sm); }
.xs { font-size: var(--fs-xs); line-height: var(--lh-xs); }
.reading { font-size: var(--fs-lg); line-height: var(--lh-lg); max-width: 68ch; }
.icon { width: 16px; height: 16px; flex: none; vertical-align: -3px; }
.icon-sm { width: 14px; height: 14px; }
svg.icon { fill: none; stroke: currentColor; }
.wrap-anywhere { overflow-wrap: anywhere; }

/* ---------- header and nav ---------- */
.app-header { position: sticky; top: 0; z-index: 30; height: var(--header-h); background: var(--bg-surface); border-bottom: 1px solid var(--border); }
.app-header .inner, .app-nav .inner, .page { max-width: var(--content-max); margin: 0 auto; padding: 0 var(--gutter); }
.app-header .inner { height: 100%; display: flex; align-items: center; gap: var(--sp-3); min-width: 0; }
.mark { display: flex; align-items: center; gap: var(--sp-2); color: var(--fg-3); font-size: var(--fs-sm); white-space: nowrap; flex: none; }
.mark svg { width: 20px; height: 20px; color: var(--fg-2); }
.app-title { font-weight: var(--fw-semibold); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1 1 auto; }
.hdr-actions { display: flex; align-items: center; gap: var(--sp-1); flex: none; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: var(--sp-1); min-height: var(--control-h); min-width: var(--control-h); padding: 0 var(--sp-3); border: 1px solid var(--border-control); border-radius: var(--radius-md); background: var(--bg-surface); color: var(--fg); cursor: pointer; white-space: nowrap; font-size: var(--fs-sm); transition: background var(--t-fast) var(--ease-in); }
.btn:hover { background: var(--bg-sunken); }
.btn[aria-pressed="true"], .btn.on { background: var(--accent-muted); color: var(--accent); border-color: var(--accent); }
.btn.quiet { border-color: transparent; background: transparent; }
.btn.quiet:hover { background: var(--bg-sunken); }
.btn.icon-only { padding: 0; width: var(--control-h); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--bg-surface); }
.kbd { font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--fg-3); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); padding: 0 4px; line-height: 16px; }
.search-btn { min-width: 0; color: var(--fg-3); justify-content: flex-start; }
.search-btn .lbl { overflow: hidden; text-overflow: ellipsis; }
@media (min-width: 720px) { .search-btn { width: 220px; } }
@media (max-width: 719px) { .search-btn .lbl, .search-btn .kbd, .mark .words, .tour-btn .lbl, .present-btn .lbl { display: none; } }
.live-ind { display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-xs); color: var(--fg-3); }
.live-ind::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--success); }
.app-nav { position: sticky; top: var(--header-h); z-index: 29; height: var(--nav-h); background: var(--bg); border-bottom: 1px solid var(--border); }
.app-nav .inner { height: 100%; display: flex; align-items: stretch; gap: var(--sp-1); min-width: 0; }
.nav-links { display: flex; align-items: stretch; gap: var(--sp-1); min-width: 0; }
.nav-links a { display: flex; align-items: center; gap: 6px; padding: 0 var(--sp-2); color: var(--fg-2); border-bottom: 2px solid transparent; white-space: nowrap; text-decoration: none; }
.nav-links a:hover { color: var(--fg); }
.nav-links a[aria-current="page"] { color: var(--fg); border-bottom-color: var(--accent); font-weight: var(--fw-medium); }
.badge { display: inline-flex; align-items: center; min-width: 20px; height: 18px; padding: 0 6px; border-radius: var(--radius-pill); background: var(--bg-sunken); color: var(--fg-2); font-size: var(--fs-xs); font-variant-numeric: tabular-nums; font-weight: var(--fw-medium); white-space: nowrap; }
.badge.danger { background: var(--danger-muted); color: var(--danger); }
.badge.warning { background: var(--warning-muted); color: var(--warning); }
.badge.success { background: var(--success-muted); color: var(--success); }
.badge.accent { background: var(--accent-muted); color: var(--accent); }
.nav-current { display: none; align-items: center; font-weight: var(--fw-medium); white-space: nowrap; }
.nav-spacer { flex: 1; }
.sel-chip { display: inline-flex; align-items: center; gap: 4px; align-self: center; max-width: 40vw; height: 26px; padding: 0 4px 0 10px; border-radius: var(--radius-pill); background: var(--accent-muted); color: var(--accent); font-size: var(--fs-xs); }
.sel-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sel-chip button { border: 0; background: transparent; color: inherit; cursor: pointer; width: 24px; height: 24px; border-radius: 50%; }
@media (max-width: 719px) {
  .nav-links { display: none; }
  .nav-current { display: flex; }
}
.pages-btn { align-self: center; }
@media (min-width: 720px) { .pages-btn { display: none; } }

/* ---------- pages ---------- */
main { display: block; min-height: 60vh; outline: none; }
.page { padding-top: var(--sp-5); padding-bottom: var(--sp-8); }
.page-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--sp-2) var(--sp-4); margin-bottom: var(--sp-4); }
.page-head h1 { outline: none; }
.brief { font-size: var(--fs-lg); line-height: var(--lh-lg); max-width: 68ch; color: var(--fg); margin-bottom: var(--sp-5); }
.brief .em { font-weight: var(--fw-medium); }
.section { margin-top: var(--sp-6); }
.section-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--sp-1) var(--sp-3); margin-bottom: var(--sp-3); }
.section-head p { color: var(--fg-3); font-size: var(--fs-sm); }
.panel { background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-lg); }
.pad { padding: var(--sp-4); }
.empty { color: var(--fg-3); font-size: var(--fs-sm); }
.grid-2 { display: grid; gap: var(--sp-5); grid-template-columns: minmax(0, 1fr); }
@media (min-width: 960px) { .grid-2 { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } }
.hr { border: 0; border-top: 1px solid var(--border); margin: var(--sp-5) 0; }

/* status, tags, chips */
.st { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; font-weight: var(--fw-medium); }
.st.sm { font-size: var(--fs-sm); }
.st.done, .st.pass { color: var(--success); }
.st.doing, .st.ready { color: var(--accent); }
.st.blocked, .st.warning { color: var(--warning); }
.st.noprov, .st.fail { color: var(--danger); }
.st .w { color: inherit; }
.st-done, .st-pass { color: var(--success); } .st-doing, .st-ready { color: var(--accent); } .st-blocked, .st-warning { color: var(--warning); } .st-noprov, .st-fail { color: var(--danger); }
.unit-ref { display: inline-flex; align-items: baseline; gap: 4px; }
.unit-ref .icon { align-self: center; }
.tag { display: inline-flex; align-items: center; gap: 5px; height: 20px; padding: 0 6px; border-radius: var(--radius-sm); background: var(--bg-sunken); color: var(--fg-2); font-size: var(--fs-xs); white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.tag.agent { gap: 4px; }
.tag.warning { background: var(--warning-muted); color: var(--warning); }
.tag.danger { background: var(--danger-muted); color: var(--danger); }
.tag.success { background: var(--success-muted); color: var(--success); }
.tag.accent { background: var(--accent-muted); color: var(--accent); }
.swatch { display: inline-block; vertical-align: -1px; width: 10px; height: 10px; border-radius: 2px; flex: none; border: 1.5px solid var(--z0); background: var(--z0-fill); }
.chip { display: inline-flex; align-items: center; max-width: 100%; padding: 1px 6px; border-radius: var(--radius-sm); background: var(--bg-sunken); color: var(--fg-2); font: var(--fs-xs)/var(--lh-xs) var(--font-mono); overflow-wrap: anywhere; }
button.chip { border: 1px solid transparent; cursor: pointer; }
button.chip:hover { border-color: var(--border-strong); }
.chip.missing { background: var(--danger-muted); color: var(--danger); }
.chips { display: flex; flex-wrap: wrap; gap: 4px; }
.id { font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--fg-3); white-space: nowrap; }
.copy-btn { border: 0; background: transparent; color: var(--fg-3); cursor: pointer; padding: 2px 4px; border-radius: var(--radius-sm); font-size: var(--fs-xs); min-height: var(--target-min); }
.copy-btn:hover { color: var(--accent); background: var(--bg-sunken); }
.bar { height: 4px; background: var(--bg-sunken); border-radius: 2px; overflow: hidden; }
.bar > span { display: block; height: 100%; background: var(--accent); }
.callout { display: flex; gap: var(--sp-2); padding: var(--sp-3) var(--sp-3); border-left: 3px solid var(--fg-3); background: var(--bg-sunken); border-radius: 0 var(--radius-md) var(--radius-md) 0; font-size: var(--fs-sm); line-height: var(--lh-sm); }
.callout.warning { border-color: var(--warning); background: var(--warning-muted); }
.callout.danger { border-color: var(--danger); background: var(--danger-muted); }
.callout.info { border-color: var(--accent); background: var(--accent-muted); }
.callout .icon { margin-top: 1px; }
.callout b { font-weight: var(--fw-semibold); }

/* lists */
.rows { list-style: none; display: grid; }
.rows > li { display: flex; align-items: baseline; gap: var(--sp-2); min-height: 32px; padding: 6px 0; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.rows > li:last-child { border-bottom: 0; }
.work-rows li.work-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; }
.work-rows .work-meta { flex-basis: 100%; padding-left: 22px; }
.warn-text { color: var(--warning); font-weight: 600; }
.exposure { margin: var(--sp-2) 0; padding: var(--sp-2) var(--sp-3); border-left: 3px solid var(--border); background: var(--bg-sunken); font-size: var(--fs-md); }
.exposure.warn, .no-test { border-left-color: var(--warning); }
.no-test { color: var(--fg); display: flex; gap: 6px; align-items: center; }
.slice-g > summary .count { margin-left: 4px; }
.list-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 2px var(--sp-3); min-height: 40px; padding: 8px var(--sp-3); border-bottom: 1px solid var(--border); color: var(--fg); text-decoration: none; }
.list-row:last-child { border-bottom: 0; }
a.list-row:hover, .list-row.sel { background: var(--bg-sunken); text-decoration: none; }
.list-row .t { min-width: 0; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.list-row .meta { grid-column: 2 / -1; display: flex; flex-wrap: wrap; gap: 4px 6px; align-items: center; color: var(--fg-3); font-size: var(--fs-xs); }
.list-row .rv { color: var(--fg-2); font-size: var(--fs-sm); font-variant-numeric: tabular-nums; white-space: nowrap; text-align: right; }
.list-row.marked { box-shadow: inset 3px 0 0 var(--accent); }

/* disclosure */
details > summary { cursor: pointer; list-style: none; }
details > summary::-webkit-details-marker { display: none; }
.disc > summary { display: flex; align-items: center; gap: var(--sp-2); min-height: 36px; padding: 6px 0; }
.disc > summary::before { content: ""; width: 7px; height: 7px; border-right: 1.5px solid var(--fg-3); border-bottom: 1.5px solid var(--fg-3); transform: rotate(-45deg); transition: transform var(--t-panel) var(--ease-in); flex: none; margin: 0 4px 0 2px; }
.disc[open] > summary::before { transform: rotate(45deg); }
.disc > .body { padding: 0 0 var(--sp-3) 22px; }

/* tables */
.table-wrap { position: relative; overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--bg-surface); }
table { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
th, td { text-align: left; padding: 6px var(--sp-3); border-bottom: 1px solid var(--border); vertical-align: top; }
thead th { position: sticky; top: 0; background: var(--bg-surface); color: var(--fg-3); font-weight: var(--fw-medium); white-space: nowrap; z-index: 1; }
tbody tr:last-child td { border-bottom: 0; }
tbody tr:hover { background: var(--bg-sunken); }
tbody tr.sel { background: var(--accent-muted); }
tbody tr.marked td:first-child { box-shadow: inset 3px 0 0 var(--accent); }
th button.sort { border: 0; background: transparent; padding: 0; color: inherit; font: inherit; cursor: pointer; display: inline-flex; gap: 4px; align-items: center; }
th[aria-sort="ascending"] button.sort::after { content: "\\2191"; }
th[aria-sort="descending"] button.sort::after { content: "\\2193"; }
@media (max-width: 719px) {
  .table-wrap.reflow { overflow: visible; }
  table.reflow thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  table.reflow, table.reflow tbody, table.reflow tr, table.reflow td { display: block; width: 100%; }
  table.reflow tr { padding: 8px var(--sp-3); border-bottom: 1px solid var(--border); }
  table.reflow td { border: 0; padding: 1px 0; }
  table.reflow td[data-label]:not(.lead)::before { content: attr(data-label) " "; color: var(--fg-3); }
  table.reflow td.hide-narrow { display: none; }
  table.reflow td.inline { display: inline-block; width: auto; margin-right: 10px; }
}
.filters { display: flex; flex-wrap: wrap; gap: var(--sp-2) var(--sp-3); align-items: end; margin-bottom: var(--sp-3); }
.field { display: grid; gap: 2px; font-size: var(--fs-xs); color: var(--fg-3); min-width: 0; }
.field input, .field select { height: var(--control-h); padding: 0 8px; border: 1px solid var(--border-control); border-radius: var(--radius-md); background: var(--bg-surface); color: var(--fg); font-size: var(--fs-sm); min-width: 0; max-width: 100%; }
.field.grow { flex: 1 1 200px; }
.field.grow input { width: 100%; }
.check { display: inline-flex; align-items: center; gap: 6px; min-height: var(--target-min); font-size: var(--fs-sm); color: var(--fg-2); cursor: pointer; }
.check input { width: 16px; height: 16px; accent-color: var(--accent); margin: 0; }
.filter-count { font-size: var(--fs-xs); color: var(--fg-3); margin-bottom: var(--sp-2); }
.chipbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.fchip { height: 28px; padding: 0 10px; border-radius: var(--radius-pill); border: 1px solid var(--border-control); background: var(--bg-surface); font-size: var(--fs-xs); cursor: pointer; color: var(--fg-2); }
.fchip[aria-pressed="true"] { background: var(--accent-muted); color: var(--accent); border-color: var(--accent); }

/* ---------- overview ---------- */
.tiles { display: grid; gap: var(--sp-3); grid-template-columns: repeat(2, minmax(0, 1fr)); margin-bottom: var(--sp-6); }
@media (min-width: 960px) { .tiles { grid-template-columns: repeat(var(--tiles, 4), minmax(0, 1fr)); } }
@media (max-width: 400px) { .tiles { grid-template-columns: minmax(0, 1fr); } }
.tile { display: grid; align-content: start; gap: 6px; padding: var(--sp-4); background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-lg); color: var(--fg); text-decoration: none; min-width: 0; }
a.tile:hover { border-color: var(--border-strong); text-decoration: none; }
.tile .q { color: var(--fg-3); font-size: var(--fs-sm); }
.tile .big { font-size: var(--fs-xl); line-height: var(--lh-xl); font-weight: var(--fw-semibold); letter-spacing: var(--tracking-tight); }
.tile .line { color: var(--fg-2); font-size: var(--fs-sm); overflow-wrap: anywhere; }
.tile[aria-selected="true"] { border-color: var(--accent); box-shadow: inset 0 -3px 0 var(--accent); }
.tile .big .big-name { display: block; font-size: var(--fs-lg); line-height: var(--lh-lg); overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.tile .big .st.pass { color: var(--fg); }
.tile .big .st.pass .icon { color: var(--fg-3); }
.tile.bad-warning .line { color: var(--warning); }
.tile.bad-fail .line { color: var(--danger); }
#overview .tiles { margin-bottom: var(--sp-4); }
.work { min-height: 240px; margin-bottom: var(--sp-6); }
.work-grid { display: grid; gap: var(--sp-5); grid-template-columns: minmax(0, 1fr); align-items: start; }
@media (min-width: 1100px) { .work-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } .work-grid.wide-first { grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); } }
.bars { display: grid; gap: var(--sp-5); grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr)); align-content: start; }
.work-panel > .bars { margin-top: var(--sp-4); }
.barlist h3 { font-size: var(--fs-md); line-height: var(--lh-md); margin-bottom: 4px; }
.barlist h3 .count { color: var(--fg-3); font-weight: var(--fw-regular); }
.barlist > p.small { margin-bottom: 6px; }
.bar-rows { list-style: none; display: grid; gap: 2px; }
.bar-rows > li { display: flex; align-items: center; gap: 4px; }
.bar-row { flex: 1; min-width: 0; display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(48px, 1fr) auto; gap: var(--sp-3); align-items: center; min-height: 32px; padding: 4px 8px; border-radius: var(--radius-sm); color: var(--fg); text-decoration: none; font-size: var(--fs-sm); }
a.bar-row:hover { background: var(--bg-sunken); text-decoration: none; }
a.bar-row:hover .bf:not(.warning):not(.fail) { background: var(--accent); }
.bar-row.on { background: var(--accent-muted); box-shadow: inset 2px 0 0 var(--accent); }
.bar-row .bl { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar-row .bl .icon { vertical-align: -3px; }
.bar-row .bt { height: 8px; border-radius: 4px; background: var(--bg-sunken); overflow: hidden; }
.bar-row .bf { display: block; height: 100%; border-radius: 4px; background: var(--fg-3); }
.bar-row .bf.warning { background: var(--warning); }
.bar-row .bf.fail { background: var(--danger); }
.bar-row .bn { font-variant-numeric: tabular-nums; color: var(--fg-2); text-align: right; white-space: nowrap; }
.bar-open { font-size: var(--fs-xs); padding: 4px 6px; }
.attention { list-style: none; }
.team-plans .team-plan { border-top: 1px solid var(--border); }
.team-plans .team-plan > summary { justify-content: flex-start; }
.team-plans .team-plan > summary > span:first-child { display: inline-flex; gap: 6px; align-items: center; font-weight: 600; }
.team-plans .rows { list-style: none; padding: 0; margin: 2px 0 8px; }
.team-plans .rows li { padding: 3px 0; }
.team-plans .gating { display: flex; gap: 6px; align-items: flex-start; margin: 6px 0; }
.attention .att-group { padding: 10px var(--sp-3) 4px; font-size: var(--fs-xs); font-weight: 600; color: var(--fg-2); border-bottom: 1px solid var(--border); background: var(--bg-sunken); }
.attention .att-group:first-child { border-radius: var(--radius-md) var(--radius-md) 0 0; }
.attention .list-row .rv { white-space: normal; max-width: 220px; }
.attention .list-row .rv.no-owner { color: var(--warning); }
.attention .more-row { grid-template-columns: minmax(0, 1fr); color: var(--accent); font-size: var(--fs-sm); min-height: 32px; }
.about dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px var(--sp-4); font-size: var(--fs-sm); }
.about dt { color: var(--fg-3); }
.about dd { margin: 0; overflow-wrap: anywhere; }
.landscape { min-height: 200px; }

/* gate road */
.road { display: flex; gap: 8px; list-style: none; }
.road > li { flex: var(--w, 1) 1 72px; min-width: 72px; }
.road a { display: grid; gap: 4px; color: var(--fg); text-decoration: none; }
.road .lab { font-size: var(--fs-xs); color: var(--fg-2); overflow-wrap: anywhere; line-height: 1.3; }
.road .lab b { font-weight: var(--fw-medium); color: var(--fg); }
.road .lab .ms-lead { display: block; color: var(--fg-3); }
.road .seg { position: relative; height: 28px; border-radius: var(--radius-sm); background: var(--bg-sunken); overflow: hidden; border: 1px solid var(--border); }
.road .seg > span { position: absolute; inset: 0 auto 0 0; background: var(--accent); }
.road li.later .seg > span { opacity: 0.6; }
.road li.passed .seg { border-color: var(--success); }
.road .cnt { font-size: var(--fs-xs); color: var(--fg-3); font-variant-numeric: tabular-nums; display: flex; gap: 6px; align-items: center; }
.road li.current .lab b::after { content: " (current)"; color: var(--fg-3); font-weight: var(--fw-regular); }
.road a:hover .seg, .road a[aria-current="true"] .seg { border-color: var(--accent); }
@media (max-width: 719px) {
  .road { flex-direction: column; gap: 10px; }
  .road > li { flex: none; min-width: 0; }
  .road .seg { height: 20px; }
}
.gate-panel { margin-top: var(--sp-4); }

/* plan */
.plan-layout { display: grid; gap: var(--sp-5); grid-template-columns: minmax(0, 1fr); }
@media (min-width: 1200px) { .plan-layout.has-detail { grid-template-columns: minmax(0, 1fr) 380px; } }
.plan-aside { position: sticky; top: calc(var(--header-h) + var(--bars-h) + 12px); max-height: calc(100vh - var(--header-h) - var(--bars-h) - 24px); overflow: auto; align-self: start; }
.chain { display: flex; flex-wrap: wrap; gap: 6px 4px; list-style: none; align-items: center; }
.chain li { display: flex; align-items: center; gap: 4px; max-width: 100%; }
.chain li + li::before { content: "\\2192"; color: var(--fg-3); font-size: var(--fs-xs); }
.chain a { display: inline-flex; align-items: center; gap: 6px; max-width: 320px; padding: 4px 8px 4px 6px; border: 1px solid var(--border); border-left: 3px solid var(--gate, var(--accent)); border-radius: var(--radius-sm); background: var(--bg-surface); color: var(--fg); font-size: var(--fs-xs); text-decoration: none; }
.chain a:hover { border-color: var(--border-strong); }
.chain a .tt { min-width: 0; overflow-wrap: anywhere; line-height: 1.3; }
.chain li.next a { border-color: var(--accent); box-shadow: 0 0 0 2px var(--halo); }
.chain .nextlab { font-size: var(--fs-xs); color: var(--accent); font-weight: var(--fw-medium); }
.g1 { --gate: var(--accent); } .g2 { --gate: color-mix(in srgb, var(--accent) 82%, var(--bg-surface)); } .g3 { --gate: color-mix(in srgb, var(--accent) 64%, var(--bg-surface)); }
.g4 { --gate: color-mix(in srgb, var(--accent) 46%, var(--bg-surface)); } .g5, .g6, .g7, .g8 { --gate: color-mix(in srgb, var(--accent) 30%, var(--bg-surface)); }
.shape-wrap { overflow-x: auto; }
.shape svg { display: block; }
.shape .dot { stroke-width: 1.5px; }
.shape .cp { fill: none; stroke: var(--fg); stroke-width: 2px; }
.shape text { fill: var(--fg-3); font-size: 11px; font-family: var(--font-ui); }
.shape g.u:focus { outline: none; }
.shape g.u:focus .dot, .shape g.u:hover .dot { stroke: var(--fg); stroke-width: 2.5px; }
.shape g.u.dep .dot { stroke: var(--fg); stroke-width: 2.5px; }

/* unit detail and inspector */
.inspector { background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: var(--sp-4); min-width: 0; }
.insp-head { display: grid; gap: 6px; margin-bottom: var(--sp-3); }
.insp-head .kind { color: var(--fg-3); font-size: var(--fs-xs); display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.insp-head h2 { font-size: var(--fs-xl); line-height: var(--lh-xl); overflow-wrap: anywhere; }
.insp-head .tags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.insp-head { position: relative; }
.insp-close { position: absolute; right: -8px; top: -8px; }
.insp-head:has(.insp-close) .kind { padding-right: 36px; }
.inspector section { margin-top: var(--sp-4); }
.inspector section > h3 { font-size: var(--fs-sm); line-height: var(--lh-sm); color: var(--fg-2); font-weight: var(--fw-semibold); margin-bottom: 6px; display: flex; gap: 6px; align-items: baseline; }
.inspector section > h3 .count { color: var(--fg-3); font-weight: var(--fw-regular); }
.done-when { padding: var(--sp-3); border: 1px solid var(--border-strong); border-radius: var(--radius-md); font-size: var(--fs-lg); line-height: var(--lh-lg); background: var(--bg); }
.facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px var(--sp-3); font-size: var(--fs-sm); margin: 0; }
.facts dt { color: var(--fg-3); }
.facts dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.ladder { display: inline-flex; gap: 4px; align-items: center; font-size: var(--fs-xs); color: var(--fg-3); flex-wrap: wrap; }
.ladder .to { color: var(--fg); font-weight: var(--fw-medium); }
.provenance-note { font-size: var(--fs-xs); color: var(--fg-3); margin-top: 6px; }
.back-link { display: inline-flex; gap: 4px; align-items: center; margin-bottom: var(--sp-3); font-size: var(--fs-sm); }

/* ---------- model ---------- */
.model-layout { display: grid; gap: var(--sp-4); grid-template-columns: minmax(0, 1fr); }
@media (min-width: 720px) { .model-layout { grid-template-columns: minmax(0, 1fr) 320px; } }
@media (min-width: 1200px) { .model-layout { grid-template-columns: 260px minmax(0, 1fr) 340px; } }
.model-layout > * { min-width: 0; }
.model-layout.no-insp .inspector-col { display: none; }
@media (min-width: 720px) { .model-layout.no-insp { grid-template-columns: minmax(0, 1fr); } }
@media (min-width: 1200px) { .model-layout.no-insp { grid-template-columns: 260px minmax(0, 1fr); } }
.rail { display: none; }
@media (min-width: 1200px) { .rail { display: block; position: sticky; top: calc(var(--header-h) + var(--bars-h) + 12px); max-height: calc(100vh - var(--header-h) - var(--bars-h) - 24px); overflow: auto; } .views-btn { display: none; } }
.rail-list { list-style: none; }
.rail-group { margin-top: var(--sp-3); }
.rail-group > .gname { font-size: var(--fs-xs); color: var(--fg-3); padding: 0 var(--sp-2) 2px; }
.rail a { display: flex; gap: var(--sp-2); justify-content: space-between; align-items: baseline; padding: 5px var(--sp-2) 5px 10px; border-left: 2px solid transparent; color: var(--fg-2); font-size: var(--fs-sm); line-height: var(--lh-sm); text-decoration: none; border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }
.rail a:hover { background: var(--bg-sunken); color: var(--fg); }
.rail a[aria-current="true"] { border-left-color: var(--accent); color: var(--fg); background: var(--accent-muted); }
.rail a .n { color: var(--fg-3); font-size: var(--fs-xs); font-variant-numeric: tabular-nums; flex: none; }
.rail a .vt { min-width: 0; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
@media (max-width: 719px) { .model-layout .inspector-col { order: 2; } }
.canvas-head { display: grid; gap: 4px; margin-bottom: var(--sp-2); }
.canvas-head h2 { font-size: var(--fs-lg); line-height: var(--lh-lg); overflow-wrap: anywhere; }
.crumbs { display: flex; flex-wrap: wrap; gap: 4px; font-size: var(--fs-xs); color: var(--fg-3); }
.crumbs a { color: var(--fg-2); }
.crumbs .sep { color: var(--fg-3); }
.toolbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: var(--sp-2); }
.toolbar .grow { flex: 1; }
.toolbar select { height: var(--control-h); border: 1px solid var(--border-control); border-radius: var(--radius-md); background: var(--bg-surface); padding: 0 6px; font-size: var(--fs-sm); max-width: 160px; }
.menu-wrap { position: relative; }
.menu { position: absolute; z-index: 40; top: calc(100% + 4px); left: 0; min-width: 220px; max-height: 60vh; overflow: auto; padding: var(--sp-2); background: var(--bg-surface); border: 1px solid var(--border-strong); border-radius: var(--radius-md); box-shadow: var(--shadow-pop); }
.menu.right { left: auto; right: 0; }
.menu h4 { font-size: var(--fs-xs); color: var(--fg-3); font-weight: var(--fw-medium); margin: 4px 0; }
.menu .check { display: flex; }
.menu [role="menuitemradio"] { display: flex; width: 100%; gap: 8px; align-items: center; border: 0; background: transparent; padding: 6px 8px; border-radius: var(--radius-sm); cursor: pointer; text-align: left; }
.menu [role="menuitemradio"]:hover, .menu [role="menuitemradio"]:focus-visible { background: var(--bg-sunken); }
.menu [role="menuitemradio"][aria-checked="true"]::after { content: "\\2713"; margin-left: auto; color: var(--accent); }
.canvas { position: relative; overflow: hidden; height: 360px; min-height: 240px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--bg-surface); touch-action: none; user-select: none; -webkit-user-select: none; cursor: grab; }
.canvas.dragging { cursor: grabbing; }
.canvas > svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.canvas .placeholder { padding: var(--sp-4); color: var(--fg-3); }
.minimap { position: absolute; right: 8px; bottom: 8px; width: 160px; background: var(--bg-surface); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); box-shadow: var(--shadow-pop); cursor: pointer; }
.minimap svg { display: block; width: 100%; height: auto; }
.minimap .vp { fill: var(--halo); stroke: var(--accent); stroke-width: 2px; vector-effect: non-scaling-stroke; }
.minimap rect.mn { stroke: none; }
.legend { display: flex; flex-wrap: wrap; gap: 6px var(--sp-4); margin-top: var(--sp-2); font-size: var(--fs-xs); color: var(--fg-2); align-items: center; }
.legend span { display: inline-flex; gap: 6px; align-items: center; }
.legend svg { overflow: visible; }
.canvas-help { font-size: var(--fs-xs); color: var(--fg-3); margin-top: 4px; }
.twin { margin-top: var(--sp-3); }
.stat-row { display: flex; flex-wrap: wrap; gap: var(--sp-2) var(--sp-4); font-size: var(--fs-sm); color: var(--fg-2); }
.kv { display: flex; gap: 6px; flex-wrap: wrap; }
.matrix-wrap { overflow-x: auto; }
table.matrix { width: auto; }
table.matrix th, table.matrix td { text-align: center; padding: 4px; }
table.matrix th[scope="row"] { text-align: right; white-space: nowrap; }
table.matrix thead th { white-space: normal; max-width: 90px; font-size: var(--fs-xs); vertical-align: bottom; }
.cell { min-width: 44px; height: 32px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-surface); cursor: pointer; font-variant-numeric: tabular-nums; }
.cell[data-l="1"] { background: color-mix(in srgb, var(--accent) 12%, var(--bg-surface)); }
.cell[data-l="2"] { background: color-mix(in srgb, var(--accent) 28%, var(--bg-surface)); }
.cell[data-l="3"] { background: color-mix(in srgb, var(--accent) 46%, var(--bg-surface)); color: var(--fg); }
.cell[data-l="4"] { background: color-mix(in srgb, var(--accent) 66%, var(--bg-surface)); color: var(--bg-surface); }
.cell:disabled { cursor: default; color: var(--fg-3); }
.cell[aria-pressed="true"] { outline: 2px solid var(--fg); outline-offset: 1px; }

/* ---------- diagram ---------- */
.dg { font-family: var(--font-ui); }
.dg .band { fill: var(--zb-fill, var(--bg-sunken)); opacity: 0.55; }
.dg .band-line { stroke: var(--zb, var(--border)); stroke-width: 1px; stroke-dasharray: 2 3; }
.dg .band-label { font-size: 12px; fill: var(--fg-2); font-weight: var(--fw-medium); }
.dg .edge .line { fill: none; stroke: var(--edge); stroke-width: var(--edge-width); stroke-linecap: round; stroke-linejoin: round; transition: opacity var(--t-fast) var(--ease-in); }
.dg .edge .hit { fill: none; stroke: transparent; stroke-width: 10px; }
.dg .ek-control .line { stroke-dasharray: 6 3; }
.dg .ek-evidence .line { stroke-dasharray: 1.5 3; }
.dg .ek-feedback .line { stroke-dasharray: 4 3; }
.dg .ek-other .line { stroke-width: 1px; }
.dg .ahp { fill: var(--edge); }
.dg .elabel, .dg .pcount { font-size: 11px; fill: var(--fg-2); paint-order: stroke; stroke: var(--bg-surface); stroke-width: 3px; stroke-linejoin: round; }
.dg .node { cursor: pointer; transition: opacity var(--t-fast) var(--ease-in); }
.dg .node .box { stroke-width: var(--node-stroke); fill: var(--z0-fill); stroke: var(--z0); }
.dg .node .deco { fill: none; stroke: inherit; stroke-width: 1px; }
.dg .node.k-external .box, .dg .node.k-external-system .box { stroke-dasharray: 4 3; }
.dg .nl { font-size: 12px; fill: var(--fg); font-weight: var(--fw-medium); }
.dg .nk { font-size: 10.5px; fill: var(--fg-3); }
.dg .fb circle { stroke: var(--bg-surface); stroke-width: 1.5px; }
.dg .fb.error circle { fill: var(--danger); }
.dg .fb.warning circle { fill: var(--warning); }
.dg .fb text { font-size: 9.5px; fill: var(--bg-surface); font-weight: var(--fw-semibold); }
.dg .node:focus { outline: none; }
.dg .node:focus-visible .box, .dg .node.kfocus .box { stroke: var(--focus); stroke-width: 2.5px; }
.dg .halo { fill: none; stroke: none; }
.dg .node.sel .halo { stroke: var(--halo); stroke-width: 6px; }
.dg .node.sel .box { stroke: var(--accent); stroke-width: 2px; }
.dg .node.mark-added .box { stroke: var(--success); stroke-width: 2.5px; }
.dg .node.mark-removed .box { stroke: var(--danger); stroke-width: 2.5px; stroke-dasharray: 5 3; }
.dg .node.mark-removed .nl { text-decoration: line-through; }
.dg .node.mark-changed .box { stroke: var(--warning); stroke-width: 2.5px; }
.dg .edge.mark-added .line { stroke: var(--success); stroke-width: 2px; }
.dg .edge.mark-removed .line { stroke: var(--danger); stroke-width: 2px; }
.dg .node.stub .box { fill: var(--bg-sunken); stroke: var(--border-strong); stroke-dasharray: 3 3; }
.dg .node.stub .nl { fill: var(--accent); }
.dg .edge.cross { display: none; }
.dg.show-cross .edge.cross { display: inline; opacity: 0.45; }
.dg.dim .edge.cross.hi { display: inline; opacity: 1; }
.dg .elabel.cross:not(.hi), .dg .pcount.cross { display: none !important; }
.dg.show-cross .pcount.cross { display: inline !important; }
.dg .edge.ek-stub .line { stroke-dasharray: 2 3; }
.dg .node.portal { cursor: pointer; }
.dg .node.portal .box { fill: var(--bg-sunken); stroke: var(--accent); stroke-dasharray: 5 3; }
.dg .node.portal .nl { fill: var(--accent); font-weight: var(--fw-semibold); }
.dg .node.portal .nk.pk { display: inline; fill: var(--fg-2); }
.dg.z-far .node.portal .nl, .dg.z-far .node.portal .nk.pk { display: inline; }
.dg .edge.ek-portal .line { stroke: var(--accent); stroke-dasharray: 3 3; stroke-width: 1px; opacity: 0.35; }
.dg.many-portal-lines .edge.ek-portal { display: none; }
.dg.many-portal-lines.dim .edge.ek-portal.hi { display: inline; }
.rows a .swatch, .rail a .swatch { margin-right: 4px; }
.dg.dim .edge.ek-portal.hi .line { opacity: 1; stroke: var(--accent); }
.dg .nnote { font-size: 11px; fill: var(--fg-3); }
.dg.z-far .nnote { display: none; }
.dg .node.focus-node .box { stroke-width: 2.5px; }
.dg.dim .node:not(.hi), .dg.dim .edge:not(.hi), .dg.dim .elabel:not(.hi) { opacity: var(--dim-opacity); }
.dg.dim .edge.hi .line { stroke: var(--fg-2); stroke-width: var(--edge-width-hi); }
.dg.dim .edge.hi .ahp, .dg .ahp.hi { fill: var(--fg-2); }
.dg .elabel { display: none; }
.dg.z-near .elabel, .dg .elabel.hi, .dg.summary .elabel { display: inline; }
.dg.summary .elabel { font-weight: var(--fw-semibold); fill: var(--fg); }
.dg .nk, .dg .fb text { display: none; }
.dg.z-near .nk, .dg.z-near .fb text { display: inline; }
.dg.z-far .nl, .dg.z-far .nk, .dg.z-far .elabel, .dg.z-far .pcount { display: none; }
.dg.z-far .edge .line { stroke-width: 0.75px; }
.dg .fb { display: none; }
.dg.z-near .fb, .dg.z-mid .fb { display: inline; }
.dg.z-far .fb.error, .dg.z-far .fb.warning { display: inline; }
/* zone tints, by fixed order; the seventh zone on reuses the hues with a hatch */
.dg .t1 .box, .swatch.t1 { fill: var(--z1-fill); stroke: var(--z1); background: var(--z1-fill); border-color: var(--z1); --zb: var(--z1); --zb-fill: var(--z1-fill); }
.dg .t2 .box, .swatch.t2 { fill: var(--z2-fill); stroke: var(--z2); background: var(--z2-fill); border-color: var(--z2); --zb: var(--z2); --zb-fill: var(--z2-fill); }
.dg .t3 .box, .swatch.t3 { fill: var(--z3-fill); stroke: var(--z3); background: var(--z3-fill); border-color: var(--z3); --zb: var(--z3); --zb-fill: var(--z3-fill); }
.dg .t4 .box, .swatch.t4 { fill: var(--z4-fill); stroke: var(--z4); background: var(--z4-fill); border-color: var(--z4); --zb: var(--z4); --zb-fill: var(--z4-fill); }
.dg .t5 .box, .swatch.t5 { fill: var(--z5-fill); stroke: var(--z5); background: var(--z5-fill); border-color: var(--z5); --zb: var(--z5); --zb-fill: var(--z5-fill); }
.dg .t6 .box, .swatch.t6 { fill: var(--z6-fill); stroke: var(--z6); background: var(--z6-fill); border-color: var(--z6); --zb: var(--z6); --zb-fill: var(--z6-fill); }
.dg g.band-g.t1 { --zb: var(--z1); --zb-fill: var(--z1-fill); } .dg g.band-g.t2 { --zb: var(--z2); --zb-fill: var(--z2-fill); }
.dg g.band-g.t3 { --zb: var(--z3); --zb-fill: var(--z3-fill); } .dg g.band-g.t4 { --zb: var(--z4); --zb-fill: var(--z4-fill); }
.dg g.band-g.t5 { --zb: var(--z5); --zb-fill: var(--z5-fill); } .dg g.band-g.t6 { --zb: var(--z6); --zb-fill: var(--z6-fill); }
.dg .hatch .box { fill: url(#de-hatch); }
.dg .hatch-line { stroke: var(--fg-3); stroke-width: 1px; opacity: 0.35; }
/* lenses */
.dg .l-err .box, .swatch.l-err { fill: var(--danger-muted); stroke: var(--danger); background: var(--danger-muted); border-color: var(--danger); }
.dg .l-warn .box, .swatch.l-warn { fill: var(--warning-muted); stroke: var(--warning); background: var(--warning-muted); border-color: var(--warning); }
.dg .l-ok .box, .swatch.l-ok { fill: var(--bg-surface); stroke: var(--border-strong); background: var(--bg-surface); border-color: var(--border-strong); }
.dg .l-done .box, .swatch.l-done { fill: var(--success-muted); stroke: var(--success); background: var(--success-muted); border-color: var(--success); }
.dg .l-doing .box, .swatch.l-doing, .dg .l-ready .box, .swatch.l-ready { fill: var(--accent-muted); stroke: var(--accent); background: var(--accent-muted); border-color: var(--accent); }
.dg .l-ready .box { stroke-dasharray: 5 2; }
.dg .l-blocked .box, .swatch.l-blocked { fill: var(--warning-muted); stroke: var(--warning); background: var(--warning-muted); border-color: var(--warning); }
.dg .l-f0 .box, .swatch.l-f0 { fill: var(--bg-surface); stroke: var(--border-strong); background: var(--bg-surface); border-color: var(--border-strong); }
.dg .l-f1 .box, .swatch.l-f1 { fill: color-mix(in srgb, var(--accent) 14%, var(--bg-surface)); stroke: var(--accent); background: color-mix(in srgb, var(--accent) 14%, var(--bg-surface)); border-color: var(--accent); }
.dg .l-f2 .box, .swatch.l-f2 { fill: color-mix(in srgb, var(--accent) 32%, var(--bg-surface)); stroke: var(--accent); background: color-mix(in srgb, var(--accent) 32%, var(--bg-surface)); border-color: var(--accent); }
.dg .l-f3 .box, .swatch.l-f3 { fill: color-mix(in srgb, var(--accent) 55%, var(--bg-surface)); stroke: var(--accent); background: color-mix(in srgb, var(--accent) 55%, var(--bg-surface)); border-color: var(--accent); }
.dg .l-o1 .box, .swatch.l-o1 { fill: var(--z1-fill); stroke: var(--z1); background: var(--z1-fill); border-color: var(--z1); }
.dg .l-o2 .box, .swatch.l-o2 { fill: var(--z2-fill); stroke: var(--z2); background: var(--z2-fill); border-color: var(--z2); }
.dg .l-o3 .box, .swatch.l-o3 { fill: var(--z3-fill); stroke: var(--z3); background: var(--z3-fill); border-color: var(--z3); }
.dg .l-o4 .box, .swatch.l-o4 { fill: var(--z4-fill); stroke: var(--z4); background: var(--z4-fill); border-color: var(--z4); }
.dg .l-o5 .box, .swatch.l-o5 { fill: var(--z5-fill); stroke: var(--z5); background: var(--z5-fill); border-color: var(--z5); }
.dg .l-o0 .box, .swatch.l-o0 { fill: var(--z0-fill); stroke: var(--z0); background: var(--z0-fill); border-color: var(--z0); }
.dg.lens .l-f3 .nl { fill: var(--fg); }
/* flow: handoffs between teams, the owner team's line, badges on boxes, the Flow lens (fill by wait) */
.dg .ek-handoff .line { stroke: var(--z6); stroke-width: 2.4px; }
.dg.dim .edge.ek-handoff.hi .line { stroke: var(--z6); stroke-width: 2.8px; }
.dg .elabel.hop { display: inline; font-size: 10px; font-weight: var(--fw-semibold); fill: color-mix(in srgb, var(--z6) 60%, var(--fg)); }
.dg.z-far .elabel.hop { display: none; }
.dg .nt { font-size: 10.5px; fill: var(--fg-2); font-weight: var(--fw-medium); }
.dg.z-far .nt { display: none; }
.dg [class*="fbadge"] rect { fill: var(--bg-sunken); stroke: var(--border-strong); stroke-width: 1px; }
.dg [class*="fbadge"] text { font-size: 12.5px; fill: var(--fg-2); font-weight: var(--fw-medium); }
.dg .fbadge.s-measured rect { fill: var(--success-muted); stroke: var(--success); }
.dg .fbadge.s-measured text { fill: var(--success); }
.dg .fbadge.s-estimated rect { fill: var(--warning-muted); stroke: var(--warning); }
.dg .fbadge.s-estimated text { fill: var(--warning); }
.dg .fbadge.s-tracker rect { fill: var(--accent-muted); stroke: var(--accent); }
.dg .fbadge.s-tracker text { fill: var(--accent); }
.dg .fbadge.none rect { fill: var(--danger-muted); stroke: var(--danger); }
.dg .fbadge.none text { fill: var(--danger); }
.dg .fbadge.stale rect { stroke-dasharray: 3 2; }
.dg.z-far [class*="fbadge"] { display: none; }
.dg .l-w0 .box, .swatch.l-w0 { fill: var(--bg-surface); stroke: var(--border-strong); background: var(--bg-surface); border-color: var(--border-strong); }
.dg .l-w1 .box, .swatch.l-w1 { fill: color-mix(in srgb, var(--warning) 10%, var(--bg-surface)); stroke: var(--warning); background: color-mix(in srgb, var(--warning) 10%, var(--bg-surface)); border-color: var(--warning); }
.dg .l-w2 .box, .swatch.l-w2 { fill: color-mix(in srgb, var(--warning) 24%, var(--bg-surface)); stroke: var(--warning); background: color-mix(in srgb, var(--warning) 24%, var(--bg-surface)); border-color: var(--warning); }
.dg .l-w3 .box, .swatch.l-w3 { fill: color-mix(in srgb, var(--warning) 42%, var(--bg-surface)); stroke: var(--warning); background: color-mix(in srgb, var(--warning) 42%, var(--bg-surface)); border-color: var(--warning); }
.dg .l-w4 .box, .swatch.l-w4 { fill: color-mix(in srgb, var(--danger) 34%, var(--bg-surface)); stroke: var(--danger); background: color-mix(in srgb, var(--danger) 34%, var(--bg-surface)); border-color: var(--danger); }
.flow-panel { margin-top: var(--sp-4); padding-top: var(--sp-3); border-top: 1px solid var(--border); display: grid; gap: var(--sp-2); }
.flow-panel h3 { font-size: var(--fs-lg); }
.flow-panel .fh { margin-top: var(--sp-3); }
.fstats { display: grid; gap: var(--sp-2); grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
.fstat { border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--bg-surface); padding: var(--sp-2) var(--sp-3); display: grid; gap: 2px; min-width: 0; }
.fstat .l { font-size: var(--fs-xs); color: var(--fg-2); }
.fstat .v { font-size: var(--fs-xl); line-height: var(--lh-xl); font-weight: var(--fw-semibold); font-variant-numeric: tabular-nums; }
.fstat .s { font-size: var(--fs-xs); color: var(--fg-3); }
.fstat.bad { border-color: var(--warning); }
.fstat.bad .v { color: var(--warning); }
.warn-text { color: var(--warning); font-weight: var(--fw-medium); }
.ba { display: grid; gap: var(--sp-3); grid-template-columns: minmax(0, 1fr); }
@media (min-width: 960px) { .ba { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } }
.ba figure { margin: 0; min-width: 0; }
.ba figcaption { font-size: var(--fs-sm); color: var(--fg-2); margin-bottom: 4px; font-weight: var(--fw-medium); }
.ba .frame { border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--bg-surface); overflow: auto; max-height: 420px; }
.ba .frame svg { display: block; }
.ba.merged { grid-template-columns: minmax(0, 1fr) !important; }
.ba.merged .frame { max-height: none; }
.ba.merged .frame svg { margin: 0 auto; }
.seg { display: inline-flex; gap: 2px; }
.seg .btn[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }
.vchg td.n { white-space: nowrap; }
.dg .node.mark-removed .box { fill: var(--bg-sunken); }
.dg .node.mark-removed .nl { fill: var(--fg-2); }
.dg .edge.mark-removed .line { stroke-dasharray: 6 4; }

/* ---------- checks ---------- */
.summary-bar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2) var(--sp-4); margin-bottom: var(--sp-4); }
.summary-bar .st { font-size: var(--fs-lg); }
.pack { margin-top: var(--sp-5); }
.pack-head { display: grid; gap: 2px; margin-bottom: var(--sp-2); }
.pack-head p { color: var(--fg-3); font-size: var(--fs-sm); max-width: 80ch; }
.rule { border-top: 1px solid var(--border); }
.rule > summary { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 4px var(--sp-3); min-height: 44px; padding: 8px 0; }
.rule > summary .rt { font-weight: var(--fw-medium); overflow-wrap: anywhere; }
.rule > summary .rmeta { display: flex; gap: 6px; align-items: center; justify-content: flex-end; flex-wrap: wrap; }
.rule > summary .chev { width: 7px; height: 7px; border-right: 1.5px solid var(--fg-3); border-bottom: 1.5px solid var(--fg-3); transform: rotate(-45deg); transition: transform var(--t-panel) var(--ease-in); margin: 0 4px; }
.rule[open] > summary .chev { transform: rotate(45deg); }
.rule .rbody { padding: 0 0 var(--sp-4) 26px; display: grid; gap: var(--sp-3); }
details.how { font-size: var(--fs-sm); } details.how > summary { cursor: pointer; color: var(--fg2); width: fit-content; } details.how > summary:hover { color: var(--fg); } details.how p { margin: 4px 0 0; } details.how code { font-size: 12px; }
.rule .why { color: var(--fg-2); max-width: 72ch; }
.subjects { display: flex; flex-wrap: wrap; gap: 6px 14px; list-style: none; }
.subjects li { max-width: 100%; overflow-wrap: anywhere; }
.subjects.long { display: grid; gap: 6px; }
.subjects .diff { color: var(--fg-2); }
.subjects li.pinned { font-weight: var(--fw-medium); }
.rule.passing .rt { color: var(--fg-2); }
.page.hide-passing .rule.passing { display: none; }
@media (max-width: 719px) { .rule > summary { grid-template-columns: auto minmax(0, 1fr); } .rule > summary .rmeta { grid-column: 2; justify-content: flex-start; } .rule .rbody { padding-left: 0; } }

/* ---------- changes ---------- */
.changes-layout { display: grid; gap: var(--sp-5); grid-template-columns: minmax(0, 1fr); }
@media (min-width: 960px) { .changes-layout { grid-template-columns: 320px minmax(0, 1fr); } }
.patch-list { padding: 0; overflow: hidden; }
.patch-list .list-row { grid-template-columns: auto minmax(0, 1fr); }
.patch-list .list-row[aria-current="true"] { background: var(--accent-muted); }
.patch { min-width: 0; }
.patch-head { display: grid; gap: 6px; margin-bottom: var(--sp-3); }
.patch-head h2 { overflow-wrap: anywhere; }
.patch-head .tags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.proposer { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; font-size: var(--fs-md); margin-bottom: 2px; }
.proposer .pb-l { color: var(--fg-3); font-size: var(--fs-sm); }
.proposer .pb-who b { font-weight: var(--fw-semibold); }
.prov { font-size: var(--fs-sm); color: var(--fg-2); display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; margin-bottom: var(--sp-3); }
.verdict { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; font-size: var(--fs-lg); line-height: var(--lh-lg); margin: var(--sp-3) 0 var(--sp-4); padding: var(--sp-3) var(--sp-4); border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--bg-surface); font-variant-numeric: tabular-nums; }
.verdict .lead { font-size: var(--fs-xl); line-height: var(--lh-xl); font-weight: var(--fw-semibold); letter-spacing: var(--tracking-tight); }
.verdict .lead.fail { color: var(--danger); }
.verdict .lead.pass { color: var(--success); }
.verdict .lead.warning { color: var(--warning); }
.verdict-why { margin: calc(-1 * var(--sp-2)) 0 var(--sp-4); gap: 4px; }
.verdict-why li { display: flex; flex-wrap: nowrap; gap: 6px; align-items: baseline; }
.verdict-why li > .icon { flex: none; position: relative; top: 2px; }
.verdict-why li > span { flex: 1; min-width: 0; }
.verdict .tok { color: var(--fg-2); white-space: nowrap; }
.verdict .tok.warn { color: var(--warning); }
.claim { display: grid; gap: var(--sp-4); grid-template-columns: minmax(0, 1fr); }
@media (min-width: 960px) { .claim { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } }
.claim h3, .patch h3 { font-size: var(--fs-md); margin-bottom: 6px; }
.ops { list-style: none; display: grid; gap: 4px; font-size: var(--fs-sm); }
.ops li { overflow-wrap: anywhere; }
.sym { display: inline-block; width: 1.2em; font-family: var(--font-mono); color: var(--fg-3); }
.sym.add { color: var(--success); } .sym.rem { color: var(--danger); } .sym.mod { color: var(--warning); }
.problems h3 { color: var(--danger); }
.rows > li.problem, .problem { padding: var(--sp-3); border: 1px solid var(--danger); border-left-width: 3px; border-radius: var(--radius-md); background: var(--bg-surface); display: grid; gap: 4px; }
.diffgroup > summary .count { color: var(--fg-3); font-weight: var(--fw-regular); }
.fieldchg { font-size: var(--fs-sm); display: grid; gap: 2px; }
.fieldchg .b { color: var(--fg-3); }
.howto { font-size: var(--fs-sm); color: var(--fg-3); border-top: 1px solid var(--border); padding-top: var(--sp-3); margin-top: var(--sp-5); display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.review { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2); margin-top: var(--sp-4); }
.patch-sec { margin-top: var(--sp-5); }

/* ---------- tracker ---------- */
.stepper { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--sp-2); list-style: none; margin-bottom: var(--sp-5); }
.stepper a { display: grid; gap: 2px; padding: var(--sp-3); border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--bg-surface); color: var(--fg); text-decoration: none; min-width: 0; height: 100%; }
.stepper a:hover { border-color: var(--border-strong); }
.stepper a[aria-current="step"] { border-color: var(--accent); box-shadow: inset 0 -3px 0 var(--accent); }
.stepper .n { font-size: var(--fs-xs); color: var(--fg-3); }
.stepper .s { font-size: var(--fs-xs); color: var(--fg-2); overflow-wrap: anywhere; }
@media (max-width: 719px) { .stepper { grid-template-columns: minmax(0, 1fr); } }
.match { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; padding: var(--sp-3) 0; border-bottom: 1px solid var(--border); }
@media (min-width: 960px) { .match { grid-template-columns: minmax(0, 1fr) 200px minmax(0, 1fr); align-items: start; } }
.match .mid { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.match .acts { display: flex; flex-wrap: wrap; gap: 6px; grid-column: 1 / -1; }
.inv-table td.used { box-shadow: inset 3px 0 0 var(--accent); }
.inv-table tr.unused td { color: var(--fg-3); }
.mapline { padding: 8px 0; border-bottom: 1px solid var(--border); display: grid; gap: 4px; }
.mapline b { font-weight: var(--fw-semibold); }

/* ---------- overlays ---------- */
dialog { border: 1px solid var(--border-strong); border-radius: var(--radius-lg); background: var(--bg-surface); color: var(--fg); box-shadow: var(--shadow-pop); padding: 0; max-width: min(640px, calc(100vw - 24px)); width: 100%; }
dialog::backdrop { background: var(--scrim); }
.palette { margin-top: 10vh; }
.palette .pin { display: flex; align-items: center; gap: var(--sp-2); padding: var(--sp-3); border-bottom: 1px solid var(--border); }
.palette input { flex: 1; min-width: 0; height: 36px; border: 0; background: transparent; font-size: var(--fs-lg); outline: none; }
.palette .res { max-height: 60vh; overflow: auto; padding: var(--sp-2); }
.palette .grp { font-size: var(--fs-xs); color: var(--fg-3); padding: 8px 8px 2px; }
.palette [role="option"] { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 8px; padding: 6px 8px; border-radius: var(--radius-sm); cursor: pointer; }
.palette [role="option"] .sub { grid-column: 1 / -1; font-size: var(--fs-xs); color: var(--fg-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.palette [role="option"][aria-selected="true"] { background: var(--accent-muted); }
.palette .hint { padding: var(--sp-2) var(--sp-3); border-top: 1px solid var(--border); font-size: var(--fs-xs); color: var(--fg-3); display: flex; flex-wrap: wrap; gap: 4px 12px; }
.sheet { margin: auto 0 0 0; max-width: 100vw; width: 100vw; border-radius: var(--radius-lg) var(--radius-lg) 0 0; max-height: 80vh; }
@media (min-width: 720px) { .sheet { margin: 10vh auto auto; width: 480px; border-radius: var(--radius-lg); } }
.sheet .sh-head { display: flex; justify-content: space-between; align-items: center; padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--border); }
.sheet .sh-body { padding: var(--sp-2) var(--sp-4) var(--sp-4); overflow: auto; max-height: calc(80vh - 56px); }
.sheet .sh-body .nav-sheet a { display: flex; justify-content: space-between; padding: 10px 4px; border-bottom: 1px solid var(--border); color: var(--fg); }
.help dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px var(--sp-4); font-size: var(--fs-sm); padding: 0 var(--sp-4) var(--sp-4); margin: 0; }
.help h3 { padding: var(--sp-3) var(--sp-4) 4px; font-size: var(--fs-sm); color: var(--fg-2); }
.help.cheat { width: min(980px, calc(100vw - 2 * var(--gutter))); max-width: none; max-height: calc(100vh - 32px); }
.help.cheat .sh-head { display: flex; align-items: center; gap: var(--sp-2); padding: 10px 16px; border-bottom: 1px solid var(--border); }
.help.cheat .sh-head h2 { font-size: var(--fs-lg); }
.help.cheat .grow { flex: 1; }
.cheat-cols { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 0 var(--sp-4); padding-bottom: var(--sp-2); }
@media (max-width: 719px) { .cheat-cols { grid-template-columns: minmax(0, 1fr); } }
.help.cheat dl { gap: 5px var(--sp-3); padding-bottom: var(--sp-2); }
.help.cheat dl.moves dt { font-weight: var(--fw-medium); white-space: nowrap; }
.toast { position: fixed; left: var(--gutter); bottom: var(--gutter); z-index: 60; max-width: min(420px, calc(100vw - 2 * var(--gutter))); padding: 10px 12px; border-radius: var(--radius-md); background: var(--fg); color: var(--bg-surface); box-shadow: var(--shadow-pop); font-size: var(--fs-sm); display: flex; gap: 10px; align-items: center; transition: opacity var(--t-panel) var(--ease-in), transform var(--t-panel) var(--ease-in); }
.toast a { color: inherit; text-decoration: underline; white-space: nowrap; font-weight: var(--fw-medium); }
.toast button { border: 0; background: transparent; color: inherit; cursor: pointer; min-width: 24px; min-height: 24px; }
.chooser { position: absolute; z-index: 5; background: var(--bg-surface); border: 1px solid var(--border-strong); border-radius: var(--radius-md); box-shadow: var(--shadow-pop); padding: 4px; max-width: 280px; }
.chooser button { display: block; width: 100%; text-align: left; border: 0; background: transparent; padding: 6px 8px; border-radius: var(--radius-sm); cursor: pointer; font-size: var(--fs-sm); }
.chooser button:focus-visible, .chooser button:hover { background: var(--accent-muted); outline: none; }
.popover { position: absolute; z-index: 45; width: min(320px, calc(100vw - 24px)); padding: var(--sp-3); background: var(--bg-surface); border: 1px solid var(--border-strong); border-radius: var(--radius-md); box-shadow: var(--shadow-pop); font-size: var(--fs-sm); }
.tip { position: fixed; z-index: 70; pointer-events: none; max-width: 280px; padding: 6px 8px; border-radius: var(--radius-sm); background: var(--fg); color: var(--bg-surface); font-size: var(--fs-xs); }

/* ---------- tour ---------- */
.caption { position: fixed; left: 0; right: 0; bottom: 0; z-index: 50; background: var(--bg-surface); border-top: 1px solid var(--border-strong); box-shadow: var(--shadow-pop); }
.caption .inner { max-width: var(--content-max); margin: 0 auto; padding: var(--sp-3) var(--gutter); display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--sp-2) var(--sp-4); align-items: center; }
.caption .step { font-size: var(--fs-xs); color: var(--fg-3); font-variant-numeric: tabular-nums; }
.caption h2 { font-size: var(--fs-lg); line-height: var(--lh-lg); font-weight: var(--fw-medium); }
.caption p { font-size: var(--fs-md); color: var(--fg-2); max-width: 90ch; }
.caption .acts { display: flex; gap: 6px; }
@media (max-width: 719px) { .caption .inner { grid-template-columns: minmax(0, 1fr); } .caption p { font-size: var(--fs-sm); } }
html.presenting .app-nav, html.presenting .statebar, html.presenting .filters, html.presenting .toolbar .opt, html.presenting .rail, html.presenting .views-btn, html.presenting .canvas-help, html.presenting .search-btn, html.presenting .present-btn { display: none !important; }
/* Learn the interface teaches the furniture, so the nav and the chip bar stay */
html.presenting.learning .app-nav { display: block !important; }
html.presenting.learning .search-btn, html.presenting.learning .present-btn { display: inline-flex !important; }
html.presenting.learning .statebar { display: block !important; }
.learn-spot { outline: 3px solid var(--accent); outline-offset: 3px; border-radius: var(--radius-sm); }
@media (prefers-reduced-motion: no-preference) { .learn-spot { animation: learn-pulse 1.6s ease-out 2; } @keyframes learn-pulse { 0% { outline-color: var(--accent); } 50% { outline-color: transparent; } 100% { outline-color: var(--accent); } } }
html.presenting body { font-size: var(--fs-lg); line-height: var(--lh-lg); padding-bottom: var(--caption-h, 160px); }
html.presenting .page { padding-top: var(--sp-4); }
html.presenting h1 { font-size: var(--fs-3xl); line-height: var(--lh-3xl); }
html.presenting .model-layout { grid-template-columns: minmax(0, 1fr); }
html.presenting:not(.tour-inspect) .inspector-col { display: none; }
@media (min-width: 1200px) { html.presenting.tour-inspect .model-layout { grid-template-columns: minmax(0, 1fr) 340px; } }

@media (forced-colors: active) {
  .dg .node .box, .swatch { fill: Canvas; stroke: CanvasText; forced-color-adjust: none; }
  .dg .nl, .dg .nk, .dg .band-label { fill: CanvasText; }
  .dg .edge .line { stroke: CanvasText; }
  .dg .ahp { fill: CanvasText; }
  .dg .node.sel .box { stroke: Highlight; }
  .dg .band { fill: Canvas; }
  .road .seg > span, .bar > span { background: Highlight; forced-color-adjust: none; }
}
/* ---------- premises: grades ---------- */
.st.g-evidence, .st-g-evidence { color: var(--success); }
.st.g-inference, .st-g-inference { color: var(--accent); }
.st.g-judgment, .st-g-judgment { color: var(--fg-2); }
.st.g-untested, .st-g-untested { color: var(--warning); }
.claim-list .list-row { grid-template-columns: 112px minmax(0, 1fr) auto; }
.claim-list .list-row .st { align-self: start; padding-top: 2px; }
.claim-list .list-row[aria-current="true"] { background: var(--accent-muted); }
.claim-ref { display: inline; }
.claim-ref .icon { vertical-align: -3px; margin-right: 4px; }
@media (max-width: 719px) { .claim-list .list-row { grid-template-columns: minmax(0, 1fr) auto; } .claim-list .list-row .st { grid-column: 1 / -1; } }

/* ---------- notes ---------- */
.btn.sm { min-height: 28px; padding: 0 var(--sp-2); font-size: var(--fs-xs); }
.note-list { list-style: none; display: grid; gap: var(--sp-3); }
.note-list.compact { gap: var(--sp-2); margin-bottom: var(--sp-2); }
.note-card { background: var(--bg-surface); border: 1px solid var(--border); border-left: 3px solid var(--border-strong); border-radius: 0 var(--radius-md) var(--radius-md) 0; padding: var(--sp-3); display: grid; gap: 6px; min-width: 0; }
.note-card.open.q { border-left-color: var(--warning); }
.note-card.answered { border-left-color: var(--accent); }
.note-card.resolved { border-left-color: var(--success); opacity: 0.85; }
.note-card.sel { box-shadow: 0 0 0 2px var(--accent); }
.note-head { display: flex; flex-wrap: wrap; gap: 4px var(--sp-2); align-items: center; font-size: var(--fs-sm); }
.note-head .id { margin-left: auto; }
.note-on { color: var(--fg-2); min-width: 0; overflow-wrap: anywhere; }
.note-text { font-size: var(--fs-md); line-height: var(--lh-md); white-space: pre-wrap; overflow-wrap: anywhere; max-width: 72ch; }
.note-answer { border-left: 2px solid var(--accent); padding: 2px 0 2px var(--sp-3); }
.note-answer p { white-space: pre-wrap; overflow-wrap: anywhere; max-width: 72ch; }
.note-acts { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.note-form { display: grid; gap: var(--sp-2); margin-top: var(--sp-2); }
.note-form textarea { width: 100%; min-height: 72px; padding: 8px; border: 1px solid var(--border-control); border-radius: var(--radius-md); background: var(--bg-surface); color: var(--fg); font: inherit; font-size: var(--fs-sm); resize: vertical; }
.note-form.inline { border-top: 1px solid var(--border); padding-top: var(--sp-2); }
.seg-radio { display: flex; gap: var(--sp-3); border: 0; padding: 0; margin: 0; font-size: var(--fs-sm); }
.seg-radio label { display: inline-flex; gap: 4px; align-items: center; }
.notes-block { margin-top: var(--sp-4); }
.notes-block > h3 { font-size: var(--fs-sm); line-height: var(--lh-sm); color: var(--fg-2); font-weight: var(--fw-semibold); margin-bottom: 6px; display: flex; gap: 6px; align-items: baseline; }
.notes-block > h3 .count { color: var(--fg-3); font-weight: var(--fw-regular); }
.note-add > summary { font-size: var(--fs-sm); color: var(--accent); }
.slot:empty { display: none; }
.rule .slot, .patch .slot { margin-top: var(--sp-3); }

/* ---------- since you last looked ---------- */
.since { background: var(--bg-surface); border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 0 var(--radius-lg) var(--radius-lg) 0; padding: var(--sp-4); margin-bottom: var(--sp-5); }
.since-head { display: flex; justify-content: space-between; align-items: center; gap: var(--sp-3); }
.since-head h2 { font-size: var(--fs-lg); line-height: var(--lh-lg); }
.since-lead { font-size: var(--fs-lg); line-height: var(--lh-lg); margin: 4px 0 var(--sp-3); max-width: 68ch; }
.since-grid { display: grid; gap: var(--sp-3) var(--sp-5); grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
.since-g h3 { color: var(--fg-2); font-weight: var(--fw-semibold); margin-bottom: 2px; }
.since-g h3 .count { color: var(--fg-3); font-weight: var(--fw-regular); }
.since-g .rows > li { min-height: 28px; padding: 4px 0; font-size: var(--fs-sm); }
.cmp h3 { font-size: var(--fs-lg); }

.cmp td.n, .cmp th.n { text-align: right; }

/* ---------- present mode: one slide at a time, sized for a 1440 x 900 screen share ---------- */
html.deck-on, html.deck-on body { overflow: hidden; }
html.deck-on .app-header, html.deck-on .app-nav, html.deck-on .statebar, html.deck-on main, html.deck-on .skip, html.deck-on .toast { display: none !important; }
.deck { --d: min(1vw, 1.6vh); position: fixed; inset: 0; z-index: 40; background: var(--bg); color: var(--fg); display: flex; flex-direction: column; }
.deck[hidden] { display: none; }
.deck-stage { flex: 1; min-height: 0; display: flex; align-items: stretch; justify-content: center; padding: calc(var(--d) * 3.2) calc(var(--d) * 5) calc(var(--d) * 1.6); }
html.presenting .deck-stage { padding-bottom: var(--caption-h, 160px); }
.slide { width: 100%; max-width: calc(var(--d) * 96); display: flex; flex-direction: column; min-height: 0; }
.slide[hidden] { display: none; }
.slide-body { flex: 1; min-height: 0; overflow: auto; }
.slide h2 { font-size: calc(var(--d) * 3.1); line-height: 1.15; font-weight: var(--fw-semibold); letter-spacing: var(--tracking-tighter, -0.019em); outline: none; }
.slide .kicker { font-size: max(14px, calc(var(--d) * 1.15)); color: var(--fg-3); margin-bottom: calc(var(--d) * 0.5); }
.slide header { border-bottom: 1px solid var(--border); padding-bottom: calc(var(--d) * 1.2); margin-bottom: calc(var(--d) * 1.6); }
.slide .lead { font-size: calc(var(--d) * 1.75); line-height: 1.4; color: var(--fg); max-width: 62ch; margin-bottom: calc(var(--d) * 1.8); }
.slide .thesis { font-size: calc(var(--d) * 2); line-height: 1.35; font-weight: var(--fw-medium); border-left: 4px solid var(--accent); padding: calc(var(--d) * 0.4) 0 calc(var(--d) * 0.4) calc(var(--d) * 1.4); margin: 0 0 calc(var(--d) * 1.6); max-width: calc(var(--d) * 70); }
.slide .items { list-style: none; padding: 0; margin: 0; display: grid; gap: calc(var(--d) * 1.05); }
.slide .items > li { display: grid; grid-template-columns: calc(var(--d) * 2.2) minmax(0, 1fr); align-items: start; gap: calc(var(--d) * 0.6); }
.slide .items .mk { display: inline-flex; padding-top: calc(var(--d) * 0.3); }
.slide .items .mk .icon { width: calc(var(--d) * 1.6); height: calc(var(--d) * 1.6); }
.slide .items .mk.dot::before { content: ""; width: calc(var(--d) * 0.7); height: calc(var(--d) * 0.7); border-radius: 50%; background: var(--accent); margin: calc(var(--d) * 0.55) 0 0 calc(var(--d) * 0.45); }
.slide .items .t { font-size: calc(var(--d) * 1.6); line-height: 1.38; }
.slide .items .s { font-size: max(14px, calc(var(--d) * 1.15)); line-height: 1.4; color: var(--fg-2); margin-top: 2px; font-variant-numeric: tabular-nums; }
.slide .items.numbered { counter-reset: dn; }
.slide .items.numbered > li { counter-increment: dn; }
.slide .items.numbered .mk.dot::before { content: counter(dn); width: calc(var(--d) * 1.9); height: calc(var(--d) * 1.9); border-radius: 50%; background: var(--accent-muted); color: var(--accent); font-size: max(14px, calc(var(--d) * 1.1)); font-weight: var(--fw-semibold); display: inline-flex; align-items: center; justify-content: center; margin: 0; }
.slide .items .tone-fail .t, .slide .items .tone-warning .t { font-weight: var(--fw-medium); }
.st-info { color: var(--accent); }
.slide .cover { height: 100%; display: flex; flex-direction: column; justify-content: center; max-width: calc(var(--d) * 80); }
.slide .cover h2 { font-size: calc(var(--d) * 4.6); line-height: 1.08; }
.slide .cover .kicker { font-size: calc(var(--d) * 1.5); margin-bottom: calc(var(--d) * 1.2); }
.slide .cover .sub { font-size: calc(var(--d) * 2); line-height: 1.4; color: var(--fg-2); margin-top: calc(var(--d) * 1.6); max-width: 46ch; }
.deck-table { overflow-x: auto; margin-bottom: calc(var(--d) * 1.6); }
.deck-table table { width: 100%; border-collapse: collapse; font-size: calc(var(--d) * 1.35); font-variant-numeric: tabular-nums; }
.deck-table th, .deck-table td { padding: calc(var(--d) * 0.7) calc(var(--d) * 0.9); border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
.deck-table thead th { position: static; background: transparent; font-size: max(14px, calc(var(--d) * 1.05)); color: var(--fg-3); font-weight: var(--fw-medium); border-bottom-color: var(--border-strong); }
.deck-table .n { text-align: right; white-space: nowrap; }
.deck-table tbody tr:hover { background: transparent; }
.deck-table tbody tr:last-child td, .deck-table tbody tr:last-child th { border-bottom: 1px solid var(--border); }
.deck-table tbody th { font-weight: var(--fw-medium); }
.deck-table tbody th .icon { width: calc(var(--d) * 1.25); height: calc(var(--d) * 1.25); vertical-align: -0.15em; }
.deck-table tr.tone-warning td:last-child { color: var(--warning); font-weight: var(--fw-semibold); }
.slide .asof { display: flex; gap: calc(var(--d) * 0.6); align-items: center; font-size: max(14px, calc(var(--d) * 1.15)); color: var(--fg-2); margin-top: calc(var(--d) * 0.4); }
.slide .asof .icon { width: calc(var(--d) * 1.2); height: calc(var(--d) * 1.2); color: var(--fg-3); flex: none; }
.deck-bar { flex: none; display: flex; align-items: center; gap: var(--sp-4); padding: calc(var(--d) * 0.7) calc(var(--d) * 5); border-top: 1px solid var(--border); font-size: max(14px, calc(var(--d) * 1)); color: var(--fg-3); }
.deck-bar .deck-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.deck-bar .deck-count { font-variant-numeric: tabular-nums; color: var(--fg-2); font-weight: var(--fw-medium); }
.deck-bar .deck-acts { display: flex; align-items: center; gap: var(--sp-3); }
.deck-end { flex: 1; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: var(--sp-3); padding: 0 calc(var(--d) * 5); }
.deck-end h2 { font-size: calc(var(--d) * 2.4); margin: 0; }
.deck-end p { font-size: max(14px, calc(var(--d) * 1.15)); color: var(--fg-2); margin: 0; }
.slide .steps li.more { display: block; padding-left: calc(var(--d) * 2.2); color: var(--fg-3); font-style: italic; }
html.presenting .deck-bar { display: none; }
.slide .notes { display: none; }
.deck-notes { flex: none; max-height: 34vh; overflow: auto; border-top: 2px solid var(--accent); background: var(--bg-surface); padding: var(--sp-3) calc(var(--d) * 5); font-size: var(--fs-lg); line-height: var(--lh-lg); }
.deck-notes[hidden] { display: none; }
.deck-notes h3 { font-size: var(--fs-sm); color: var(--fg-3); font-weight: var(--fw-medium); margin-bottom: 4px; }
.deck-notes ul { margin: 0; padding-left: 1.2em; display: grid; gap: 4px; }
.deck-notes .warn { color: var(--warning); font-size: var(--fs-sm); margin-top: 6px; }

/* ---------- teams ---------- */
.team-table th[scope=row], .roles-table th[scope=row], .waits-matrix th[scope=row] { font-weight: var(--fw-medium); min-width: 180px; }
.team-table td.n, .team-table th.n, .roles-table .n, .waits-matrix .n { text-align: right; white-space: nowrap; }
.team-table tr.warn-row th { color: var(--warning); }
.team-table .tag { margin-left: 6px; }
.waits-matrix td.has { font-weight: var(--fw-semibold); background: var(--accent-muted); color: var(--accent); }
.waits-matrix thead th { white-space: normal; vertical-align: bottom; }
.waits-list > li .t { flex: 1; min-width: 0; }
.waits-list > li .rv { color: var(--fg-2); font-variant-numeric: tabular-nums; }
.waits-list > li .meta { flex-basis: 100%; }
#teams .callout { margin-bottom: var(--sp-3); max-width: 80ch; }
#teams ul.chips { list-style: none; padding: 0; margin: 6px 0 var(--sp-3); }

/* ---------- Tier 1: the chip bar, record cards, the drawer stack ---------- */
.statebar { position: sticky; top: calc(var(--header-h) + var(--nav-h)); z-index: 28; min-height: var(--chip-h); background: var(--bg); border-bottom: 1px solid var(--border); }
.statebar .inner { max-width: var(--content-max); margin: 0 auto; padding: 6px var(--gutter); display: flex; flex-wrap: wrap; align-items: center; gap: 6px var(--sp-2); min-height: var(--chip-h); }
.statebar .grow { flex: 1; }
.statebar .btn.sm, .drawer .btn.sm, .insp-head .btn.sm { min-height: 28px; padding: 0 var(--sp-2); font-size: var(--fs-xs); }
.statebar .add-filter { color: var(--fg-2); }
.fchip-x { display: inline-flex; align-items: stretch; height: 28px; border: 1px solid var(--accent); border-radius: var(--radius-pill); background: var(--accent-muted); color: var(--accent); font-size: var(--fs-xs); overflow: hidden; max-width: 100%; }
.fchip-x .fc { border: 0; background: transparent; color: inherit; padding: 0 4px 0 10px; cursor: pointer; font-weight: var(--fw-medium); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 360px; }
.fchip-x .fx { display: inline-flex; align-items: center; padding: 0 8px 0 4px; color: inherit; }
.fchip-x .fx:hover { background: color-mix(in srgb, var(--accent) 14%, transparent); }
.fchip-x.ignored { border-style: dashed; background: var(--bg-surface); color: var(--fg-3); border-color: var(--border-control); }
.chipbar .not-applied { max-width: 60ch; line-height: 1.35; }
.match-count { font-size: var(--fs-xs); color: var(--fg-2); font-variant-numeric: tabular-nums; white-space: nowrap; }
.statebar .sel-chip { height: 28px; max-width: 34vw; }
.statebar .sel-chip .sel-follow { width: 24px; }
.trail { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 2px 4px; padding: 2px 4px 2px 8px; border-radius: var(--radius-md); background: var(--bg-surface); border: 1px solid var(--border); font-size: var(--fs-sm); max-width: 100%; }
.trail .crumb { padding: 2px 4px; border-radius: var(--radius-sm); }
.trail a.crumb:hover { background: var(--bg-sunken); text-decoration: none; }
.trail .crumb.cur { font-weight: var(--fw-semibold); color: var(--fg); }
.trail .crumb .count { color: var(--fg-3); font-weight: var(--fw-regular); margin-left: 2px; }
.trail .sep { color: var(--fg-3); }
.trail .crumb-x { display: inline-flex; align-items: center; padding: 4px; color: var(--fg-3); border-radius: var(--radius-sm); }
.gpop { position: absolute; z-index: 70; min-width: 240px; width: max-content; max-width: min(420px, calc(100vw - 16px)); max-height: 60vh; overflow: auto; padding: var(--sp-2); background: var(--bg-surface); border: 1px solid var(--border-strong); border-radius: var(--radius-md); box-shadow: var(--shadow-pop); font-size: var(--fs-sm); }
.gpop-h { font-size: var(--fs-xs); color: var(--fg-3); font-weight: var(--fw-medium); padding: 2px 6px 6px; }
.gpop-list { list-style: none; display: grid; }
.gpop-list li { display: flex; align-items: center; }
.gpop-list a, .gpop-list button { flex: 1; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 6px 8px; border: 0; background: transparent; color: var(--fg); border-radius: var(--radius-sm); text-align: left; cursor: pointer; text-decoration: none; font-size: var(--fs-sm); }
.gpop-list button { grid-template-columns: minmax(0, 1fr) auto; }
.gpop-list a[role="menuitem"] { grid-template-columns: minmax(0, 1fr) auto; }
.gpop-list a:hover, .gpop-list button:hover, .gpop-list a:focus-visible, .gpop-list button:focus-visible { background: var(--bg-sunken); text-decoration: none; }
.gpop-list .n { color: var(--fg-3); font-variant-numeric: tabular-nums; }
.gpop-list .zero .v, .gpop-list .zero .n { color: var(--fg-3); }
.gpop-list .tick { width: 14px; height: 14px; border: 1.5px solid var(--border-control); border-radius: 3px; }
.gpop-list [aria-checked="true"] .tick { background: var(--accent); border-color: var(--accent); box-shadow: inset 0 0 0 2px var(--bg-surface); }
.gpop-list .open-zone { flex: none; padding: 4px 8px; font-size: var(--fs-xs); color: var(--accent); }
.ref { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; }
.ref .kind-ic { color: var(--fg-3); }
.ref > span { overflow-wrap: anywhere; }
.inline-ref { display: inline; font-family: var(--font-mono); font-size: 0.92em; padding: 0 2px; border-radius: var(--radius-sm); background: var(--accent-muted); text-decoration: none; }
.inline-ref:hover { text-decoration: underline; }
.inline-ref .kind-ic { display: none; }
.hovercard { position: fixed; z-index: 80; width: 320px; max-width: calc(100vw - 16px); padding: var(--sp-3); background: var(--bg-surface); border: 1px solid var(--border-strong); border-radius: var(--radius-md); box-shadow: var(--shadow-pop); font-size: var(--fs-sm); pointer-events: none; }
.hovercard .ref { display: inline; }
.hovercard .ref .kind-ic { display: none; }
.hovercard .card-fields.compact dd { display: -webkit-box; }
/* a card's context: what the reference does not say (why, waits on, unblocks, questions; a part's units) */
.card-more { display: grid; gap: 4px; margin: var(--sp-2) 0 0; padding-top: var(--sp-2); border-top: 1px solid var(--border); font-size: var(--fs-xs); line-height: var(--lh-sm); }
.card-more > div { display: grid; grid-template-columns: 80px minmax(0, 1fr); gap: 8px; }
.card-more dt { color: var(--fg-3); }
.card-more dd { margin: 0; overflow-wrap: anywhere; }
/* the Tracker's Match step: why a disagreement appears, and how to settle it (src/tracker/settle.ts) */
.settle { display: grid; gap: 4px; margin: 0 0 var(--sp-2); padding: var(--sp-2) var(--sp-3); background: var(--bg-sunken); border-radius: var(--radius-md); font-size: var(--fs-sm); line-height: var(--lh-sm); }
.settle > div { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 8px; }
.settle dt { color: var(--fg-3); }
.settle dd { margin: 0; }
@media (max-width: 559px) { .settle > div { grid-template-columns: minmax(0, 1fr); gap: 0; } }
/* the glossary: a term at its first use, and its definition on hover or focus (client/glossary.js) */
.gl { text-decoration: underline dotted var(--fg-3); text-decoration-thickness: 1px; text-underline-offset: 3px; cursor: help; border-radius: var(--radius-sm); }
.gl:hover, .gl:focus-visible { text-decoration-color: var(--accent); }
.gloss-tip { width: 300px; }
.gloss-tip .card-t { margin: 4px 0 4px; }
.gloss-tip .gloss-def { color: var(--fg-2); line-height: var(--lh-sm); }
.card-head { display: flex; align-items: center; gap: 6px; color: var(--fg-3); font-size: var(--fs-xs); }
.card-head .kind-ic { color: var(--accent); }
.card-head .id { margin-left: auto; }
.card-t { font-weight: var(--fw-semibold); margin: 4px 0 8px; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
h2.card-t { font-size: var(--fs-xl); line-height: var(--lh-xl); -webkit-line-clamp: 4; margin: 6px 0 var(--sp-3); }
.card-title { color: var(--fg); }
.card-title:hover { color: var(--accent); }
.card-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--sp-3) var(--sp-4); margin: 0; }
.card-fields > div { min-width: 0; }
.card-fields dt { color: var(--fg-3); font-size: var(--fs-xs); margin-bottom: 2px; }
.card-fields dd { margin: 0; overflow-wrap: anywhere; display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; }
.card-fields.compact { gap: 6px var(--sp-3); }
.card-fields.compact dd { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.novalue { color: var(--fg-3); font-style: italic; }
.inspector .card-fields { margin: 0 0 var(--sp-2); }
.drawer-layer { position: fixed; inset: 0; z-index: 55; }
.drawer-layer .scrim { position: absolute; inset: 0; background: var(--scrim); }
.drawer { position: absolute; top: 0; right: 0; bottom: 0; width: min(520px, 94vw); display: flex; flex-direction: column; background: var(--bg-surface); border-left: 1px solid var(--border-strong); box-shadow: var(--shadow-pop); transition: transform var(--t-panel) var(--ease-in), filter var(--t-panel) var(--ease-in); }
.drawer.under { filter: brightness(0.94); }
.drawer-bar { display: flex; align-items: center; gap: var(--sp-2); padding: var(--sp-2) var(--sp-3); border-bottom: 1px solid var(--border); }
.drawer-bar .grow { flex: 1; }
.drawer-body { flex: 1; overflow: auto; padding: var(--sp-4); }
.drawer .linked { margin-top: var(--sp-5); }
.drawer .linked > h3 { font-size: var(--fs-sm); color: var(--fg-2); margin-bottom: 4px; }
.linked-g > summary { justify-content: flex-start; border-bottom: 1px solid var(--border); }
.linked-g > summary .count { margin-left: auto; color: var(--fg-2); font-variant-numeric: tabular-nums; }
.linked-g > .body { padding: 4px 0 var(--sp-2) 22px; }
html.drawer-open { overflow: hidden; }
.f-out { opacity: 0.22; }
.dg .node.f-out .box { stroke-dasharray: 3 2; }
tr.f-out, li.f-out { opacity: 0.35; }
.filter-line { color: var(--accent); }
.units-table .why { display: block; margin-top: 2px; font-size: var(--fs-xs); color: var(--fg-2); font-weight: 400; overflow-wrap: anywhere; }
.units-table .why code { font-size: inherit; }
.units-table .why a { color: var(--fg); }
.rail .zone-sw { width: 10px; height: 10px; border-radius: 2px; flex: none; margin-right: 6px; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .drawer.under { filter: brightness(0.8); } }
:root[data-theme="dark"] .drawer.under { filter: brightness(0.8); }

/* status: red, amber, green, each with an icon and a word */
.st.rag-red, .st-rag-red { color: var(--danger); }
.st.rag-amber, .st-rag-amber { color: var(--warning); }
.st.rag-green, .st-rag-green { color: var(--success); }
.tile .big .st.rag-red, .tile .big .st.rag-amber, .tile .big .st.rag-green { font-size: inherit; }
.road .cnt .st { font-size: var(--fs-xs); gap: 4px; }
.road .cnt .st .icon { width: 13px; height: 13px; }
.road li.rag-red .seg { border-color: var(--danger); }
.road li.rag-amber .seg { border-color: var(--warning); }
.status-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 10px; margin: 0 0 var(--sp-2); font-size: var(--fs-lg); line-height: var(--lh-lg); max-width: 68ch; }
.status-line .st { font-size: var(--fs-lg); }
.status-block { margin: var(--sp-2) 0 var(--sp-4); padding: var(--sp-3) var(--sp-4); border-radius: var(--radius-md); background: var(--bg-sunken); }
.status-block[data-status="red"] { box-shadow: inset 3px 0 0 var(--danger); }
.status-block[data-status="amber"] { box-shadow: inset 3px 0 0 var(--warning); }
.status-block[data-status="green"] { box-shadow: inset 3px 0 0 var(--success); }
.status-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 6px; }
.status-block .override { margin: 0 0 6px; color: var(--fg-2); }
.ovr-flag { display: flex; gap: 6px; align-items: flex-start; margin: 0 0 6px; padding: 4px 8px; border-radius: var(--radius-sm); background: var(--warning-muted); color: var(--fg); }
.ovr-flag .icon { color: var(--warning); margin-top: 2px; flex: none; }
[data-by-hand] { margin-top: var(--sp-3); }
[data-by-hand] code { overflow-wrap: anywhere; }
.ms-flag { display: block; margin-top: 2px; color: var(--warning); font-size: var(--fs-xs); line-height: var(--lh-xs); }
.hist { margin: var(--sp-5) 0; }
.hist-table th, .hist-table td { vertical-align: top; text-align: left; padding: 6px 10px; }
.hist-table thead th { white-space: nowrap; }
.hist-table thead th .xs, .hist-table td .xs { display: block; }
.hist-table tbody th { font-weight: var(--fw-medium); max-width: 22ch; }
.hist-overall th, .hist-overall td { border-top: 1px solid var(--border); }
.ovr-flag-inline { display: inline-flex; gap: 4px; align-items: center; color: var(--fg-2); }
.tour-spot { outline: 3px solid var(--accent); outline-offset: 3px; border-radius: var(--radius-sm); }
.slide .deck-verdict { display: flex; gap: 8px; align-items: center; margin: 2px 0 4px; font-size: max(14px, calc(var(--d) * 1.1)); color: var(--fg-2); font-weight: var(--fw-medium); }
.slide .deck-verdict .icon { width: 1em; height: 1em; flex: none; }
.slide .ms-flag { font-size: max(14px, calc(var(--d) * 1.15)); line-height: 1.35; }
.reasons, .path { list-style: none; display: grid; gap: 6px; margin: 4px 0 0; padding: 0; }
.reasons li { display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: 8px; align-items: start; font-size: var(--fs-sm); }
.reasons li .icon { margin-top: 2px; }
.path { counter-reset: step; }
.path li { display: grid; grid-template-columns: 22px 16px minmax(0, 1fr); gap: 8px; align-items: start; counter-increment: step; }
.path li::before { content: counter(step) "."; color: var(--fg-3); font-size: var(--fs-sm); font-variant-numeric: tabular-nums; text-align: right; }
.path ol[start] li::before, .path[start] li::before { content: counter(step) "."; }
.path li .icon { margin-top: 3px; }
.path .t { font-size: var(--fs-sm); margin: 0; }
.path .who { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin: 2px 0 0; }
.team-chip { display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 8px; border-radius: 11px; border: 1px solid var(--border-strong); background: var(--bg-surface); color: var(--fg); font-size: var(--fs-xs); text-decoration: none; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.team-chip:hover { border-color: var(--accent); }
.tag.marker { font-weight: var(--fw-medium); }

/* leadership slides: the milestone road, what each milestone means, the path to green */
.slide .rag.st { font-size: calc(var(--d) * 1.35); gap: calc(var(--d) * 0.45); }
.slide .rag .icon, .slide .marker .icon { width: calc(var(--d) * 1.4); height: calc(var(--d) * 1.4); }
.slide .marker { display: inline-flex; align-items: center; gap: calc(var(--d) * 0.35); font-size: max(14px, calc(var(--d) * 1.05)); font-weight: var(--fw-semibold); padding: calc(var(--d) * 0.15) calc(var(--d) * 0.6); border-radius: var(--radius-sm); }
.slide .marker.blocked { background: var(--danger-muted); color: var(--danger); }
.slide .marker.attention { background: var(--warning-muted); color: var(--warning); }
.msroad { list-style: none; padding: 0; margin: 0 0 calc(var(--d) * 1.2); display: grid; gap: calc(var(--d) * 0.7); }
.msroad .ms { display: grid; grid-template-columns: calc(var(--d) * 13) minmax(0, 1.15fr) minmax(0, 1fr); gap: calc(var(--d) * 1.4); align-items: start; padding: calc(var(--d) * 0.8) calc(var(--d) * 1); border-radius: var(--radius-md); background: var(--bg-surface); border: 1px solid var(--border); border-left: calc(var(--d) * 0.45) solid var(--border-strong); }
.msroad .ms.rag-red { border-left-color: var(--danger); }
.msroad .ms.rag-amber { border-left-color: var(--warning); }
.msroad .ms.rag-green { border-left-color: var(--success); }
.msroad .ms.current { box-shadow: 0 0 0 2px var(--halo, var(--accent-muted)); }
.msroad .ms-st { display: flex; flex-direction: column; align-items: flex-start; gap: calc(var(--d) * 0.4); }
.ms-name { font-size: calc(var(--d) * 1.55); line-height: 1.3; font-weight: var(--fw-semibold); }
.ms-name .now { font-size: max(14px, calc(var(--d) * 0.95)); font-weight: var(--fw-semibold); color: var(--accent); background: var(--accent-muted); border-radius: var(--radius-sm); padding: 0 calc(var(--d) * 0.45); vertical-align: 0.15em; }
.ms-del { font-size: max(14px, calc(var(--d) * 1.15)); line-height: 1.4; color: var(--fg-2); margin-top: calc(var(--d) * 0.25); }
.ms-why { font-size: calc(var(--d) * 1.3); line-height: 1.4; }
.ms-why .ovr { display: block; font-size: max(14px, calc(var(--d) * 1.05)); color: var(--fg-3); margin-top: calc(var(--d) * 0.25); }
.ms-flow { font-size: max(14px, calc(var(--d) * 1.05)); line-height: 1.4; color: var(--fg-2); margin-top: calc(var(--d) * 0.35); }
.msroad .ms.reached .ms-why { color: var(--fg-3); }
.msmeans { list-style: none; padding: 0; margin: 0; display: grid; gap: calc(var(--d) * 1.1); }
.msmeans li { display: grid; grid-template-columns: minmax(0, 0.8fr) minmax(0, 2fr); gap: calc(var(--d) * 1.6); padding-bottom: calc(var(--d) * 1); border-bottom: 1px solid var(--border); }
.msmeans li.reached { opacity: 0.7; }
.msmeans .ms-lead { margin: calc(var(--d) * 0.3) 0 0; font-size: max(14px, calc(var(--d) * 1.05)); color: var(--fg-2); }
.msmeans dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: calc(var(--d) * 0.35) calc(var(--d) * 1); margin: 0; }
.msmeans dt { font-size: max(14px, calc(var(--d) * 1.05)); color: var(--fg-3); padding-top: calc(var(--d) * 0.2); }
.msmeans dd { margin: 0; font-size: calc(var(--d) * 1.35); line-height: 1.4; }
.pgroups { display: grid; grid-template-columns: repeat(auto-fit, minmax(calc(var(--d) * 38), 1fr)); gap: calc(var(--d) * 2); }
.pg h3 { display: flex; align-items: center; gap: calc(var(--d) * 0.8); font-size: calc(var(--d) * 1.7); line-height: 1.25; margin-bottom: calc(var(--d) * 0.3); }
.pg-why { font-size: max(14px, calc(var(--d) * 1.2)); color: var(--fg-2); margin-bottom: calc(var(--d) * 0.9); }
.slide .steps { list-style: none; padding: 0; margin: 0; display: grid; gap: calc(var(--d) * 0.9); }
.slide .steps > li { display: grid; grid-template-columns: calc(var(--d) * 2.2) minmax(0, 1fr); gap: calc(var(--d) * 0.6); align-items: start; }
.slide .steps .num { width: calc(var(--d) * 1.9); height: calc(var(--d) * 1.9); border-radius: 50%; background: var(--accent-muted); color: var(--accent); font-size: max(14px, calc(var(--d) * 1.05)); font-weight: var(--fw-semibold); display: inline-flex; align-items: center; justify-content: center; }
.slide .steps .t { font-size: calc(var(--d) * 1.35); line-height: 1.38; }
.slide .steps .t .icon { width: calc(var(--d) * 1.25); height: calc(var(--d) * 1.25); vertical-align: -0.15em; }
.slide .steps .s { font-size: max(14px, calc(var(--d) * 1.1)); color: var(--fg-2); margin-top: 2px; }
.slide.t-challenges .items .t, .slide.t-risks .items .t { font-size: calc(var(--d) * 1.45); }
.slide.t-risks .items .s { font-size: calc(var(--d) * 1.25); color: var(--fg); margin-top: calc(var(--d) * 0.3); }
.slide.t-challenges .items .tone-warning .t, .slide.t-challenges .items .tone-fail .t { font-weight: var(--fw-regular); }
.slide .marker.override { background: var(--bg-sunken); color: var(--fg-2); border: 1px solid var(--border-strong); }
.slide .marker.computed.rag-red { background: var(--danger-muted); color: var(--danger); }
.slide .marker.computed.rag-amber { background: var(--warning-muted); color: var(--warning); }
.msroad.dense { gap: calc(var(--d) * 0.5); }
.msmeans.dense { gap: calc(var(--d) * 0.7); }
.msmeans.dense li { padding-bottom: calc(var(--d) * 0.65); }
.msmeans.dense .ms-name { font-size: calc(var(--d) * 1.35); }
.msmeans.dense dd { font-size: max(14px, calc(var(--d) * 1.15)); }
.msroad.dense .ms { padding: calc(var(--d) * 0.55) calc(var(--d) * 0.9); }
.msroad.dense .ms-name { font-size: calc(var(--d) * 1.35); }
.msroad.dense .ms-del { font-size: max(14px, calc(var(--d) * 1.02)); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.msroad.dense .ms-why { font-size: max(14px, calc(var(--d) * 1.15)); }
.msroad.dense .ms-st { flex-direction: row; flex-wrap: wrap; }

/* Teams: a team opens its card and its work; who waits on whom, drawn */
.team-open { color: var(--fg); text-decoration: underline; text-decoration-color: var(--border-strong); text-underline-offset: 3px; }
.team-open:hover { color: var(--accent); text-decoration-color: var(--accent); }
.team-work { border: 1px solid var(--border); border-radius: var(--radius-lg); padding: var(--sp-4); background: var(--bg-surface); }
.team-work-rows li { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; }
.team-work-rows .tag { margin-left: auto; }
.waits-wrap { border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--bg-surface); padding: var(--sp-2); margin: var(--sp-3) 0; }
.waits-svg { display: block; width: 100%; height: auto; max-height: 520px; }
.waits-svg .tnode { cursor: pointer; }
.waits-svg .tnode rect { fill: var(--bg-sunken); stroke: var(--border-strong); stroke-width: 1.2; }
.waits-svg .tnode text { fill: var(--fg); font: 500 13px var(--font-ui); pointer-events: none; }
.waits-svg .tnode:hover rect, .waits-svg .tnode:focus rect { stroke: var(--accent); stroke-width: 2; }
.waits-svg .tnode:focus { outline: none; }
.waits-svg .wedge { cursor: pointer; }
.waits-svg .wline { fill: none; stroke: var(--edge); }
.waits-svg .whit { fill: none; stroke: transparent; stroke-width: 14; }
.waits-svg .whead { fill: var(--edge); }
.waits-svg .wcount circle, .waits-svg .wcount rect { fill: var(--bg-surface); stroke: var(--edge); stroke-width: 1.2; }
.waits-svg .wcount text { fill: var(--fg); font: 600 11px var(--font-ui); font-variant-numeric: tabular-nums; pointer-events: none; }
.waits-svg .wedge:hover .wline, .waits-svg .wedge:focus .wline, .waits-svg .wedge.on .wline { stroke: var(--accent); }
.waits-svg .wedge:hover .wcount circle, .waits-svg .wedge:focus .wcount circle, .waits-svg .wedge.on .wcount circle, .waits-svg .wedge:hover .wcount rect, .waits-svg .wedge:focus .wcount rect, .waits-svg .wedge.on .wcount rect { stroke: var(--accent); fill: var(--accent-muted); }
.waits-svg .wedge:focus { outline: none; }
.waits-svg .wedge:focus-visible .wcount circle { stroke-width: 3; }
.waits-svg.handoffs .wline { stroke: var(--z6); }
.waits-svg.handoffs .whead { fill: var(--z6); }
.waits-svg.handoffs .wcount circle, .waits-svg.handoffs .wcount rect { stroke: var(--z6); }
.flow-effect .reading { margin-bottom: var(--sp-2); }
.wait-detail { margin: var(--sp-2) 0 var(--sp-4); }
.wait-list { border-left: 3px solid var(--accent); padding: var(--sp-2) var(--sp-3); background: var(--bg-sunken); border-radius: 0 var(--radius-md) var(--radius-md) 0; }
.wait-list h3 { font-size: var(--fs-md, 14px); margin-bottom: 6px; outline: none; }
.wait-list .rows li { display: block; }
.wait-list .id.small, .waits-list .id.small { margin-left: 6px; color: var(--fg-3); }
.wpair { display: flex; gap: 8px; align-items: baseline; width: 100%; text-align: left; background: none; border: 0; padding: 0; color: inherit; font: inherit; cursor: pointer; }
.wpair:hover .t, .wpair.on .t { color: var(--accent); }
.wpair .rv { margin-left: auto; }
.waits-list li { display: grid; gap: 2px; }
.wcell { background: none; border: 0; padding: 2px 6px; font: inherit; color: var(--accent); cursor: pointer; text-decoration: underline; }
.wcell.on { background: var(--accent-muted); border-radius: var(--radius-sm); }

/* focus: a team or a lead; their parts at full strength, the rest dimmed, every line to or from them kept */
.focus-btn .lbl { max-width: 16ch; overflow: hidden; text-overflow: ellipsis; }
@media (max-width: 719px) { .focus-btn .lbl { display: none; } }
svg.focused .node.fz-out { opacity: 0.22; }
svg.focused .node.fz-near { opacity: 0.6; }
svg.focused .edge.fz-out, svg.focused .elabel.fz-out { opacity: 0.12; }
svg.focused .node.fz-in .box { stroke-width: 2.25px; }
.chain .fz-out { opacity: 0.3; }
.focus-rel { margin-left: 6px; font-weight: var(--fw-regular); }
td .focus-rel { display: inline-block; margin: 2px 0 0 6px; }
.focus-chip { border-color: var(--accent); }
.road .lab .fz-share { display: block; color: var(--accent); }
.fz-share-line { margin: var(--sp-2) 0; }
.team-work-rows li { flex-wrap: wrap; min-width: 0; }
.team-work-rows li .tag { white-space: normal; max-width: 100%; }
tr.fz-row th { box-shadow: inset 3px 0 0 var(--accent); }
/* grouped blockers: one row per capability, its provider or providers (alternatives said so) */
.blk-list { margin: 0; }
.blk-row { flex-wrap: wrap; gap: 4px 6px; }
.blk-cap { font-weight: var(--fw-medium); }
.blk-row .alt { color: var(--fg-2); }
.blk-row .blk-us { display: inline-flex; flex-wrap: wrap; gap: 4px 10px; min-width: 0; }
.blk-met { margin-top: 4px; }

@media print { .app-header, .app-nav, .statebar, .caption, .toolbar { display: none; } }
`;

/**
 * The portfolio page's rules and the bar a design page built inside a portfolio carries. Kept
 * apart from CSS, so a lone instance's page carries exactly the stylesheet it always did; only the portfolio page and
 * the design pages inside a portfolio add these. Tokens only: no literal colour here.
 */
export const PORTFOLIO_CSS = `
/* ---------- the mode bar: on the portfolio page and on every design page inside it ---------- */
html.deck-on .pf-ctx { display: none !important; }
/* a design page inside a portfolio: the bar is the sticky header's second row, so every sticky offset below grows with it */
html.in-pf { --header-h: 81px; }
html.in-pf .app-header > .inner { height: 48px; }
.pf-ctx.in-header { height: 32px; overflow: hidden; border-top: 1px solid var(--border); border-bottom: 0; }
.pf-ctx.in-header .inner { height: 100%; flex-wrap: nowrap; white-space: nowrap; padding-top: 0; padding-bottom: 0; }
.pf-ctx.in-header .pf-ctx-line, .pf-ctx.in-header .pf-others { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.pf-ctx.in-header .pf-others { flex-wrap: nowrap; }
@media (max-width: 719px) { .pf-ctx.in-header .pf-others { display: none; } }
.pf-mode, .pf-ctx { background: var(--bg-sunken); border-bottom: 1px solid var(--border); }
.pf-mode .inner, .pf-ctx .inner { max-width: var(--content-max); margin: 0 auto; padding: 6px var(--gutter); display: flex; flex-wrap: wrap; align-items: center; gap: 4px var(--sp-3); font-size: var(--fs-sm); color: var(--fg-2); min-width: 0; }
.pf-mode.presenting, .pf-ctx.presenting { background: var(--accent-muted); }
.pf-mode-tag { font-weight: var(--fw-semibold); }
.pf-mode-line, .pf-ctx-line { min-width: 0; overflow-wrap: anywhere; }
.pf-focus-chip:empty { display: none; }
.pf-ctx .pf-back { display: inline-flex; align-items: center; gap: 4px; font-weight: var(--fw-medium); }
.pf-ctx .pf-others { display: inline-flex; flex-wrap: wrap; gap: 2px 10px; }
.pf-ctx .pf-others a { white-space: nowrap; }

/* ---------- the portfolio page ---------- */
.pf-nav .inner { overflow-x: auto; scrollbar-width: none; }
.pf-nav .inner::-webkit-scrollbar { display: none; }
.pf-links { display: flex; align-items: stretch; gap: var(--sp-1); }
.pf-links a { display: flex; align-items: center; padding: 0 var(--sp-2); color: var(--fg-2); border-bottom: 2px solid transparent; white-space: nowrap; text-decoration: none; }
.pf-links a:hover { color: var(--fg); border-bottom-color: var(--border-strong); }
.pf-page .section { margin-top: var(--sp-7); }
.pf-page .section:first-of-type { margin-top: var(--sp-5); }
.pf-page h2 { scroll-margin-top: calc(var(--header-h) + var(--nav-h) + 12px); }
.pf-page [id] { scroll-margin-top: calc(var(--header-h) + var(--nav-h) + 12px); }
.pf-modeline { margin: calc(-1 * var(--sp-3)) 0 var(--sp-4); }
.pf-focus-note { margin: 0 0 var(--sp-4); align-items: center; flex-wrap: wrap; }
.pf-h3 { font-size: var(--fs-md); margin: 0 0 6px; }
.pf-design .pf-open { color: var(--accent); }
.pf-menu { min-width: 260px; }
.pf-menu [role="menuitemradio"], .pf-menu [role="menuitem"] { display: flex; width: 100%; gap: 8px; align-items: center; justify-content: space-between; border: 0; background: transparent; padding: 6px 8px; border-radius: var(--radius-sm); cursor: pointer; text-align: left; }
.pf-menu [role="menuitemradio"]:hover, .pf-menu [role="menuitemradio"]:focus-visible, .pf-menu [role="menuitem"]:hover { background: var(--bg-sunken); }
.pf-menu [role="menuitemradio"][aria-checked="true"] { color: var(--accent); font-weight: var(--fw-medium); }
.pf-menu .n { color: var(--fg-3); font-size: var(--fs-xs); }
body.focused .fz-out { opacity: 0.38; }
body.focused .fz-out .fz-out { opacity: 1; } /* dimmed once: a row inside a dimmed card is not dimmed again */
body.focused .fz-in.rm-ms > a, body.focused .pf-team.fz-in, body.focused .pf-seam.fz-in, body.focused .pf-bet.fz-in { box-shadow: inset 3px 0 0 var(--accent); }
.fz-share { display: block; font-size: var(--fs-xs); line-height: var(--lh-xs); color: var(--accent); font-weight: var(--fw-medium); }
.fz-none { font-size: var(--fs-xs); color: var(--fg-3); }
.pf-hover { white-space: normal; }
.pf-hover .card-t { font-weight: var(--fw-medium); margin: 0 0 4px; }
.pf-hover-lines { list-style: none; display: grid; gap: 2px; color: var(--fg-2); font-size: var(--fs-xs); }
.pf-foot { margin-top: var(--sp-7); }

/* Roadmap: dated milestones on the month grid, undated phases in a wrapping strip. */
.rm { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--sp-3); }
.rm-months, .rm-track { display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); gap: 4px; list-style: none; }
.rm-months { padding-left: 0; font-size: var(--fs-xs); color: var(--fg-3); border-bottom: 1px solid var(--border); padding-bottom: 4px; }
.rm-months li { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rm-months li.now { color: var(--fg); font-weight: var(--fw-medium); }
.rm-row { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; padding: var(--sp-3) 0; border-bottom: 1px solid var(--border); }
.rm-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px var(--sp-3); }
.rm-title { font-weight: var(--fw-semibold); font-size: var(--fs-md); }
.rm-label { font-size: var(--fs-xs); color: var(--fg-3); }
.rm-reached { font-size: var(--fs-xs); color: var(--fg-2); display: inline-flex; gap: 4px; align-items: center; }
.rm-ms { grid-column: var(--col) / span var(--span, 1); min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr); align-content: start; gap: 2px; }
.rm-ms > a { display: grid; gap: 2px; padding: 6px; border: 1px solid var(--border); border-left: 3px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--bg-surface); color: var(--fg); text-decoration: none; min-width: 0; }
.rm-ms > a:hover { border-color: var(--border-strong); text-decoration: none; }
.rm-ms.rag-green > a { border-left-color: var(--success); } .rm-ms.rag-amber > a { border-left-color: var(--warning); } .rm-ms.rag-red > a { border-left-color: var(--danger); }
.rm-ms.current > a { box-shadow: 0 0 0 2px var(--halo); }
.rm-phases { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr)); gap: var(--sp-3); list-style: none; }
.rm-phases .rm-ms { grid-column: auto; }
.rm-phases .rm-ms > a { padding: var(--sp-3); gap: 6px; }
.rm-phases .rm-when { display: block; }
.rm-phases .rm-name { display: block; font-size: var(--fs-sm); overflow: visible; }
.rm-when { display: none; font-size: var(--fs-xs); color: var(--fg-3); }
.rm-name { font-size: var(--fs-xs); line-height: 1.3; font-weight: var(--fw-medium); overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.rm-meta { font-size: var(--fs-xs); color: var(--fg-3); line-height: 1.3; }
.rm-ms .st.sm { font-size: var(--fs-xs); }
.rm-relief { display: flex; gap: 4px; align-items: flex-start; font-size: var(--fs-xs); line-height: 1.3; color: var(--success); padding: 2px 2px 0; overflow-wrap: anywhere; }
.rm-relief .icon { flex: none; margin-top: 1px; }
.rm-empty { grid-column: 1 / -1; font-size: var(--fs-sm); color: var(--fg-3); }
.rm-waits { list-style: none; display: grid; gap: 2px; font-size: var(--fs-sm); color: var(--fg-2); }
.rm-waits li { display: flex; gap: 6px; align-items: baseline; overflow-wrap: anywhere; }
@media (max-width: 899px) {
  .rm-months { display: none; }
  .rm-track { display: grid; grid-template-columns: minmax(0, 1fr); }
  .rm-ms { grid-column: auto; }
  .rm-when { display: block; }
}

/* load by team */
.pf-teams { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--sp-3); }
.pf-team { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--sp-2); min-width: 0; }
.pf-team-head, .pf-seam-head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px var(--sp-2); }
.pf-team-head h3, .pf-seam-head h3 { margin-right: var(--sp-1); }
.lb { position: relative; margin-top: 18px; }
.lb-bar { display: flex; height: 30px; border-radius: var(--radius-sm); overflow: hidden; background: var(--bg-sunken); border: 1px solid var(--border); }
.lb-seg { display: flex; align-items: center; min-width: 0; padding: 0 6px; font-size: var(--fs-xs); white-space: nowrap; overflow: hidden; border-right: 1px solid var(--bg-surface); color: var(--fg); }
.lb-seg .lb-t { overflow: hidden; text-overflow: ellipsis; }
.lb-seg.bau, .lb-key.bau { background: var(--z2-fill); box-shadow: inset 0 -3px 0 var(--z2); }
.lb-seg.stream, .lb-key.stream { background: var(--z4-fill); box-shadow: inset 0 -3px 0 var(--z4); }
.lb-seg.unit.z1, .lb-key.unit.z1 { background: var(--z1-fill); box-shadow: inset 0 -3px 0 var(--z1); }
.lb-seg.unit.z3, .lb-key.unit.z3 { background: var(--z3-fill); box-shadow: inset 0 -3px 0 var(--z3); }
.lb-seg.unit.z5, .lb-key.unit.z5 { background: var(--z5-fill); box-shadow: inset 0 -3px 0 var(--z5); }
.lb-seg.unit.z4, .lb-key.unit.z4 { background: var(--z4-fill); box-shadow: inset 0 -3px 0 var(--z4); }
.lb-seg.unit.z6, .lb-key.unit.z6 { background: var(--z6-fill); box-shadow: inset 0 -3px 0 var(--z6); }
.lb-seg.unit.z2, .lb-key.unit.z2 { background: var(--z2-fill); box-shadow: inset 0 -3px 0 var(--z2); }
.lb-seg.transition { background-image: repeating-linear-gradient(135deg, transparent 0 5px, var(--bg-surface) 5px 7px); }
.lb-seg.free, .lb-key.free { background: var(--bg-surface); color: var(--fg-3); box-shadow: inset 0 0 0 1px var(--border-strong); }
.lb-limit { position: absolute; top: -18px; bottom: -4px; width: 0; border-left: 2px solid var(--fg); }
.lb-limit span { position: absolute; top: 0; left: 4px; font-size: var(--fs-xs); line-height: 14px; color: var(--fg-2); white-space: nowrap; }
.lb-limit.end span { left: auto; right: 4px; }
.lb-bar .lb-seg.over, .lb-key.over { background: var(--danger-muted); box-shadow: inset 0 -3px 0 var(--danger); background-image: repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in srgb, var(--danger) 30%, transparent) 5px 7px); }
.lb-unc-row { display: flex; flex-wrap: wrap; gap: 4px var(--sp-3); align-items: center; }
.lb-unc { min-width: 92px; height: 16px; display: flex; align-items: center; padding: 0 6px; font-size: var(--fs-xs); border: 1px dashed var(--border-control); border-radius: var(--radius-sm); color: var(--fg-3); overflow: hidden; white-space: nowrap; min-width: 0; }
.lb-legend { list-style: none; display: flex; flex-wrap: wrap; gap: 2px var(--sp-4); font-size: var(--fs-xs); color: var(--fg-2); }
.lb-legend li { display: inline-flex; gap: 6px; align-items: center; }
.lb-key { display: inline-block; width: 12px; height: 12px; border-radius: 2px; flex: none; }
.prov { list-style: none; display: grid; gap: 2px; color: var(--fg-2); }
.prov .pv-what { color: var(--fg); font-weight: var(--fw-medium); }
.pf-mw-h { margin-top: var(--sp-5); }
.pf-mws > li { display: block; }
.pf-mws .rows { margin: 4px 0 0 0; }
.pf-mws .rows li { align-items: baseline; min-height: 0; }
.pending { color: var(--accent); }
.tl { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; }
.tl-cols { list-style: none; display: grid; grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); gap: 3px; align-items: end; max-width: 720px; }
.tl-cols li { display: grid; gap: 2px; justify-items: stretch; min-width: 0; }
.tl-col { position: relative; height: 48px; background: var(--bg-surface); border: 1px solid var(--border-strong); border-top: 2px solid var(--fg); border-radius: 2px; overflow: hidden; }
.tl-s { position: absolute; left: 0; right: 0; bottom: 0; height: var(--s); background: color-mix(in srgb, var(--z2) 45%, var(--bg-surface)); box-shadow: inset 0 2px 0 var(--z2); }
.tl-v { position: absolute; left: 0; right: 0; bottom: 2px; font-size: 10px; line-height: 12px; text-align: center; color: var(--fg); font-variant-numeric: tabular-nums; }
.tl-m { font-size: 10px; line-height: 12px; color: var(--fg-3); text-align: center; overflow: hidden; }
.tl-events { list-style: none; display: grid; gap: 2px; color: var(--fg-2); }
.tl-date { font-variant-numeric: tabular-nums; color: var(--fg); font-weight: var(--fw-medium); }

/* the most contended team, seams, bets, changes */
.pf-contended .rows li { align-items: baseline; }
.pf-seams, .pf-bets, .pf-patches { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--sp-3); }
@media (min-width: 1100px) { .pf-bets { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.pf-seam, .pf-bet, .pf-patch { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--sp-2); min-width: 0; }
.pf-seam h4 { font-size: var(--fs-sm); color: var(--fg-2); margin-top: var(--sp-1); }
.pf-seam .disc > summary h4 { margin: 0; }
.pf-xs { list-style: none; display: grid; gap: var(--sp-2); }
.pf-x { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px var(--sp-2); align-items: start; padding: 6px var(--sp-2); border-radius: var(--radius-sm); }
.pf-x > .icon { margin-top: 3px; }
.pf-x.undeclared { background: var(--warning-muted); }
.pf-x.undeclared.relevant { box-shadow: inset 3px 0 0 var(--warning); }
.pf-x.undeclared.error { background: var(--danger-muted); box-shadow: inset 3px 0 0 var(--danger); }
@media (max-width: 719px) { body.pf .table-wrap.reflow { overflow: hidden; } }
.pf-x p + p { margin-top: 2px; }
.pf-carries { display: inline-flex; vertical-align: middle; }
.pf-exc li { align-items: baseline; }
.pf-callouts { display: grid; gap: var(--sp-2); margin-bottom: var(--sp-3); }

/* flow distribution */
.fd-bar { display: flex; height: 10px; min-width: 80px; border-radius: 3px; overflow: hidden; background: var(--bg-sunken); }
.fd-feature { background: var(--z1); } .fd-defect { background: var(--z3); } .fd-risk { background: var(--z2); } .fd-debt { background: var(--z4); }
.lb-key.fd-feature { background: var(--z1); } .lb-key.fd-defect { background: var(--z3); } .lb-key.fd-risk { background: var(--z2); } .lb-key.fd-debt { background: var(--z4); }
.fd-key { margin-top: var(--sp-2); }

/* estimates */
.pf-est td { vertical-align: top; }
.pf-est .pv-what-cell, .pf-est .pv-owner, .pf-est .pv-gap, .pf-est .pending { display: block; }
.trend { display: block; overflow: visible; cursor: help; }
.trend .tr-v { fill: none; stroke: var(--accent); stroke-width: 1.5px; }
.trend .tr-m { fill: var(--bg-surface); stroke: var(--fg); stroke-width: 1.25px; }
.trend .tr-s { fill: none; stroke: var(--fg-3); stroke-width: 1.25px; stroke-dasharray: 3 2; }
.trend:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
`;
