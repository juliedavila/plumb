// The flow words for the server render. One source: this loads src/site/client/flow.js, the same file the page's
// script carries, so a flow number reads the same in the static markup and on the page.
import FLOW_JS from "./client/flow.js" with { type: "text" };

export interface FlowUi {
  days(n: number): string; date(iso: string, today?: string): string; src(s?: string): string;
  val(v: unknown, today?: string, unit?: "days" | "limit"): string; meas(m: unknown): string;
  hop(b: unknown, h: unknown): string; summary(b: unknown, s: unknown): string; measuredLine(b: unknown, s: unknown): string;
  panel(b: unknown, viewId: string, link?: (id: string) => string): string;
  tile(b: unknown): { view: string; title: string; big: string; line: string; bad: boolean; measured: string } | null;
  limitWords(n: number, limit: number): string; teamName(b: unknown, id: string): string; elName(b: unknown, id: string): string;
  [k: string]: unknown;
}
export const FLOWUI: FlowUi = new Function(`${FLOW_JS}\nreturn FLOWUI;`)();
