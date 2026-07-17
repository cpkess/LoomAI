import { eq, inArray } from "drizzle-orm";

import { requireOrgPage, roleAtLeast } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { promptVersions, prompts } from "@/lib/db/schema";

import { PromptsView } from "./prompts-view";

export const metadata = { title: "Prompts" };
export const dynamic = "force-dynamic";

export default async function PromptsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgPage(orgSlug);

  const orgPrompts = await db.query.prompts.findMany({
    where: eq(prompts.organizationId, ctx.org.id),
    orderBy: (t, { asc }) => [asc(t.category), asc(t.name)],
  });
  const versions = orgPrompts.length
    ? await db.query.promptVersions.findMany({
        where: inArray(
          promptVersions.promptId,
          orgPrompts.map((p) => p.id)
        ),
        orderBy: (t, { desc }) => desc(t.version),
      })
    : [];

  return (
    <div className="flex flex-col gap-6 p-6">
      <PromptsView
        orgSlug={ctx.org.slug}
        canManage={roleAtLeast(ctx.role, "workspace_manager")}
        prompts={orgPrompts.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          category: p.category,
          content: p.content,
          variables: p.variables,
          version: p.version,
          history: versions
            .filter((v) => v.promptId === p.id)
            .map((v) => ({ version: v.version, content: v.content })),
        }))}
      />
    </div>
  );
}
