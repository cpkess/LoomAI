// Proactive project intelligence (pure, testable). Beyond contradictions and
// staleness, a living project should surface emerging themes, gaps in what it
// knows, and the next investigations worth doing. These are deterministic
// functions over the knowledge graph so they run cheaply on open — no model
// call needed — and are unit-tested.

export interface ItemLite {
  id: string;
  type: string;
  status: string;
  content: string;
}

export interface EdgeLite {
  fromItemId: string;
  toItemId: string;
  relation: string;
}

export interface Theme {
  /** A representative label for the cluster (the most-connected member). */
  label: string;
  itemIds: string[];
  size: number;
}

// Relations that indicate two items belong to the same theme (positive links).
const THEME_RELATIONS = new Set(["supports", "refines", "answers"]);

// Item statuses that count as "live" knowledge worth clustering.
const LIVE = new Set(["active", "challenged"]);

/**
 * Emerging themes: connected components of live items linked by positive
 * relations. A theme needs at least `minSize` members; the label is the
 * content of the member with the most connections. Sorted largest-first.
 */
export function emergingThemes(items: ItemLite[], edges: EdgeLite[], minSize = 2, max = 5): Theme[] {
  const live = new Map(items.filter((i) => LIVE.has(i.status)).map((i) => [i.id, i]));

  // Union-find over live item ids linked by theme relations.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  const union = (a: string, b: string) => {
    parent.set(find(a), find(b));
  };
  for (const id of live.keys()) parent.set(id, id);

  const degree = new Map<string, number>();
  for (const e of edges) {
    if (!THEME_RELATIONS.has(e.relation)) continue;
    if (!live.has(e.fromItemId) || !live.has(e.toItemId)) continue;
    union(e.fromItemId, e.toItemId);
    degree.set(e.fromItemId, (degree.get(e.fromItemId) ?? 0) + 1);
    degree.set(e.toItemId, (degree.get(e.toItemId) ?? 0) + 1);
  }

  const groups = new Map<string, string[]>();
  for (const id of live.keys()) {
    const root = find(id);
    (groups.get(root) ?? groups.set(root, []).get(root)!).push(id);
  }

  const themes: Theme[] = [];
  for (const ids of groups.values()) {
    if (ids.length < minSize) continue;
    const rep = ids.reduce((best, id) => ((degree.get(id) ?? 0) > (degree.get(best) ?? 0) ? id : best), ids[0]);
    themes.push({ label: live.get(rep)!.content, itemIds: ids, size: ids.length });
  }
  themes.sort((a, b) => b.size - a.size);
  return themes.slice(0, max);
}

export interface Gap {
  kind: "open_question" | "thin_evidence";
  itemId: string;
  content: string;
}

// Item types whose claims should be backed by evidence to be trusted.
const EVIDENCE_BACKED = new Set(["claim", "assumption", "decision"]);

/**
 * Missing information: unresolved questions, plus load-bearing claims/
 * assumptions/decisions that rest on too little evidence.
 */
export function knowledgeGaps(
  items: ItemLite[],
  evidenceCountById: Map<string, number>,
  minEvidence = 2,
  max = 8
): Gap[] {
  const gaps: Gap[] = [];
  for (const i of items) {
    if (i.status !== "active" && i.status !== "challenged") continue;
    if (i.type === "question" && i.status === "active") {
      gaps.push({ kind: "open_question", itemId: i.id, content: i.content });
    } else if (EVIDENCE_BACKED.has(i.type) && (evidenceCountById.get(i.id) ?? 0) < minEvidence) {
      gaps.push({ kind: "thin_evidence", itemId: i.id, content: i.content });
    }
  }
  return gaps.slice(0, max);
}

export interface Investigation {
  reason: "answer_question" | "corroborate" | "resolve_contradiction";
  content: string;
}

/**
 * The next investigations worth doing, derived deterministically from open
 * questions, thin-evidence items, and unresolved contradictions.
 */
export function suggestedInvestigations(items: ItemLite[], gaps: Gap[], max = 6): Investigation[] {
  const out: Investigation[] = [];
  for (const c of items.filter((i) => i.status === "challenged")) {
    out.push({ reason: "resolve_contradiction", content: c.content });
  }
  for (const g of gaps) {
    out.push({
      reason: g.kind === "open_question" ? "answer_question" : "corroborate",
      content: g.content,
    });
  }
  // De-duplicate by content, preserving order (contradictions first).
  const seen = new Set<string>();
  return out.filter((i) => (seen.has(i.content) ? false : (seen.add(i.content), true))).slice(0, max);
}
