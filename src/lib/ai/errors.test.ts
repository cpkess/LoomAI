import { APICallError } from "ai";
import { describe, expect, it } from "vitest";

import { asDetailedModelError, isRecoverableModelError, rootModelError } from "./errors";

function apiError(opts: { statusCode?: number; responseBody?: string; data?: unknown; message?: string }) {
  return new APICallError({
    message: opts.message ?? "Bad Request",
    url: "http://localhost:1234/v1/chat/completions",
    requestBodyValues: {},
    statusCode: opts.statusCode,
    responseBody: opts.responseBody,
    data: opts.data,
  });
}

/** Mimic the AI SDK's RetryError shape (it wraps the last provider error). */
function retryError(last: unknown) {
  return { name: "AI_RetryError", message: "failed after 3 attempts", lastError: last };
}

describe("rootModelError", () => {
  it("unwraps a RetryError to the underlying provider error", () => {
    const inner = apiError({ statusCode: 400 });
    expect(rootModelError(retryError(inner))).toBe(inner);
  });

  it("follows a cause chain", () => {
    const inner = apiError({ statusCode: 400 });
    const wrapper = Object.assign(new Error("wrapped"), { cause: inner });
    expect(rootModelError(wrapper)).toBe(inner);
  });

  it("returns the error itself when there is nothing to unwrap", () => {
    const e = new Error("plain");
    expect(rootModelError(e)).toBe(e);
  });
});

describe("isRecoverableModelError", () => {
  it("treats a 400 as recoverable (retry without tools)", () => {
    expect(isRecoverableModelError(retryError(apiError({ statusCode: 400 })))).toBe(true);
  });

  it("treats auth errors as non-recoverable", () => {
    expect(isRecoverableModelError(apiError({ statusCode: 401 }))).toBe(false);
    expect(isRecoverableModelError(apiError({ statusCode: 403 }))).toBe(false);
  });

  it("treats server errors as non-recoverable", () => {
    expect(isRecoverableModelError(apiError({ statusCode: 500 }))).toBe(false);
  });
});

describe("asDetailedModelError", () => {
  it("surfaces the provider's error message from responseBody JSON", () => {
    const err = asDetailedModelError(
      retryError(
        apiError({ statusCode: 400, responseBody: JSON.stringify({ error: { message: "This model does not support tools" } }) })
      ),
      "qwen2.5-7b"
    );
    expect(err.message).toContain("HTTP 400");
    expect(err.message).toContain("This model does not support tools");
    expect(err.message).toContain("qwen2.5-7b");
  });

  it("reads a message from the parsed data field", () => {
    const err = asDetailedModelError(apiError({ statusCode: 400, data: { error: { message: "no tools here" } } }));
    expect(err.message).toContain("no tools here");
  });

  it("handles a string error field in the body", () => {
    const err = asDetailedModelError(apiError({ statusCode: 400, responseBody: JSON.stringify({ error: "plain string" }) }));
    expect(err.message).toContain("plain string");
  });

  it("falls back to a readable message for non-API errors", () => {
    const err = asDetailedModelError(new Error("connection refused"));
    expect(err.message).toContain("connection refused");
    expect(err.message).toContain("provider is reachable");
  });
});
