import { errorResponse, requirePlatformAdmin } from "@/lib/auth/authorize";
import { checkStatus, requestUpdate, selfUpdateEnabled } from "@/lib/update/git";

export const maxDuration = 60;

// Software update status: current deployed commit vs. the latest on GitHub.
export async function GET() {
  try {
    await requirePlatformAdmin();
    return Response.json(await checkStatus());
  } catch (err) {
    return errorResponse(err);
  }
}

// Trigger an update: mark it and restart. The container's entrypoint pulls the
// latest source, rebuilds, migrates, and comes back on the new version. Guarded
// behind LOOMAI_SELF_UPDATE so it can't be triggered on deployments that aren't
// set up for it.
export async function POST() {
  try {
    await requirePlatformAdmin();
    if (!selfUpdateEnabled()) {
      return Response.json(
        { error: "Self-update is disabled. Set LOOMAI_SELF_UPDATE=1 on the app to enable it." },
        { status: 403 }
      );
    }
    await requestUpdate();
    // Respond first, then exit so the container restarts into the update.
    setTimeout(() => process.exit(0), 800);
    return Response.json({ restarting: true });
  } catch (err) {
    return errorResponse(err);
  }
}
