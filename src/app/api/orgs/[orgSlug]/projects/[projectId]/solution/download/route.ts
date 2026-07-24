import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { FORMAT_META, renderDeliverable, type DeliverableFormat } from "@/lib/export/render";
import { renderPptx } from "@/lib/export/pptx";
import { renderXlsx } from "@/lib/export/xlsx";
import { ownedProject } from "@/lib/projects/chat";
import { evidenceSchema, latestSolution, problemSchema, researchRecordSchema, solutionModelSchema } from "@/lib/projects/solution";
import { solutionToDeck, solutionToMarkdown, solutionToOnePager, solutionToWorkbook } from "@/lib/projects/solutionRender";
import { slugify } from "@/lib/utils";

const NATIVE = {
  pptx: { ext: "pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  xlsx: { ext: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
} as const;

// Render the ONE Solution into any format. Report/one-pager are prose (md/html/
// pdf/docx); the deck is a native .pptx; the model is a native .xlsx. Every
// format is derived from the same Solution, so they always agree.
export async function GET(req: Request, { params }: { params: Promise<{ orgSlug: string; projectId: string }> }) {
  try {
    const { orgSlug, projectId } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    if (!(await ownedProject(ctx.org.id, projectId))) return Response.json({ error: "Project not found" }, { status: 404 });

    const s = await latestSolution(projectId);
    if (!s || !s.model) return Response.json({ error: "No completed solution yet" }, { status: 409 });
    const problem = s.problem ? problemSchema.safeParse(s.problem).data ?? null : null;
    const model = solutionModelSchema.parse(s.model);
    const evidence = s.evidence ? evidenceSchema.safeParse(s.evidence).data ?? [] : [];
    const blocked = s.research ? researchRecordSchema.safeParse(s.research).data?.blocked ?? [] : [];

    const url = new URL(req.url);
    const doc = url.searchParams.get("doc") ?? "report"; // report | onepager | deck | model
    const base = slugify(model.title || "solution") || "solution";

    if (doc === "deck") {
      const bytes = await renderPptx(solutionToDeck(problem, model, evidence));
      return binary(bytes, `${base}.pptx`, NATIVE.pptx.mime);
    }
    if (doc === "model") {
      const bytes = await renderXlsx(solutionToWorkbook(model, evidence));
      return binary(bytes, `${base}.xlsx`, NATIVE.xlsx.mime);
    }

    // Prose documents: report or one-pager, in md/html/pdf/docx.
    const format = (url.searchParams.get("format") ?? "md") as DeliverableFormat;
    if (!["md", "html", "pdf", "docx"].includes(format)) return Response.json({ error: "Unsupported format" }, { status: 400 });
    const markdown = doc === "onepager" ? solutionToOnePager(problem, model) : solutionToMarkdown(problem, model, evidence, blocked);
    const bytes = await renderDeliverable(format, { title: model.title || "Solution", orgName: ctx.org.name, markdown });
    return binary(bytes, `${base}${doc === "onepager" ? "-onepager" : ""}.${FORMAT_META[format].ext}`, FORMAT_META[format].mime);
  } catch (err) {
    return errorResponse(err);
  }
}

function binary(bytes: Buffer, filename: string, mime: string): Response {
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(bytes.byteLength),
    },
  });
}
