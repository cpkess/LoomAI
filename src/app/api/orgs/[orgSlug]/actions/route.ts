import { desc, eq, inArray } from "drizzle-orm";

import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { agents, orgActions, users } from "@/lib/db/schema";

export async function GET(_req: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  try {
    const { orgSlug } = await params;
    const ctx = await requireOrg(orgSlug, "member");

    const rows = await db.query.orgActions.findMany({
      where: eq(orgActions.organizationId, ctx.org.id),
      orderBy: desc(orgActions.createdAt),
      limit: 100,
    });

    const agentIds = [...new Set(rows.flatMap((r) => (r.proposedByAgentId ? [r.proposedByAgentId] : [])))];
    const userIds = [
      ...new Set(rows.flatMap((r) => [r.proposedByUserId, r.decidedByUserId]).filter((x): x is string => Boolean(x))),
    ];
    const [actionAgents, actionUsers] = await Promise.all([
      agentIds.length ? db.query.agents.findMany({ where: inArray(agents.id, agentIds) }) : Promise.resolve([]),
      userIds.length ? db.query.users.findMany({ where: inArray(users.id, userIds) }) : Promise.resolve([]),
    ]);
    const agentsById = new Map(actionAgents.map((a) => [a.id, a]));
    const usersById = new Map(actionUsers.map((u) => [u.id, u]));

    return Response.json({
      actions: rows.map((row) => ({
        id: row.id,
        type: row.type,
        payload: row.payload,
        status: row.status,
        summary: row.summary,
        result: row.result,
        error: row.error,
        createdAt: row.createdAt,
        decidedAt: row.decidedAt,
        proposedBy: row.proposedByAgentId
          ? { kind: "agent", name: agentsById.get(row.proposedByAgentId)?.name ?? "Unknown agent", title: agentsById.get(row.proposedByAgentId)?.title ?? "", avatarColor: agentsById.get(row.proposedByAgentId)?.avatarColor ?? null }
          : row.proposedByUserId
            ? { kind: "human", name: usersById.get(row.proposedByUserId)?.name ?? "Unknown user", title: null, avatarColor: null }
            : null,
        decidedBy: row.decidedByUserId ? (usersById.get(row.decidedByUserId)?.name ?? "Unknown") : null,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
