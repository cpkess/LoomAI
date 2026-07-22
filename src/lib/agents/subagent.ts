import { generateText, stepCountIs, type ToolSet } from "ai";

import { asDetailedModelError, isRecoverableModelError } from "@/lib/ai/errors";
import { generation, limits, type GenSettings } from "@/lib/ai/generation";
import { resolveChatModel } from "@/lib/ai/registry";
import type { Organization } from "@/lib/db/schema";
import { allOrgCollectionIds } from "@/lib/rag/knowledge";
import { retrieveContext } from "@/lib/rag/retrieve";
import { buildResearchTools, describeResearch } from "@/lib/research/tools";

import { fallbackModelId } from "./resolve";

// Ephemeral subagents replace the old persistent "AI employee". A subagent is
// just a persona a project spins up to do one bounded piece of work — plan an
// outline, extract knowledge, write a section, critique it — with no DB row and
// zero setup. `systemReply` is the single grounded generation primitive: it
// resolves the org's default model, retrieves relevant context, wears the given
// persona, and (optionally) offers free web-research tools with a graceful
// tools → no-tools fallback for local models that reject tool payloads.

/** Whether the org has web research enabled (free, key-less; on by default). */
export function webResearchEnabled(org: Organization): boolean {
  const settings = (org.settings ?? {}) as { webResearch?: boolean };
  return settings.webResearch !== false;
}

/**
 * The model every subagent uses: the org's configured default, else the first
 * enabled chat model, so a fresh org works with zero per-agent configuration.
 */
export async function orgDefaultModelId(org: Organization): Promise<string | null> {
  const settings = (org.settings ?? {}) as { defaultModelId?: string };
  return settings.defaultModelId ?? (await fallbackModelId());
}

export interface SystemReplyOptions {
  /** Persona/role instructions layered onto the system prompt. */
  persona?: string;
  /** Generation settings tuned per call type (plan/work/summary/extract). */
  gen?: GenSettings;
  /** Offer free web-research tools (used by the researcher role). */
  withTools?: boolean;
  /** Collections to ground on; defaults to the whole org knowledge base. */
  collectionIds?: string[];
  /** Extra grounding text to append to the system prompt (e.g. project context). */
  extraSystem?: string;
}

/**
 * Run one grounded generation as an ephemeral subagent. Retrieves context over
 * the given collections, assembles persona + guidance + evidence into the
 * system prompt, and calls the model — retrying once without tools if a local
 * model rejects the tools payload, so work still gets done.
 */
export async function systemReply(org: Organization, prompt: string, options: SystemReplyOptions = {}): Promise<string> {
  const modelDbId = await orgDefaultModelId(org);
  if (!modelDbId) throw new Error("No AI model available — register a provider and enable a chat model");
  const { model, modelRow } = await resolveChatModel(modelDbId);

  const wantsTools = Boolean(options.withTools) && webResearchEnabled(org);
  const tools: ToolSet = buildResearchTools(wantsTools);
  const research = describeResearch(wantsTools);

  const collectionIds = options.collectionIds ?? (await allOrgCollectionIds(org.id));
  const retrieved = await retrieveContext(collectionIds, prompt);
  const system = [options.persona, research, options.extraSystem, retrieved.contextBlock].filter(Boolean).join("\n\n");

  const gen = options.gen ?? generation.work;
  return runGeneration(model, modelRow.displayName, system, prompt, { gen, tools });
}

/**
 * Shared model call with a tools → no-tools fallback. Many local models reject
 * a tools payload with HTTP 400; rather than fail, we retry once without tools.
 * Only if the tool-less attempt also fails do we surface a detailed error.
 */
export async function runGeneration(
  model: Parameters<typeof generateText>[0]["model"],
  modelName: string | null | undefined,
  system: string,
  prompt: string,
  opts: { gen: GenSettings; tools?: ToolSet }
): Promise<string> {
  const settings = { temperature: opts.gen.temperature, maxOutputTokens: opts.gen.maxOutputTokens };
  const tools = opts.tools ?? {};

  if (Object.keys(tools).length > 0) {
    try {
      const { text } = await generateText({ model, system, prompt, tools, stopWhen: stepCountIs(limits.toolSteps), ...settings });
      return text;
    } catch (err) {
      if (!isRecoverableModelError(err)) throw asDetailedModelError(err, modelName);
      const note =
        "\n\n(Note: your tools are unavailable for this step — the model could not use them. Do the task directly and describe precisely what still needs to be done.)";
      try {
        const { text } = await generateText({ model, system, prompt: prompt + note, ...settings });
        return text;
      } catch (err2) {
        throw asDetailedModelError(err2, modelName);
      }
    }
  }

  try {
    const { text } = await generateText({ model, system, prompt, ...settings });
    return text;
  } catch (err) {
    throw asDetailedModelError(err, modelName);
  }
}
