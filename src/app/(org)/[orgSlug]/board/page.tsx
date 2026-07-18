import { requireOrgPage, roleAtLeast } from "@/lib/auth/authorize";

import { BoardView } from "./board-view";

export const metadata = { title: "Board room" };
export const dynamic = "force-dynamic";

export default async function BoardPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgPage(orgSlug);

  return (
    <div className="flex flex-col gap-6 p-6">
      <BoardView orgSlug={ctx.org.slug} isBoardMember={roleAtLeast(ctx.role, "org_admin")} />
    </div>
  );
}
