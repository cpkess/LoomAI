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
  projects,
  type Agent,
  type MessageAction,
  type Organization,
} from "@/lib/db/schema";
import { addTextToKnowledge, defaultKnowledgeCollectionId } from "@/lib/rag/knowledge";
import { retrieveContext } from "@/lib/rag/retrieve";

import { getChiefAgent } from "./chief";
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
//   4. On completion the deliverable is emailed to the Board and, when the
//      org's auto-knowledge setting is on, the coordinator decides whether it
//      is reusable reference material and files it in the knowledge base.
//
// Projects are larger requests: a project manager plans a project into tasks
// (each of which runs through the engine); when all a project's tasks finish
// the manager writes a summary.
//
// A single per-task activity log (plan, subtask results, deliverables, and
// feedback) is the shared memory every agent reads before working. Runs
// in-process like the ingestion queue; every state transition is persisted so
// the UI can poll live progress.

const MAX_SUBTASKS = 5;
const MAX_PROJECT_TASKS = 6;

interface QueueEntry {
  id: string;
  mode: "run" | "continue" | "project";
}

const queue: QueueEntry[] = [];
let running = false;

export function enqueueTask(taskId: string, mode: "run" | "continue" = "run"): void {
  queue.push({ id: taskId, mode });
  if (!running) void drain();
}

export function enqueueProject(projectId: string): void {
  queue.push({ id: projectId, mode: "project" });
  if (!running) void drain();
}

async function drain(): Promise<void> {
  running = true;
  try {
    while (queue.length > 0) {
      const entry = queue.shift()!;
      try {
        if (entry.mode === "project") await planProject(entry.id);
        else if (entry.mode === "continue") await continueTask(entry.id);
        else await runTask(entry.id);
      } catch (err) {
        console.error(`${entry.mode} ${entry.id} failed`, err);
        if (entry.mode === "project") {
          await db
            .update(projects)
            .set({ status: "in_progress", updatedAt: new Date() })
            .where(eq(projects.id, entry.id));
        } else {
          await setTask(entry.id, {
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
          });
        }
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
// delegation plan, subtask results, aggregated deliverables, and human
// feedback — is appended here so no agent working the task ever loses context.
type UpdateKind = "result" | "feedback" | "plan" | "subtask_result";

const UPDATE_LABELS: Record<UpdateKind, string> = {
  result: "Result",
  feedback: "Feedback from the requester",
  plan: "Delegation plan",
  subtask_result: "Subtask result",
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

/**
 * Record the deliverable, mark the task complete, email the Board, auto-curate
 * knowledge, and advance the parent project if any. The deliverable is kept so
 * the requester can review it and follow up with feedback.
 */
async function finalize(
  taskId: string,
  coordinator: Agent,
  org: Organization,
  task: { id: string; title: string; description: string | null; projectId?: string | null },
  deliverable: string
): Promise<void> {
  await setTask(taskId, { result: deliverable, status: "completed", error: null });
  await recordUpdate(taskId, "result", deliverable);

  // Email the Board the final output so it lands in the Board room inbox.
  await db.insert(boardEmails).values({
    organizationId: org.id,
    taskId,
    fromAgentId: coordinator.id,
    fromName: `${coordinator.name} (${coordinator.title})`,
    subject: `Task complete: ${task.title}`,
    body: deliverable,
    outcome: "completed",
  });

  await curateKnowledge(coordinator, org, task, deliverable);

  if (task.projectId) await checkProjectCompletion(task.projectId);
}

const curationSchema = z.object({
  save: z.boolean(),
  title: z.string().optional(),
  content: z.string().optional(),
});

function autoKnowledgeEnabled(org: Organization): boolean {
  const settings = (org.settings ?? {}) as { autoKnowledge?: boolean };
  // On by default; only an explicit false disables it.
  return settings.autoKnowledge !== false;
}

/**
 * The company decides what to remember: after a deliverable, the coordinator
 * judges whether it is reusable reference knowledge and, if so, files a
 * cleaned version in the knowledge base automatically.
 */
async function curateKnowledge(
  coordinator: Agent,
  org: Organization,
  task: { id: string; title: string; description: string | null },
  deliverable: string
): Promise<void> {
  if (!autoKnowledgeEnabled(org)) return;
  try {
    const text = await agentReply(
      coordinator,
      org,
      [
        "You decide what the company should remember in its shared knowledge base.",
        "",
        `Task: ${task.title}${task.description ? `\n${task.description}` : ""}`,
        "",
        "Deliverable:",
        deliverable,
        "",
        "If this deliverable contains reusable reference knowledge worth keeping for the whole company (facts, decisions, guides, research, specs), respond to save it. If it is ephemeral, a one-off chat, or not useful later, do not save.",
        'Respond with JSON only: {"save": true, "title": "concise document title", "content": "the cleaned, self-contained knowledge to store"} or {"save": false}.',
      ].join("\n")
    );
    const parsed = curationSchema.safeParse(extractJson(text));
    if (!parsed.success || !parsed.data.save) return;
    const title = parsed.data.title?.trim() || task.title;
    const content = parsed.data.content?.trim() || deliverable;
    const collectionId = await defaultKnowledgeCollectionId(org.id);
    await addTextToKnowledge({ orgId: org.id, collectionId, title, content });
    await recordUpdate(task.id, "result", `📚 Filed in the knowledge base: "${title}"`);
  } catch (err) {
    console.error("knowledge curation failed", err);
  }
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
        "Full activity log for this task so far (every result and feedback — read it all so no context is lost):",
        await taskLog(task.id),
        "",
        "Address the latest feedback and continue the task to completion.",
        "If the feedback asks for company actions you have tools for, perform them now — do not merely describe or promise them.",
      ].join("\n"),
      { withTools: true, actions }
    )) + actionsBlock(actions);

  await finalize(taskId, coordinator, org, task, result);
}

// --- Projects --------------------------------------------------------------

/**
 * Create a task (with a coordinator assignment) and enqueue it. Shared by
 * project planning and the manual "add task to project" flow.
 */
export async function createAndEnqueueTask(options: {
  orgId: string;
  title: string;
  description?: string | null;
  coordinatorAgentId: string;
  projectId?: string | null;
  createdByUserId?: string | null;
  createdByAgentId?: string | null;
}): Promise<string> {
  const [task] = await db
    .insert(agentTasks)
    .values({
      organizationId: options.orgId,
      projectId: options.projectId ?? null,
      title: options.title,
      description: options.description ?? null,
      status: "pending",
      createdByUserId: options.createdByUserId ?? null,
      createdByAgentId: options.createdByAgentId ?? null,
    })
    .returning();
  await db.insert(agentTaskAssignments).values({ taskId: task.id, agentId: options.coordinatorAgentId, role: "coordinator" });
  enqueueTask(task.id);
  return task.id;
}

const projectPlanSchema = z.object({
  tasks: z
    .array(z.object({ title: z.string().min(1), description: z.string().min(1) }))
    .min(1)
    .max(MAX_PROJECT_TASKS),
});

/**
 * The project manager breaks a project into tasks. Each task is created in the
 * project and enqueued; a manager delegates each to the best-suited report, or
 * runs it themselves when they have no reports.
 */
async function planProject(projectId: string): Promise<void> {
  const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });
  if (!project || project.status === "cancelled") return;
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, project.organizationId) });
  if (!org) throw new Error("Organization not found");

  const manager = project.managerAgentId
    ? await db.query.agents.findFirst({ where: eq(agents.id, project.managerAgentId) })
    : await getChiefAgent(org.id);
  if (!manager) throw new Error("No project manager available");

  const reports = await db.query.agents.findMany({
    where: and(eq(agents.reportsToAgentId, manager.id), eq(agents.status, "active")),
  });
  const assignee = reports[0] ?? manager;

  const planText = await agentReply(
    manager,
    org,
    [
      `You are the project manager for this project:`,
      `Project: ${project.title}${project.description ? `\n${project.description}` : ""}`,
      "",
      `Break the project into up to ${MAX_PROJECT_TASKS} concrete tasks that together deliver the project. Each task should be self-contained and independently workable.`,
      'Respond with JSON only: {"tasks":[{"title":"...","description":"..."}]}',
    ].join("\n")
  );
  const parsed = projectPlanSchema.safeParse(extractJson(planText));
  const tasks = parsed.success ? parsed.data.tasks : [{ title: project.title, description: project.description ?? project.title }];

  await db.update(projects).set({ status: "in_progress", updatedAt: new Date() }).where(eq(projects.id, projectId));

  for (const t of tasks) {
    await createAndEnqueueTask({
      orgId: org.id,
      projectId,
      title: t.title,
      description: t.description,
      coordinatorAgentId: assignee.id,
      createdByAgentId: manager.id,
    });
  }
}

/**
 * When every task in a project has reached a terminal state, the manager
 * writes a project summary, the project is marked complete, and the Board is
 * emailed.
 */
async function checkProjectCompletion(projectId: string): Promise<void> {
  const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });
  if (!project || project.status === "completed" || project.status === "cancelled") return;

  const tasks = await db.query.agentTasks.findMany({ where: eq(agentTasks.projectId, projectId) });
  if (tasks.length === 0) return;
  const allDone = tasks.every((t) => t.status === "completed" || t.status === "failed");
  if (!allDone) return;

  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, project.organizationId) });
  if (!org) return;
  const manager = project.managerAgentId
    ? await db.query.agents.findFirst({ where: eq(agents.id, project.managerAgentId) })
    : await getChiefAgent(org.id);

  let summary = tasks.map((t) => `- ${t.title}: ${t.status}`).join("\n");
  if (manager) {
    try {
      summary = await agentReply(
        manager,
        org,
        [
          `The project "${project.title}" is complete. Its tasks and their results:`,
          "",
          ...tasks.map((t) => `### ${t.title} (${t.status})\n${t.result ?? t.error ?? "(no result)"}`),
          "",
          "Write a concise executive summary of the project outcome for the Board.",
        ].join("\n")
      );
    } catch (err) {
      console.error("project summary failed", err);
    }
  }

  await db.update(projects).set({ status: "completed", summary, updatedAt: new Date() }).where(eq(projects.id, projectId));

  await db.insert(boardEmails).values({
    organizationId: org.id,
    fromAgentId: manager?.id ?? null,
    fromName: manager ? `${manager.name} (${manager.title})` : "Project manager",
    subject: `Project complete: ${project.title}`,
    body: summary,
    outcome: "completed",
  });

  if (autoKnowledgeEnabled(org) && manager) {
    await curateKnowledge(manager, org, { id: tasks[0].id, title: project.title, description: project.description }, summary).catch(
      () => {}
    );
  }
}
