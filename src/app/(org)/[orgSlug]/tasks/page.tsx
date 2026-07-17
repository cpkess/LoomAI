import { eq } from "drizzle-orm";

import { requireOrgPage } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { agents } from "@/lib/db/schema";

import { TasksView } from "./tasks-view";

export const metadata = { title: "Delegated tasks" };
export const dynamic = "force-dynamic";

export default async function TasksPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgPage(orgSlug);

  const orgAgents = await db.query.agents.findMany({
    where: eq(agents.organizationId, ctx.org.id),
    orderBy: (t, { asc }) => asc(t.name),
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <TasksView
        orgSlug={ctx.org.slug}
        agents={orgAgents
          .filter((a) => a.status === "active")
          .map((a) => ({ id: a.id, name: a.name, title: a.title, avatarColor: a.avatarColor }))}
      />
    </div>
  );
}
