import mammoth from "mammoth";

// Formats LoomAI can ingest into a project's long-term memory. Parsers preserve
// as much structure as possible (slides, sheets, transcript text) and return
// provenance metadata alongside the extracted text.
export const SUPPORTED_EXTENSIONS = [
  "pdf",
  "docx",
  "pptx",
  "xlsx",
  "md",
  "markdown",
  "txt",
  "csv",
  "json",
  "html",
  "htm",
  "vtt",
  "srt",
  "zip",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
] as const;

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

export interface ParsedDocument {
  text: string;
  /** Provenance/structure: source kind and counts (slides/sheets/files). */
  metadata: Record<string, unknown>;
}

export function extensionOf(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

export function isSupportedFilename(filename: string): boolean {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(extensionOf(filename));
}

/** Extract text + provenance metadata from an uploaded document buffer. */
export async function parseDocument(filename: string, buffer: Buffer): Promise<ParsedDocument> {
  const ext = extensionOf(filename);

  switch (ext) {
    case "pptx":
      return parsePptx(buffer);
    case "xlsx":
      return parseXlsx(buffer);
    case "zip":
      return parseZip(buffer);
    case "vtt":
    case "srt":
      return { text: parseSubtitles(buffer.toString("utf8")), metadata: { kind: "transcript" } };
    default:
      if (IMAGE_EXTS.has(ext)) {
        // OCR/vision captioning is deferred; index the filename so the image is
        // discoverable and its provenance recorded.
        return { text: `Image: ${filename}`, metadata: { kind: "image", filename } };
      }
      return { text: await extractText(ext, buffer), metadata: { kind: "document" } };
  }
}

/** Plain-text extraction for the "flat" document types (also reused by zip). */
async function extractText(ext: string, buffer: Buffer): Promise<string> {
  switch (ext) {
    case "pdf": {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: buffer });
      try {
        const result = await parser.getText();
        return result.text ?? "";
      } finally {
        await parser.destroy();
      }
    }
    case "docx": {
      const result = await mammoth.extractRawText({ buffer });
      return result.value ?? "";
    }
    case "html":
    case "htm":
      return stripHtml(buffer.toString("utf8"));
    case "vtt":
    case "srt":
      return parseSubtitles(buffer.toString("utf8"));
    case "md":
    case "markdown":
    case "txt":
    case "csv":
    case "json":
      return buffer.toString("utf8");
    default:
      throw new Error(`Unsupported file type: .${ext}`);
  }
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Strip cue numbers and timestamps from WebVTT/SRT, leaving spoken text. */
export function parseSubtitles(raw: string): string {
  const lines = raw.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t === "WEBVTT") continue;
    if (/^\d+$/.test(t)) continue; // SRT cue index
    if (t.includes("-->")) continue; // timestamp line
    out.push(t.replace(/<[^>]+>/g, ""));
  }
  return out.join(" ").replace(/\s{2,}/g, " ").trim();
}

/** PowerPoint: slide text + speaker notes, marked per slide. */
async function parsePptx(buffer: Buffer): Promise<ParsedDocument> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);

  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => slideNum(a) - slideNum(b));

  const parts: string[] = [];
  for (const name of slideNames) {
    const n = slideNum(name);
    const xml = await zip.files[name].async("string");
    const body = xmlText(xml);
    const notesName = `ppt/notesSlides/notesSlide${n}.xml`;
    const notes = zip.files[notesName] ? xmlText(await zip.files[notesName].async("string")) : "";
    parts.push(`## Slide ${n}\n${body}${notes ? `\n\nNotes: ${notes}` : ""}`);
  }
  return { text: parts.join("\n\n"), metadata: { kind: "presentation", slides: slideNames.length } };
}

function slideNum(name: string): number {
  return Number(name.match(/(\d+)\.xml$/)?.[1] ?? 0);
}

/** Concatenate the text runs (<a:t>) of an Office Open XML part. */
function xmlText(xml: string): string {
  const runs = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXml(m[1]));
  return runs.join(" ").replace(/\s{2,}/g, " ").trim();
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Excel: each sheet serialized as a heading + tab-separated rows. */
async function parseXlsx(buffer: Buffer): Promise<ParsedDocument> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);

  const parts: string[] = [];
  const sheetNames: string[] = [];
  wb.eachSheet((sheet) => {
    sheetNames.push(sheet.name);
    const rows: string[] = [];
    sheet.eachRow((row) => {
      const values = (row.values as unknown[]).slice(1).map((v) => cellText(v));
      if (values.some((v) => v !== "")) rows.push(values.join("\t"));
    });
    parts.push(`# Sheet: ${sheet.name}\n${rows.join("\n")}`);
  });
  return { text: parts.join("\n\n"), metadata: { kind: "workbook", sheets: sheetNames } };
}

function cellText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") {
    const o = v as { text?: string; result?: unknown; hyperlink?: string };
    if (typeof o.text === "string") return o.text;
    if (o.result != null) return String(o.result);
    if (o.hyperlink) return o.hyperlink;
    return "";
  }
  return String(v);
}

/** ZIP archive: expand and concatenate the text of supported entries. */
async function parseZip(buffer: Buffer): Promise<ParsedDocument> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);

  const parts: string[] = [];
  const files: string[] = [];
  for (const name of Object.keys(zip.files).sort()) {
    const entry = zip.files[name];
    if (entry.dir) continue;
    const ext = extensionOf(name);
    // Skip nested archives (zip bombs) and unsupported/binary entries.
    if (ext === "zip" || !(SUPPORTED_EXTENSIONS as readonly string[]).includes(ext) || IMAGE_EXTS.has(ext)) continue;
    try {
      const entryBuffer = Buffer.from(await entry.async("uint8array"));
      const nested = ext === "pptx" ? (await parsePptx(entryBuffer)).text : ext === "xlsx" ? (await parseXlsx(entryBuffer)).text : await extractText(ext, entryBuffer);
      if (nested.trim()) {
        files.push(name);
        parts.push(`# File: ${name}\n${nested.trim()}`);
      }
    } catch {
      // Skip entries we can't parse rather than failing the whole archive.
    }
  }
  return { text: parts.join("\n\n"), metadata: { kind: "archive", files } };
}
