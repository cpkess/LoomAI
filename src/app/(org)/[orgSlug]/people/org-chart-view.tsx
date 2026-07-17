import { User } from "lucide-react";

import type { ChartNode, OrgChart } from "@/lib/agents/orgchart";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export function OrgChartView({ chart }: { chart: OrgChart }) {
  const empty = chart.roots.length === 0 && chart.unassigned.length === 0;
  return (
    <div className="flex flex-col gap-6">
      {empty && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nobody here yet. Invite members and hire AI employees to grow the org chart.
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {chart.roots.map((node) => (
          <ChartBranch key={node.id} node={node} depth={0} />
        ))}
      </div>

      {chart.unassigned.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Not in the reporting structure
          </div>
          {chart.unassigned.map((node) => (
            <ChartBranch key={node.id} node={node} depth={0} />
          ))}
        </div>
      )}
    </div>
  );
}

function ChartBranch({ node, depth }: { node: ChartNode; depth: number }) {
  return (
    <div className="flex flex-col gap-2" style={{ marginLeft: depth === 0 ? 0 : 28 }}>
      <NodeCard node={node} />
      {node.children.length > 0 && (
        <div className="flex flex-col gap-2 border-l pl-4">
          {node.children.map((child) => (
            <ChartBranch key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function NodeCard({ node }: { node: ChartNode }) {
  return (
    <div className="flex w-fit min-w-64 items-center gap-3 rounded-lg border bg-card px-3 py-2 shadow-xs">
      {node.kind === "human" ? (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary">
          <User className="size-4" />
        </div>
      ) : (
        <AgentAvatar name={node.name} color={node.avatarColor} />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{node.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          {node.kind === "human" ? (node.title ?? node.role.replace("_", " ")) : node.title}
        </div>
      </div>
      {node.kind === "agent" ? (
        <Badge variant={node.status === "active" ? "success" : "outline"}>AI</Badge>
      ) : (
        <Badge variant="secondary">human</Badge>
      )}
    </div>
  );
}
