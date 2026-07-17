import { eq, inArray } from "drizzle-orm";

import { listEnabledModels } from "@/lib/ai/registry";
import { requireOrgPage, roleAtLeast } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { collectionWorkspaces, collections, documents, workspaces } from "@/lib/db/schema";

import { KnowledgeView } from "./knowledge-view";

export const metadata = { title: "Knowledge" };
export const dynamic = "force-dynamic";

export default async function KnowledgePage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgPage(orgSlug);

  const [orgCollections, departments, embeddingModels] = await Promise.all([
    db.query.collections.findMany({
      where: eq(collections.organizationId, ctx.org.id),
      orderBy: (t, { asc }) => asc(t.name),
    }),
    db.query.workspaces.findMany({
      where: eq(workspaces.organizationId, ctx.org.id),
      orderBy: (t, { asc }) => asc(t.name),
    }),
    listEnabledModels("embedding"),
  ]);

  const collectionIds = orgCollections.map((c) => c.id);
  const [links, docs] = await Promise.all([
    collectionIds.length
      ? db.query.collectionWorkspaces.findMany({ where: inArray(collectionWorkspaces.collectionId, collectionIds) })
      : Promise.resolve([]),
    collectionIds.length
      ? db.query.documents.findMany({
          where: inArray(documents.collectionId, collectionIds),
          orderBy: (t, { desc }) => desc(t.createdAt),
        })
      : Promise.resolve([]),
  ]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <KnowledgeView
        orgSlug={ctx.org.slug}
        canManage={roleAtLeast(ctx.role, "workspace_manager")}
        collections={orgCollections.map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          workspaceIds: links.filter((l) => l.collectionId === c.id).map((l) => l.workspaceId),
          documents: docs
            .filter((d) => d.collectionId === c.id)
            .map((d) => ({
              id: d.id,
              filename: d.filename,
              status: d.status,
              error: d.error,
              chunkCount: d.chunkCount,
              sizeBytes: d.sizeBytes,
            })),
        }))}
        departments={departments.map((d) => ({ id: d.id, name: d.name }))}
        embeddingModels={embeddingModels.map((m) => ({ id: m.id, label: `${m.displayName} · ${m.providerName}` }))}
      />
    </div>
  );
}
