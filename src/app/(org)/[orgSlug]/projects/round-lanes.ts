export interface RoundNode {
  id: string;
  round: number;
  parentId: string | null;
  mergedFrom: string[];
}

/**
 * Order rounds parent-before-child and give each its depth, so lineage renders
 * as indentation.
 *
 * Deliberately a list rather than a graph: real projects produce a handful of
 * branches two or three deep, and an indented list stays legible at that size
 * where a node-and-edge diagram would not. A comparison round hangs off its
 * newest parent, so the tree stays a tree even though the merge has several.
 */
export function layoutRounds<T extends RoundNode>(rounds: T[]): { round: T; depth: number }[] {
  const byParent = new Map<string | null, T[]>();
  const ids = new Set(rounds.map((r) => r.id));
  for (const r of rounds) {
    // A round whose parent is missing is treated as a root, so nothing vanishes.
    const key = r.parentId && ids.has(r.parentId) ? r.parentId : null;
    byParent.set(key, [...(byParent.get(key) ?? []), r]);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.round - b.round);

  const out: { round: T; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (parentId: string | null, depth: number) => {
    for (const r of byParent.get(parentId) ?? []) {
      if (seen.has(r.id)) continue; // cycle guard — a round can't be its own ancestor
      seen.add(r.id);
      out.push({ round: r, depth });
      walk(r.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
