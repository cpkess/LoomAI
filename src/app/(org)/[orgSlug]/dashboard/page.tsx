import Link from "next/link";
import { count, eq, inArray } from "drizzle-orm";
import { ArrowRight, Bot, BookOpen, FileText, MessagesSquare, Users } from "lucide-react";

import { requireOrgPage } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import {
  agents,
  collections,
  conversations,
  documents,
  organizationMembers,
  workspaces,
} from "@/lib/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DashboardPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgPage(orgSlug);

  const orgWorkspaces = await db.query.workspaces.findMany({
    where: eq(workspaces.organizationId, ctx.org.id),
  });
  const workspaceIds = orgWorkspaces.map((w) => w.id);
  const orgCollections = await db.query.collections.findMany({
    where: eq(collections.organizationId, ctx.org.id),
  });
  const collectionIds = orgCollections.map((c) => c.id);

  const [[memberCount], [agentCount], [documentCount], [conversationCount]] = await Promise.all([
    db.select({ value: count() }).from(organizationMembers).where(eq(organizationMembers.organizationId, ctx.org.id)),
    db.select({ value: count() }).from(agents).where(eq(agents.organizationId, ctx.org.id)),
    collectionIds.length
      ? db.select({ value: count() }).from(documents).where(inArray(documents.collectionId, collectionIds))
      : Promise.resolve([{ value: 0 }]),
    workspaceIds.length
      ? db.select({ value: count() }).from(conversations).where(inArray(conversations.workspaceId, workspaceIds))
      : Promise.resolve([{ value: 0 }]),
  ]);

  const stats = [
    { label: "Members", value: memberCount.value, icon: Users, href: `/${ctx.org.slug}/members` },
    { label: "AI employees", value: agentCount.value, icon: Bot, href: `/${ctx.org.slug}/people` },
    { label: "Departments", value: orgWorkspaces.length, icon: MessagesSquare, href: `/${ctx.org.slug}/people` },
    { label: "Documents", value: documentCount.value, icon: FileText, href: `/${ctx.org.slug}/knowledge` },
    { label: "Conversations", value: conversationCount.value, icon: BookOpen, href: `/${ctx.org.slug}/dashboard` },
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">{ctx.org.name}</h1>
        <p className="text-sm text-muted-foreground">Your hybrid human + AI organization at a glance.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
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
            <CardTitle>Departments</CardTitle>
            <CardDescription>Each department has its own chats, staff, knowledge, and tools.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {orgWorkspaces.map((w) => (
              <Link
                key={w.id}
                href={`/${ctx.org.slug}/w/${w.slug}`}
                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent"
              >
                <div>
                  <div className="font-medium">{w.name}</div>
                  {w.description && <div className="text-xs text-muted-foreground">{w.description}</div>}
                </div>
                <ArrowRight className="size-4 text-muted-foreground" />
              </Link>
            ))}
            {orgWorkspaces.length === 0 && (
              <p className="text-sm text-muted-foreground">No departments yet. Create one from Settings.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Getting started</CardTitle>
            <CardDescription>Set up your AI corporation in a few steps.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="flex list-decimal flex-col gap-2 pl-4 text-sm text-muted-foreground">
              <li>Ask a platform admin to register an AI provider (LM Studio, Ollama, OpenAI-compatible…).</li>
              <li>
                <Link href={`/${ctx.org.slug}/people`} className="text-foreground underline underline-offset-4">
                  Hire your first AI employee
                </Link>{" "}
                and place them in the org chart.
              </li>
              <li>
                <Link href={`/${ctx.org.slug}/knowledge`} className="text-foreground underline underline-offset-4">
                  Upload knowledge
                </Link>{" "}
                so agents can answer from your documents.
              </li>
              <li>Open a department and start chatting.</li>
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
