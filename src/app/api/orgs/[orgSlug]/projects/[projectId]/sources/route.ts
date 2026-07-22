import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { addSource } from "@/lib/projects/sources";
import { projectCollectionId } from "@/lib/projects/knowledge";
import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { documents, projectSources, projects } from "@/lib/db/schema";
import { enqueueDocument } from "@/lib/rag/ingest";
import { isSupportedFilename, parseDocument } from "@/lib/rag/parse";
import { fetchReadable } from "@/lib/research/web";

export const maxDuration = 120;

const schema = z.object({
  kind: z.enum(["note", "document", "email", "research", "manual"]).default("note"),
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(50000).optional(),
  url: z.string().url().optional(),
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
// Accepts a JSON note, a URL to import, or a multipart file upload.
export async function POST(req: Request, { params }: { params: Promise<{ orgSlug: string; projectId: string }> }) {
  try {
    const { orgSlug, projectId } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    if (!(await ownedProject(ctx.org.id, projectId))) return Response.json({ error: "Project not found" }, { status: 404 });

    const contentType = req.headers.get("content-type") ?? "";

    // File upload: parse to text, ingest the raw file into the project's
    // collection (preserving slide/sheet metadata), and queue analysis.
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return Response.json({ error: "No file provided" }, { status: 400 });
      if (!isSupportedFilename(file.name)) {
        return Response.json({ error: `Unsupported file type: ${file.name}` }, { status: 415 });
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const { text } = await parseDocument(file.name, buffer).catch(() => ({ text: "" }));
      if (!text.trim()) return Response.json({ error: "No text could be extracted from this file" }, { status: 422 });

      // Ingest the raw file into the project collection (metadata preserved).
      const collectionId = await projectCollectionId(projectId, ctx.org.id);
      const [document] = await db
        .insert(documents)
        .values({
          collectionId,
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: buffer.byteLength,
          status: "pending",
          uploadedByUserId: ctx.user.id,
        })
        .returning();
      enqueueDocument(document.id, buffer);

      const source = await addSource({
        projectId,
        orgId: ctx.org.id,
        kind: "document",
        title: file.name,
        content: text.slice(0, 200_000),
        ref: document.id,
        addedByUserId: ctx.user.id,
        skipIngest: true, // the raw file is ingested above
      });
      return Response.json({ source: { id: source.id } }, { status: 201 });
    }

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });

    // URL import: fetch a readable version of the page.
    if (parsed.data.url) {
      const page = await fetchReadable(parsed.data.url).catch(() => null);
      if (!page || !page.text.trim()) return Response.json({ error: "Could not read that URL" }, { status: 422 });
      const source = await addSource({
        projectId,
        orgId: ctx.org.id,
        kind: "research",
        title: parsed.data.title || page.title || parsed.data.url,
        content: page.text.slice(0, 200_000),
        ref: parsed.data.url,
        addedByUserId: ctx.user.id,
      });
      return Response.json({ source: { id: source.id } }, { status: 201 });
    }

    if (!parsed.data.content) return Response.json({ error: "Content or a URL is required" }, { status: 400 });
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
