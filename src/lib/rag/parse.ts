import mammoth from "mammoth";

export const SUPPORTED_EXTENSIONS = ["pdf", "docx", "md", "markdown", "txt", "csv", "json", "html"] as const;

export function isSupportedFilename(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(ext);
}

/** Extract plain text from an uploaded document buffer. */
export async function parseDocument(filename: string, buffer: Buffer): Promise<string> {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
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
    case "html": {
      const text = buffer.toString("utf8");
      return text
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/\s{2,}/g, " ");
    }
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
