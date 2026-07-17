export interface ChunkOptions {
  /** Target maximum characters per chunk. */
  maxChars?: number;
  /** Characters of trailing context carried into the next chunk. */
  overlap?: number;
}

const DEFAULTS: Required<ChunkOptions> = { maxChars: 1500, overlap: 200 };

/**
 * Split text into retrieval chunks. Prefers paragraph boundaries, falls back
 * to sentence boundaries, and hard-splits only when a single sentence exceeds
 * the budget. Consecutive chunks share `overlap` characters of context.
 */
export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const { maxChars, overlap } = { ...DEFAULTS, ...options };
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const paragraphs = normalized.split(/\n{2,}/);
  const pieces: string[] = [];
  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;
    if (trimmed.length <= maxChars) {
      pieces.push(trimmed);
    } else {
      // Split oversized paragraphs on sentence boundaries.
      let current = "";
      for (const sentence of trimmed.split(/(?<=[.!?])\s+/)) {
        if (current && current.length + sentence.length + 1 > maxChars) {
          pieces.push(current);
          current = sentence;
        } else {
          current = current ? `${current} ${sentence}` : sentence;
        }
        // A single sentence longer than the budget gets hard-split.
        while (current.length > maxChars) {
          pieces.push(current.slice(0, maxChars));
          current = current.slice(maxChars - overlap);
        }
      }
      if (current) pieces.push(current);
    }
  }

  // Merge small pieces into chunks up to maxChars, carrying overlap between chunks.
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (current && current.length + piece.length + 2 > maxChars) {
      chunks.push(current);
      const tail = current.slice(Math.max(0, current.length - overlap));
      current = tail ? `${tail}\n\n${piece}` : piece;
      // If even the fresh piece with overlap overflows, flush the overlap.
      if (current.length > maxChars) {
        chunks.push(current.slice(0, maxChars));
        current = current.slice(maxChars - overlap);
      }
    } else {
      current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter((c) => c.length > 0);
}
