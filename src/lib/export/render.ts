import { marked } from "marked";

import { slugify } from "@/lib/utils";
import { findChromium } from "@/lib/research/web";

// Turn a deliverable (stored as markdown text) into real, downloadable files:
// a styled HTML document, a print-quality PDF (rendered by the same Chromium
// used for web research), or a Word .docx. Everything is generated on demand
// from the markdown that already lives in the database — no file storage.

export type DeliverableFormat = "md" | "html" | "pdf" | "docx";

export const FORMAT_META: Record<DeliverableFormat, { ext: string; mime: string; label: string }> = {
  md: { ext: "md", mime: "text/markdown; charset=utf-8", label: "Markdown" },
  html: { ext: "html", mime: "text/html; charset=utf-8", label: "HTML" },
  pdf: { ext: "pdf", mime: "application/pdf", label: "PDF" },
  docx: {
    ext: "docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    label: "Word",
  },
};

/** Download filename for a deliverable title + format, e.g. "launch-plan.pdf". */
export function fileName(title: string, format: DeliverableFormat): string {
  return `${slugify(title) || "deliverable"}.${FORMAT_META[format].ext}`;
}

const STYLES = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a;
    line-height: 1.6; max-width: 46rem; margin: 0 auto; padding: 2.5rem; }
  header.doc { border-bottom: 2px solid #e5e7eb; margin-bottom: 1.5rem; padding-bottom: 1rem; }
  header.doc .title { font-size: 1.6rem; font-weight: 700; margin: 0 0 .25rem; }
  header.doc .meta { color: #6b7280; font-size: .8rem; }
  h1, h2, h3, h4 { line-height: 1.25; margin: 1.4em 0 .5em; }
  h1 { font-size: 1.5rem; } h2 { font-size: 1.25rem; } h3 { font-size: 1.1rem; }
  p { margin: .6em 0; }
  a { color: #2563eb; }
  code { background: #f3f4f6; padding: .1em .35em; border-radius: 4px; font-size: .9em;
    font-family: "SF Mono", ui-monospace, Menlo, Consolas, monospace; }
  pre { background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1rem; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #d1d5db; margin: .8em 0; padding: .2em 1rem; color: #4b5563; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: .95em; }
  th, td { border: 1px solid #e5e7eb; padding: .5rem .75rem; text-align: left; }
  th { background: #f9fafb; font-weight: 600; }
  ul, ol { padding-left: 1.4rem; }
  img { max-width: 100%; }
  @media print { body { padding: 0; max-width: none; } }
`;

/** Escape a string for safe insertion into HTML text nodes. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Render a deliverable's markdown into a complete, self-contained, print-styled
 * HTML document with a titled header. The page shell is fixed; the deliverable
 * body is produced by marked.
 */
export function deliverableHtml(input: { title: string; orgName: string; markdown: string }): string {
  const body = marked.parse(input.markdown, { gfm: true, async: false }) as string;
  const date = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(input.title)}</title>
<style>${STYLES}</style></head>
<body>
<header class="doc">
  <p class="title">${escapeHtml(input.title)}</p>
  <p class="meta">${escapeHtml(input.orgName)} · ${escapeHtml(date)}</p>
</header>
${body}
</body></html>`;
}

/** Render HTML to a PDF via the shipped Chromium (same one used for web research). */
export async function renderPdf(html: string): Promise<Buffer> {
  const executablePath = findChromium();
  if (!executablePath) {
    throw new Error(
      "PDF export needs Chromium, which isn't available here. It ships in the Docker image; for bare `npm run dev`, set LOOMAI_CHROMIUM_PATH to a Chrome/Chromium binary. Meanwhile HTML, Markdown, and Word downloads work without it."
    );
  }
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

/** Render a full HTML document to a Word .docx buffer. */
export async function renderDocx(html: string): Promise<Buffer> {
  const htmlToDocx = (await import("@turbodocx/html-to-docx")).default;
  const out = await htmlToDocx(html, null, { table: { row: { cantSplit: true } } });
  if (Buffer.isBuffer(out)) return out;
  if (out instanceof ArrayBuffer) return Buffer.from(out);
  // Blob (browser-shaped) — normalize to Buffer.
  return Buffer.from(await (out as Blob).arrayBuffer());
}

/** Produce the bytes for a deliverable in the requested format. */
export async function renderDeliverable(
  format: DeliverableFormat,
  input: { title: string; orgName: string; markdown: string }
): Promise<Buffer> {
  if (format === "md") return Buffer.from(input.markdown, "utf8");
  const html = deliverableHtml(input);
  if (format === "html") return Buffer.from(html, "utf8");
  if (format === "pdf") return renderPdf(html);
  return renderDocx(html);
}
