import { eq, inArray } from "drizzle-orm";

import { listEnabledModels } from "@/lib/ai/registry";
import { buildOrgChart, type ChartAgent, type ChartPerson } from "@/lib/agents/orgchart";
import { requireOrgPage, roleAtLeast } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { agentWorkspaces, agents, organizationMembers, prompts, users, workspaces } from "@/lib/db/schema";

import { PeopleView, type HumanRow } from "./people-view";

export const metadata = { title: "People & org chart" };
export const dynamic = "force-dynamic";

export default async function PeoplePage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgPage(orgSlug);

  const [memberships, orgAgents, departments, orgPrompts, models] = await Promise.all([
    db.query.organizationMembers.findMany({ where: eq(organizationMembers.organizationId, ctx.org.id) }),
    db.query.agents.findMany({
      where: eq(agents.organizationId, ctx.org.id),
      orderBy: (t, { asc }) => asc(t.name),
    }),
    db.query.workspaces.findMany({
      where: eq(workspaces.organizationId, ctx.org.id),
      orderBy: (t, { asc }) => asc(t.name),
    }),
    db.query.prompts.findMany({
      where: eq(prompts.organizationId, ctx.org.id),
      orderBy: (t, { asc }) => asc(t.name),
    }),
    listEnabledModels("chat"),
  ]);

  const memberUsers = memberships.length
    ? await db.query.users.findMany({
        where: inArray(
          users.id,
          memberships.map((m) => m.userId)
        ),
      })
    : [];
  const usersById = new Map(memberUsers.map((u) => [u.id, u]));

  const agentIds = orgAgents.map((a) => a.id);
  const workspaceLinks = agentIds.length
    ? await db.query.agentWorkspaces.findMany({ where: inArray(agentWorkspaces.agentId, agentIds) })
    : [];

  const humans: HumanRow[] = memberships.flatMap((m) => {
    const user = usersById.get(m.userId);
    return user ? [{ id: user.id, name: user.name, title: m.title, role: m.role as string }] : [];
  });

  const chartHumans: ChartPerson[] = humans.map((h) => ({
    kind: "human",
    id: h.id,
    name: h.name,
    title: h.title,
    role: h.role,
  }));

  const chartAgents: ChartAgent[] = orgAgents.map((a) => ({
    kind: "agent",
    id: a.id,
    name: a.name,
    title: a.title,
    status: a.status,
    avatarColor: a.avatarColor,
    reportsToAgentId: a.reportsToAgentId,
    reportsToUserId: a.reportsToUserId,
  }));

  const chart = buildOrgChart(chartHumans, chartAgents);

  return (
    <PeopleView
      orgSlug={ctx.org.slug}
      orgName={ctx.org.name}
      canManage={roleAtLeast(ctx.role, "org_admin")}
      humans={humans}
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
        collectionIds: [],
        permissions: a.permissions ?? [],
      }))}
      chart={chart}
      departments={departments.map((d) => ({ id: d.id, name: d.name }))}
      prompts={orgPrompts.map((p) => ({ id: p.id, name: p.name }))}
      models={models.map((m) => ({ id: m.id, label: `${m.displayName} · ${m.providerName}` }))}
    />
  );
}
