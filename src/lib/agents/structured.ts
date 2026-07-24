import type { z } from "zod";

import type { GenSettings } from "@/lib/ai/generation";
import type { Organization } from "@/lib/db/schema";

import { extractJson } from "./json";
import { systemReply } from "./subagent";

// Structured generation with an honest failure mode.
//
// Local models drop malformed JSON often enough that it matters, and the old
// behaviour was to silently substitute a default: an empty solution presented
// as a finished one, or a verification that defaulted to "passes" for a review
// that never happened. That turns a visible failure into invisible bad output,
// which is the worst possible trade.
//
// So: parse, retry once with the parser's complaint fed back, then throw. The
// engine marks the run failed and the error surfaces in the UI. A run that
// failed is recoverable; a run that quietly produced nothing is not.

export class StructuredOutputError extends Error {
  constructor(
    readonly label: string,
    readonly detail: string
  ) {
    super(`${label}: the model did not return usable JSON (${detail})`);
    this.name = "StructuredOutputError";
  }
}

/** Compact a Zod failure into something worth showing a model — and a human. */
function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 4)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

export interface StructuredOptions<T> {
  org: Organization;
  persona: string;
  prompt: string;
  schema: z.ZodType<T>;
  gen: GenSettings;
  /** Names this call in errors and logs, e.g. "solution.findings". */
  label: string;
}

/**
 * Generate JSON matching a schema. Retries once on unusable output, telling the
 * model what was wrong, then fails the run rather than inventing a default.
 */
export async function generateStructured<T>(options: StructuredOptions<T>): Promise<T> {
  const { org, persona, prompt, schema, gen, label } = options;
  let detail = "no response";

  for (let attempt = 0; attempt < 2; attempt++) {
    const ask =
      attempt === 0
        ? prompt
        : [
            prompt,
            "",
            `Your previous reply could not be used: ${detail}.`,
            "Reply with the JSON object only — no prose, no markdown fence, no commentary. Every required field must be present.",
          ].join("\n");

    let text: string;
    try {
      text = await systemReply(org, ask, { persona, gen });
    } catch (err) {
      detail = err instanceof Error ? err.message : String(err);
      continue; // a provider hiccup is worth one more try
    }

    const json = extractJson(text);
    if (json === null || json === undefined) {
      detail = "no JSON object found in the reply";
      continue;
    }
    const parsed = schema.safeParse(json);
    if (parsed.success) return parsed.data;
    detail = describeIssues(parsed.error);
  }

  throw new StructuredOutputError(label, detail);
}
