import { and, eq, inArray } from "drizzle-orm";

import { listEnabledModels } from "@/lib/ai/registry";
import { requireWorkspacePage } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { agentWorkspaces, agents, prompts } from "@/lib/db/schema";

import { NewChat } from "./new-chat";

export default async function WorkspaceHome({
  params,
}: {
  params: Promise<{ orgSlug: string; workspaceSlug: string }>;
}) {
  const { orgSlug, workspaceSlug } = await params;
  const ctx = await requireWorkspacePage(orgSlug, workspaceSlug);

  const assignments = await db.query.agentWorkspaces.findMany({
    where: eq(agentWorkspaces.workspaceId, ctx.workspace.id),
  });
  const staff = assignments.length
    ? await db.query.agents.findMany({
        where: and(
          inArray(
            agents.id,
            assignments.map((a) => a.agentId)
          ),
          eq(agents.organizationId, ctx.org.id),
          eq(agents.status, "active")
        ),
      })
    : [];

  const [models, orgPrompts] = await Promise.all([
    listEnabledModels("chat"),
    db.query.prompts.findMany({ where: eq(prompts.organizationId, ctx.org.id), orderBy: (t, { asc }) => asc(t.name) }),
  ]);

  return (
    <NewChat
      orgSlug={ctx.org.slug}
      workspaceSlug={ctx.workspace.slug}
      workspaceName={ctx.workspace.name}
      staff={staff.map((a) => ({ id: a.id, name: a.name, title: a.title, avatarColor: a.avatarColor }))}
      models={models.map((m) => ({ id: m.id, label: `${m.displayName} · ${m.providerName}` }))}
      prompts={orgPrompts.map((p) => ({ id: p.id, name: p.name, category: p.category }))}
    />
  );
}
