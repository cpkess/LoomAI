import { describe, expect, it } from "vitest";

import { renderPptx, slideFromMarkdown } from "./pptx";
import { renderXlsx, sheetFromMarkdown } from "./xlsx";

// PPTX/XLSX/ZIP files are ZIP containers — they start with the "PK" magic.
const isZipContainer = (b: Buffer) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b;

describe("slideFromMarkdown", () => {
  it("turns list items and lines into bullets", () => {
    const s = slideFromMarkdown("Overview", "## ignored\n- first point\n- second point\nplain line");
    expect(s.title).toBe("Overview");
    expect(s.bullets).toEqual(["first point", "second point", "plain line"]);
  });
});

describe("sheetFromMarkdown", () => {
  it("parses a Markdown table into columns and rows", () => {
    const s = sheetFromMarkdown("Budget", "| Item | Cost |\n| --- | --- |\n| Widgets | 42 |\n| Gadgets | 7 |");
    expect(s.columns).toEqual(["Item", "Cost"]);
    expect(s.rows).toEqual([
      ["Widgets", "42"],
      ["Gadgets", "7"],
    ]);
  });
  it("falls back to one cell per line without a table", () => {
    const s = sheetFromMarkdown("Notes", "- alpha\n- beta");
    expect(s.rows).toEqual([["alpha"], ["beta"]]);
  });
});

describe("renderPptx", () => {
  it("produces a non-empty .pptx container", async () => {
    const buf = await renderPptx({
      title: "Q3 Review",
      slides: [{ title: "Highlights", bullets: ["Revenue up", "Costs down"], notes: "speaker notes" }],
    });
    expect(buf.byteLength).toBeGreaterThan(1000);
    expect(isZipContainer(buf)).toBe(true);
  });
});

describe("renderXlsx", () => {
  it("produces a non-empty .xlsx container", async () => {
    const buf = await renderXlsx({
      title: "Plan",
      sheets: [{ name: "Budget", columns: ["Item", "Cost"], rows: [["Widgets", "42"]] }],
    });
    expect(buf.byteLength).toBeGreaterThan(1000);
    expect(isZipContainer(buf)).toBe(true);
  });
  it("sanitizes and de-duplicates sheet names", async () => {
    // Should not throw on invalid/duplicate names.
    const buf = await renderXlsx({
      title: "t",
      sheets: [
        { name: "a/b:c", rows: [["1"]] },
        { name: "a/b:c", rows: [["2"]] },
      ],
    });
    expect(isZipContainer(buf)).toBe(true);
  });
});
