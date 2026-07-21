import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { acceptRecommendation, isRecommendation } from "@/lib/agents/recommend";
import { decideAction } from "@/lib/company/actions";
import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { orgActions } from "@/lib/db/schema";

const decideSchema = z.object({ approve: z.boolean() });

// Board decision: only humans with org_admin (the Board) may decide, and an
// approval executes the stored plan immediately.
export async function POST(req: Request, { params }: { params: Promise<{ orgSlug: string; actionId: string }> }) {
  try {
    const { orgSlug, actionId } = await params;
    const ctx = await requireOrg(orgSlug, "org_admin");
    const parsed = decideSchema.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });

    const action = await db.query.orgActions.findFirst({
      where: and(eq(orgActions.id, actionId), eq(orgActions.organizationId, ctx.org.id)),
    });
    if (!action) return Response.json({ error: "Proposal not found" }, { status: 404 });

    // Recommendations are Board proposals too, but approving one creates a
    // project/task rather than running a governance executor. Rejection is
    // generic, so decideAction handles it for every proposal type.
    const updated =
      parsed.data.approve && isRecommendation(action.type)
        ? await acceptRecommendation(ctx.org, action, ctx.user.id)
        : await decideAction(ctx.org, action, parsed.data.approve, ctx.user.id);
    return Response.json({ action: updated });
  } catch (err) {
    return errorResponse(err);
  }
}
