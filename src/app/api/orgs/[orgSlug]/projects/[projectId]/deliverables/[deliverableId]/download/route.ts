import { and, eq } from "drizzle-orm";

import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { deliverables, projects } from "@/lib/db/schema";
import { renderDeliverable, FORMAT_META, fileName, type DeliverableFormat } from "@/lib/export/render";
import { renderPptx, type DeckSpec } from "@/lib/export/pptx";
import { renderXlsx, type WorkbookSpec } from "@/lib/export/xlsx";
import { slugify } from "@/lib/utils";

export const maxDuration = 120;

const NATIVE = {
  pptx: { ext: "pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  xlsx: { ext: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
} as const;

// Download a completed deliverable. Prose kinds render from Markdown (md/html/
// pdf/docx); structured kinds render their typed spec into a native .pptx/.xlsx.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ orgSlug: string; projectId: string; deliverableId: string }> }
) {
  try {
    const { orgSlug, projectId, deliverableId } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    if (!(await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.organizationId, ctx.org.id)) }))) {
      return Response.json({ error: "Project not found" }, { status: 404 });
    }
    const d = await db.query.deliverables.findFirst({
      where: and(eq(deliverables.id, deliverableId), eq(deliverables.projectId, projectId)),
    });
    if (!d) return Response.json({ error: "Deliverable not found" }, { status: 404 });

    const format = new URL(req.url).searchParams.get("format") ?? "md";

    // Native structured formats.
    if (format === "pptx" || format === "xlsx") {
      if (!d.spec) return Response.json({ error: "This deliverable has no structured spec" }, { status: 409 });
      const bytes = format === "pptx" ? await renderPptx(d.spec as DeckSpec) : await renderXlsx(d.spec as WorkbookSpec);
      const name = `${slugify(d.title) || "deliverable"}.${NATIVE[format].ext}`;
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": NATIVE[format].mime,
          "Content-Disposition": `attachment; filename="${name}"`,
          "Content-Length": String(bytes.byteLength),
        },
      });
    }

    // Prose formats from the assembled Markdown.
    if (!["md", "html", "pdf", "docx"].includes(format)) {
      return Response.json({ error: "Unsupported format" }, { status: 400 });
    }
    const fmt = format as DeliverableFormat;
    const bytes = await renderDeliverable(fmt, { title: d.title, orgName: ctx.org.name, markdown: d.content ?? `# ${d.title}` });
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": FORMAT_META[fmt].mime,
        "Content-Disposition": `attachment; filename="${fileName(d.title, fmt)}"`,
        "Content-Length": String(bytes.byteLength),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
