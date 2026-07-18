import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { AVATAR_COLORS } from "@/lib/agents/schema";
import { assertNoReportingCycle } from "@/lib/agents/validate";
import { db } from "@/lib/db";
import {
  agentWorkspaces,
  agents,
  orgActions,
  organizations,
  workspaceMembers,
  workspaces,
  type Organization,
  type OrgAction,
} from "@/lib/db/schema";
import { slugify } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Company actions: the operations AI employees can perform on the company
// itself. Each action has a payload schema, a human-readable summary, and an
// executor. Agents hold per-action grants (agents.permissions); the org's
// governance policy decides per action type whether execution is autonomous
// or queued for Board approval (organizations.settings.governance).
// ---------------------------------------------------------------------------

export const ACTION_TYPES = [
  "hire_employee",
  "update_employee",
  "offboard_employee",
  "create_department",
  "assign_to_department",
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

export type GovernanceMode = "auto" | "board";

// Safe-by-default: structural changes need the Board; smaller personnel
// edits run autonomously. Fully overridable per org in Settings.
export const DEFAULT_GOVERNANCE: Record<ActionType, GovernanceMode> = {
  hire_employee: "board",
  offboard_employee: "board",
  create_department: "board",
  update_employee: "auto",
  assign_to_department: "auto",
};

export function getGovernance(org: Organization): Record<ActionType, GovernanceMode> {
  const settings = (org.settings ?? {}) as { governance?: Partial<Record<ActionType, GovernanceMode>> };
  return { ...DEFAULT_GOVERNANCE, ...(settings.governance ?? {}) };
}

const hireSchema = z.object({
  name: z.string().min(1).max(80).describe("The new AI employee's name"),
  title: z.string().min(1).max(120).describe("Their job title"),
  personaText: z
    .string()
    .max(8000)
    .optional()
    .describe("System-prompt persona describing how they work. Base it on the job description."),
  reportsToAgentId: z.string().uuid().optional().describe("Agent id of their manager, if any"),
  departmentId: z.string().uuid().optional().describe("Department (workspace) id to staff them in"),
});

const updateSchema = z.object({
  agentId: z.string().uuid().describe("Id of the AI employee to update"),
  title: z.string().min(1).max(120).optional().describe("New job title"),
  personaText: z.string().max(8000).optional().describe("New persona"),
  reportsToAgentId: z.string().uuid().nullish().describe("New manager's agent id (null to clear)"),
  status: z.enum(["active", "paused"]).optional().describe("Pause or reactivate"),
});

const offboardSchema = z.object({
  agentId: z.string().uuid().describe("Id of the AI employee to offboard"),
});

const createDepartmentSchema = z.object({
  name: z.string().min(1).max(120).describe("Department name, e.g. Quality Assurance"),
  description: z.string().max(500).optional().describe("What the department does"),
});

const assignSchema = z.object({
  agentId: z.string().uuid().describe("Id of the AI employee"),
  departmentId: z.string().uuid().describe("Department (workspace) id"),
  remove: z.boolean().optional().describe("True to remove them from the department instead"),
});

export interface ActionDefinition<S extends z.ZodTypeAny = z.ZodTypeAny> {
  type: ActionType;
  label: string;
  description: string;
  schema: S;
  summarize(payload: z.infer<S>): string;
  execute(orgId: string, payload: z.infer<S>): Promise<string>;
}

async function orgAgent(orgId: string, agentId: string) {
  const agent = await db.query.agents.findFirst({
    where: and(eq(agents.id, agentId), eq(agents.organizationId, orgId)),
  });
  if (!agent) throw new Error("No AI employee with that id exists in this organization");
  return agent;
}

async function orgDepartment(orgId: string, workspaceId: string) {
  const workspace = await db.query.workspaces.findFirst({
    where: and(eq(workspaces.id, workspaceId), eq(workspaces.organizationId, orgId)),
  });
  if (!workspace) throw new Error("No department with that id exists in this organization");
  return workspace;
}

export const COMPANY_ACTIONS: { [T in ActionType]: ActionDefinition } = {
  hire_employee: {
    type: "hire_employee",
    label: "Hire AI employee",
    description:
      "Hire a new AI employee: creates the agent with a name, job title, persona, optional manager, and optional department.",
    schema: hireSchema,
    summarize: (p) => {
      const { name, title } = p as z.infer<typeof hireSchema>;
      return `Hire "${name}" as ${title}`;
    },
    execute: async (orgId, payload) => {
      const p = payload as z.infer<typeof hireSchema>;
      if (p.reportsToAgentId) await orgAgent(orgId, p.reportsToAgentId);
      if (p.departmentId) await orgDepartment(orgId, p.departmentId);
      const [agent] = await db
        .insert(agents)
        .values({
          organizationId: orgId,
          name: p.name,
          title: p.title,
          personaText: p.personaText ?? null,
          reportsToAgentId: p.reportsToAgentId ?? null,
          avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
        })
        .returning();
      if (p.departmentId) {
        await db.insert(agentWorkspaces).values({ agentId: agent.id, workspaceId: p.departmentId });
      }
      return `${p.name} joined as ${p.title} (agent id ${agent.id})`;
    },
  },

  update_employee: {
    type: "update_employee",
    label: "Update AI employee",
    description: "Update an AI employee's title, persona, manager, or active/paused status.",
    schema: updateSchema,
    summarize: (p) => {
      const u = p as z.infer<typeof updateSchema>;
      const changes = [
        u.title && `title → ${u.title}`,
        u.personaText && "persona updated",
        u.reportsToAgentId !== undefined && "manager changed",
        u.status && `status → ${u.status}`,
      ].filter(Boolean);
      return `Update employee ${u.agentId}: ${changes.join(", ") || "no changes"}`;
    },
    execute: async (orgId, payload) => {
      const p = payload as z.infer<typeof updateSchema>;
      const agent = await orgAgent(orgId, p.agentId);
      if (p.reportsToAgentId) {
        if (p.reportsToAgentId === p.agentId) throw new Error("An employee cannot report to themselves");
        await orgAgent(orgId, p.reportsToAgentId);
        await assertNoReportingCycle(p.agentId, p.reportsToAgentId);
      }
      await db
        .update(agents)
        .set({
          ...(p.title !== undefined ? { title: p.title } : {}),
          ...(p.personaText !== undefined ? { personaText: p.personaText } : {}),
          ...(p.reportsToAgentId !== undefined ? { reportsToAgentId: p.reportsToAgentId ?? null } : {}),
          ...(p.status !== undefined ? { status: p.status } : {}),
          updatedAt: new Date(),
        })
        .where(eq(agents.id, p.agentId));
      return `${agent.name} updated`;
    },
  },

  offboard_employee: {
    type: "offboard_employee",
    label: "Offboard AI employee",
    description: "Permanently remove an AI employee from the company.",
    schema: offboardSchema,
    summarize: (p) => `Offboard employee ${(p as z.infer<typeof offboardSchema>).agentId}`,
    execute: async (orgId, payload) => {
      const p = payload as z.infer<typeof offboardSchema>;
      const agent = await orgAgent(orgId, p.agentId);
      await db.delete(agents).where(eq(agents.id, agent.id));
      await db.update(agents).set({ reportsToAgentId: null }).where(eq(agents.reportsToAgentId, agent.id));
      return `${agent.name} has been offboarded`;
    },
  },

  create_department: {
    type: "create_department",
    label: "Create department",
    description: "Create a new department (workspace) in the company.",
    schema: createDepartmentSchema,
    summarize: (p) => `Create department "${(p as z.infer<typeof createDepartmentSchema>).name}"`,
    execute: async (orgId, payload) => {
      const p = payload as z.infer<typeof createDepartmentSchema>;
      const root = slugify(p.name) || "department";
      let slug = root;
      for (let i = 2; ; i++) {
        const clash = await db.query.workspaces.findFirst({
          where: and(eq(workspaces.organizationId, orgId), eq(workspaces.slug, slug)),
        });
        if (!clash) break;
        slug = `${root}-${i}`;
      }
      const [workspace] = await db
        .insert(workspaces)
        .values({ organizationId: orgId, slug, name: p.name, description: p.description ?? null })
        .returning();
      // Org admins can already access every department; give the humans who
      // sit on the Board membership for visibility in listings.
      const org = await db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
      if (org) {
        const admins = await db.query.organizationMembers.findMany({
          where: (m, { and: andOp, eq: eqOp }) => andOp(eqOp(m.organizationId, orgId), eqOp(m.role, "org_admin")),
        });
        if (admins.length > 0) {
          await db
            .insert(workspaceMembers)
            .values(admins.map((a) => ({ workspaceId: workspace.id, userId: a.userId, isManager: true })));
        }
      }
      return `Department "${p.name}" created (id ${workspace.id})`;
    },
  },

  assign_to_department: {
    type: "assign_to_department",
    label: "Change department staffing",
    description: "Staff an AI employee in a department, or remove them from one.",
    schema: assignSchema,
    summarize: (p) => {
      const a = p as z.infer<typeof assignSchema>;
      return `${a.remove ? "Remove" : "Staff"} employee ${a.agentId} ${a.remove ? "from" : "in"} department ${a.departmentId}`;
    },
    execute: async (orgId, payload) => {
      const p = payload as z.infer<typeof assignSchema>;
      const agent = await orgAgent(orgId, p.agentId);
      const department = await orgDepartment(orgId, p.departmentId);
      if (p.remove) {
        await db
          .delete(agentWorkspaces)
          .where(and(eq(agentWorkspaces.agentId, agent.id), eq(agentWorkspaces.workspaceId, department.id)));
        return `${agent.name} removed from ${department.name}`;
      }
      const existing = await db.query.agentWorkspaces.findFirst({
        where: and(eq(agentWorkspaces.agentId, agent.id), eq(agentWorkspaces.workspaceId, department.id)),
      });
      if (!existing) {
        await db.insert(agentWorkspaces).values({ agentId: agent.id, workspaceId: department.id });
      }
      return `${agent.name} staffed in ${department.name}`;
    },
  },
};

export interface ActionOutcome {
  status: "executed" | "pending_approval" | "failed";
  summary: string;
  detail: string;
  actionId: string;
}

/**
 * Run a company action on behalf of a proposer, honoring the org's
 * governance policy: "auto" executes immediately, "board" records a
 * pending proposal for a human Board member to approve. Every outcome is
 * recorded in org_actions (the audit log).
 */
export async function performAction(
  org: Organization,
  type: ActionType,
  payload: unknown,
  proposer: { agentId?: string; userId?: string }
): Promise<ActionOutcome> {
  const definition = COMPANY_ACTIONS[type];
  const parsed = definition.schema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(`Invalid ${type} payload: ${parsed.error.issues[0]?.message ?? "invalid input"}`);
  }
  const summary = definition.summarize(parsed.data);
  const governance = getGovernance(org);

  if (governance[type] === "board" && !proposer.userId) {
    const [action] = await db
      .insert(orgActions)
      .values({
        organizationId: org.id,
        type,
        payload: parsed.data,
        status: "pending_approval",
        summary,
        proposedByAgentId: proposer.agentId ?? null,
      })
      .returning();
    return {
      status: "pending_approval",
      summary,
      detail: "Submitted to the Board for approval. It will execute automatically once approved.",
      actionId: action.id,
    };
  }

  try {
    const result = await definition.execute(org.id, parsed.data);
    const [action] = await db
      .insert(orgActions)
      .values({
        organizationId: org.id,
        type,
        payload: parsed.data,
        status: "executed",
        summary,
        proposedByAgentId: proposer.agentId ?? null,
        proposedByUserId: proposer.userId ?? null,
        result,
      })
      .returning();
    return { status: "executed", summary, detail: result, actionId: action.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const [action] = await db
      .insert(orgActions)
      .values({
        organizationId: org.id,
        type,
        payload: parsed.data,
        status: "failed",
        summary,
        proposedByAgentId: proposer.agentId ?? null,
        proposedByUserId: proposer.userId ?? null,
        error: message,
      })
      .returning();
    return { status: "failed", summary, detail: message, actionId: action.id };
  }
}

/** Board decision on a pending proposal. Approval executes the stored plan. */
export async function decideAction(
  org: Organization,
  action: OrgAction,
  approve: boolean,
  deciderUserId: string
): Promise<OrgAction> {
  if (action.status !== "pending_approval") throw new Error("This proposal has already been decided");

  if (!approve) {
    const [updated] = await db
      .update(orgActions)
      .set({ status: "rejected", decidedByUserId: deciderUserId, decidedAt: new Date() })
      .where(eq(orgActions.id, action.id))
      .returning();
    return updated;
  }

  const definition = COMPANY_ACTIONS[action.type as ActionType];
  if (!definition) throw new Error(`Unknown action type ${action.type}`);
  try {
    const result = await definition.execute(org.id, definition.schema.parse(action.payload));
    const [updated] = await db
      .update(orgActions)
      .set({ status: "executed", decidedByUserId: deciderUserId, decidedAt: new Date(), result })
      .where(eq(orgActions.id, action.id))
      .returning();
    return updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const [updated] = await db
      .update(orgActions)
      .set({ status: "failed", decidedByUserId: deciderUserId, decidedAt: new Date(), error: message })
      .where(eq(orgActions.id, action.id))
      .returning();
    return updated;
  }
}
