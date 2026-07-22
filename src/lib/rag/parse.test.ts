import { describe, expect, it } from "vitest";

import { isSupportedFilename, parseDocument, parseSubtitles, stripHtml } from "./parse";

describe("parseSubtitles", () => {
  it("strips cue numbers and timestamps from SRT", () => {
    const srt = "1\n00:00:01,000 --> 00:00:04,000\nHello there\n\n2\n00:00:04,000 --> 00:00:06,000\ngeneral <b>Kenobi</b>";
    expect(parseSubtitles(srt)).toBe("Hello there general Kenobi");
  });
  it("drops the WEBVTT header and timestamps", () => {
    const vtt = "WEBVTT\n\n00:00.000 --> 00:02.000\nline one\n\n00:00:02.000 --> 00:00:03.000\nline two";
    expect(parseSubtitles(vtt)).toBe("line one line two");
  });
});

describe("stripHtml", () => {
  it("removes tags, scripts, and decodes entities", () => {
    const html = "<div>Hello <script>evil()</script><b>world</b> &amp; more</div>";
    expect(stripHtml(html)).toBe("Hello world & more");
  });
});

describe("isSupportedFilename", () => {
  it("accepts the new formats", () => {
    for (const f of ["a.pptx", "b.xlsx", "c.zip", "d.png", "e.vtt", "f.srt"]) {
      expect(isSupportedFilename(f)).toBe(true);
    }
    expect(isSupportedFilename("g.exe")).toBe(false);
  });
});

describe("parseDocument xlsx", () => {
  it("extracts sheet names and cells", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("Budget");
    sheet.addRow(["Item", "Cost"]);
    sheet.addRow(["Widgets", 42]);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const parsed = await parseDocument("plan.xlsx", buffer);
    expect(parsed.metadata).toMatchObject({ kind: "workbook", sheets: ["Budget"] });
    expect(parsed.text).toContain("# Sheet: Budget");
    expect(parsed.text).toContain("Widgets");
    expect(parsed.text).toContain("42");
  });
});

describe("parseDocument zip", () => {
  it("concatenates supported entries with headers", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file("notes.txt", "alpha beta");
    zip.file("data.csv", "x,y\n1,2");
    zip.file("ignore.bin", "binary");
    const buffer = Buffer.from(await zip.generateAsync({ type: "uint8array" }));

    const parsed = await parseDocument("bundle.zip", buffer);
    expect(parsed.metadata).toMatchObject({ kind: "archive" });
    expect(parsed.text).toContain("# File: notes.txt");
    expect(parsed.text).toContain("alpha beta");
    expect(parsed.text).toContain("# File: data.csv");
    expect((parsed.metadata as { files: string[] }).files).not.toContain("ignore.bin");
  });
});

describe("parseDocument image", () => {
  it("records image provenance without failing", async () => {
    const parsed = await parseDocument("diagram.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(parsed.metadata).toMatchObject({ kind: "image" });
    expect(parsed.text).toContain("diagram.png");
  });
});
