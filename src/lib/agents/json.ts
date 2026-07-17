// Robust JSON extraction for model output. Local models often wrap JSON in
// code fences or prose, so we try progressively looser strategies rather
// than relying on structured-output support.

export function extractJson(text: string): unknown | null {
  const candidates: string[] = [];

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1]);
  candidates.push(text);

  const firstBrace = text.search(/[[{]/);
  if (firstBrace >= 0) {
    const opener = text[firstBrace];
    const closer = opener === "[" ? "]" : "}";
    const lastCloser = text.lastIndexOf(closer);
    if (lastCloser > firstBrace) candidates.push(text.slice(firstBrace, lastCloser + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate.trim());
    } catch {
      // try the next strategy
    }
  }
  return null;
}
