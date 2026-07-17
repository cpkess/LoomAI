import { and, desc, eq, inArray } from "drizzle-orm";

import { requireWorkspacePage } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { agentWorkspaces, agents, conversations } from "@/lib/db/schema";

import { WorkspaceSidebar } from "./workspace-sidebar";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
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
          eq(agents.organizationId, ctx.org.id)
        ),
      })
    : [];

  const myConversations = await db.query.conversations.findMany({
    where: and(eq(conversations.workspaceId, ctx.workspace.id), eq(conversations.userId, ctx.user.id)),
    orderBy: desc(conversations.updatedAt),
    limit: 50,
  });

  const base = `/${ctx.org.slug}/w/${ctx.workspace.slug}`;

  return (
    <div className="flex h-svh">
      <WorkspaceSidebar
        base={base}
        workspaceName={ctx.workspace.name}
        staff={staff.map((a) => ({
          id: a.id,
          name: a.name,
          title: a.title,
          status: a.status,
          avatarColor: a.avatarColor,
        }))}
        conversations={myConversations.map((c) => ({ id: c.id, title: c.title, agentId: c.agentId }))}
      />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
