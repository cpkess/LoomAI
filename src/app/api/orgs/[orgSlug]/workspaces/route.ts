import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { workspaceMembers, workspaces } from "@/lib/db/schema";
import { slugify } from "@/lib/utils";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  try {
    const { orgSlug } = await params;
    const ctx = await requireOrg(orgSlug, "org_admin");
    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });

    const root = slugify(parsed.data.name) || "department";
    let slug = root;
    for (let i = 2; ; i++) {
      const clash = await db.query.workspaces.findFirst({
        where: and(eq(workspaces.organizationId, ctx.org.id), eq(workspaces.slug, slug)),
      });
      if (!clash) break;
      slug = `${root}-${i}`;
    }

    const [workspace] = await db
      .insert(workspaces)
      .values({
        organizationId: ctx.org.id,
        slug,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
      })
      .returning();

    // The creator joins as a manager so the department is immediately usable.
    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: ctx.user.id, isManager: true });

    return Response.json({ workspace }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
