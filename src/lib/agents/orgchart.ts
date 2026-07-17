// Builds the hybrid human + AI org chart. Humans are roots (human-to-human
// reporting is not modeled yet); agents hang off their manager — a human, an
// agent, or nobody (shown under "Unassigned").

export interface ChartPerson {
  kind: "human";
  id: string;
  name: string;
  title: string | null;
  role: string;
}

export interface ChartAgent {
  kind: "agent";
  id: string;
  name: string;
  title: string;
  status: string;
  avatarColor: string | null;
  reportsToAgentId: string | null;
  reportsToUserId: string | null;
}

export type ChartNode = (ChartPerson | ChartAgent) & { children: ChartNode[] };

export interface OrgChart {
  roots: ChartNode[];
  unassigned: ChartNode[];
}

export function buildOrgChart(humans: ChartPerson[], agents: ChartAgent[]): OrgChart {
  const humanNodes = new Map<string, ChartNode>(humans.map((h) => [h.id, { ...h, children: [] }]));
  const agentNodes = new Map<string, ChartNode>(agents.map((a) => [a.id, { ...a, children: [] }]));

  const unassigned: ChartNode[] = [];
  const attachedAgentIds = new Set<string>();

  for (const agent of agents) {
    const node = agentNodes.get(agent.id)!;
    if (agent.reportsToUserId && humanNodes.has(agent.reportsToUserId)) {
      humanNodes.get(agent.reportsToUserId)!.children.push(node);
      attachedAgentIds.add(agent.id);
    } else if (agent.reportsToAgentId && agentNodes.has(agent.reportsToAgentId)) {
      // Guard against cycles that may exist in bad data: only attach when the
      // manager chain terminates without revisiting this agent.
      if (!chainRevisits(agent.id, agent.reportsToAgentId, agents)) {
        agentNodes.get(agent.reportsToAgentId)!.children.push(node);
        attachedAgentIds.add(agent.id);
      }
    }
  }

  for (const agent of agents) {
    if (!attachedAgentIds.has(agent.id)) {
      unassigned.push(agentNodes.get(agent.id)!);
    }
  }

  sortChildren([...humanNodes.values()]);
  sortChildren(unassigned);

  return {
    roots: [...humanNodes.values()].sort(byName),
    unassigned: unassigned.sort(byName),
  };
}

function chainRevisits(startId: string, managerId: string, agents: ChartAgent[]): boolean {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const seen = new Set<string>([startId]);
  let current: string | null = managerId;
  while (current) {
    if (seen.has(current)) return true;
    seen.add(current);
    current = byId.get(current)?.reportsToAgentId ?? null;
  }
  return false;
}

function byName(a: ChartNode, b: ChartNode): number {
  return a.name.localeCompare(b.name);
}

function sortChildren(nodes: ChartNode[]): void {
  for (const node of nodes) {
    node.children.sort(byName);
    sortChildren(node.children);
  }
}
