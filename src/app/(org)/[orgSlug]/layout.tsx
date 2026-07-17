import { eq, inArray } from "drizzle-orm";
import { BookOpen, Bot, LayoutDashboard, MessagesSquare, Network, ScrollText, Settings, Users } from "lucide-react";

import { requireOrgPage, roleAtLeast } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { organizationMembers, organizations, workspaces } from "@/lib/db/schema";
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

  const departments = await db.query.workspaces.findMany({
    where: eq(workspaces.organizationId, ctx.org.id),
    orderBy: (t, { asc }) => asc(t.name),
  });

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
            <NavLink href={`${base}/people`}>
              <Network />
              People &amp; org chart
            </NavLink>
            <NavLink href={`${base}/agents`}>
              <Bot />
              AI employees
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

          <div className="flex flex-col gap-0.5">
            <div className="px-2 pb-1 text-xs font-medium text-muted-foreground">Departments</div>
            {departments.map((d) => (
              <NavLink key={d.id} href={`${base}/w/${d.slug}`}>
                <MessagesSquare />
                {d.name}
              </NavLink>
            ))}
            {departments.length === 0 && (
              <p className="px-2 py-1 text-xs text-muted-foreground">No departments yet</p>
            )}
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
      <main className="ml-60 flex-1">{children}</main>
    </div>
  );
}
