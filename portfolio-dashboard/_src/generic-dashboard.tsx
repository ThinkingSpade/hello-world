"use client";

import { useState, type ReactNode } from "react";
import { MdCalendarMonth, MdDataObject, MdGridView, MdNumbers, MdOutlineBarChart, MdOutlineDataset, MdUploadFile } from "react-icons/md";
import type { GenericColumn, GenericNumberFormat, GenericSheet, GenericWorkbookData } from "./generic-workbook";
import { SankeyChart, type SankeyLink } from "./sankey-chart";
import { InfoTip } from "./info-tip";

const COLORS = ["#024ad8", "#447180", "#7f56d9", "#039855", "#f79009", "#ff5050"];

function formatValue(value: number, format: GenericNumberFormat = "number", percentScale: 1 | 100 = 1) {
  if (!Number.isFinite(value)) return "—";
  if (format === "currency") return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: Math.abs(value) >= 1_000_000 ? "compact" : "standard", maximumFractionDigits: Math.abs(value) >= 1000 ? 1 : 2 }).format(value);
  if (format === "percent") return new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format(value / percentScale);
  return new Intl.NumberFormat("en-US", { notation: Math.abs(value) >= 1_000_000 ? "compact" : "standard", maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2 }).format(value);
}

function shortDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "2-digit", timeZone: "UTC" }).format(date) : value;
}

function titleFromFile(value: string) {
  return value.replace(/\.(xlsx|xls)$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

const measureColumns = (sheet: GenericSheet) => sheet.columns.filter((column) => column.isMeasure);
const dimensionColumns = (sheet: GenericSheet) => sheet.columns.filter((column) => column.kind === "category" || column.kind === "boolean");
const dateColumns = (sheet: GenericSheet) => sheet.columns.filter((column) => column.kind === "date");

function valueOf(row: Record<string, unknown>, column: GenericColumn) {
  const value = row[column.key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function aggregateCategories(sheet: GenericSheet, dimension: GenericColumn, measure: GenericColumn | null) {
  const groups = new Map<string, { value: number; rows: number }>();
  for (const row of sheet.rows) {
    const category = String(row[dimension.key] ?? "Unspecified").trim() || "Unspecified";
    const current = groups.get(category) ?? { value: 0, rows: 0 };
    current.value += measure ? valueOf(row, measure) : 1;
    current.rows += 1;
    groups.set(category, current);
  }
  return [...groups.entries()].map(([label, item]) => ({ label, value: measure ? item.value : item.rows })).sort((a, b) => b.value - a.value).slice(0, 8);
}

function aggregateTime(sheet: GenericSheet, date: GenericColumn, measure: GenericColumn | null) {
  const groups = new Map<string, number>();
  for (const row of sheet.rows) {
    const key = String(row[date.key] ?? "").slice(0, 10);
    if (!key) continue;
    groups.set(key, (groups.get(key) ?? 0) + (measure ? valueOf(row, measure) : 1));
  }
  const points = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, value }));
  if (points.length <= 24) return points;
  const bucketSize = Math.ceil(points.length / 24);
  return Array.from({ length: Math.ceil(points.length / bucketSize) }, (_, index) => {
    const bucket = points.slice(index * bucketSize, (index + 1) * bucketSize);
    return { label: bucket[0].label, value: bucket.reduce((sum, point) => sum + point.value, 0) };
  });
}

function aggregateFlow(sheet: GenericSheet, source: GenericColumn, target: GenericColumn, measure: GenericColumn | null): SankeyLink[] {
  const raw = new Map<string, { source: string; target: string; value: number }>();
  for (const row of sheet.rows) {
    const sourceValue = String(row[source.key] ?? "").trim();
    const targetValue = String(row[target.key] ?? "").trim();
    if (!sourceValue || !targetValue) continue;
    const value = measure ? valueOf(row, measure) : 1;
    if (!Number.isFinite(value) || value <= 0) continue;
    const key = `${sourceValue}\u0000${targetValue}`;
    const current = raw.get(key) ?? { source: sourceValue, target: targetValue, value: 0 };
    current.value += value;
    raw.set(key, current);
  }
  const items = [...raw.values()];
  const sourceTotals = new Map<string, number>();
  const targetTotals = new Map<string, number>();
  items.forEach((item) => {
    sourceTotals.set(item.source, (sourceTotals.get(item.source) ?? 0) + item.value);
    targetTotals.set(item.target, (targetTotals.get(item.target) ?? 0) + item.value);
  });
  const topSources = new Set([...sourceTotals].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label]) => label));
  const topTargets = new Set([...targetTotals].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label]) => label));
  const grouped = new Map<string, SankeyLink>();
  items.forEach((item) => {
    const sourceLabel = topSources.has(item.source) ? item.source : "Other";
    const targetLabel = topTargets.has(item.target) ? item.target : "Other";
    const key = `${sourceLabel}\u0000${targetLabel}`;
    const current = grouped.get(key) ?? { source: sourceLabel, target: targetLabel, value: 0 };
    current.value += item.value;
    grouped.set(key, current);
  });
  return [...grouped.values()].sort((a, b) => b.value - a.value);
}

function GenericKpi({ icon, label, value, meta, info }: { icon: ReactNode; label: string; value: string; meta: string; info: string }) {
  return <div className="generic-kpi"><span>{icon}</span><div><div className="metric-label"><small>{label}</small><InfoTip text={info} label={`About ${label}`} /></div><strong>{value}</strong><p>{meta}</p></div></div>;
}

function GenericCardHeader({ title, meta, info, icon }: { title: string; meta: string; info: string; icon?: ReactNode }) {
  return <header><div><div className="card-title-line"><h2>{title}</h2><InfoTip text={info} label={`About ${title}`} /></div><p>{meta}</p></div>{icon}</header>;
}

function GenericBars({ rows, format, percentScale = 1 }: { rows: { label: string; value: number }[]; format: GenericNumberFormat; percentScale?: 1 | 100 }) {
  const max = Math.max(0, ...rows.map((row) => Math.abs(row.value))) || 1;
  return <div className="generic-bars">{rows.map((row, index) => <div key={row.label}><span title={row.label}>{row.label}</span><i><b style={{ width: `${Math.max(1.5, (Math.abs(row.value) / max) * 100)}%`, background: COLORS[index % COLORS.length] }} /></i><strong>{formatValue(row.value, format, percentScale)}</strong></div>)}</div>;
}

function GenericTrend({ points, format, percentScale = 1 }: { points: { label: string; value: number }[]; format: GenericNumberFormat; percentScale?: 1 | 100 }) {
  if (points.length < 2) return <div className="generic-empty-chart">Add more dated rows to show a trend.</div>;
  const width = 760;
  const height = 260;
  const min = Math.min(...points.map((point) => point.value));
  const max = Math.max(...points.map((point) => point.value));
  const range = max - min || 1;
  const coords = points.map((point, index) => ({ ...point, x: 36 + (index / Math.max(1, points.length - 1)) * (width - 62), y: 24 + ((max - point.value) / range) * (height - 68) }));
  const path = coords.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  return (
    <div className="generic-trend"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Workbook trend chart">
      {[0, 1, 2, 3].map((line) => <line key={line} x1="36" x2={width - 26} y1={24 + line * 55} y2={24 + line * 55} />)}
      <path d={`${path} L${coords.at(-1)!.x} ${height - 42} L${coords[0].x} ${height - 42} Z`} className="generic-area" /><path d={path} className="generic-line" />
      {coords.map((point, index) => <circle key={`${point.label}-${index}`} cx={point.x} cy={point.y} r="4"><title>{`${shortDate(point.label)}: ${formatValue(point.value, format, percentScale)}`}</title></circle>)}
      {coords.filter((_, index) => index === 0 || index === coords.length - 1 || index % Math.max(1, Math.ceil(coords.length / 5)) === 0).map((point) => <text key={point.x} x={point.x} y={height - 18} textAnchor="middle">{shortDate(point.label)}</text>)}
    </svg></div>
  );
}

function DataPreview({ sheet }: { sheet: GenericSheet }) {
  const columns = sheet.columns.slice(0, 7);
  return <div className="generic-table-wrap"><table className="generic-table"><thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{sheet.rows.slice(0, 8).map((row, index) => <tr key={index}>{columns.map((column) => <td key={column.key}>{row[column.key] === null ? "—" : String(row[column.key])}</td>)}</tr>)}</tbody></table></div>;
}

export function GenericDashboard({ data, brand, onReplace }: { data: GenericWorkbookData; brand: ReactNode; onReplace: () => void }) {
  const [sheetName, setSheetName] = useState(data.sheets[0].name);
  const sheet = data.sheets.find((item) => item.name === sheetName) ?? data.sheets[0];
  const measures = measureColumns(sheet);
  const dimensions = dimensionColumns(sheet);
  const dates = dateColumns(sheet);
  const [measureKey, setMeasureKey] = useState(measures[0]?.key ?? "__rows");
  const [dimensionKey, setDimensionKey] = useState(dimensions[0]?.key ?? "");
  const [dateKey, setDateKey] = useState(dates[0]?.key ?? "");
  const selectedMeasure = measures.find((column) => column.key === measureKey) ?? null;
  const selectedDimension = dimensions.find((column) => column.key === dimensionKey) ?? null;
  const selectedDate = dates.find((column) => column.key === dateKey) ?? null;
  const flowSource = dimensions.find((column) => /(^|\b)(source|from|origin|previous stage|stage from)(\b|$)/i.test(column.label)) ?? null;
  const flowTarget = dimensions.find((column) => /(^|\b)(target|to|destination|next stage|stage to)(\b|$)/i.test(column.label)) ?? null;
  const explicitFlowMeasure = measures.find((column) => /(^|\b)(flow|count|volume|weight|value|units|amount)(\b|$)/i.test(column.label)) ?? null;
  const flowMeasure = explicitFlowMeasure?.numberFormat === "percent" ? null : explicitFlowMeasure;
  const categoryRows = selectedDimension ? aggregateCategories(sheet, selectedDimension, selectedMeasure) : [];
  const trendRows = selectedDate ? aggregateTime(sheet, selectedDate, selectedMeasure) : [];
  const flowRows = flowSource && flowTarget && flowSource.key !== flowTarget.key ? aggregateFlow(sheet, flowSource, flowTarget, flowMeasure) : [];
  const primaryValue = selectedMeasure?.sum ?? sheet.rowCount;
  const format = selectedMeasure?.numberFormat ?? "number";
  const percentScale = selectedMeasure?.percentScale ?? 1;

  const selectSheet = (nextName: string) => {
    const next = data.sheets.find((item) => item.name === nextName) ?? data.sheets[0];
    setSheetName(next.name);
    setMeasureKey(measureColumns(next)[0]?.key ?? "__rows");
    setDimensionKey(dimensionColumns(next)[0]?.key ?? "");
    setDateKey(dateColumns(next)[0]?.key ?? "");
  };

  return (
    <div className="generic-shell">
      <header className="generic-topbar">{brand}<div><small>WORKBOOK DASHBOARD</small><strong>{titleFromFile(data.meta.sourceFile)}</strong></div><button type="button" onClick={onReplace}><MdUploadFile />Replace data</button></header>
      <main className="generic-main">
        <section className="generic-heading"><div><p>AUTOMATIC ANALYSIS</p><h1>{sheet.name}</h1></div><div className="generic-controls">
          <label><span>Sheet</span><select value={sheet.name} onChange={(event) => selectSheet(event.target.value)}>{data.sheets.map((item) => <option key={item.name}>{item.name}</option>)}</select></label>
          <label><span>Measure</span><select value={measureKey} onChange={(event) => setMeasureKey(event.target.value)}><option value="__rows">Row count</option>{measures.map((column) => <option value={column.key} key={column.key}>{column.label}</option>)}</select></label>
          {dimensions.length ? <label><span>Group by</span><select value={dimensionKey} onChange={(event) => setDimensionKey(event.target.value)}>{dimensions.map((column) => <option value={column.key} key={column.key}>{column.label}</option>)}</select></label> : null}
          {dates.length ? <label><span>Date</span><select value={dateKey} onChange={(event) => setDateKey(event.target.value)}>{dates.map((column) => <option value={column.key} key={column.key}>{column.label}</option>)}</select></label> : null}
        </div></section>
        <section className="generic-kpis">
          <GenericKpi icon={<MdOutlineDataset />} label={selectedMeasure ? `Total ${selectedMeasure.label}` : "Rows"} value={formatValue(primaryValue, format, percentScale)} meta={`${sheet.rowCount.toLocaleString()} analyzed rows`} info={selectedMeasure ? `Sum of all populated values detected in ${selectedMeasure.label}.` : "Number of data rows detected in the selected sheet."} />
          <GenericKpi icon={<MdNumbers />} label={selectedMeasure ? "Average" : "Numeric measures"} value={selectedMeasure ? formatValue(selectedMeasure.average ?? 0, format, percentScale) : String(measures.length)} meta={selectedMeasure ? `${selectedMeasure.nonEmpty.toLocaleString()} populated values` : `${sheet.columnCount} total columns`} info={selectedMeasure ? `Arithmetic mean across populated ${selectedMeasure.label} values.` : "Count of columns detected as usable numeric measures rather than identifiers."} />
          <GenericKpi icon={<MdDataObject />} label="Data completeness" value={`${Math.round((sheet.columns.reduce((sum, column) => sum + column.completeness, 0) / Math.max(1, sheet.columnCount)) * 100)}%`} meta="Across detected columns" info="Average share of nonblank cells across every detected column in the selected table." />
          <GenericKpi icon={<MdGridView />} label="Workbook coverage" value={`${data.meta.tableCount} table${data.meta.tableCount === 1 ? "" : "s"}`} meta={`${data.meta.sheetCount} workbook sheet${data.meta.sheetCount === 1 ? "" : "s"}`} info="Number of workbook sheets containing a usable tabular region with headers and data rows." />
        </section>
        <section className="generic-grid">
          <article className="generic-card generic-trend-card"><GenericCardHeader title={selectedDate ? `${selectedMeasure?.label ?? "Rows"} over time` : "Data profile"} meta={selectedDate ? `Grouped by ${selectedDate.label}` : "No date column detected"} info={selectedDate ? `Values are summed for each detected ${selectedDate.label} period.` : "Bars show the share of populated cells in each detected column."} icon={<MdCalendarMonth />} />{selectedDate ? <GenericTrend points={trendRows} format={format} percentScale={percentScale} /> : <div className="generic-profile-list">{sheet.columns.slice(0, 8).map((column) => <div key={column.key}><span>{column.label}</span><i><b style={{ width: `${column.completeness * 100}%` }} /></i><strong>{Math.round(column.completeness * 100)}%</strong></div>)}</div>}</article>
          <article className="generic-card generic-category-card"><GenericCardHeader title={selectedDimension ? `By ${selectedDimension.label}` : "Column overview"} meta={selectedDimension ? `Top ${Math.min(8, categoryRows.length)} categories` : "Detected workbook structure"} info={selectedDimension ? `${selectedMeasure ? selectedMeasure.label : "Rows"} grouped by ${selectedDimension.label}; the largest eight groups are shown.` : "Counts of numeric, date, and categorical columns detected in the table."} icon={<MdOutlineBarChart />} />{selectedDimension ? <GenericBars rows={categoryRows} format={format} percentScale={percentScale} /> : <div className="generic-column-summary"><strong>{measures.length}</strong><span>numeric measures</span><strong>{dates.length}</strong><span>date columns</span><strong>{dimensions.length}</strong><span>categorical dimensions</span></div>}</article>
          {flowRows.length ? <article className="generic-card generic-flow-card"><GenericCardHeader title="Relationship flow" meta={`${flowSource!.label} → ${flowTarget!.label} · ${flowMeasure?.label ?? "row count"}`} info="Shown only when the workbook explicitly identifies source and destination fields. Ribbon width equals the detected flow value, or row count when no value field exists." /><SankeyChart links={flowRows} valueFormatter={(value) => formatValue(value, flowMeasure?.numberFormat ?? "number", flowMeasure?.percentScale ?? 1)} ariaLabel={`${flowSource!.label} to ${flowTarget!.label} flow`} /></article> : null}
          <article className="generic-card generic-preview-card"><header><div><h2>Data preview</h2><p>First 8 rows · {sheet.columnCount} columns detected</p></div><MdGridView /></header><DataPreview sheet={sheet} /></article>
        </section>
        <footer className="generic-footer"><span>{data.meta.sourceFile}</span><span>{data.meta.totalRows.toLocaleString()} rows analyzed</span><span>{data.meta.truncated ? "Large workbook sampled" : "Processed in your browser"}</span></footer>
      </main>
    </div>
  );
}
