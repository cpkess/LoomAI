import { eq, inArray } from "drizzle-orm";

import { buildOrgChart, type ChartAgent, type ChartPerson } from "@/lib/agents/orgchart";
import { requireOrgPage } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { agents, organizationMembers, users } from "@/lib/db/schema";
import { initials } from "@/lib/utils";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { OrgChartView } from "./org-chart-view";

export const metadata = { title: "People & org chart" };

export default async function PeoplePage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgPage(orgSlug);

  const memberships = await db.query.organizationMembers.findMany({
    where: eq(organizationMembers.organizationId, ctx.org.id),
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

  const orgAgents = await db.query.agents.findMany({
    where: eq(agents.organizationId, ctx.org.id),
    orderBy: (t, { asc }) => asc(t.name),
  });

  const humans: ChartPerson[] = memberships.flatMap((m) => {
    const user = usersById.get(m.userId);
    return user
      ? [{ kind: "human" as const, id: user.id, name: user.name, title: m.title, role: m.role as string }]
      : [];
  });

  const chartAgents: ChartAgent[] = orgAgents.map((a) => ({
    kind: "agent",
    id: a.id,
    name: a.name,
    title: a.title,
    status: a.status,
    avatarColor: a.avatarColor,
    reportsToAgentId: a.reportsToAgentId,
    reportsToUserId: a.reportsToUserId,
  }));

  const chart = buildOrgChart(humans, chartAgents);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">People &amp; org chart</h1>
        <p className="text-sm text-muted-foreground">
          {ctx.org.name} is a hybrid company: {humans.length} human{humans.length === 1 ? "" : "s"} and{" "}
          {orgAgents.length} AI employee{orgAgents.length === 1 ? "" : "s"} working side by side.
        </p>
      </div>

      <Tabs defaultValue="chart">
        <TabsList>
          <TabsTrigger value="chart">Org chart</TabsTrigger>
          <TabsTrigger value="directory">Directory</TabsTrigger>
        </TabsList>

        <TabsContent value="chart" className="pt-2">
          <OrgChartView chart={chart} />
        </TabsContent>

        <TabsContent value="directory" className="pt-2">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {humans.map((person) => (
              <Card key={person.id} className="py-4">
                <CardContent className="flex items-center gap-3 px-4">
                  <Avatar className="size-10">
                    <AvatarFallback>{initials(person.name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{person.name}</div>
                    <div className="truncate text-sm text-muted-foreground">
                      {person.title ?? person.role.replace("_", " ")}
                    </div>
                  </div>
                  <Badge variant="secondary">human</Badge>
                </CardContent>
              </Card>
            ))}
            {orgAgents.map((agent) => (
              <Card key={agent.id} className="py-4">
                <CardContent className="flex items-center gap-3 px-4">
                  <AgentAvatar name={agent.name} color={agent.avatarColor} size="lg" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{agent.name}</div>
                    <div className="truncate text-sm text-muted-foreground">{agent.title}</div>
                  </div>
                  <Badge variant={agent.status === "active" ? "success" : "outline"}>
                    {agent.status === "active" ? "AI · active" : "AI · paused"}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
