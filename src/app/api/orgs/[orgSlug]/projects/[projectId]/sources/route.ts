import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { addSource } from "@/lib/projects/sources";
import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { projectSources, projects } from "@/lib/db/schema";

const schema = z.object({
  kind: z.enum(["note", "document", "email", "research", "manual"]).default("note"),
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(50000),
});

async function ownedProject(orgId: string, projectId: string) {
  return db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.organizationId, orgId)) });
}

export async function GET(_req: Request, { params }: { params: Promise<{ orgSlug: string; projectId: string }> }) {
  try {
    const { orgSlug, projectId } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    if (!(await ownedProject(ctx.org.id, projectId))) return Response.json({ error: "Project not found" }, { status: 404 });
    const rows = await db.query.projectSources.findMany({
      where: eq(projectSources.projectId, projectId),
      orderBy: desc(projectSources.createdAt),
    });
    return Response.json({
      sources: rows.map((s) => ({
        id: s.id,
        kind: s.kind,
        title: s.title,
        status: s.status,
        error: s.error,
        createdAt: s.createdAt,
        analyzedAt: s.analyzedAt,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

// Add a source — the event that folds new information into the living project.
export async function POST(req: Request, { params }: { params: Promise<{ orgSlug: string; projectId: string }> }) {
  try {
    const { orgSlug, projectId } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    if (!(await ownedProject(ctx.org.id, projectId))) return Response.json({ error: "Project not found" }, { status: 404 });
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });

    const source = await addSource({
      projectId,
      orgId: ctx.org.id,
      kind: parsed.data.kind,
      title: parsed.data.title,
      content: parsed.data.content,
      addedByUserId: ctx.user.id,
    });
    return Response.json({ source: { id: source.id } }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
