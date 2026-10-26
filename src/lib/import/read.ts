import "server-only";
import ExcelJS from "exceljs";
import { headerScore } from "./detect";

export type RawSheet = { name: string; raw: string[][] };
export type FileKind = "excel" | "csv" | "pdf";

const MAX_ROWS = 5000;
const MAX_COLS = 40;

export function kindOf(name: string): FileKind | null {
  const ext = name.toLowerCase().split(".").pop();
  if (ext === "xlsx" || ext === "xlsm") return "excel";
  if (ext === "csv") return "csv";
  if (ext === "pdf") return "pdf";
  return null;
}

/** Read every sheet (or every PDF page as one table) into a grid of strings. */
export async function readFile(kind: FileKind, buf: Buffer): Promise<RawSheet[]> {
  if (kind === "excel") return readExcel(buf);
  if (kind === "csv") return [{ name: "CSV", raw: readCsv(buf.toString("utf8")) }];
  return readPdf(buf);
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((p) => p.text).join("");
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue);
    if ("text" in v) return String(v.text);
    if ("error" in v) return "";
    return "";
  }
  return String(v);
}

async function readExcel(buf: Buffer): Promise<RawSheet[]> {
  const wb = new ExcelJS.Workbook();
  // exceljs' types predate Node's generic Buffer
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const sheets: RawSheet[] = [];
  wb.eachSheet((ws) => {
    if (ws.state && ws.state !== "visible") return;
    const raw: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber > MAX_ROWS) return;
      // keep blank lines so row numbers shown later match the spreadsheet
      while (raw.length < rowNumber - 1) raw.push([]);
      const cells: string[] = [];
      for (let c = 1; c <= Math.min(row.cellCount, MAX_COLS); c++) cells.push(cellText(row.getCell(c).value).trim());
      raw.push(cells);
    });
    if (raw.length) sheets.push({ name: ws.name, raw });
  });
  return sheets;
}

export function readCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, "");
  const first = s.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t"].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell.trim()); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell.trim());
      rows.push(row.slice(0, MAX_COLS));
      row = [];
      cell = "";
      if (rows.length >= MAX_ROWS) break;
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row.slice(0, MAX_COLS)); }
  return rows;
}

type Item = { x: number; w: number; y: number; str: string };

const ARABIC = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

/**
 * Many PDF writers store Arabic as separate letter shapes laid out left-to-right.
 * Put the pieces back in reading order, add spaces at word gaps, and turn the
 * letter shapes (presentation forms) back into normal Arabic letters.
 */
function cellString(parts: Item[]): string {
  const asc = [...parts].sort((a, b) => a.x - b.x);
  const gapBefore = asc.map((p, i) => (i ? p.x - (asc[i - 1].x + asc[i - 1].w) : 0));
  const order = parts.some((p) => ARABIC.test(p.str)) ? asc.map((_, i) => asc.length - 1 - i) : asc.map((_, i) => i);
  let out = "";
  order.forEach((i, k) => {
    // a word gap sits between this piece and its left/right neighbour depending on direction
    const prevIdx = order[k - 1];
    if (k > 0 && gapBefore[Math.max(i, prevIdx)] > 1.5) out += " ";
    out += asc[i].str;
  });
  return out.normalize("NFKC").replace(/\s+/g, " ").trim();
}

/**
 * Text-based PDF tables: group text by line, find the header line, then put every
 * piece of text under the nearest header column. Scanned (image-only) PDFs have no
 * text and come back empty.
 */
async function readPdf(buf: Buffer): Promise<RawSheet[]> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const lines: Item[][] = [];
  for (let p = 1; p <= Math.min(pdf.numPages, 50); p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const items = (tc.items as { str?: string; transform?: number[]; width?: number }[])
      .filter((i) => i.str && i.str.trim() && i.transform)
      .map((i) => ({ x: i.transform![4], w: i.width ?? 0, y: i.transform![5], str: i.str!.trim() }));
    // top-to-bottom lines (PDF y grows upwards); items within 3pt share a line
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const pageLines: Item[][] = [];
    for (const it of items) {
      const last = pageLines[pageLines.length - 1];
      if (last && Math.abs(last[0].y - it.y) <= 3) last.push(it);
      else pageLines.push([it]);
    }
    lines.push(...pageLines);
  }
  if (!lines.length) return [];

  // Split a line into cells wherever the horizontal gap is wide
  const split = (line: Item[]) => {
    const s = [...line].sort((a, b) => a.x - b.x);
    const groups: Item[][] = [];
    for (const it of s) {
      const g = groups[groups.length - 1];
      const prev = g?.[g.length - 1];
      if (prev && it.x - (prev.x + prev.w) < 6) g.push(it);
      else groups.push([it]);
    }
    return groups.map((g) => ({ x: g[0].x, w: g[g.length - 1].x + g[g.length - 1].w - g[0].x, y: g[0].y, str: cellString(g) }));
  };
  const splitLines = lines.map(split);
  let h = 0;
  let bestScore = 0;
  splitLines.slice(0, 40).forEach((cells, i) => {
    const sc = headerScore(cells.map((c) => c.str));
    if (sc > bestScore) { bestScore = sc; h = i; }
  });
  const header = splitLines[h];
  const centers = header.map((c) => c.x + c.w / 2);
  const raw: string[][] = [header.map((c) => c.str)];
  for (const cells of splitLines.slice(h + 1)) {
    const row = header.map(() => "");
    for (const c of cells) {
      const mid = c.x + c.w / 2;
      let k = 0;
      centers.forEach((x, i) => { if (Math.abs(x - mid) < Math.abs(centers[k] - mid)) k = i; });
      row[k] = row[k] ? `${row[k]} ${c.str}` : c.str;
    }
    raw.push(row);
    if (raw.length >= MAX_ROWS) break;
  }
  // keep any title lines above the header out of the grid
  return [{ name: "PDF", raw }];
}
