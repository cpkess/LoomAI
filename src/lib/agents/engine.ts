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
  boardEmails,
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
//   4. Every deliverable passes a validation hook that checks the ORIGINAL
//      goal was actually achieved; if not, the task fails cleanly with a
//      reason (an acceptable outcome) instead of reporting false success.
//
// A single per-task activity log (plan, subtask results, deliverables,
// feedback, validation verdicts) is the shared memory every agent reads
// before working, so context is never lost across the team or across
// feedback rounds. Runs in-process like the ingestion queue; every state
// transition is persisted so the Tasks UI can poll live progress.

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

// The task log is the shared memory of a task. Every meaningful step —
// delegation plan, subtask results, aggregated deliverables, human feedback,
// and validation verdicts — is appended here so no agent working the task
// ever loses context.
type UpdateKind = "result" | "feedback" | "plan" | "subtask_result" | "validation";

const UPDATE_LABELS: Record<UpdateKind, string> = {
  result: "Result",
  feedback: "Feedback from the requester",
  plan: "Delegation plan",
  subtask_result: "Subtask result",
  validation: "Goal validation",
};

async function recordUpdate(taskId: string, kind: UpdateKind, content: string): Promise<void> {
  await db.insert(agentTaskUpdates).values({ taskId, kind, content });
}

/** Full ordered activity log for a task, formatted for an agent to read. */
async function taskLog(taskId: string): Promise<string> {
  const updates = await db.query.agentTaskUpdates.findMany({
    where: eq(agentTaskUpdates.taskId, taskId),
    orderBy: asc(agentTaskUpdates.createdAt),
  });
  if (updates.length === 0) return "(no prior activity)";
  return updates
    .map((u) => `[${UPDATE_LABELS[u.kind as UpdateKind] ?? u.kind}]\n${u.content}`)
    .join("\n\n---\n\n");
}

const validationSchema = z.object({ achieved: z.boolean(), reason: z.string().min(1) });

/**
 * Validation hook: after a deliverable is produced, critically check that the
 * ORIGINAL goal was actually achieved — not merely described or planned. A
 * clean failure (missing data, blocked, only described) is an acceptable,
 * intended outcome. The coordinator performs the check with a critical
 * framing and no tools (read-only judgment); an unparseable verdict from a
 * weak model does not false-fail the task.
 */
async function validateGoal(
  coordinator: Agent,
  org: Organization,
  task: { id: string; title: string; description: string | null },
  deliverable: string
): Promise<{ achieved: boolean; reason: string }> {
  const prompt = [
    "You are validating whether a company task actually achieved its original goal.",
    "",
    `Original goal:\nTask: ${task.title}${task.description ? `\n${task.description}` : ""}`,
    "",
    "Full activity log for this task:",
    await taskLog(task.id),
    "",
    "Proposed final deliverable:",
    deliverable,
    "",
    "Verify critically. If the goal required a company action (e.g. hiring, creating a department), confirm it was ACTUALLY executed — look for an 'Actions taken' section showing 'executed' or 'awaiting Board approval'. Work that only describes or plans the action, or is blocked by missing data, has NOT achieved the goal.",
    "It is correct and acceptable to report failure when the goal was not achieved — do not pretend success.",
    "Treat an action that is correctly 'awaiting Board approval' as achieved (the goal is properly in motion).",
    'Respond with JSON only: {"achieved": true|false, "reason": "one concise sentence"}',
  ].join("\n");

  const text = await agentReply(coordinator, org, prompt);
  const parsed = validationSchema.safeParse(extractJson(text));
  if (!parsed.success) {
    return { achieved: true, reason: "Validation inconclusive (verdict could not be parsed); accepted as complete." };
  }
  return parsed.data;
}

/**
 * Record the deliverable, run the validation hook, and set the terminal
 * status: completed when the goal was achieved, failed (with the reason) when
 * it was not. The deliverable is kept either way so the requester can review
 * it and follow up with feedback.
 */
async function finalize(
  taskId: string,
  coordinator: Agent,
  org: Organization,
  task: { id: string; title: string; description: string | null },
  deliverable: string
): Promise<void> {
  await setTask(taskId, { result: deliverable });
  await recordUpdate(taskId, "result", deliverable);

  const verdict = await validateGoal(coordinator, org, task, deliverable);
  await recordUpdate(taskId, "validation", `${verdict.achieved ? "PASSED" : "FAILED"} — ${verdict.reason}`);

  const outcome = verdict.achieved ? "completed" : "failed";
  if (verdict.achieved) {
    await setTask(taskId, { status: "completed", error: null });
  } else {
    await setTask(taskId, { status: "failed", error: verdict.reason });
  }

  // Email the Board the final output so it lands in the Board room inbox.
  const statusLine = verdict.achieved
    ? "✅ Completed — goal achieved."
    : `⚠️ Could not fully complete — ${verdict.reason}`;
  await db.insert(boardEmails).values({
    organizationId: org.id,
    taskId,
    fromAgentId: coordinator.id,
    fromName: `${coordinator.name} (${coordinator.title})`,
    subject: `${verdict.achieved ? "Task complete" : "Task needs attention"}: ${task.title}`,
    body: `${statusLine}\n\n${deliverable}`,
    outcome,
  });
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
    await finalize(taskId, coordinator, org, task, result);
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
    await finalize(taskId, coordinator, org, task, result);
    return;
  }

  // Record the plan so workers (and later readers) see how the task was split.
  await recordUpdate(
    task.id,
    "plan",
    plan.map((s) => `- ${s.title} → ${reportsById.get(s.assignee)!.name}\n  ${s.description}`).join("\n")
  );

  // 2. Create child tasks and run each worker. Each worker reads the full
  //    parent task log (goal, plan, and any sibling results so far) so no
  //    context is lost across the team.
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
          [
            `You are working on a subtask of a larger company task led by your manager ${coordinator.name}.`,
            "",
            `Overall task: ${task.title}${task.description ? `\n${task.description}` : ""}`,
            "",
            "Full activity log for the overall task so far (read it to stay in context):",
            await taskLog(task.id),
            "",
            `Your assigned subtask:\nSubtask: ${subtask.title}\n${subtask.description}`,
            "",
            "Complete your subtask and deliver the result. If it calls for company actions you have tools for, perform them — do not merely describe them. If you cannot complete it (e.g. missing data), say so clearly.",
          ].join("\n"),
          { withTools: true, actions: workerActions }
        )) + actionsBlock(workerActions);
      await setTask(child.id, { status: "completed", result });
      await recordUpdate(task.id, "subtask_result", `${subtask.title} — by ${worker.name} (${worker.title}):\n${result}`);
      workerResults.push({ agent: worker, title: subtask.title, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await setTask(child.id, { status: "failed", error: message });
      await recordUpdate(task.id, "subtask_result", `${subtask.title} — by ${worker.name}: FAILED — ${message}`);
      workerResults.push({ agent: worker, title: subtask.title, result: `(failed: ${message})` });
    }
  }

  // 3. Coordinator aggregates the workers' output into the deliverable, with
  //    the full task log available.
  const aggregationActions: MessageAction[] = [];
  const aggregation =
    (await agentReply(
      coordinator,
      org,
      [
        taskText,
        "",
        "Full activity log for this task (plan and every subtask result):",
        await taskLog(task.id),
        "",
        "Combine your reports' work into the final deliverable for this task. Resolve conflicts and fill gaps yourself.",
        "If completing the task requires company actions you have tools for and they have not been performed yet, perform them now.",
      ].join("\n"),
      { withTools: true, actions: aggregationActions }
    )) + actionsBlock(aggregationActions);

  await finalize(taskId, coordinator, org, task, aggregation);
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

  const actions: MessageAction[] = [];
  const result =
    (await agentReply(
      coordinator,
      org,
      [
        `Task: ${task.title}${task.description ? `\n\n${task.description}` : ""}`,
        "",
        "Full activity log for this task so far (every result, feedback, and validation — read it all so no context is lost):",
        await taskLog(task.id),
        "",
        "Address the latest feedback and continue the task to completion.",
        "If the feedback asks for company actions you have tools for, perform them now — do not merely describe or promise them.",
      ].join("\n"),
      { withTools: true, actions }
    )) + actionsBlock(actions);

  await finalize(taskId, coordinator, org, task, result);
}
