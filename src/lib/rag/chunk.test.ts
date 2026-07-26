import { describe, expect, it } from "vitest";

import { chunkText } from "./chunk";

describe("chunkText", () => {
  it("returns empty for blank input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n  ")).toEqual([]);
  });

  it("keeps short text as a single chunk", () => {
    expect(chunkText("Hello world")).toEqual(["Hello world"]);
  });

  it("respects the max chunk size", () => {
    const paragraphs = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} with some sentence content here.`);
    const text = paragraphs.join("\n\n");
    const chunks = chunkText(text, { maxChars: 200, overlap: 40 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(200);
    }
  });

  it("covers all content", () => {
    const text = Array.from({ length: 30 }, (_, i) => `Unique marker alpha${i}.`).join("\n\n");
    const chunks = chunkText(text, { maxChars: 120, overlap: 20 });
    const joined = chunks.join("\n");
    for (let i = 0; i < 30; i++) {
      expect(joined).toContain(`alpha${i}`);
    }
  });

  it("hard-splits a single oversized sentence", () => {
    const long = "x".repeat(5000);
    const chunks = chunkText(long, { maxChars: 1000, overlap: 100 });
    expect(chunks.length).toBeGreaterThan(4);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1000);
    }
  });

  it("creates overlapping context between chunks", () => {
    const text = Array.from({ length: 20 }, (_, i) => `Sentence number ${i} is right here.`).join(" ");
    const chunks = chunkText(text, { maxChars: 150, overlap: 50 });
    expect(chunks.length).toBeGreaterThan(1);
  });
});
