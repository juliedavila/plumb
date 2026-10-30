// The Jira adapter: reads raw Jira REST JSON (Cloud v3 or Data Center v2) and writes Jira's CSV import format.

import type { TrackerAdapter } from "../adapter.ts";
import { parseTime } from "../../core/flow.ts";
import { discoverJira } from "./discover.ts";
import { draftJiraMapping } from "./draft.ts";
import { draftJiraOrgMapping } from "./draft-org.ts";
import { exportJiraCsv } from "./export.ts";
import { sortRaw } from "./raw.ts";
import { readJiraState } from "./state.ts";

export const adapter: TrackerAdapter = {
  name: "jira",
  title: "Jira",
  discover: (raw) => discoverJira(raw),
  draftMapping: draftJiraMapping,
  readState: readJiraState,
  exportStructure: exportJiraCsv,
  // when the export was taken: the server's time in the serverInfo response saved beside the searches
  exportedAt: (raw) => {
    const t = parseTime(String(sortRaw(raw).serverInfo?.serverTime ?? ""));
    return Number.isNaN(t) ? undefined : new Date(t).toISOString().replace(/\.000Z$/, "Z");
  },
  draftOrgMapping: draftJiraOrgMapping,
};
