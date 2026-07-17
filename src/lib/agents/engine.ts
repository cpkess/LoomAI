import { and, eq } from "drizzle-orm";
import { generateText } from "ai";
import { z } from "zod";

import { resolveChatModel } from "@/lib/ai/registry";
import { db } from "@/lib/db";
import {
  agentTaskAssignments,
  agentTasks,
  agents,
  organizations,
  type Agent,
  type Organization,
} from "@/lib/db/schema";
import { retrieveContext } from "@/lib/rag/retrieve";

import { extractJson } from "./json";
import { fallbackModelId, resolveAgentRuntime } from "./resolve";

// The delegation engine executes tasks over the AI org chart:
//
//   1. A task is assigned to a coordinator agent.
//   2. If the coordinator has direct reports, it decomposes the task into
//      subtasks (JSON plan) routed to those reports; each worker executes
//      its subtask with its own persona, model, and knowledge; the
//      coordinator then aggregates the results into the final deliverable.
//   3. An agent with no reports (or a plan that fails to parse) completes
//      the task solo.
//
// Runs in-process like the ingestion queue; every state transition is
// persisted so the Tasks UI can poll live progress.

const MAX_SUBTASKS = 5;

const queue: string[] = [];
let running = false;

export function enqueueTask(taskId: string): void {
  queue.push(taskId);
  if (!running) void drain();
}

async function drain(): Promise<void> {
  running = true;
  try {
    while (queue.length > 0) {
      const taskId = queue.shift()!;
      try {
        await runTask(taskId);
      } catch (err) {
        console.error(`task ${taskId} failed`, err);
        await setTask(taskId, {
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    running = false;
  }
}

async function setTask(
  taskId: string,
  values: Partial<{ status: "pending" | "in_progress" | "completed" | "failed" | "cancelled"; result: string | null; error: string | null }>
): Promise<void> {
  await db
    .update(agentTasks)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(agentTasks.id, taskId));
}

async function agentReply(agent: Agent, org: Organization, prompt: string, extraSystem?: string): Promise<string> {
  const runtime = await resolveAgentRuntime(agent, org);
  const modelDbId = runtime.modelDbId ?? (await fallbackModelId());
  if (!modelDbId) throw new Error("No AI model available — register a provider and enable a chat model");
  const { model } = await resolveChatModel(modelDbId);

  const retrieved = await retrieveContext(runtime.collectionIds, prompt);
  const system = [runtime.system, extraSystem, retrieved.contextBlock].filter(Boolean).join("\n\n");

  const { text } = await generateText({ model, system, prompt });
  return text;
}

const planSchema = z.object({
  subtasks: z
    .array(
      z.object({
        title: z.string().min(1),
        description: z.string().min(1),
        assignee: z.string().min(1),
      })
    )
    .min(1)
    .max(MAX_SUBTASKS),
});

async function runTask(taskId: string): Promise<void> {
  const task = await db.query.agentTasks.findFirst({ where: eq(agentTasks.id, taskId) });
  if (!task || task.status === "cancelled") return;

  const assignment = await db.query.agentTaskAssignments.findFirst({
    where: and(eq(agentTaskAssignments.taskId, taskId), eq(agentTaskAssignments.role, "coordinator")),
  });
  if (!assignment) throw new Error("Task has no coordinator assignment");

  const coordinator = await db.query.agents.findFirst({ where: eq(agents.id, assignment.agentId) });
  if (!coordinator) throw new Error("Coordinator agent no longer exists");
  if (coordinator.status !== "active") throw new Error(`${coordinator.name} is paused`);

  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, task.organizationId) });
  if (!org) throw new Error("Organization not found");

  await setTask(taskId, { status: "in_progress", error: null });

  const reports = await db.query.agents.findMany({
    where: and(eq(agents.reportsToAgentId, coordinator.id), eq(agents.status, "active")),
  });

  const taskText = `Task: ${task.title}${task.description ? `\n\n${task.description}` : ""}`;

  // Solo execution when the coordinator has nobody to delegate to.
  if (reports.length === 0) {
    const result = await agentReply(coordinator, org, `${taskText}\n\nComplete this task and deliver the result.`);
    await setTask(taskId, { status: "completed", result });
    return;
  }

  // 1. Ask the coordinator for a delegation plan.
  const roster = reports.map((r) => `- ${r.name} (id: ${r.id}) — ${r.title}`).join("\n");
  const planText = await agentReply(
    coordinator,
    org,
    [
      taskText,
      "",
      "You manage the following direct reports:",
      roster,
      "",
      `Break the task into up to ${MAX_SUBTASKS} subtasks and assign each to the best-suited report.`,
      'Respond with JSON only, in this exact shape: {"subtasks":[{"title":"...","description":"...","assignee":"<report id>"}]}',
    ].join("\n")
  );

  const parsed = planSchema.safeParse(extractJson(planText));
  const reportsById = new Map(reports.map((r) => [r.id, r]));
  const plan = parsed.success
    ? parsed.data.subtasks.filter((s) => reportsById.has(s.assignee)).slice(0, MAX_SUBTASKS)
    : [];

  // A plan we can't parse (or that names unknown assignees) falls back to
  // solo execution rather than failing the task — weaker local models
  // shouldn't brick delegation.
  if (plan.length === 0) {
    const result = await agentReply(coordinator, org, `${taskText}\n\nComplete this task and deliver the result.`);
    await setTask(taskId, { status: "completed", result });
    return;
  }

  // 2. Create child tasks and run each worker.
  const workerResults: { agent: Agent; title: string; result: string }[] = [];
  for (const subtask of plan) {
    const worker = reportsById.get(subtask.assignee)!;
    const [child] = await db
      .insert(agentTasks)
      .values({
        organizationId: org.id,
        parentTaskId: task.id,
        title: subtask.title,
        description: subtask.description,
        status: "in_progress",
        createdByAgentId: coordinator.id,
      })
      .returning();
    await db.insert(agentTaskAssignments).values({ taskId: child.id, agentId: worker.id, role: "worker" });

    try {
      const result = await agentReply(
        worker,
        org,
        `Your manager ${coordinator.name} assigned you this subtask as part of "${task.title}":\n\nSubtask: ${subtask.title}\n${subtask.description}\n\nComplete it and deliver the result.`
      );
      await setTask(child.id, { status: "completed", result });
      workerResults.push({ agent: worker, title: subtask.title, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await setTask(child.id, { status: "failed", error: message });
      workerResults.push({ agent: worker, title: subtask.title, result: `(failed: ${message})` });
    }
  }

  // 3. Coordinator aggregates the workers' output into the deliverable.
  const aggregation = await agentReply(
    coordinator,
    org,
    [
      taskText,
      "",
      "Your reports have completed their subtasks:",
      ...workerResults.map((w) => `\n### ${w.title} — by ${w.agent.name} (${w.agent.title})\n${w.result}`),
      "",
      "Combine their work into the final deliverable for this task. Resolve conflicts and fill gaps yourself.",
    ].join("\n")
  );

  await setTask(taskId, { status: "completed", result: aggregation });
}
