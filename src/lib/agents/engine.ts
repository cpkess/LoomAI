import { and, asc, eq } from "drizzle-orm";
import { generateText, stepCountIs } from "ai";
import { z } from "zod";

import { resolveChatModel } from "@/lib/ai/registry";
import { buildAgentTools, describeAuthority } from "@/lib/company/tools";
import { db } from "@/lib/db";
import {
  agentTaskAssignments,
  agentTaskUpdates,
  agentTasks,
  agents,
  organizations,
  type Agent,
  type MessageAction,
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

interface QueueEntry {
  taskId: string;
  mode: "run" | "continue";
}

const queue: QueueEntry[] = [];
let running = false;

export function enqueueTask(taskId: string, mode: "run" | "continue" = "run"): void {
  queue.push({ taskId, mode });
  if (!running) void drain();
}

async function drain(): Promise<void> {
  running = true;
  try {
    while (queue.length > 0) {
      const entry = queue.shift()!;
      try {
        if (entry.mode === "continue") await continueTask(entry.taskId);
        else await runTask(entry.taskId);
      } catch (err) {
        console.error(`task ${entry.taskId} failed`, err);
        await setTask(entry.taskId, {
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

interface AgentReplyOptions {
  extraSystem?: string;
  /** Offer the agent its granted company-action tools (permissions apply). */
  withTools?: boolean;
  /** Collects company actions the agent took during this reply. */
  actions?: MessageAction[];
}

async function agentReply(
  agent: Agent,
  org: Organization,
  prompt: string,
  options: AgentReplyOptions = {}
): Promise<string> {
  const runtime = await resolveAgentRuntime(agent, org);
  const modelDbId = runtime.modelDbId ?? (await fallbackModelId());
  if (!modelDbId) throw new Error("No AI model available — register a provider and enable a chat model");
  const { model } = await resolveChatModel(modelDbId);

  const toolContext = { actions: options.actions ?? [] };
  const tools = options.withTools ? buildAgentTools(agent, org, toolContext) : {};
  const authority = options.withTools ? describeAuthority(agent, org) : null;

  const retrieved = await retrieveContext(runtime.collectionIds, prompt);
  const system = [runtime.system, authority, options.extraSystem, retrieved.contextBlock]
    .filter(Boolean)
    .join("\n\n");

  const { text } = await generateText({
    model,
    system,
    prompt,
    ...(Object.keys(tools).length > 0 ? { tools, stopWhen: stepCountIs(6) } : {}),
  });
  return text;
}

/** Render taken actions as an explicit block appended to a task result. */
function actionsBlock(actions: MessageAction[]): string {
  if (actions.length === 0) return "";
  const lines = actions.map(
    (a) =>
      `- ${a.summary} — ${a.status === "executed" ? "executed" : a.status === "pending_approval" ? "awaiting Board approval" : "failed"}`
  );
  return `\n\n**Actions taken:**\n${lines.join("\n")}`;
}

async function recordResult(taskId: string, content: string): Promise<void> {
  await db.insert(agentTaskUpdates).values({ taskId, kind: "result", content });
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
    const actions: MessageAction[] = [];
    const result =
      (await agentReply(
        coordinator,
        org,
        `${taskText}\n\nComplete this task and deliver the result. If it calls for company actions you have tools for, perform them — do not merely describe them.`,
        { withTools: true, actions }
      )) + actionsBlock(actions);
    await setTask(taskId, { status: "completed", result });
    await recordResult(taskId, result);
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
    const actions: MessageAction[] = [];
    const result =
      (await agentReply(
        coordinator,
        org,
        `${taskText}\n\nComplete this task and deliver the result. If it calls for company actions you have tools for, perform them — do not merely describe them.`,
        { withTools: true, actions }
      )) + actionsBlock(actions);
    await setTask(taskId, { status: "completed", result });
    await recordResult(taskId, result);
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
      const workerActions: MessageAction[] = [];
      const result =
        (await agentReply(
          worker,
          org,
          `Your manager ${coordinator.name} assigned you this subtask as part of "${task.title}":\n\nSubtask: ${subtask.title}\n${subtask.description}\n\nComplete it and deliver the result. If it calls for company actions you have tools for, perform them — do not merely describe them.`,
          { withTools: true, actions: workerActions }
        )) + actionsBlock(workerActions);
      await setTask(child.id, { status: "completed", result });
      workerResults.push({ agent: worker, title: subtask.title, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await setTask(child.id, { status: "failed", error: message });
      workerResults.push({ agent: worker, title: subtask.title, result: `(failed: ${message})` });
    }
  }

  // 3. Coordinator aggregates the workers' output into the deliverable.
  const aggregationActions: MessageAction[] = [];
  const aggregation =
    (await agentReply(
      coordinator,
      org,
      [
        taskText,
        "",
        "Your reports have completed their subtasks:",
        ...workerResults.map((w) => `\n### ${w.title} — by ${w.agent.name} (${w.agent.title})\n${w.result}`),
        "",
        "Combine their work into the final deliverable for this task. Resolve conflicts and fill gaps yourself.",
        "If completing the task requires company actions you have tools for and they have not been performed yet, perform them now.",
      ].join("\n"),
      { withTools: true, actions: aggregationActions }
    )) + actionsBlock(aggregationActions);

  await setTask(taskId, { status: "completed", result: aggregation });
  await recordResult(taskId, aggregation);
}

/**
 * Continue a task after human feedback: the coordinator re-engages with the
 * full history (previous results + feedback) and its company-action tools,
 * so "you only described the hire — actually do it" leads to real execution.
 */
async function continueTask(taskId: string): Promise<void> {
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

  const updates = await db.query.agentTaskUpdates.findMany({
    where: eq(agentTaskUpdates.taskId, taskId),
    orderBy: asc(agentTaskUpdates.createdAt),
  });

  const history = updates
    .map((u) => (u.kind === "feedback" ? `[Feedback from the Board/requester]\n${u.content}` : `[Your previous result]\n${u.content}`))
    .join("\n\n---\n\n");

  const actions: MessageAction[] = [];
  const result =
    (await agentReply(
      coordinator,
      org,
      [
        `Task: ${task.title}${task.description ? `\n\n${task.description}` : ""}`,
        "",
        "History of this task so far:",
        history || "(no recorded history)",
        "",
        "Address the latest feedback and continue the task to completion.",
        "If the feedback asks for company actions you have tools for, perform them now — do not merely describe or promise them.",
      ].join("\n"),
      { withTools: true, actions }
    )) + actionsBlock(actions);

  await setTask(taskId, { status: "completed", result, error: null });
  await recordResult(taskId, result);
}
