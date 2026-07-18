import { eq, inArray } from "drizzle-orm";

import { listEnabledModels } from "@/lib/ai/registry";
import { requireOrgPage, roleAtLeast } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import {
  agentCollections,
  agentWorkspaces,
  agents,
  collections,
  organizationMembers,
  prompts,
  users,
  workspaces,
} from "@/lib/db/schema";

import { AgentsView } from "./agents-view";

export const metadata = { title: "AI employees" };
export const dynamic = "force-dynamic";

export default async function AgentsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgPage(orgSlug);

  const [orgAgents, departments, orgCollections, orgPrompts, models, memberships] = await Promise.all([
    db.query.agents.findMany({ where: eq(agents.organizationId, ctx.org.id), orderBy: (t, { asc }) => asc(t.name) }),
    db.query.workspaces.findMany({ where: eq(workspaces.organizationId, ctx.org.id), orderBy: (t, { asc }) => asc(t.name) }),
    db.query.collections.findMany({ where: eq(collections.organizationId, ctx.org.id), orderBy: (t, { asc }) => asc(t.name) }),
    db.query.prompts.findMany({ where: eq(prompts.organizationId, ctx.org.id), orderBy: (t, { asc }) => asc(t.name) }),
    listEnabledModels("chat"),
    db.query.organizationMembers.findMany({ where: eq(organizationMembers.organizationId, ctx.org.id) }),
  ]);

  const memberUsers = memberships.length
    ? await db.query.users.findMany({
        where: inArray(
          users.id,
          memberships.map((m) => m.userId)
        ),
      })
    : [];

  const agentIds = orgAgents.map((a) => a.id);
  const [workspaceLinks, collectionLinks] = await Promise.all([
    agentIds.length
      ? db.query.agentWorkspaces.findMany({ where: inArray(agentWorkspaces.agentId, agentIds) })
      : Promise.resolve([]),
    agentIds.length
      ? db.query.agentCollections.findMany({ where: inArray(agentCollections.agentId, agentIds) })
      : Promise.resolve([]),
  ]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <AgentsView
        orgSlug={ctx.org.slug}
        canManage={roleAtLeast(ctx.role, "org_admin")}
        agents={orgAgents.map((a) => ({
          id: a.id,
          name: a.name,
          title: a.title,
          status: a.status,
          avatarColor: a.avatarColor,
          modelId: a.modelId,
          personaPromptId: a.personaPromptId,
          personaText: a.personaText,
          reportsToAgentId: a.reportsToAgentId,
          reportsToUserId: a.reportsToUserId,
          workspaceIds: workspaceLinks.filter((l) => l.agentId === a.id).map((l) => l.workspaceId),
          collectionIds: collectionLinks.filter((l) => l.agentId === a.id).map((l) => l.collectionId),
          permissions: a.permissions ?? [],
        }))}
        departments={departments.map((d) => ({ id: d.id, name: d.name }))}
        collections={orgCollections.map((c) => ({ id: c.id, name: c.name }))}
        prompts={orgPrompts.map((p) => ({ id: p.id, name: p.name }))}
        models={models.map((m) => ({ id: m.id, label: `${m.displayName} · ${m.providerName}` }))}
        humans={memberUsers.map((u) => ({ id: u.id, name: u.name }))}
      />
    </div>
  );
}
