import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { agents, type Agent } from "@/lib/db/schema";

/**
 * The organization's "chief" AI employee — the top of the AI org chart, who
 * the Board delegates work to by default. Preference order:
 *   1. an active agent that reports to a human (a Board member),
 *   2. the active agent with the most direct reports,
 *   3. the earliest active agent.
 */
export async function getChiefAgent(orgId: string): Promise<Agent | null> {
  const active = await db.query.agents.findMany({
    where: and(eq(agents.organizationId, orgId), eq(agents.status, "active")),
    orderBy: (t, { asc }) => asc(t.createdAt),
  });
  if (active.length === 0) return null;

  const reportCounts = new Map<string, number>();
  for (const a of active) {
    if (a.reportsToAgentId) reportCounts.set(a.reportsToAgentId, (reportCounts.get(a.reportsToAgentId) ?? 0) + 1);
  }

  const boardReports = active.filter((a) => a.reportsToUserId);
  const pool = boardReports.length > 0 ? boardReports : active;
  pool.sort((a, b) => (reportCounts.get(b.id) ?? 0) - (reportCounts.get(a.id) ?? 0));
  return pool[0];
}
