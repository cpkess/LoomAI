import type { Organization } from "@/lib/db/schema";

import { addTextToKnowledge, defaultKnowledgeCollectionId } from "./knowledge";
import { deriveTitle, isKnowledgeCandidate } from "./knowledge-heuristics";

// Capture knowledge from ordinary AI-employee chats so the organization keeps
// learning from every interaction — not just from formal tasks and projects.
// This path uses NO extra LLM call: a pure heuristic gate decides candidacy and
// embedding-based dedup prevents near-duplicates, so it is cheap and consistent.

function autoKnowledgeEnabled(org: Organization): boolean {
  const settings = (org.settings ?? {}) as { autoKnowledge?: boolean };
  return settings.autoKnowledge !== false;
}

/**
 * File a substantive AI-employee chat answer into the shared knowledge base.
 * Silently does nothing when auto-capture is off, the answer isn't substantial,
 * or equivalent knowledge already exists.
 */
export async function captureChatKnowledge(input: {
  org: Organization;
  agentName: string;
  question: string;
  answer: string;
  conversationTitle: string;
}): Promise<void> {
  if (!autoKnowledgeEnabled(input.org)) return;
  if (!isKnowledgeCandidate(input.answer)) return;

  const title = deriveTitle(
    input.answer,
    input.conversationTitle && input.conversationTitle !== "New conversation" ? input.conversationTitle : input.question
  );
  // Keep the prompting question as light framing so the stored answer stays
  // self-contained and retrievable.
  const content = input.question.trim() ? `> ${input.question.trim()}\n\n${input.answer.trim()}` : input.answer.trim();

  const collectionId = await defaultKnowledgeCollectionId(input.org.id);
  await addTextToKnowledge({ orgId: input.org.id, collectionId, title, content, dedupe: true });
}
