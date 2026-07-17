"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

export function NavLink({
  href,
  exact = false,
  children,
  className,
}: {
  href: string;
  exact?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0",
        active && "bg-accent font-medium text-accent-foreground",
        className
      )}
    >
      {children}
    </Link>
  );
}
