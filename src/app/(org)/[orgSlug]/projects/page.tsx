import { eq } from "drizzle-orm";

import { getChiefAgent } from "@/lib/agents/chief";
import { requireOrgPage } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { agents } from "@/lib/db/schema";

import { ProjectsView } from "./projects-view";

export const metadata = { title: "Projects" };
export const dynamic = "force-dynamic";

export default async function ProjectsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgPage(orgSlug);

  const orgAgents = await db.query.agents.findMany({
    where: eq(agents.organizationId, ctx.org.id),
    orderBy: (t, { asc }) => asc(t.name),
  });
  const chief = await getChiefAgent(ctx.org.id);

  return (
    <div className="flex flex-col gap-6 p-6">
      <ProjectsView
        orgSlug={ctx.org.slug}
        defaultManagerId={chief?.id ?? null}
        agents={orgAgents
          .filter((a) => a.status === "active")
          .map((a) => ({ id: a.id, name: a.name, title: a.title, avatarColor: a.avatarColor }))}
      />
    </div>
  );
}
