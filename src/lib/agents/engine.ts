// The in-process work queue that drives the Living-Projects engines:
//   - `analyze` folds a new project source into the project's knowledge graph;
//   - `deliverable` advances a multi-stage deliverable one production step.
// Both live in lib/projects and are dispatched via dynamic import to avoid
// static import cycles. Because their state lives in the DB, `resumePendingWork`
// re-enqueues interrupted work after a restart — the non-durable queue stays
// restart-safe. Generation itself is done by ephemeral subagents (see
// lib/agents/subagent.ts); there are no persistent AI employees.

interface QueueEntry {
  id: string;
  mode: "analyze" | "deliverable";
}

const queue: QueueEntry[] = [];
let running = false;

/** Analyze a project source into the knowledge graph (off the request thread). */
export function enqueueSourceAnalysis(sourceId: string): void {
  queue.push({ id: sourceId, mode: "analyze" });
  if (!running) void drain();
}

/** Advance a multi-stage deliverable by one production step. */
export function enqueueDeliverable(deliverableId: string): void {
  queue.push({ id: deliverableId, mode: "deliverable" });
  if (!running) void drain();
}

let resumed = false;

async function drain(): Promise<void> {
  running = true;
  try {
    // On the first drain of this process, sweep up any work interrupted by a
    // restart (resumable execution).
    if (!resumed) {
      resumed = true;
      await resumePendingWork().catch((err) => console.error("resumePendingWork failed", err));
    }
    while (queue.length > 0) {
      const entry = queue.shift()!;
      try {
        if (entry.mode === "analyze") {
          const { analyzeSource } = await import("@/lib/projects/analysis");
          await analyzeSource(entry.id);
        } else {
          const { advanceDeliverable } = await import("@/lib/projects/deliverables");
          await advanceDeliverable(entry.id);
        }
      } catch (err) {
        console.error(`${entry.mode} ${entry.id} failed`, err);
        if (entry.mode === "analyze") {
          const { markSourceError } = await import("@/lib/projects/analysis");
          await markSourceError(entry.id, err instanceof Error ? err.message : String(err)).catch(() => {});
        } else {
          const { markDeliverableFailed } = await import("@/lib/projects/deliverables");
          await markDeliverableFailed(entry.id, err instanceof Error ? err.message : String(err)).catch(() => {});
        }
      }
    }
  } finally {
    running = false;
  }
}

/**
 * Re-enqueue interrupted work after a restart: pending source analyses and
 * non-terminal deliverables. The queue is in-memory, but state is durable, so
 * this makes execution resumable.
 */
export async function resumePendingWork(): Promise<void> {
  const { pendingSourceIds } = await import("@/lib/projects/analysis");
  const { activeDeliverableIds } = await import("@/lib/projects/deliverables");
  for (const id of await pendingSourceIds()) enqueueSourceAnalysis(id);
  for (const id of await activeDeliverableIds()) enqueueDeliverable(id);
}
