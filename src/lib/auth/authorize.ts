import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";

import { db } from "@/lib/db";
import {
  organizationMembers,
  organizations,
  workspaceMembers,
  workspaces,
  type Organization,
  type OrgRole,
  type Workspace,
} from "@/lib/db/schema";

import { auth } from "./index";

const ROLE_RANK: Record<OrgRole, number> = {
  member: 0,
  workspace_manager: 1,
  org_admin: 2,
};

export function roleAtLeast(role: OrgRole, minimum: OrgRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  isPlatformAdmin: boolean;
}

export interface OrgContext {
  user: SessionUser;
  org: Organization;
  role: OrgRole;
}

export class AuthorizationError extends Error {
  constructor(
    message: string,
    public status: 401 | 403 | 404 = 403
  ) {
    super(message);
  }
}

/** Current session user, or null. */
export async function currentUser(): Promise<SessionUser | null> {
  const session = await auth();
  return session?.user ?? null;
}

/** Session user for API routes — throws AuthorizationError when signed out. */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new AuthorizationError("Not authenticated", 401);
  return user;
}

/** Session user for pages — redirects to /login when signed out. */
export async function requireUserPage(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requirePlatformAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.isPlatformAdmin) throw new AuthorizationError("Platform administrator access required");
  return user;
}

/**
 * Resolve an organization by slug and verify the session user is a member
 * with at least `minRole`. Platform admins get org_admin access everywhere.
 * The returned context carries the trusted org id — org-scoped queries must
 * take it from here, never from client input.
 */
export async function requireOrg(orgSlug: string, minRole: OrgRole = "member"): Promise<OrgContext> {
  const user = await requireUser();
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) });
  if (!org) throw new AuthorizationError("Organization not found", 404);

  if (user.isPlatformAdmin) return { user, org, role: "org_admin" };

  const membership = await db.query.organizationMembers.findFirst({
    where: and(eq(organizationMembers.organizationId, org.id), eq(organizationMembers.userId, user.id)),
  });
  if (!membership) throw new AuthorizationError("Organization not found", 404);
  if (!roleAtLeast(membership.role, minRole)) {
    throw new AuthorizationError("Insufficient permissions");
  }
  return { user, org, role: membership.role };
}

export interface WorkspaceContext extends OrgContext {
  workspace: Workspace;
  isWorkspaceManager: boolean;
}

/**
 * Resolve a workspace within an authorized org. Org admins and platform
 * admins can access every workspace; other users need a membership row.
 */
export async function requireWorkspace(orgSlug: string, workspaceSlug: string): Promise<WorkspaceContext> {
  const ctx = await requireOrg(orgSlug);
  const workspace = await db.query.workspaces.findFirst({
    where: and(eq(workspaces.organizationId, ctx.org.id), eq(workspaces.slug, workspaceSlug)),
  });
  if (!workspace) throw new AuthorizationError("Workspace not found", 404);

  if (roleAtLeast(ctx.role, "org_admin")) {
    return { ...ctx, workspace, isWorkspaceManager: true };
  }

  const membership = await db.query.workspaceMembers.findFirst({
    where: and(eq(workspaceMembers.workspaceId, workspace.id), eq(workspaceMembers.userId, ctx.user.id)),
  });
  if (!membership) throw new AuthorizationError("Workspace not found", 404);
  return {
    ...ctx,
    workspace,
    isWorkspaceManager: membership.isManager || ctx.role === "workspace_manager",
  };
}

/** Page flavor of requireOrg — redirects to login / renders 404 instead of throwing. */
export async function requireOrgPage(orgSlug: string, minRole: OrgRole = "member"): Promise<OrgContext> {
  try {
    return await requireOrg(orgSlug, minRole);
  } catch (err) {
    handlePageAuthError(err);
  }
}

/** Page flavor of requireWorkspace. */
export async function requireWorkspacePage(orgSlug: string, workspaceSlug: string): Promise<WorkspaceContext> {
  try {
    return await requireWorkspace(orgSlug, workspaceSlug);
  } catch (err) {
    handlePageAuthError(err);
  }
}

function handlePageAuthError(err: unknown): never {
  if (err instanceof AuthorizationError) {
    if (err.status === 401) redirect("/login");
    notFound();
  }
  throw err;
}

/** Convert an AuthorizationError into a Response for API routes. */
export function errorResponse(err: unknown): Response {
  if (err instanceof AuthorizationError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  console.error(err);
  return Response.json({ error: "Internal server error" }, { status: 500 });
}
