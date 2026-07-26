import { SoftwareView } from "./software-view";

export const metadata = { title: "Software update" };
export const dynamic = "force-dynamic";

export default function SoftwarePage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Software update</h1>
        <p className="text-sm text-muted-foreground">
          Update LoomAI to the latest version from GitHub — no manual rebuild required.
        </p>
      </div>
      <SoftwareView />
    </div>
  );
}
