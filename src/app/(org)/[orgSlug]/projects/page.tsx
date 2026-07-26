import { requireOrgPage } from "@/lib/auth/authorize";

import { ProjectsView } from "./projects-view";

export const metadata = { title: "Projects" };
export const dynamic = "force-dynamic";

export default async function ProjectsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgPage(orgSlug);
  return (
    <div className="flex flex-col gap-6 p-6">
      <ProjectsView orgSlug={ctx.org.slug} />
    </div>
  );
}
