import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { requireUserPage } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { organizationMembers, organizations } from "@/lib/db/schema";

export default async function Home() {
  const user = await requireUserPage();

  const membership = await db.query.organizationMembers.findFirst({
    where: eq(organizationMembers.userId, user.id),
  });

  if (membership) {
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, membership.organizationId),
    });
    if (org) redirect(`/${org.slug}/projects`);
  }

  if (user.isPlatformAdmin) redirect("/admin");

  redirect("/register");
}
