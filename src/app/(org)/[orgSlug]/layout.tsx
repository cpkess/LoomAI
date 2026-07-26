import { FolderKanban, Settings } from "lucide-react";

import { requireOrgPage, roleAtLeast } from "@/lib/auth/authorize";
import { NavLink } from "@/components/shell/nav-link";
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
  const base = `/${ctx.org.slug}`;

  return (
    <div className="flex min-h-svh">
      <aside className="fixed inset-y-0 z-30 flex w-56 flex-col border-r bg-sidebar text-sidebar-foreground">
        <div className="flex items-center gap-2 p-4">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <FolderKanban className="size-4" />
          </div>
          <span className="text-base font-semibold">Loom</span>
        </div>
        <Separator />
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3">
          <NavLink href={`${base}/projects`}>
            <FolderKanban />
            Projects
          </NavLink>
          {isAdmin && (
            <div className="mt-auto">
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
            <span className="truncate text-xs text-muted-foreground">{ctx.user.email}</span>
          </div>
          <UserMenu name={ctx.user.name} email={ctx.user.email} isPlatformAdmin={ctx.user.isPlatformAdmin} />
        </div>
      </aside>
      <main className="ml-56 min-w-0 flex-1 overflow-x-hidden">{children}</main>
    </div>
  );
}
