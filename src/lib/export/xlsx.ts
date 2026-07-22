// Native Excel generation from a typed workbook spec. The deliverable engine
// plans sheets and drafts each sheet's data; this renders them into a real
// .xlsx with exceljs.

export interface SheetSpec {
  name: string;
  columns?: string[];
  rows: string[][];
}

export interface WorkbookSpec {
  title: string;
  sheets: SheetSpec[];
}

/** Render a workbook spec into a .xlsx buffer. */
export async function renderXlsx(spec: WorkbookSpec): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "LoomAI";
  wb.created = new Date();

  const seen = new Set<string>();
  const sheets = spec.sheets.length > 0 ? spec.sheets : [{ name: "Sheet1", rows: [] }];
  for (const [i, sheet] of sheets.entries()) {
    // Excel sheet names: max 31 chars, unique, no []:*?/\ characters.
    let name = (sheet.name || `Sheet${i + 1}`).replace(/[[\]:*?/\\]/g, " ").slice(0, 31).trim() || `Sheet${i + 1}`;
    while (seen.has(name.toLowerCase())) name = `${name.slice(0, 28)}_${i}`;
    seen.add(name.toLowerCase());

    const ws = wb.addWorksheet(name);
    if (sheet.columns && sheet.columns.length > 0) {
      const header = ws.addRow(sheet.columns);
      header.font = { bold: true };
    }
    for (const row of sheet.rows) ws.addRow(row);
    // Reasonable column widths.
    const widthSource = sheet.columns && sheet.columns.length ? [sheet.columns, ...sheet.rows] : sheet.rows;
    const colCount = widthSource.reduce((m, r) => Math.max(m, r.length), 0);
    for (let c = 1; c <= colCount; c++) {
      const maxLen = widthSource.reduce((m, r) => Math.max(m, String(r[c - 1] ?? "").length), 10);
      ws.getColumn(c).width = Math.min(60, maxLen + 2);
    }
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

/**
 * Parse a writer's Markdown section into a sheet. A Markdown table becomes
 * columns + rows; otherwise each non-empty line becomes a single-cell row.
 */
export function sheetFromMarkdown(name: string, markdown: string): SheetSpec {
  const lines = (markdown ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const tableLines = lines.filter((l) => l.startsWith("|") && l.endsWith("|"));

  if (tableLines.length >= 2) {
    const cells = (l: string) =>
      l
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim());
    const columns = cells(tableLines[0]);
    const rows = tableLines
      .slice(1)
      .filter((l) => !/^\|[\s:|-]+\|$/.test(l)) // drop the --- separator row
      .map(cells);
    return { name, columns, rows };
  }

  return { name, rows: lines.filter((l) => !l.startsWith("#")).map((l) => [l.replace(/^[-*+]\s+/, "")]) };
}
