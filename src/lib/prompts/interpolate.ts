// Prompt variables use {{name}} syntax. Unknown variables are left intact so
// a partially-filled prompt stays legible.

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export function extractVariables(content: string): string[] {
  const found = new Set<string>();
  for (const match of content.matchAll(VARIABLE_PATTERN)) {
    found.add(match[1]);
  }
  return [...found];
}

export function interpolatePrompt(content: string, values: Record<string, string>): string {
  return content.replace(VARIABLE_PATTERN, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name] : whole
  );
}
