import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { agents } from "@/lib/db/schema";

/**
 * Walk the reports_to chain from `managerAgentId` upward and reject if it
 * ever reaches `agentId` — that would make the org chart cyclic.
 */
export async function assertNoReportingCycle(agentId: string, managerAgentId: string): Promise<void> {
  let current: string | null = managerAgentId;
  const seen = new Set<string>([agentId]);
  while (current) {
    if (seen.has(current)) {
      throw new Error("This manager assignment would create a reporting cycle");
    }
    seen.add(current);
    const manager: { reportsToAgentId: string | null } | undefined = await db.query.agents.findFirst({
      where: eq(agents.id, current),
      columns: { reportsToAgentId: true },
    });
    current = manager?.reportsToAgentId ?? null;
  }
}
