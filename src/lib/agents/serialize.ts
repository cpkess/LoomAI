import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { agentTaskAssignments, agentTaskUpdates, agentTasks, agents, users } from "@/lib/db/schema";

// Serialize top-level tasks (and their subtasks + activity timeline) into the
// shape the Tasks/Projects UI renders. Shared by the tasks list and project
// detail endpoints.
export async function serializeTaskTree(where: { organizationId: string; projectId?: string | null }) {
  const rootFilter = [
    eq(agentTasks.organizationId, where.organizationId),
    isNull(agentTasks.parentTaskId),
    where.projectId === undefined
      ? isNull(agentTasks.projectId)
      : where.projectId === null
        ? isNull(agentTasks.projectId)
        : eq(agentTasks.projectId, where.projectId),
  ];

  const roots = await db.query.agentTasks.findMany({
    where: and(...rootFilter),
    orderBy: (t, { desc }) => desc(t.createdAt),
    limit: 100,
  });
  const rootIds = roots.map((t) => t.id);
  const children = rootIds.length
    ? await db.query.agentTasks.findMany({
        where: inArray(agentTasks.parentTaskId, rootIds),
        orderBy: asc(agentTasks.createdAt),
      })
    : [];
  const allIds = [...rootIds, ...children.map((c) => c.id)];
  const assignments = allIds.length
    ? await db.query.agentTaskAssignments.findMany({ where: inArray(agentTaskAssignments.taskId, allIds) })
    : [];
  const updates = rootIds.length
    ? await db.query.agentTaskUpdates.findMany({
        where: inArray(agentTaskUpdates.taskId, rootIds),
        orderBy: asc(agentTaskUpdates.createdAt),
      })
    : [];
  const authorIds = [...new Set(updates.map((u) => u.authorUserId).filter((x): x is string => Boolean(x)))];
  const authors = authorIds.length ? await db.query.users.findMany({ where: inArray(users.id, authorIds) }) : [];
  const authorsById = new Map(authors.map((u) => [u.id, u.name]));
  const agentIds = [...new Set(assignments.map((a) => a.agentId))];
  const taskAgents = agentIds.length ? await db.query.agents.findMany({ where: inArray(agents.id, agentIds) }) : [];
  const agentsById = new Map(taskAgents.map((a) => [a.id, a]));

  const serialize = (task: (typeof roots)[number]) => {
    const assignment = assignments.find((a) => a.taskId === task.id);
    const agent = assignment ? agentsById.get(assignment.agentId) : undefined;
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      result: task.result,
      error: task.error,
      stageId: task.stageId ?? null,
      createdAt: task.createdAt,
      agent: agent
        ? { id: agent.id, name: agent.name, title: agent.title, avatarColor: agent.avatarColor }
        : null,
    };
  };

  return roots.map((root) => ({
    ...serialize(root),
    subtasks: children.filter((c) => c.parentTaskId === root.id).map(serialize),
    updates: updates
      // "validation" is a retired kind; ignore any legacy rows.
      .filter((u) => u.taskId === root.id && u.kind !== "validation")
      .map((u) => ({
        id: u.id,
        kind: u.kind,
        content: u.content,
        author: u.authorUserId ? (authorsById.get(u.authorUserId) ?? "Unknown") : null,
        createdAt: u.createdAt,
      })),
  }));
}
