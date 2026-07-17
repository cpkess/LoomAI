import { z } from "zod";

import { errorResponse, requirePlatformAdmin } from "@/lib/auth/authorize";
import { discoverLMStudioServers } from "@/lib/ai/providers/lmstudio";

const schema = z.object({ extraHosts: z.array(z.string().url()).optional() });

// Probe well-known local hosts for running LM Studio servers.
export async function POST(req: Request) {
  try {
    await requirePlatformAdmin();
    const body = await req.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    const servers = await discoverLMStudioServers(parsed.success ? (parsed.data.extraHosts ?? []) : []);
    return Response.json({ servers });
  } catch (err) {
    return errorResponse(err);
  }
}
