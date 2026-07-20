// Programmatic gate for auto-captured knowledge. Deciding whether a piece of
// output is worth remembering used to be an extra LLM call per task; most of
// that decision is mechanical, so we do it in code — faster, free, and
// perfectly consistent. Only outputs that pass this gate are considered for
// storage (and, for task deliverables, cleaned up by a single extraction call).

const MIN_LENGTH = 200;

// Phrases that mark an output as ephemeral, a failure, or otherwise not worth
// keeping as reference knowledge.
const NON_KNOWLEDGE_MARKERS = [
  "i cannot",
  "i can't",
  "i'm unable",
  "i am unable",
  "unable to complete",
  "could not complete",
  "no result",
  "failed:",
  "(failed",
  "error:",
  "as an ai",
];

/** Strip markdown/formatting noise to estimate real informational content. */
function informationalLength(text: string): number {
  const stripped = text
    .replace(/```[\s\S]*?```/g, " ") // code fences still count below, but not toward prose floor
    .replace(/[#>*_`~\-|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length;
}

/**
 * Decide whether an output is a candidate for the knowledge base. Pure and
 * deterministic: rejects trivially short outputs, obvious failures/refusals,
 * and pure pleasantries; accepts substantive deliverables.
 */
export function isKnowledgeCandidate(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length < MIN_LENGTH) return false;

  const lower = trimmed.toLowerCase();
  // A short output dominated by a failure/refusal marker is not knowledge.
  if (trimmed.length < 600 && NON_KNOWLEDGE_MARKERS.some((m) => lower.includes(m))) return false;

  // Require some real prose or structured content, not just a few symbols.
  if (informationalLength(trimmed) < MIN_LENGTH / 2) return false;

  // A single short question is not reference knowledge.
  if (trimmed.length < 400 && trimmed.endsWith("?") && !trimmed.includes("\n")) return false;

  return true;
}

/**
 * Derive a concise document title from content when the model didn't supply
 * one — a markdown H1, a bold lead-in, or the first sentence, trimmed.
 */
export function deriveTitle(content: string, fallback: string): string {
  const lines = content.split("\n").map((l) => l.trim());
  const h1 = lines.find((l) => l.startsWith("# "));
  if (h1) return clampTitle(h1.replace(/^#+\s*/, ""));

  const firstNonEmpty = lines.find((l) => l.length > 0);
  if (firstNonEmpty) {
    const bold = firstNonEmpty.match(/^\*\*(.+?)\*\*/);
    if (bold) return clampTitle(bold[1]);
    // First sentence of the first paragraph.
    const sentence = firstNonEmpty.split(/(?<=[.!?])\s/)[0];
    if (sentence && sentence.length >= 8) return clampTitle(sentence.replace(/[#*_`>]/g, ""));
  }
  return clampTitle(fallback);
}

function clampTitle(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length > 120 ? `${t.slice(0, 117)}…` : t;
}
