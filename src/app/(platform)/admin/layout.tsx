import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Building2, Cpu, LayoutDashboard, RefreshCw, ShieldCheck } from "lucide-react";

import { currentUser } from "@/lib/auth/authorize";
import { NavLink } from "@/components/shell/nav-link";
import { UserMenu } from "@/components/shell/user-menu";
import { Separator } from "@/components/ui/separator";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!user.isPlatformAdmin) redirect("/");

  return (
    <div className="flex min-h-svh">
      <aside className="fixed inset-y-0 z-30 flex w-60 flex-col border-r bg-sidebar text-sidebar-foreground">
        <div className="flex items-center gap-2 p-4 font-semibold">
          <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <ShieldCheck className="size-3.5" />
          </div>
          Platform admin
        </div>
        <Separator />
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3">
          <NavLink href="/admin" exact>
            <LayoutDashboard />
            Overview
          </NavLink>
          <NavLink href="/admin/providers">
            <Cpu />
            AI providers
          </NavLink>
          <NavLink href="/admin/organizations">
            <Building2 />
            Organizations
          </NavLink>
          <NavLink href="/admin/software">
            <RefreshCw />
            Software update
          </NavLink>
          <Link
            href="/"
            className="mt-auto flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground [&_svg]:size-4"
          >
            <ArrowLeft />
            Back to app
          </Link>
        </nav>
        <Separator />
        <div className="flex items-center justify-between p-3">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{user.name}</span>
            <span className="truncate text-xs text-muted-foreground">platform admin</span>
          </div>
          <UserMenu name={user.name} email={user.email} isPlatformAdmin={user.isPlatformAdmin} />
        </div>
      </aside>
      <main className="ml-60 min-w-0 flex-1 overflow-x-hidden">{children}</main>
    </div>
  );
}
