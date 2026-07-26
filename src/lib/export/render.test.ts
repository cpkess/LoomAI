import { describe, expect, it } from "vitest";

import { deliverableHtml, fileName } from "./render";

describe("fileName", () => {
  it("slugifies the title and appends the extension", () => {
    expect(fileName("Launch Plan v2!", "pdf")).toBe("launch-plan-v2.pdf");
    expect(fileName("Q3 Report", "docx")).toBe("q3-report.docx");
    expect(fileName("notes", "md")).toBe("notes.md");
  });

  it("falls back when the title has no usable characters", () => {
    expect(fileName("...", "html")).toBe("deliverable.html");
  });
});

describe("deliverableHtml", () => {
  const html = deliverableHtml({
    title: "Quarterly Plan",
    orgName: "Acme Corp",
    markdown: "# Goals\n\n- Ship v2\n- Grow revenue\n\n| A | B |\n|---|---|\n| 1 | 2 |",
  });

  it("produces a full HTML document with the title and org in the header", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>Quarterly Plan</title>");
    expect(html).toContain("Acme Corp");
  });

  it("renders markdown structure (headings, lists, GFM tables)", () => {
    expect(html).toContain("<h1"); // # Goals
    expect(html).toContain("<li>Ship v2</li>");
    expect(html).toContain("<table>");
  });

  it("escapes HTML in the title to prevent breaking the shell", () => {
    const injected = deliverableHtml({ title: "<script>x</script>", orgName: "Acme", markdown: "hi" });
    expect(injected).toContain("&lt;script&gt;");
    expect(injected).not.toContain("<title><script>");
  });
});
