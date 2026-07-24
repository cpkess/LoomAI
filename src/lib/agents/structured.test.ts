import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const systemReply = vi.fn();
vi.mock("./subagent", () => ({ systemReply: (...args: unknown[]) => systemReply(...args) }));

const { generateStructured, StructuredOutputError } = await import("./structured");

import type { Organization } from "@/lib/db/schema";

const org = { id: "org-1" } as Organization;
const schema = z.object({ answer: z.string(), score: z.number() });

function call() {
  return generateStructured({
    org,
    persona: "p",
    prompt: "produce the thing",
    schema,
    gen: { temperature: 0.2 },
    label: "test.call",
  });
}

// Block body on purpose: mockReset() returns the mock, and vitest treats a
// returned function as a teardown hook — it would call the mock after the test.
beforeEach(() => {
  systemReply.mockReset();
});

describe("structured generation", () => {
  it("returns parsed data when the model complies", async () => {
    systemReply.mockResolvedValueOnce('{"answer":"yes","score":90}');
    await expect(call()).resolves.toEqual({ answer: "yes", score: 90 });
    expect(systemReply).toHaveBeenCalledTimes(1);
  });

  it("retries once and tells the model what was wrong", async () => {
    systemReply.mockResolvedValueOnce("I think the answer is yes!");
    systemReply.mockResolvedValueOnce('{"answer":"yes","score":90}');

    await expect(call()).resolves.toEqual({ answer: "yes", score: 90 });
    expect(systemReply).toHaveBeenCalledTimes(2);
    const retryPrompt = systemReply.mock.calls[1][1] as string;
    expect(retryPrompt).toContain("could not be used");
    expect(retryPrompt).toContain("no JSON object found");
  });

  it("feeds schema complaints back on the retry", async () => {
    systemReply.mockResolvedValueOnce('{"answer":"yes"}'); // missing score
    systemReply.mockResolvedValueOnce('{"answer":"yes","score":80}');

    await call();
    expect(systemReply.mock.calls[1][1]).toContain("score");
  });

  // The point of the whole module: never substitute a default for a failure.
  it("throws instead of returning a fabricated default", async () => {
    systemReply.mockResolvedValue("still not json");
    await expect(call()).rejects.toBeInstanceOf(StructuredOutputError);
    expect(systemReply).toHaveBeenCalledTimes(2);
  });

  it("names the failing step so the error is actionable", async () => {
    systemReply.mockResolvedValue("nope");
    await expect(call()).rejects.toThrow(/test\.call/);
  });

  it("rides out a one-off provider error", async () => {
    systemReply.mockImplementationOnce(async () => { throw new Error("connection reset"); });
    systemReply.mockResolvedValueOnce('{"answer":"ok","score":1}');
    await expect(call()).resolves.toEqual({ answer: "ok", score: 1 });
  });

  it("surfaces a persistent provider error rather than swallowing it", async () => {
    systemReply.mockImplementation(async () => { throw new Error("connection reset"); });
    let caught: unknown;
    try {
      await call();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(StructuredOutputError);
    expect((caught as Error).message).toContain("connection reset");
    expect(systemReply).toHaveBeenCalledTimes(2);
  });

  it("reads JSON out of a markdown fence", async () => {
    systemReply.mockResolvedValueOnce('```json\n{"answer":"fenced","score":5}\n```');
    await expect(call()).resolves.toEqual({ answer: "fenced", score: 5 });
  });
});
