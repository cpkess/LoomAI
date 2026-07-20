import { APICallError } from "ai";

// Turning provider failures into something a human can act on. Local models
// frequently return a terse "Bad Request" (HTTP 400) — often because they were
// handed a tools payload they don't support. These helpers unwrap the AI SDK's
// retry wrapper, decide whether a tool-less retry is worth attempting, and pull
// the provider's actual error text into an informative message.

/** Unwrap the AI SDK's RetryError (and any cause chain) to the root error. */
export function rootModelError(err: unknown): unknown {
  let current = err;
  for (let i = 0; i < 8 && current && typeof current === "object"; i++) {
    const e = current as { name?: string; lastError?: unknown; cause?: unknown };
    if (e.name === "AI_RetryError" && e.lastError) current = e.lastError;
    else if (e.cause && e.cause !== current) current = e.cause;
    else break;
  }
  return current;
}

/**
 * A recoverable error is one where retrying without tools has a real chance of
 * succeeding — chiefly a 4xx (typically 400) from a model that doesn't accept
 * the tools payload. Auth (401/403) and server (5xx) errors are not retried
 * this way.
 */
export function isRecoverableModelError(err: unknown): boolean {
  const root = rootModelError(err);
  if (APICallError.isInstance(root)) {
    const status = root.statusCode;
    if (status === undefined) return true;
    return status >= 400 && status < 500 && status !== 401 && status !== 403;
  }
  // Unknown shape — a tool-less retry is cheap and often the fix.
  return true;
}

/** Pull the most specific message out of a provider's error response body. */
export function extractProviderMessage(err: APICallError): string | undefined {
  const data = err.data as { error?: { message?: string }; message?: string } | undefined;
  const fromData = data?.error?.message ?? data?.message;
  if (fromData) return fromData;
  const body = err.responseBody;
  if (!body) return undefined;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    if (typeof parsed.error === "string") return parsed.error;
    return parsed.error?.message ?? parsed.message ?? body.slice(0, 300);
  } catch {
    return body.slice(0, 300);
  }
}

/** Build a human-readable Error carrying the provider's actual response text. */
export function asDetailedModelError(err: unknown, modelName?: string | null): Error {
  const root = rootModelError(err);
  const where = modelName ? ` (model: ${modelName})` : "";

  if (APICallError.isInstance(root)) {
    const status = root.statusCode ? `HTTP ${root.statusCode}` : "request failed";
    const detail = extractProviderMessage(root) ?? root.message;
    return new Error(
      `The AI model could not complete this step${where}. ${status}: ${detail}. ` +
        "Try a model that supports tool use, or pick a different model in Settings."
    );
  }

  const message = root instanceof Error ? root.message : String(root);
  return new Error(
    `The AI model could not complete this step${where}: ${message}. ` +
      "Check that the provider is reachable and the model is loaded, then try again."
  );
}
