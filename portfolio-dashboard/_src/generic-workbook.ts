import type * as XlsxNamespace from "xlsx";
import { xlsx } from "./xlsx-lazy";

export type GenericCell = string | number | boolean | null;
export type GenericColumnKind = "number" | "date" | "category" | "text" | "boolean";
export type GenericNumberFormat = "number" | "currency" | "percent";

export type GenericColumn = {
  key: string;
  label: string;
  kind: GenericColumnKind;
  nonEmpty: number;
  completeness: number;
  uniqueCount: number;
  isMeasure: boolean;
  numberFormat?: GenericNumberFormat;
  percentScale?: 1 | 100;
  sum?: number;
  average?: number;
  min?: number;
  max?: number;
};

export type GenericSheet = {
  name: string;
  headerRow: number;
  rowCount: number;
  columnCount: number;
  columns: GenericColumn[];
  rows: Record<string, GenericCell>[];
};

export type GenericWorkbookData = {
  meta: {
    sourceFile: string;
    sheetCount: number;
    tableCount: number;
    totalRows: number;
    truncated: boolean;
  };
  sheets: GenericSheet[];
};

const MAX_SHEETS = 20;
const MAX_ROWS_PER_SHEET = 100_000;
const DATE_HEADER = /(^|\b)(date|day|week|month|quarter|year|period|time|timestamp)(\b|$)/i;
const CATEGORY_HEADER = /(^|\b)(category|type|segment|region|state|country|city|department|team|status|channel|product|customer|vendor|retailer|group)(\b|$)/i;
const IDENTIFIER_HEADER = /(^|\b)(id|identifier|code|sku|zip|postal|phone|account|invoice|order|serial)(\b|$)/i;
const CURRENCY_HEADER = /(^|\b)(revenue|sales|amount|price|cost|expense|profit|income|budget|spend|value|dollars?)(\b|$)/i;
const PERCENT_HEADER = /(^|\b)(percent|percentage|rate|ratio|share|margin|growth|change|yoy|conversion)(\b|$)|%/i;

function isBlank(value: unknown) {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

function cleanLabel(value: unknown, index: number) {
  const label = String(value ?? "").trim().replace(/\s+/g, " ");
  return label || `Column ${index + 1}`;
}

function uniqueLabels(values: unknown[], width: number) {
  const counts = new Map<string, number>();
  return Array.from({ length: width }, (_, index) => {
    const base = cleanLabel(values[index], index);
    const normalized = base.toLowerCase();
    const next = (counts.get(normalized) ?? 0) + 1;
    counts.set(normalized, next);
    return next === 1 ? base : `${base} ${next}`;
  });
}

function headerScore(row: unknown[], rowIndex: number, matrix: unknown[][]) {
  const cells = row.filter((value) => !isBlank(value));
  if (cells.length < 2) return Number.NEGATIVE_INFINITY;
  const strings = cells.filter((value) => typeof value === "string").length;
  const unique = new Set(cells.map((value) => String(value).trim().toLowerCase())).size;
  const following = matrix.slice(rowIndex + 1, rowIndex + 7);
  const populatedFollowing = following.filter((candidate) => candidate.filter((value) => !isBlank(value)).length >= Math.min(2, cells.length)).length;
  const headerWords = cells.filter((value) => /date|name|category|type|amount|sales|revenue|units|value|status|region|product|customer|id/i.test(String(value))).length;
  return cells.length * 1.8 + strings * 2.4 + unique + populatedFollowing * 1.5 + headerWords * 1.8 - rowIndex * 0.2;
}

function detectHeader(matrix: unknown[][]) {
  const candidates = matrix.slice(0, Math.min(matrix.length, 25));
  let bestIndex = -1;
  let bestScore = Number.NEGATIVE_INFINITY;
  candidates.forEach((row, index) => {
    const score = headerScore(row, index, matrix);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  if (bestIndex < 0) return -1;
  const populated = matrix[bestIndex].filter((value) => !isBlank(value));
  const stringRatio = populated.length ? populated.filter((value) => typeof value === "string").length / populated.length : 0;
  return stringRatio >= 0.5 ? bestIndex : -1;
}

function parseLooseNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || /^0\d+/.test(raw.replace(/[^0-9.-]/g, ""))) return null;
  const negative = /^\(.*\)$/.test(raw);
  const percent = raw.includes("%");
  const cleaned = raw.replace(/[,$£€¥%()\s]/g, "");
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  const signed = negative ? -Math.abs(parsed) : parsed;
  return percent ? signed / 100 : signed;
}

function isoDate(value: unknown) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\D|$)/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\D|$)/);
  if (us) {
    const year = us[3].length === 2 ? Number(us[3]) + (Number(us[3]) >= 70 ? 1900 : 2000) : Number(us[3]);
    const date = new Date(Date.UTC(year, Number(us[1]) - 1, Number(us[2])));
    return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
  }
  const parsed = new Date(text);
  return /[A-Za-z]{3,}/.test(text) && Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
}

function cleanCell(value: unknown): GenericCell {
  if (isBlank(value)) return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  const text = String(value).trim();
  return text || null;
}

function profileColumn(label: string, key: string, rawValues: GenericCell[], rowCount: number): GenericColumn {
  const values = rawValues.filter((value) => !isBlank(value));
  const numberValues = values.map(parseLooseNumber).filter((value): value is number => value !== null);
  const dateValues = values.map(isoDate).filter((value): value is string => value !== null);
  const booleanValues = values.filter((value) => typeof value === "boolean" || /^(true|false|yes|no)$/i.test(String(value)));
  const uniqueCount = new Set(values.map((value) => String(value).trim().toLowerCase())).size;
  const ratio = (count: number) => values.length ? count / values.length : 0;

  let kind: GenericColumnKind;
  if (ratio(dateValues.length) >= 0.8 && (DATE_HEADER.test(label) || values.some((value) => (value as unknown) instanceof Date || /^\d{4}-\d{2}-\d{2}/.test(String(value))))) {
    kind = "date";
  } else if (ratio(numberValues.length) >= 0.8) {
    kind = "number";
  } else if (ratio(booleanValues.length) >= 0.8) {
    kind = "boolean";
  } else if (uniqueCount > 0 && (uniqueCount <= Math.min(50, Math.max(8, Math.round(values.length * 0.35))) || (CATEGORY_HEADER.test(label) && uniqueCount <= 200))) {
    kind = "category";
  } else {
    kind = "text";
  }

  const isIdentifier = IDENTIFIER_HEADER.test(label) && uniqueCount >= Math.max(2, values.length * 0.75);
  const numberFormat: GenericNumberFormat | undefined = kind !== "number"
    ? undefined
    : PERCENT_HEADER.test(label) || values.some((value) => typeof value === "string" && value.includes("%"))
      ? "percent"
      : CURRENCY_HEADER.test(label) || values.some((value) => typeof value === "string" && /[$£€¥]/.test(value))
        ? "currency"
        : "number";
  const percentScale = numberFormat === "percent" && numberValues.some((value) => Math.abs(value) > 1.5) ? 100 : 1;
  const sum = numberValues.reduce((total, value) => total + value, 0);

  return {
    key,
    label,
    kind,
    nonEmpty: values.length,
    completeness: rowCount ? values.length / rowCount : 0,
    uniqueCount,
    isMeasure: kind === "number" && !isIdentifier,
    numberFormat,
    ...(numberFormat === "percent" ? { percentScale: percentScale as 1 | 100 } : {}),
    ...(kind === "number" && numberValues.length ? {
      sum,
      average: sum / numberValues.length,
      min: Math.min(...numberValues),
      max: Math.max(...numberValues),
    } : {}),
  };
}

function parseSheet(name: string, sheet: XlsxNamespace.WorkSheet) {
  const matrix = xlsx().utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true, blankrows: false });
  if (!matrix.length) return null;
  const headerIndex = detectHeader(matrix);
  const sourceRows = matrix.slice(headerIndex >= 0 ? headerIndex + 1 : 0).filter((row) => row.some((value) => !isBlank(value)));
  if (!sourceRows.length) return null;
  const width = Math.max(headerIndex >= 0 ? matrix[headerIndex].length : 0, ...sourceRows.slice(0, 500).map((row) => row.length));
  if (width < 2) return null;

  const labels = uniqueLabels(headerIndex >= 0 ? matrix[headerIndex] : [], width);
  const keys = labels.map((_, index) => `c${index}`);
  const limitedRows = sourceRows.slice(0, MAX_ROWS_PER_SHEET);
  const rawRows = limitedRows.map((row) => Object.fromEntries(keys.map((key, index) => [key, cleanCell(row[index])])) as Record<string, GenericCell>);
  const columns = labels.map((label, index) => profileColumn(label, keys[index], rawRows.map((row) => row[keys[index]]), rawRows.length));
  const rows = rawRows.map((row) => {
    const next: Record<string, GenericCell> = {};
    columns.forEach((column) => {
      const value = row[column.key];
      next[column.key] = column.kind === "number" ? parseLooseNumber(value) : column.kind === "date" ? isoDate(value) : value;
    });
    return next;
  });
  return { name, headerRow: headerIndex >= 0 ? headerIndex + 1 : 0, rowCount: rows.length, columnCount: columns.length, columns, rows, truncated: sourceRows.length > MAX_ROWS_PER_SHEET };
}

export function parseGenericWorkbookBuffer(input: ArrayBuffer | Uint8Array, sourceFile = "Uploaded workbook.xlsx"): GenericWorkbookData {
  const workbook = xlsx().read(input, { type: "array", cellDates: true });
  const parsed = workbook.SheetNames.slice(0, MAX_SHEETS)
    .map((name) => parseSheet(name, workbook.Sheets[name]))
    .filter((sheet): sheet is NonNullable<ReturnType<typeof parseSheet>> => Boolean(sheet));
  if (!parsed.length) throw new Error("No tabular data was found. Use a workbook with column headers and data rows.");

  const sorted = parsed.sort((a, b) => {
    const score = (sheet: typeof a) => sheet.rowCount * Math.min(sheet.columnCount, 20) + sheet.columns.filter((column) => column.isMeasure).length * 100 + sheet.columns.filter((column) => column.kind === "date").length * 80;
    return score(b) - score(a);
  });
  const sheets: GenericSheet[] = sorted.map((sheet) => ({ name: sheet.name, headerRow: sheet.headerRow, rowCount: sheet.rowCount, columnCount: sheet.columnCount, columns: sheet.columns, rows: sheet.rows }));
  return {
    meta: {
      sourceFile,
      sheetCount: workbook.SheetNames.length,
      tableCount: sheets.length,
      totalRows: sheets.reduce((sum, sheet) => sum + sheet.rowCount, 0),
      truncated: workbook.SheetNames.length > MAX_SHEETS || parsed.some((sheet) => sheet.truncated),
    },
    sheets,
  };
}
