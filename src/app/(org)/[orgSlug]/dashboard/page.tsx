import Link from "next/link";
import { count, desc, eq, inArray } from "drizzle-orm";
import { ArrowRight, BookOpen, FileText, FolderKanban, Sparkles } from "lucide-react";

import { requireOrgPage } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { collections, documents, projects } from "@/lib/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DashboardPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgPage(orgSlug);

  const orgCollections = await db.query.collections.findMany({
    where: eq(collections.organizationId, ctx.org.id),
  });
  const collectionIds = orgCollections.map((c) => c.id);

  const [recentProjects, [projectCount], [documentCount]] = await Promise.all([
    db.query.projects.findMany({
      where: eq(projects.organizationId, ctx.org.id),
      orderBy: desc(projects.updatedAt),
      limit: 6,
    }),
    db.select({ value: count() }).from(projects).where(eq(projects.organizationId, ctx.org.id)),
    collectionIds.length
      ? db.select({ value: count() }).from(documents).where(inArray(documents.collectionId, collectionIds))
      : Promise.resolve([{ value: 0 }]),
  ]);

  const stats = [
    { label: "Projects", value: projectCount.value, icon: FolderKanban, href: `/${ctx.org.slug}/projects` },
    { label: "Documents", value: documentCount.value, icon: FileText, href: `/${ctx.org.slug}/knowledge` },
    { label: "Collections", value: orgCollections.length, icon: BookOpen, href: `/${ctx.org.slug}/knowledge` },
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">{ctx.org.name}</h1>
        <p className="text-sm text-muted-foreground">
          An intelligent workspace for knowledge work — build living projects and produce exceptional deliverables.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {stats.map((stat) => (
          <Link key={stat.label} href={stat.href}>
            <Card className="gap-2 py-4 transition-colors hover:bg-accent/40">
              <CardHeader className="px-4">
                <CardDescription className="flex items-center gap-2">
                  <stat.icon className="size-4" />
                  {stat.label}
                </CardDescription>
                <CardTitle className="text-2xl tabular-nums">{stat.value}</CardTitle>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent projects</CardTitle>
            <CardDescription>Living workstreams that build understanding as you add sources.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {recentProjects.map((p) => (
              <Link
                key={p.id}
                href={`/${ctx.org.slug}/projects`}
                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{p.title}</div>
                  {p.description && <div className="truncate text-xs text-muted-foreground">{p.description}</div>}
                </div>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            ))}
            {recentProjects.length === 0 && (
              <p className="text-sm text-muted-foreground">No projects yet. Create one to get started.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4" />
              Getting started
            </CardTitle>
            <CardDescription>Three steps to your first deliverable.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="flex list-decimal flex-col gap-2 pl-4 text-sm text-muted-foreground">
              <li>Ask a platform admin to register an AI provider (LM Studio, Ollama, OpenAI-compatible…).</li>
              <li>
                <Link href={`/${ctx.org.slug}/projects`} className="text-foreground underline underline-offset-4">
                  Create a project
                </Link>{" "}
                and add sources — documents, notes, spreadsheets, decks, web pages.
              </li>
              <li>Let the project build its knowledge, then generate a deliverable.</li>
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
