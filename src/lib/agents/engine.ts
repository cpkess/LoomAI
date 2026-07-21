import { and, asc, eq } from "drizzle-orm";
import { generateText, stepCountIs } from "ai";
import { z } from "zod";

import { asDetailedModelError, isRecoverableModelError } from "@/lib/ai/errors";
import { generation, limits, type GenSettings } from "@/lib/ai/generation";
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
  projectStages,
  projects,
  type Agent,
  type MessageAction,
  type Organization,
  type ProjectStage,
} from "@/lib/db/schema";
import { addTextToKnowledge, defaultKnowledgeCollectionId } from "@/lib/rag/knowledge";
import { deriveTitle, isKnowledgeCandidate } from "@/lib/rag/knowledge-heuristics";
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
// Projects are larger, longer initiatives. A project manager plans a project
// into ordered MILESTONES (stages), each with a GATE: an `auto` gate advances
// the moment its tasks finish; a `review` gate pauses for the Board to approve
// or request changes. Each milestone is planned into tasks only when it becomes
// active, so feedback at one gate informs the planning of the next — the
// project gets smarter as it runs. When every milestone is done the manager
// writes a project summary.
//
// A single per-task activity log (plan, subtask results, deliverables, and
// feedback) is the shared memory every agent reads before working. Runs
// in-process like the ingestion queue; every state transition is persisted so
// the UI can poll live progress.

interface QueueEntry {
  id: string;
  mode: "run" | "continue" | "project" | "stage";
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

/** Plan a milestone into tasks and start it (off the request thread). */
export function enqueueStage(stageId: string): void {
  queue.push({ id: stageId, mode: "stage" });
  if (!running) void drain();
}

async function drain(): Promise<void> {
  running = true;
  try {
    while (queue.length > 0) {
      const entry = queue.shift()!;
      try {
        if (entry.mode === "project") await planProject(entry.id);
        else if (entry.mode === "stage") await planStage(entry.id);
        else if (entry.mode === "continue") await continueTask(entry.id);
        else await runTask(entry.id);
      } catch (err) {
        console.error(`${entry.mode} ${entry.id} failed`, err);
        if (entry.mode === "project") {
          await db.update(projects).set({ status: "in_progress", updatedAt: new Date() }).where(eq(projects.id, entry.id));
        } else if (entry.mode === "stage") {
          await db.update(projectStages).set({ status: "pending", updatedAt: new Date() }).where(eq(projectStages.id, entry.id));
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
  /** Generation settings tuned per call type (planning, work, summary…). */
  gen?: GenSettings;
}

export async function agentReply(
  agent: Agent,
  org: Organization,
  prompt: string,
  options: AgentReplyOptions = {}
): Promise<string> {
  const runtime = await resolveAgentRuntime(agent, org);
  const modelDbId = runtime.modelDbId ?? (await fallbackModelId());
  if (!modelDbId) throw new Error("No AI model available — register a provider and enable a chat model");
  const { model, modelRow } = await resolveChatModel(modelDbId);

  const toolContext = { actions: options.actions ?? [] };
  const tools = options.withTools ? buildAgentTools(agent, org, toolContext) : {};
  const authority = options.withTools ? describeAuthority(agent, org) : null;

  const retrieved = await retrieveContext(runtime.collectionIds, prompt);
  const system = [runtime.system, authority, options.extraSystem, retrieved.contextBlock]
    .filter(Boolean)
    .join("\n\n");

  const gen = options.gen ?? generation.work;
  const settings = { temperature: gen.temperature, maxOutputTokens: gen.maxOutputTokens };
  const hasTools = Object.keys(tools).length > 0;

  // Attempt the call with tools when requested. Many local models don't
  // support tool-calling and reject the request (typically HTTP 400 "Bad
  // Request"); rather than fail the whole task, we retry once without tools so
  // the agent can still produce a text deliverable. Only if the tool-less
  // attempt also fails do we surface a detailed error.
  if (hasTools) {
    try {
      const { text } = await generateText({ model, system, prompt, tools, stopWhen: stepCountIs(limits.toolSteps), ...settings });
      return text;
    } catch (err) {
      if (!isRecoverableModelError(err)) throw asDetailedModelError(err, modelRow.displayName);
      // Fall through to a plain-text attempt without tools.
      const note =
        "\n\n(Note: your tools are unavailable for this step — the model could not use them. Do the task directly and describe precisely what actions still need to be taken.)";
      try {
        const { text } = await generateText({ model, system, prompt: prompt + note, ...settings });
        return text;
      } catch (err2) {
        throw asDetailedModelError(err2, modelRow.displayName);
      }
    }
  }

  try {
    const { text } = await generateText({ model, system, prompt, ...settings });
    return text;
  } catch (err) {
    throw asDetailedModelError(err, modelRow.displayName);
  }
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
  task: { id: string; title: string; description: string | null; projectId?: string | null; stageId?: string | null },
  deliverable: string
): Promise<void> {
  await setTask(taskId, { result: deliverable, status: "completed", error: null });
  await recordUpdate(taskId, "result", deliverable);

  // A task inside a project milestone doesn't email the Board on its own — the
  // milestone reports up when the whole stage finishes. Standalone tasks email
  // their deliverable straight to the Board room.
  if (!task.projectId) {
    await db.insert(boardEmails).values({
      organizationId: org.id,
      taskId,
      fromAgentId: coordinator.id,
      fromName: `${coordinator.name} (${coordinator.title})`,
      subject: `Task complete: ${task.title}`,
      body: deliverable,
      outcome: "completed",
    });
  }

  await curateKnowledge(coordinator, org, task, deliverable, task.id);

  // Advance the project this task belongs to.
  if (task.stageId) await checkStageCompletion(task.stageId);
  else if (task.projectId) await checkProjectCompletion(task.projectId);
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
 * The company remembers what it learns. After a deliverable (task, milestone,
 * or project), the output is filed in the shared knowledge base so every future
 * task can retrieve it — the organization gets smarter with every piece of work.
 *
 * Two programmatic gates keep this cheap and consistent:
 *   1. `isKnowledgeCandidate` (pure heuristic, no LLM) drops trivial, failed, or
 *      too-short outputs before any model runs.
 *   2. embedding-based dedup (in `addTextToKnowledge`) skips near-duplicates so
 *      the base grows without bloating.
 * Only genuine candidates get a single, low-temperature extraction call to
 * clean them into self-contained reference knowledge.
 */
async function curateKnowledge(
  coordinator: Agent,
  org: Organization,
  subject: { title: string; description: string | null },
  deliverable: string,
  noteTaskId?: string
): Promise<void> {
  if (!autoKnowledgeEnabled(org)) return;
  if (!isKnowledgeCandidate(deliverable)) return;

  try {
    let title: string;
    let content: string;
    try {
      const text = await agentReply(
        coordinator,
        org,
        [
          "Extract the reusable reference knowledge from this deliverable so the whole company can find it later.",
          "",
          `Topic: ${subject.title}${subject.description ? `\n${subject.description}` : ""}`,
          "",
          "Deliverable:",
          deliverable,
          "",
          "Rewrite it as clean, self-contained knowledge (facts, decisions, guides, research, specs) — no meta-commentary.",
          "If there is genuinely nothing reusable here, respond {\"save\": false}.",
          'Otherwise respond with JSON only: {"save": true, "title": "concise document title", "content": "the knowledge to store"}.',
        ].join("\n"),
        { gen: generation.extract }
      );
      const parsed = curationSchema.safeParse(extractJson(text));
      if (parsed.success && parsed.data.save === false) return;
      if (parsed.success && parsed.data.content?.trim()) {
        content = parsed.data.content.trim();
        title = parsed.data.title?.trim() || deriveTitle(content, subject.title);
      } else {
        // The extraction didn't yield clean JSON — the deliverable already
        // passed the candidacy gate, so store it as-is rather than lose the
        // learning entirely.
        content = deliverable;
        title = deriveTitle(deliverable, subject.title);
      }
    } catch {
      content = deliverable;
      title = deriveTitle(deliverable, subject.title);
    }

    const collectionId = await defaultKnowledgeCollectionId(org.id);
    const docId = await addTextToKnowledge({ orgId: org.id, collectionId, title, content, dedupe: true });
    if (docId && noteTaskId) {
      await recordUpdate(noteTaskId, "result", `📚 Filed in the knowledge base: "${title}"`);
    }
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
    .max(limits.maxSubtasks),
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
        { withTools: true, actions, gen: generation.work }
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
      `Break the task into up to ${limits.maxSubtasks} subtasks and assign each to the best-suited report. Only split work that genuinely needs more than one person — a simple task can be a single subtask.`,
      'Respond with JSON only, in this exact shape: {"subtasks":[{"title":"...","description":"...","assignee":"<report id>"}]}',
    ].join("\n"),
    { gen: generation.plan }
  );

  const parsed = planSchema.safeParse(extractJson(planText));
  const reportsById = new Map(reports.map((r) => [r.id, r]));
  const plan = parsed.success
    ? parsed.data.subtasks.filter((s) => reportsById.has(s.assignee)).slice(0, limits.maxSubtasks)
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
        { withTools: true, actions, gen: generation.work }
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
          { withTools: true, actions: workerActions, gen: generation.work }
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

  // 3. Coordinator aggregates the workers' output into the deliverable. When
  //    there was only one subtask and it succeeded, the worker's result IS the
  //    deliverable — skip a redundant aggregation call (faster, and the output
  //    stays verbatim rather than being paraphrased). Any company actions the
  //    lone worker took are already applied.
  if (plan.length === 1 && workerResults.length === 1 && !workerResults[0].result.startsWith("(failed")) {
    await finalize(taskId, coordinator, org, task, workerResults[0].result);
    return;
  }

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
      { withTools: true, actions: aggregationActions, gen: generation.work }
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
      { withTools: true, actions, gen: generation.work }
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
  stageId?: string | null;
  createdByUserId?: string | null;
  createdByAgentId?: string | null;
}): Promise<string> {
  const [task] = await db
    .insert(agentTasks)
    .values({
      organizationId: options.orgId,
      projectId: options.projectId ?? null,
      stageId: options.stageId ?? null,
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

/**
 * Decide which milestone a manually-added project task should join, so it
 * participates in the stage/gate flow like planned tasks. Prefers an
 * in-progress milestone; falls back to any not-yet-complete one; and when the
 * whole project has already finished, opens a fresh "Additional work"
 * milestone (auto gate) and reactivates the project. Returns null only for
 * legacy projects that have no milestones at all.
 */
export async function resolveManualTaskStage(projectId: string): Promise<string | null> {
  const stages = await db.query.projectStages.findMany({
    where: eq(projectStages.projectId, projectId),
    orderBy: asc(projectStages.orderIndex),
  });
  if (stages.length === 0) return null;

  const active =
    stages.find((s) => s.status === "in_progress") ??
    stages.find((s) => s.status === "awaiting_review") ??
    stages.find((s) => s.status === "pending");
  if (active) return active.id;

  // Everything is done — open a follow-up milestone.
  const maxOrder = Math.max(...stages.map((s) => s.orderIndex));
  const [stage] = await db
    .insert(projectStages)
    .values({
      projectId,
      orderIndex: maxOrder + 1,
      title: "Additional work",
      description: "Follow-up tasks added after the project's milestones completed.",
      gate: "auto",
      status: "in_progress",
    })
    .returning();
  await db.update(projects).set({ status: "in_progress", updatedAt: new Date() }).where(eq(projects.id, projectId));
  return stage.id;
}

/** Resolve a project's manager (its assigned agent, else the org's chief). */
async function projectManager(project: { managerAgentId: string | null; organizationId: string }): Promise<Agent | null> {
  return project.managerAgentId
    ? ((await db.query.agents.findFirst({ where: eq(agents.id, project.managerAgentId) })) ?? null)
    : getChiefAgent(project.organizationId);
}

const milestonePlanSchema = z.object({
  milestones: z
    .array(
      z.object({
        title: z.string().min(1),
        description: z.string().min(1),
        gate: z.enum(["auto", "review"]).optional(),
      })
    )
    .min(1)
    .max(limits.maxMilestones),
});

/**
 * Plan a project into ordered MILESTONES. The manager proposes phases, each
 * with a gate (auto/review); we persist them as `pending` stages and activate
 * the first one. Tasks for a milestone are planned only when it becomes active,
 * so feedback at earlier gates shapes later phases.
 */
async function planProject(projectId: string): Promise<void> {
  const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });
  if (!project || project.status === "cancelled") return;
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, project.organizationId) });
  if (!org) throw new Error("Organization not found");
  const manager = await projectManager(project);
  if (!manager) throw new Error("No project manager available");

  // Don't re-plan a project that already has milestones (e.g. a retry).
  const existing = await db.query.projectStages.findMany({ where: eq(projectStages.projectId, projectId) });
  if (existing.length === 0) {
    const planText = await agentReply(
      manager,
      org,
      [
        "You are the project manager. Break this project into a sequence of milestones (phases) that together deliver it.",
        "",
        `Project: ${project.title}${project.description ? `\n${project.description}` : ""}`,
        "",
        `Produce up to ${limits.maxMilestones} milestones in delivery order. Each needs a clear deliverable.`,
        'Set "gate":"review" on milestones where the Board should review progress before continuing (key decision points, before expensive or irreversible work, and the final delivery); use "gate":"auto" for routine phases that should flow straight through.',
        'Respond with JSON only: {"milestones":[{"title":"...","description":"...","gate":"auto|review"}]}',
      ].join("\n"),
      { gen: generation.plan }
    );
    const parsed = milestonePlanSchema.safeParse(extractJson(planText));
    const milestones = parsed.success
      ? parsed.data.milestones
      : [{ title: project.title, description: project.description ?? project.title, gate: "review" as const }];

    await db.insert(projectStages).values(
      milestones.map((m, i) => ({
        projectId,
        orderIndex: i,
        title: m.title,
        description: m.description,
        gate: m.gate ?? ("auto" as const),
        status: "pending" as const,
      }))
    );
  }

  await db.update(projects).set({ status: "in_progress", updatedAt: new Date() }).where(eq(projects.id, projectId));
  await advanceProject(projectId);
}

const stageTaskSchema = z.object({
  tasks: z
    .array(z.object({ title: z.string().min(1), description: z.string().min(1) }))
    .min(1)
    .max(limits.maxStageTasks),
});

/** Prior completed milestones, formatted as context for planning the next. */
async function priorStageContext(projectId: string, beforeOrder: number): Promise<string> {
  const done = await db.query.projectStages.findMany({
    where: and(eq(projectStages.projectId, projectId)),
    orderBy: asc(projectStages.orderIndex),
  });
  const prior = done.filter((s) => s.orderIndex < beforeOrder && (s.summary || s.reviewFeedback));
  if (prior.length === 0) return "";
  return [
    "Context from completed milestones so far (build on these; honor the Board's feedback):",
    ...prior.map(
      (s) =>
        `### ${s.title}\n${s.summary ?? "(no summary)"}${s.reviewFeedback ? `\nBoard feedback: ${s.reviewFeedback}` : ""}`
    ),
  ].join("\n\n");
}

/**
 * Plan a milestone into tasks and start it. Each task is coordinated by the
 * project manager, who delegates it across their reports through the normal
 * task engine.
 */
async function planStage(stageId: string): Promise<void> {
  const stage = await db.query.projectStages.findFirst({ where: eq(projectStages.id, stageId) });
  if (!stage || stage.status !== "pending") return;
  const project = await db.query.projects.findFirst({ where: eq(projects.id, stage.projectId) });
  if (!project || project.status === "cancelled") return;
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, project.organizationId) });
  if (!org) throw new Error("Organization not found");
  const manager = await projectManager(project);
  if (!manager) throw new Error("No project manager available");

  const context = await priorStageContext(stage.projectId, stage.orderIndex);
  const planText = await agentReply(
    manager,
    org,
    [
      `You are the project manager delivering the milestone "${stage.title}" of the project "${project.title}".`,
      stage.description ? `Milestone goal: ${stage.description}` : "",
      context ? `\n${context}\n` : "",
      `Break THIS milestone into up to ${limits.maxStageTasks} concrete, independently-workable tasks. Only create as many as the milestone truly needs.`,
      'Respond with JSON only: {"tasks":[{"title":"...","description":"..."}]}',
    ]
      .filter(Boolean)
      .join("\n"),
    { gen: generation.plan }
  );
  const parsed = stageTaskSchema.safeParse(extractJson(planText));
  const tasks = parsed.success
    ? parsed.data.tasks
    : [{ title: stage.title, description: stage.description ?? stage.title }];

  await db.update(projectStages).set({ status: "in_progress", updatedAt: new Date() }).where(eq(projectStages.id, stageId));

  for (const t of tasks) {
    await createAndEnqueueTask({
      orgId: org.id,
      projectId: stage.projectId,
      stageId: stage.id,
      title: t.title,
      description: t.description,
      coordinatorAgentId: manager.id,
      createdByAgentId: manager.id,
    });
  }
}

/** Summarize a milestone from its tasks — verbatim for a single task (no LLM), synthesized otherwise. */
async function summarizeStage(
  stage: ProjectStage,
  tasks: { title: string; status: string; result: string | null; error: string | null }[],
  manager: Agent | null,
  org: Organization
): Promise<string> {
  const succeeded = tasks.filter((t) => t.status === "completed" && t.result);
  if (succeeded.length === 1 && tasks.length === 1) return succeeded[0].result!;

  if (manager && succeeded.length > 0) {
    try {
      return await agentReply(
        manager,
        org,
        [
          `The milestone "${stage.title}" is finished. Its tasks and results:`,
          "",
          ...tasks.map((t) => `### ${t.title} (${t.status})\n${t.result ?? t.error ?? "(no result)"}`),
          "",
          "Write a concise summary of what this milestone delivered, for the Board and for the next milestone to build on.",
        ].join("\n"),
        { gen: generation.summary }
      );
    } catch (err) {
      console.error("stage summary failed", err);
    }
  }
  return tasks.map((t) => `- ${t.title}: ${t.status}`).join("\n");
}

/**
 * Called when a task in a milestone finishes. When every task in the milestone
 * is terminal, summarize it and apply its gate: an `auto` gate advances the
 * project immediately; a `review` gate pauses for the Board.
 */
async function checkStageCompletion(stageId: string): Promise<void> {
  const stage = await db.query.projectStages.findFirst({ where: eq(projectStages.id, stageId) });
  if (!stage || stage.status !== "in_progress") return;

  const tasks = await db.query.agentTasks.findMany({ where: eq(agentTasks.stageId, stageId) });
  if (tasks.length === 0) return;
  if (!tasks.every((t) => t.status === "completed" || t.status === "failed" || t.status === "cancelled")) return;

  const project = await db.query.projects.findFirst({ where: eq(projects.id, stage.projectId) });
  if (!project) return;
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, project.organizationId) });
  if (!org) return;
  const manager = await projectManager(project);

  const summary = await summarizeStage(stage, tasks, manager, org);
  await db.update(projectStages).set({ summary, updatedAt: new Date() }).where(eq(projectStages.id, stageId));

  if (stage.gate === "review") {
    await db.update(projectStages).set({ status: "awaiting_review", updatedAt: new Date() }).where(eq(projectStages.id, stageId));
    await db.update(projects).set({ status: "awaiting_review", updatedAt: new Date() }).where(eq(projects.id, project.id));
    await db.insert(boardEmails).values({
      organizationId: org.id,
      fromAgentId: manager?.id ?? null,
      fromName: manager ? `${manager.name} (${manager.title})` : "Project manager",
      subject: `Milestone ready for review: ${stage.title} — ${project.title}`,
      body: `${summary}\n\n---\nApprove this milestone or request changes on the project's page.`,
      outcome: "review",
    });
    return;
  }

  await completeStage(stage, project, org, manager, summary);
}

/** Mark a milestone complete, capture its knowledge, and advance the project. */
async function completeStage(
  stage: ProjectStage,
  project: { id: string },
  org: Organization,
  manager: Agent | null,
  summary: string
): Promise<void> {
  await db.update(projectStages).set({ status: "completed", updatedAt: new Date() }).where(eq(projectStages.id, stage.id));
  if (manager) {
    await curateKnowledge(manager, org, { title: `${stage.title}`, description: stage.description }, summary).catch(() => {});
  }
  await advanceProject(project.id);
}

/**
 * Board review of a milestone at a `review` gate: approve to advance, or
 * request changes (the manager opens a revision task addressing the feedback,
 * and the gate re-triggers when it finishes).
 */
export async function reviewStage(
  stageId: string,
  decision: "approve" | "request_changes",
  feedback: string | null
): Promise<void> {
  const stage = await db.query.projectStages.findFirst({ where: eq(projectStages.id, stageId) });
  if (!stage || stage.status !== "awaiting_review") throw new Error("This milestone is not awaiting review");
  const project = await db.query.projects.findFirst({ where: eq(projects.id, stage.projectId) });
  if (!project) throw new Error("Project not found");
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, project.organizationId) });
  if (!org) throw new Error("Organization not found");
  const manager = await projectManager(project);

  await db
    .update(projectStages)
    .set({ reviewFeedback: feedback ?? stage.reviewFeedback, updatedAt: new Date() })
    .where(eq(projectStages.id, stageId));

  if (decision === "approve") {
    await db.update(projects).set({ status: "in_progress", updatedAt: new Date() }).where(eq(projects.id, project.id));
    await completeStage(stage, project, org, manager, stage.summary ?? "");
    return;
  }

  // Request changes: reopen the milestone with a revision task.
  if (!manager) throw new Error("No project manager available to revise");
  await db.update(projectStages).set({ status: "in_progress", updatedAt: new Date() }).where(eq(projectStages.id, stageId));
  await db.update(projects).set({ status: "in_progress", updatedAt: new Date() }).where(eq(projects.id, project.id));
  await createAndEnqueueTask({
    orgId: org.id,
    projectId: project.id,
    stageId: stage.id,
    title: `Revise: ${stage.title}`,
    description: [
      `The Board reviewed the milestone "${stage.title}" and requested changes.`,
      stage.summary ? `\nWhat was delivered:\n${stage.summary}` : "",
      feedback ? `\nBoard feedback to address:\n${feedback}` : "",
      "\nRevise the milestone deliverable to fully address the feedback.",
    ]
      .filter(Boolean)
      .join("\n"),
    coordinatorAgentId: manager.id,
    createdByAgentId: manager.id,
  });
}

/** Activate the next pending milestone, or complete the project when none remain. */
async function advanceProject(projectId: string): Promise<void> {
  const next = await db.query.projectStages.findFirst({
    where: and(eq(projectStages.projectId, projectId), eq(projectStages.status, "pending")),
    orderBy: asc(projectStages.orderIndex),
  });
  if (next) {
    await db.update(projects).set({ status: "in_progress", updatedAt: new Date() }).where(eq(projects.id, projectId));
    enqueueStage(next.id);
    return;
  }
  await completeProject(projectId);
}

/**
 * All milestones done: the manager writes an executive summary, the project is
 * marked complete, the Board is emailed, and the summary is captured as
 * knowledge.
 */
async function completeProject(projectId: string): Promise<void> {
  const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });
  if (!project || project.status === "completed" || project.status === "cancelled") return;

  const stages = await db.query.projectStages.findMany({
    where: eq(projectStages.projectId, projectId),
    orderBy: asc(projectStages.orderIndex),
  });
  // Only complete once every milestone is in a terminal state.
  if (stages.some((s) => s.status !== "completed" && s.status !== "skipped")) return;

  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, project.organizationId) });
  if (!org) return;
  const manager = await projectManager(project);
  const done = stages.filter((s) => s.status === "completed");

  let summary: string;
  if (done.length <= 1) {
    summary = done[0]?.summary ?? stages.map((s) => `- ${s.title}: ${s.status}`).join("\n");
  } else if (manager) {
    try {
      summary = await agentReply(
        manager,
        org,
        [
          `The project "${project.title}" is complete. Milestone summaries:`,
          "",
          ...done.map((s) => `### ${s.title}\n${s.summary ?? "(no summary)"}`),
          "",
          "Write a concise executive summary of the whole project's outcome for the Board.",
        ].join("\n"),
        { gen: generation.summary }
      );
    } catch {
      summary = done.map((s) => `### ${s.title}\n${s.summary ?? ""}`).join("\n\n");
    }
  } else {
    summary = done.map((s) => `### ${s.title}\n${s.summary ?? ""}`).join("\n\n");
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
  if (manager) {
    await curateKnowledge(manager, org, { title: project.title, description: project.description }, summary).catch(() => {});
  }

  // Fresh knowledge just landed — let the company proactively suggest what to
  // do next (throttled + gated inside). Dynamic import breaks the static cycle
  // (recommend.ts imports this engine).
  try {
    const { generateRecommendations } = await import("./recommend");
    await generateRecommendations(org.id);
  } catch (err) {
    console.error("recommendation generation failed", err);
  }
}

/**
 * Legacy completion path for projects created before milestones existed (their
 * tasks have a projectId but no stageId). Projects that use milestones are
 * driven entirely by the stage flow above.
 */
async function checkProjectCompletion(projectId: string): Promise<void> {
  const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });
  if (!project || project.status === "completed" || project.status === "cancelled") return;

  const stages = await db.query.projectStages.findMany({ where: eq(projectStages.projectId, projectId) });
  if (stages.length > 0) return; // milestone flow owns this project

  const tasks = await db.query.agentTasks.findMany({ where: eq(agentTasks.projectId, projectId) });
  if (tasks.length === 0) return;
  if (!tasks.every((t) => t.status === "completed" || t.status === "failed")) return;

  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, project.organizationId) });
  if (!org) return;
  const manager = await projectManager(project);

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
        ].join("\n"),
        { gen: generation.summary }
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
  if (manager) {
    await curateKnowledge(manager, org, { title: project.title, description: project.description }, summary).catch(() => {});
  }
}
