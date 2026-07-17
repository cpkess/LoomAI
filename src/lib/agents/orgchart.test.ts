import { describe, expect, it } from "vitest";

import { buildOrgChart, type ChartAgent, type ChartPerson } from "./orgchart";

const human = (id: string, name: string): ChartPerson => ({ kind: "human", id, name, title: null, role: "org_admin" });

const agent = (id: string, name: string, opts: Partial<ChartAgent> = {}): ChartAgent => ({
  kind: "agent",
  id,
  name,
  title: "AI",
  status: "active",
  avatarColor: null,
  reportsToAgentId: null,
  reportsToUserId: null,
  ...opts,
});

describe("buildOrgChart", () => {
  it("attaches agents to their human manager", () => {
    const chart = buildOrgChart([human("h1", "Ada")], [agent("a1", "Atlas", { reportsToUserId: "h1" })]);
    expect(chart.roots).toHaveLength(1);
    expect(chart.roots[0].children.map((c) => c.name)).toEqual(["Atlas"]);
    expect(chart.unassigned).toHaveLength(0);
  });

  it("builds agent-to-agent chains", () => {
    const chart = buildOrgChart(
      [human("h1", "Ada")],
      [
        agent("a1", "Atlas", { reportsToUserId: "h1" }),
        agent("a2", "Nova", { reportsToAgentId: "a1" }),
      ]
    );
    const atlas = chart.roots[0].children[0];
    expect(atlas.children.map((c) => c.name)).toEqual(["Nova"]);
  });

  it("puts agents without a manager under unassigned", () => {
    const chart = buildOrgChart([human("h1", "Ada")], [agent("a1", "Solo")]);
    expect(chart.unassigned.map((n) => n.name)).toEqual(["Solo"]);
  });

  it("does not loop on cyclic data", () => {
    const chart = buildOrgChart(
      [],
      [
        agent("a1", "One", { reportsToAgentId: "a2" }),
        agent("a2", "Two", { reportsToAgentId: "a1" }),
      ]
    );
    // Both members of the cycle end up unassigned rather than crashing.
    expect(chart.unassigned.map((n) => n.name).sort()).toEqual(["One", "Two"]);
  });

  it("treats a manager pointing at a missing agent as unassigned", () => {
    const chart = buildOrgChart([], [agent("a1", "Orphan", { reportsToAgentId: "ghost" })]);
    expect(chart.unassigned.map((n) => n.name)).toEqual(["Orphan"]);
  });
});
