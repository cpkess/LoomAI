import { z } from "zod";

import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { FORMAT_META, fileName, renderDeliverable, type DeliverableFormat } from "@/lib/export/render";

export const maxDuration = 120;

const bodySchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(200_000),
  format: z.enum(["md", "html", "pdf", "docx"]),
});

// Convert a deliverable (markdown text) into a downloadable file on the fly.
// The deliverable is the user's own org content; we only ever wrap it in a
// fixed page shell, never execute it here.
export async function POST(req: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  try {
    const { orgSlug } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });

    const format = parsed.data.format as DeliverableFormat;
    let bytes: Buffer;
    try {
      bytes = await renderDeliverable(format, {
        title: parsed.data.title,
        orgName: ctx.org.name,
        markdown: parsed.data.content,
      });
    } catch (err) {
      // PDF (Chromium) may be unavailable in bare dev — surface a clear reason.
      const message = err instanceof Error ? err.message : "Could not generate the file";
      return Response.json({ error: message }, { status: format === "pdf" ? 501 : 500 });
    }

    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": FORMAT_META[format].mime,
        "Content-Disposition": `attachment; filename="${fileName(parsed.data.title, format)}"`,
        "Content-Length": String(bytes.byteLength),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
