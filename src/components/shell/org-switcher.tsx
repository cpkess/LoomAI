"use client";

import { useRouter } from "next/navigation";
import { Blend, ChevronsUpDown } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function OrgSwitcher({
  current,
  orgs,
}: {
  current: { slug: string; name: string };
  orgs: { slug: string; name: string }[];
}) {
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-semibold outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50">
        <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Blend className="size-3.5" />
        </div>
        <span className="truncate">{current.name}</span>
        <ChevronsUpDown className="ml-auto size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Organizations</DropdownMenuLabel>
        {orgs.map((org) => (
          <DropdownMenuItem key={org.slug} onSelect={() => router.push(`/${org.slug}/dashboard`)}>
            {org.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
