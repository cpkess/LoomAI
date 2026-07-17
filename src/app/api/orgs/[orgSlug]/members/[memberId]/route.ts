import { and, count, eq } from "drizzle-orm";
import { z } from "zod";

import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { organizationMembers, orgRole } from "@/lib/db/schema";

const updateSchema = z.object({
  role: z.enum(orgRole.enumValues).optional(),
  title: z.string().max(120).nullish(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ orgSlug: string; memberId: string }> }) {
  try {
    const { orgSlug, memberId } = await params;
    const ctx = await requireOrg(orgSlug, "org_admin");
    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });

    const member = await db.query.organizationMembers.findFirst({
      where: and(eq(organizationMembers.id, memberId), eq(organizationMembers.organizationId, ctx.org.id)),
    });
    if (!member) return Response.json({ error: "Member not found" }, { status: 404 });

    // Keep at least one org admin around.
    if (parsed.data.role && parsed.data.role !== "org_admin" && member.role === "org_admin") {
      const [admins] = await db
        .select({ value: count() })
        .from(organizationMembers)
        .where(and(eq(organizationMembers.organizationId, ctx.org.id), eq(organizationMembers.role, "org_admin")));
      if (admins.value <= 1) {
        return Response.json({ error: "An organization needs at least one admin" }, { status: 400 });
      }
    }

    const [updated] = await db
      .update(organizationMembers)
      .set({
        ...(parsed.data.role !== undefined ? { role: parsed.data.role } : {}),
        ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      })
      .where(eq(organizationMembers.id, memberId))
      .returning();
    return Response.json({ member: updated });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ orgSlug: string; memberId: string }> }) {
  try {
    const { orgSlug, memberId } = await params;
    const ctx = await requireOrg(orgSlug, "org_admin");
    const member = await db.query.organizationMembers.findFirst({
      where: and(eq(organizationMembers.id, memberId), eq(organizationMembers.organizationId, ctx.org.id)),
    });
    if (!member) return Response.json({ error: "Member not found" }, { status: 404 });
    if (member.role === "org_admin") {
      const [admins] = await db
        .select({ value: count() })
        .from(organizationMembers)
        .where(and(eq(organizationMembers.organizationId, ctx.org.id), eq(organizationMembers.role, "org_admin")));
      if (admins.value <= 1) {
        return Response.json({ error: "An organization needs at least one admin" }, { status: 400 });
      }
    }
    await db.delete(organizationMembers).where(eq(organizationMembers.id, memberId));
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
