import { generateRecommendations } from "@/lib/agents/recommend";
import { errorResponse, requireOrg } from "@/lib/auth/authorize";

export const maxDuration = 120;

// Manually ask the company (its CEO agent) to propose new projects/deliverables
// now. Recommendations are gated on the org having learned enough; the response
// reports whether that gate is met so the UI can explain when it isn't.
export async function POST(_req: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  try {
    const { orgSlug } = await params;
    const ctx = await requireOrg(orgSlug, "org_admin");
    const result = await generateRecommendations(ctx.org.id);
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
