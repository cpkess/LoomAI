import { eq, inArray } from "drizzle-orm";

import { requireOrgPage } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { organizationMembers, users } from "@/lib/db/schema";

import { MembersView } from "./members-view";

export const metadata = { title: "Members" };
export const dynamic = "force-dynamic";

export default async function MembersPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgPage(orgSlug, "org_admin");

  const memberships = await db.query.organizationMembers.findMany({
    where: eq(organizationMembers.organizationId, ctx.org.id),
    orderBy: (t, { asc }) => asc(t.createdAt),
  });
  const memberUsers = memberships.length
    ? await db.query.users.findMany({
        where: inArray(
          users.id,
          memberships.map((m) => m.userId)
        ),
      })
    : [];
  const usersById = new Map(memberUsers.map((u) => [u.id, u]));

  return (
    <div className="flex flex-col gap-6 p-6">
      <MembersView
        orgSlug={ctx.org.slug}
        currentUserId={ctx.user.id}
        members={memberships.flatMap((m) => {
          const user = usersById.get(m.userId);
          return user
            ? [
                {
                  id: m.id,
                  userId: user.id,
                  name: user.name,
                  email: user.email,
                  role: m.role,
                  title: m.title,
                },
              ]
            : [];
        })}
      />
    </div>
  );
}
