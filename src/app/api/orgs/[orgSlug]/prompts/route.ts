import { z } from "zod";

import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { prompts } from "@/lib/db/schema";
import { extractVariables } from "@/lib/prompts/interpolate";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  category: z.string().min(1).max(60).default("General"),
  content: z.string().min(1).max(20000),
});

export async function POST(req: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  try {
    const { orgSlug } = await params;
    const ctx = await requireOrg(orgSlug, "workspace_manager");
    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });
    const data = parsed.data;

    const [prompt] = await db
      .insert(prompts)
      .values({
        organizationId: ctx.org.id,
        name: data.name,
        description: data.description ?? null,
        category: data.category,
        content: data.content,
        variables: extractVariables(data.content),
        createdByUserId: ctx.user.id,
      })
      .returning();
    return Response.json({ prompt }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
