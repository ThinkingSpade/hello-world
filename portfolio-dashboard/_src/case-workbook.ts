import type * as XlsxNamespace from "xlsx";
import { loadXlsx, xlsx } from "./xlsx-lazy";

export type CaseRecord = {
  id: string;
  week: string;
  retailer: string;
  sku: string;
  generation: "Legacy" | "New";
  description: string;
  color: "Black" | "Color";
  yieldType: string;
  yield: number;
  msrpIndex: number;
  salesUnits: number;
  inventoryUnits: number;
  ratedPages: number;
  sourceRows: number;
  inventoryValues?: number[];
  fiscalYears?: string[];
  fiscalQuarters?: string[];
  fiscalMonths?: string[];
};

export type Product = {
  sku: string;
  generation: "Legacy" | "New";
  family: string;
  description: string;
  color: "Black" | "Color";
  yieldType: string;
  yield: number;
  msrpIndex: number;
};

export type CaseData = {
  meta: {
    sourceFile: string;
    rawRows: number;
    includedRows?: number;
    excludedPartialRows?: number;
    groupedRecords: number;
    duplicateKeys: number;
    inventoryConflictKeys?: number;
    retailerCount?: number;
    skuCount?: number;
    firstWeek?: string;
    lastCompleteWeek: string;
    convention: string;
  };
  reference: Product[];
  records: CaseRecord[];
};

type RawRow = {
  fiscalYear: string;
  fiscalQuarter: string;
  fiscalMonth: string;
  week: string;
  retailer: string;
  sku: string;
  salesUnits: number;
  inventoryUnits: number;
};

type GroupedRow = RawRow & {
  sourceRows: number;
  inventoryValues: number[];
  fiscalYears: Set<string>;
  fiscalQuarters: Set<string>;
  fiscalMonths: Set<string>;
};

const RAW_HEADERS = ["Fiscal Week Ending", "Retailer", "SKU", "Sales (Units)", "Inventory (Units)"];
const REFERENCE_HEADERS = ["SKU List", "Legacy/New", "Short Description", "Black/Color", "Yield Type", "Yield", "MSRP Index"];

function normalize(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ");
}

function normalizedRow(row: Record<string, unknown>) {
  return new Map(Object.entries(row).map(([key, value]) => [normalize(key), value]));
}

function cell(row: Map<string, unknown>, header: string) {
  return row.get(normalize(header));
}

function numberValue(value: unknown, label: string, rowNumber: number, options: { positive?: boolean } = {}) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(parsed) || (options.positive && parsed <= 0)) {
    throw new Error(`${label} contains an invalid value on row ${rowNumber}.`);
  }
  return parsed;
}

function isoDate(value: unknown, rowNumber: number) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
  }
  if (typeof value === "number") {
    const parsed = xlsx().SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const text = String(value ?? "").trim();
  const direct = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (direct) return `${direct[1]}-${direct[2].padStart(2, "0")}-${direct[3].padStart(2, "0")}`;
  const parsed = new Date(text);
  if (Number.isFinite(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  throw new Error(`Fiscal Week Ending contains an invalid date on row ${rowNumber}.`);
}

function sheetByName(workbook: XlsxNamespace.WorkBook, expected: string) {
  const name = workbook.SheetNames.find((item) => normalize(item) === normalize(expected));
  return name ? workbook.Sheets[name] : null;
}

function readSheet(sheet: XlsxNamespace.WorkSheet) {
  return xlsx().utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: true,
  });
}

function assertHeaders(rows: Record<string, unknown>[], required: string[], sheetName: string) {
  if (!rows.length) throw new Error(`The ${sheetName} sheet is empty.`);
  const headers = new Set(Object.keys(rows[0]).map(normalize));
  const missing = required.filter((header) => !headers.has(normalize(header)));
  if (missing.length) throw new Error(`${sheetName} is missing: ${missing.join(", ")}.`);
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function detectPartialWeek(rows: RawRow[]) {
  const coverage = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!coverage.has(row.week)) coverage.set(row.week, new Set());
    coverage.get(row.week)!.add(`${row.retailer}|${row.sku}`);
  }
  const weeks = [...coverage.keys()].sort();
  const latest = weeks.at(-1)!;
  const comparisonWeeks = weeks.slice(Math.max(0, weeks.length - 9), -1);
  const expected = Math.max(0, ...comparisonWeeks.map((week) => coverage.get(week)!.size));
  const observed = coverage.get(latest)!.size;
  return expected > 0 && observed < expected * 0.75 ? latest : null;
}

export function parseCaseWorkbookBuffer(input: ArrayBuffer | Uint8Array, sourceFile = "Uploaded workbook.xlsx"): CaseData {
  const workbook = xlsx().read(input, { type: "array", cellDates: true });
  const rawSheet = sheetByName(workbook, "Raw Data");
  const referenceSheet = sheetByName(workbook, "Reference");
  if (!rawSheet || !referenceSheet) throw new Error('Workbook must contain sheets named "Raw Data" and "Reference".');

  const rawSource = readSheet(rawSheet);
  const referenceSource = readSheet(referenceSheet);
  assertHeaders(rawSource, RAW_HEADERS, "Raw Data");
  assertHeaders(referenceSource, REFERENCE_HEADERS, "Reference");

  const reference: Product[] = referenceSource.map((source, index) => {
    const row = normalizedRow(source);
    const generationText = normalize(cell(row, "Legacy/New"));
    const colorText = normalize(cell(row, "Black/Color"));
    if (generationText !== "legacy" && generationText !== "new") {
      throw new Error(`Legacy/New contains an invalid value on Reference row ${index + 2}.`);
    }
    if (colorText !== "black" && colorText !== "color") {
      throw new Error(`Black/Color contains an invalid value on Reference row ${index + 2}.`);
    }
    const sku = String(cell(row, "SKU List") ?? "").trim().toUpperCase();
    if (!sku) throw new Error(`SKU List is blank on Reference row ${index + 2}.`);
    return {
      sku,
      generation: generationText === "new" ? "New" : "Legacy",
      family: String(cell(row, "Selectability/SKU Family") ?? "").trim(),
      description: String(cell(row, "Short Description") ?? "").trim(),
      color: colorText === "black" ? "Black" : "Color",
      yieldType: String(cell(row, "Yield Type") ?? "").trim(),
      yield: numberValue(cell(row, "Yield"), "Yield", index + 2, { positive: true }),
      msrpIndex: numberValue(cell(row, "MSRP Index"), "MSRP Index", index + 2),
    };
  });

  const referenceBySku = new Map(reference.map((product) => [product.sku, product]));
  const rawRows: RawRow[] = rawSource.map((source, index) => {
    const row = normalizedRow(source);
    const sku = String(cell(row, "SKU") ?? "").trim().toUpperCase();
    const retailer = String(cell(row, "Retailer") ?? "").trim().toUpperCase();
    if (!sku || !retailer) throw new Error(`Retailer or SKU is blank on Raw Data row ${index + 2}.`);
    if (!referenceBySku.has(sku)) throw new Error(`SKU ${sku} on Raw Data row ${index + 2} is missing from Reference.`);
    return {
      fiscalYear: String(cell(row, "Fiscal Year") ?? "").trim(),
      fiscalQuarter: String(cell(row, "Fiscal Quarter") ?? "").trim(),
      fiscalMonth: String(cell(row, "Fiscal Month") ?? "").trim(),
      week: isoDate(cell(row, "Fiscal Week Ending"), index + 2),
      retailer,
      sku,
      salesUnits: numberValue(cell(row, "Sales (Units)"), "Sales (Units)", index + 2),
      inventoryUnits: numberValue(cell(row, "Inventory (Units)"), "Inventory (Units)", index + 2),
    };
  });

  if (!rawRows.length) throw new Error("Raw Data has no usable rows.");
  const partialWeek = detectPartialWeek(rawRows);
  const includedRows = partialWeek ? rawRows.filter((row) => row.week !== partialWeek) : rawRows;
  const grouped = new Map<string, GroupedRow>();

  for (const row of includedRows) {
    const key = `${row.week}|${row.retailer}|${row.sku}`;
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        ...row,
        sourceRows: 1,
        inventoryValues: [row.inventoryUnits],
        fiscalYears: new Set(row.fiscalYear ? [row.fiscalYear] : []),
        fiscalQuarters: new Set(row.fiscalQuarter ? [row.fiscalQuarter] : []),
        fiscalMonths: new Set(row.fiscalMonth ? [row.fiscalMonth] : []),
      });
      continue;
    }
    current.salesUnits += row.salesUnits;
    current.sourceRows += 1;
    current.inventoryValues.push(row.inventoryUnits);
    if (row.fiscalYear) current.fiscalYears.add(row.fiscalYear);
    if (row.fiscalQuarter) current.fiscalQuarters.add(row.fiscalQuarter);
    if (row.fiscalMonth) current.fiscalMonths.add(row.fiscalMonth);
  }

  const records: CaseRecord[] = [...grouped.values()]
    .map((row) => {
      const product = referenceBySku.get(row.sku)!;
      const uniqueInventory = [...new Set(row.inventoryValues)].sort((a, b) => a - b);
      const nonzeroInventory = uniqueInventory.filter((value) => value !== 0);
      const inventoryUnits = nonzeroInventory.length ? Math.max(...nonzeroInventory) : 0;
      return {
        id: `${row.week}-${slug(row.retailer)}-${slug(row.sku)}`,
        week: row.week,
        retailer: row.retailer,
        sku: row.sku,
        generation: product.generation,
        description: product.description,
        color: product.color,
        yieldType: product.yieldType,
        yield: product.yield,
        msrpIndex: product.msrpIndex,
        salesUnits: row.salesUnits,
        inventoryUnits,
        ratedPages: row.salesUnits * product.yield,
        sourceRows: row.sourceRows,
        inventoryValues: uniqueInventory,
        fiscalYears: [...row.fiscalYears].sort(),
        fiscalQuarters: [...row.fiscalQuarters].sort(),
        fiscalMonths: [...row.fiscalMonths].sort(),
      };
    })
    .sort((a, b) => b.week.localeCompare(a.week) || a.retailer.localeCompare(b.retailer) || a.sku.localeCompare(b.sku));

  const weeks = [...new Set(records.map((record) => record.week))].sort();
  return {
    meta: {
      sourceFile,
      rawRows: rawRows.length,
      includedRows: includedRows.length,
      excludedPartialRows: rawRows.length - includedRows.length,
      groupedRecords: records.length,
      duplicateKeys: records.filter((record) => record.sourceRows > 1).length,
      inventoryConflictKeys: records.filter((record) => (record.inventoryValues?.length ?? 0) > 1).length,
      retailerCount: new Set(records.map((record) => record.retailer)).size,
      skuCount: reference.length,
      firstWeek: weeks[0],
      lastCompleteWeek: weeks.at(-1)!,
      convention: "Sales are summed within retailer-SKU-week duplicates; inventory remains a non-additive snapshot and uses the largest nonzero observation for display.",
    },
    reference,
    records,
  };
}

export async function parseCaseWorkbook(file: File) {
  const buffer = await file.arrayBuffer();
  await loadXlsx();
  return parseCaseWorkbookBuffer(buffer, file.name);
}
