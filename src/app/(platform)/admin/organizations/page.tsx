import { count, eq } from "drizzle-orm";

import { requirePlatformAdmin } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { agents, organizationMembers, organizations, workspaces } from "@/lib/db/schema";

import { OrganizationsView } from "./organizations-view";

export const metadata = { title: "Organizations" };
export const dynamic = "force-dynamic";

export default async function OrganizationsPage() {
  await requirePlatformAdmin();

  const orgs = await db.query.organizations.findMany({ orderBy: (t, { asc }) => asc(t.createdAt) });

  const rows = await Promise.all(
    orgs.map(async (org) => {
      const [[members], [depts], [orgAgents]] = await Promise.all([
        db.select({ value: count() }).from(organizationMembers).where(eq(organizationMembers.organizationId, org.id)),
        db.select({ value: count() }).from(workspaces).where(eq(workspaces.organizationId, org.id)),
        db.select({ value: count() }).from(agents).where(eq(agents.organizationId, org.id)),
      ]);
      return {
        id: org.id,
        slug: org.slug,
        name: org.name,
        members: members.value,
        departments: depts.value,
        agents: orgAgents.value,
      };
    })
  );

  return (
    <div className="flex flex-col gap-6 p-6">
      <OrganizationsView organizations={rows} />
    </div>
  );
}
