import { eq, inArray } from "drizzle-orm";
import { BookOpen, FolderKanban, LayoutDashboard, ScrollText, Settings, Users } from "lucide-react";

import { requireOrgPage, roleAtLeast } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { organizationMembers, organizations } from "@/lib/db/schema";
import { NavLink } from "@/components/shell/nav-link";
import { OrgSwitcher } from "@/components/shell/org-switcher";
import { UserMenu } from "@/components/shell/user-menu";
import { Separator } from "@/components/ui/separator";

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const ctx = await requireOrgPage(orgSlug);
  const isAdmin = roleAtLeast(ctx.role, "org_admin");

  const memberships = await db.query.organizationMembers.findMany({
    where: eq(organizationMembers.userId, ctx.user.id),
  });
  const myOrgs = memberships.length
    ? await db.query.organizations.findMany({
        where: inArray(
          organizations.id,
          memberships.map((m) => m.organizationId)
        ),
      })
    : [ctx.org];

  const base = `/${ctx.org.slug}`;

  return (
    <div className="flex min-h-svh">
      <aside className="fixed inset-y-0 z-30 flex w-60 flex-col border-r bg-sidebar text-sidebar-foreground">
        <div className="p-3">
          <OrgSwitcher
            current={{ slug: ctx.org.slug, name: ctx.org.name }}
            orgs={myOrgs.map((o) => ({ slug: o.slug, name: o.name }))}
          />
        </div>
        <Separator />
        <nav className="flex flex-1 flex-col gap-4 overflow-y-auto p-3">
          <div className="flex flex-col gap-0.5">
            <NavLink href={`${base}/dashboard`}>
              <LayoutDashboard />
              Dashboard
            </NavLink>
            <NavLink href={`${base}/projects`}>
              <FolderKanban />
              Projects
            </NavLink>
            <NavLink href={`${base}/knowledge`}>
              <BookOpen />
              Knowledge
            </NavLink>
            <NavLink href={`${base}/prompts`}>
              <ScrollText />
              Prompts
            </NavLink>
          </div>

          {isAdmin && (
            <div className="mt-auto flex flex-col gap-0.5">
              <NavLink href={`${base}/members`}>
                <Users />
                Members
              </NavLink>
              <NavLink href={`${base}/settings`}>
                <Settings />
                Settings
              </NavLink>
            </div>
          )}
        </nav>
        <Separator />
        <div className="flex items-center justify-between p-3">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{ctx.user.name}</span>
            <span className="truncate text-xs text-muted-foreground">{ctx.role.replace("_", " ")}</span>
          </div>
          <UserMenu name={ctx.user.name} email={ctx.user.email} isPlatformAdmin={ctx.user.isPlatformAdmin} />
        </div>
      </aside>
      <main className="ml-60 min-w-0 flex-1 overflow-x-hidden">{children}</main>
    </div>
  );
}
