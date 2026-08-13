"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  MdCheck,
  MdClose,
  MdCloudUpload,
  MdInventory2,
  MdKeyboardArrowDown,
  MdOutlineCompareArrows,
  MdOutlineTrendingDown,
  MdRefresh,
  MdSwapHoriz,
  MdTableChart,
  MdUploadFile,
} from "react-icons/md";
import { parseCaseWorkbookBuffer, type CaseData, type CaseRecord } from "./case-workbook";
import { GenericDashboard } from "./generic-dashboard";
import { parseGenericWorkbookBuffer, type GenericWorkbookData } from "./generic-workbook";
import { InfoTip, type InfoTipProps } from "./info-tip";
import { loadXlsx } from "./xlsx-lazy";

const BUNDLED_WORKBOOK_NAME = "Business Case_Product Porfolio Simplification_Data.xlsx";

type Metric = "pages" | "units" | "mix";
type ColorFilter = "All" | "Black" | "Color";

type Filters = {
  retailer: string;
  color: ColorFilter;
};

type Totals = {
  units: number;
  pages: number;
  newUnits: number;
  legacyInventory: number;
};

type TrendPoint = {
  week: string;
  label: string;
  value: number;
  current: number;
  prior: number;
  newUnits: number;
  units: number;
};

type RetailerMetric = {
  retailer: string;
  value: number;
};

type WosRow = {
  retailer: string;
  black: number | null;
  color: number | null;
};

type Detail =
  | { kind: "week"; week: string }
  | { kind: "retailer"; retailer: string }
  | { kind: "inventory"; retailer: string };

type ImportStatus = {
  state: "idle" | "reading" | "success" | "error";
  message: string;
};

export function PortfolioMark() {
  return (
    <span className="portfolio-mark" aria-hidden="true">
      <svg viewBox="0 0 44 44" fill="none">
        <defs><linearGradient id="portfolio-cube-top" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fff" /><stop offset="1" stopColor="#cfe5ff" /></linearGradient><linearGradient id="portfolio-cube-side" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#d8eaff" /><stop offset="1" stopColor="#8dbcf6" /></linearGradient></defs>
        <path d="M8.2 11.1 13 8.4l4.8 2.7-4.8 2.8-4.8-2.8Z" fill="url(#portfolio-cube-top)" /><path d="M8.2 11.1v5.5l4.8 2.8v-5.5l-4.8-2.8Z" fill="#b9d7fb" /><path d="M17.8 11.1v5.5L13 19.4v-5.5l4.8-2.8Z" fill="url(#portfolio-cube-side)" />
        <path d="M17.2 8.3 22 5.5l4.8 2.8L22 11l-4.8-2.7Z" fill="url(#portfolio-cube-top)" /><path d="M17.2 8.3v5.5l4.8 2.8V11l-4.8-2.7Z" fill="#b9d7fb" /><path d="M26.8 8.3v5.5L22 16.6V11l4.8-2.7Z" fill="url(#portfolio-cube-side)" />
        <path d="m26.2 11.1 4.8-2.7 4.8 2.7-4.8 2.8-4.8-2.8Z" fill="url(#portfolio-cube-top)" /><path d="M26.2 11.1v5.5l4.8 2.8v-5.5l-4.8-2.8Z" fill="#b9d7fb" /><path d="M35.8 11.1v5.5L31 19.4v-5.5l4.8-2.8Z" fill="url(#portfolio-cube-side)" />
        <path d="M13 22.2v2.1c0 2.6 2.1 4.7 4.7 4.7h8.6c2.6 0 4.7-2.1 4.7-4.7v-2.1M22 20.1V29" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" opacity=".9" />
        <path d="m13.1 33.2 5.4-3.1 5.4 3.1-5.4 3.1-5.4-3.1Z" fill="#fff" /><path d="M13.1 33.2v4.2l5.4 3.1v-4.2l-5.4-3.1Z" fill="#b9d7fb" /><path d="M23.9 33.2v4.2l-5.4 3.1v-4.2l5.4-3.1Z" fill="#79acec" />
        <path d="m20.1 33.2 5.4-3.1 5.4 3.1-5.4 3.1-5.4-3.1Z" fill="#fff" /><path d="M20.1 33.2v4.2l5.4 3.1v-4.2l-5.4-3.1Z" fill="#b9d7fb" /><path d="M30.9 33.2v4.2l-5.4 3.1v-4.2l5.4-3.1Z" fill="#79acec" />
      </svg>
    </span>
  );
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function analysisDates(data: CaseData) {
  const end = data.meta.lastCompleteWeek;
  return {
    end,
    start: addDays(end, -98),
    latestFourStart: addDays(end, -21),
    legacyBase: addDays(end, -105),
  };
}

function firstNewInventoryWeek(records: CaseRecord[], retailer: string) {
  return records
    .filter((record) => record.retailer === retailer && record.generation === "New" && record.inventoryUnits > 0)
    .map((record) => record.week)
    .sort()[0] ?? null;
}

function titleCase(value: string) {
  const knownNames: Record<string, string> = {
    "HOUSE OF INK": "House of Ink",
    "INK IN A WINK": "Ink in a Wink",
    "INK-O-MATIC": "Ink-O-Matic",
    "JENNY'S PRINT SHOP": "Jenny’s Print Shop",
    "THE PRINT GUYS": "The Print Guys",
  };
  if (knownNames[value]) return knownNames[value];
  return value
    .toLowerCase()
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
    .replace("Jenny's", "Jenny’s");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00Z`),
  );
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatPercent(value: number, digits = 1) {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(digits)}%`;
}

function metricValue(current: number, prior: number) {
  return prior ? (current / prior - 1) * 100 : 0;
}

function matches(record: CaseRecord, filters: Filters) {
  return (
    (filters.retailer === "All retailers" || record.retailer === filters.retailer) &&
    (filters.color === "All" || record.color === filters.color)
  );
}

function sumRange(
  records: CaseRecord[],
  start: string,
  end: string,
  filters: Filters,
  options: { generation?: "Legacy" | "New"; sku?: string } = {},
): Totals {
  return records.reduce<Totals>(
    (total, record) => {
      if (record.week < start || record.week > end || !matches(record, filters)) return total;
      if (options.generation && record.generation !== options.generation) return total;
      if (options.sku && record.sku !== options.sku) return total;
      total.units += record.salesUnits;
      total.pages += record.ratedPages;
      total.newUnits += record.generation === "New" ? record.salesUnits : 0;
      total.legacyInventory += record.generation === "Legacy" ? record.inventoryUnits : 0;
      return total;
    },
    { units: 0, pages: 0, newUnits: 0, legacyInventory: 0 },
  );
}

function matchedPerformance(
  records: CaseRecord[],
  start: string,
  end: string,
  filters: Filters,
) {
  const current = sumRange(records, start, end, filters);
  const prior = sumRange(records, addDays(start, -364), addDays(end, -364), filters);
  return {
    current,
    prior,
    pages: metricValue(current.pages, prior.pages),
    units: metricValue(current.units, prior.units),
  };
}

function alignedPerformance(records: CaseRecord[], retailer: string, color: ColorFilter) {
  const launch = firstNewInventoryWeek(records, retailer);
  if (!launch) return { pre: Number.NaN, post: Number.NaN, launch: null };
  const filters: Filters = { retailer, color };
  const pre = matchedPerformance(records, addDays(launch, -70), addDays(launch, -7), filters);
  const post = matchedPerformance(records, launch, addDays(launch, 63), filters);
  return { pre: pre.pages, post: post.pages, launch };
}

function FilterMenu<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value)?.label ?? value;

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, []);

  return (
    <div className={`filter-menu ${open ? "open" : ""}`} ref={root}>
      <button
        type="button"
        className="filter-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span><small>{label}</small><strong>{selected}</strong></span>
        <MdKeyboardArrowDown aria-hidden="true" />
      </button>
      {open ? (
        <div className="filter-popover" role="listbox" aria-label={label}>
          {options.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={option.value === value ? "selected" : ""}
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {option.value === value ? <MdCheck aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  // Surface structure adapted from Horizon UI's MIT-licensed Card component.
  return <section className={`card ${className}`}>{children}</section>;
}

function KpiCard({
  icon,
  label,
  value,
  meta,
  info,
  tone = "blue",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  meta: string;
  info: string;
  tone?: "blue" | "coral" | "slate" | "black";
}) {
  return (
    <Card className={`kpi-card kpi-${tone}`}>
      <div className="kpi-icon" aria-hidden="true">{icon}</div>
      <div className="kpi-copy">
        <div className="metric-label"><p>{label}</p><InfoTip text={info} label={`About ${label}`} /></div>
        <strong>{value}</strong>
        <small>{meta}</small>
      </div>
    </Card>
  );
}

function CardHeader({ title, meta, info, action }: { title: string; meta?: string; info?: string; action?: ReactNode }) {
  return (
    <div className="card-header">
      <div>
        <div className="card-title-line"><h2>{title}</h2>{info ? <InfoTip text={info} label={`About ${title}`} /> : null}</div>
        {meta ? <p>{meta}</p> : null}
      </div>
      {action ? <div className="card-action">{action}</div> : null}
    </div>
  );
}

function PortfolioMapping({ products }: { products: CaseData["reference"] }) {
  const lanes = (["Black", "Color"] as const).map((color) => ({
    color,
    legacy: products.filter((product) => product.generation === "Legacy" && product.color === color),
    replacement: products.find((product) => product.generation === "New" && product.color === color),
  })).filter((lane) => lane.replacement && lane.legacy.length);
  return (
    <div className="sku-map">
      <div className="sku-map-head"><span>Legacy portfolio</span><span /><span>Replacement portfolio</span></div>
      {lanes.map((lane) => (
        <div className={`sku-map-row ${lane.color.toLowerCase()}`} key={lane.color}>
          <div className="sku-map-sources">
            {lane.legacy.map((product) => (
              <div className="sku-map-node legacy" key={product.sku}>
                <i aria-hidden="true" />
                <span><strong>{product.description}</strong><small>{product.yieldType} · {formatNumber(product.yield)} pages</small></span>
              </div>
            ))}
          </div>
          <div className="sku-map-connector" aria-hidden="true"><span>2 → 1</span><i /></div>
          <div className="sku-map-node replacement">
            <i aria-hidden="true" />
            <span><strong>{lane.replacement!.description}</strong><small>{lane.replacement!.yieldType} · {formatNumber(lane.replacement!.yield)} pages</small></span>
          </div>
        </div>
      ))}
    </div>
  );
}

function TrendChart({
  points,
  metric,
  baseline,
  onSelect,
}: {
  points: TrendPoint[];
  metric: Metric;
  baseline: number | null;
  onSelect: (week: string) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const width = 820;
  const height = 325;
  const pad = { left: 54, right: 18, top: 24, bottom: 42 };
  const values = points.map((point) => point.value);
  let minimum = metric === "mix" ? 0 : Math.floor((Math.min(...values, baseline ?? 0, 0) - 5) / 10) * 10;
  let maximum = metric === "mix" ? 100 : Math.ceil((Math.max(...values, baseline ?? 0, 0) + 5) / 10) * 10;
  if (maximum - minimum < 40) {
    minimum -= 10;
    maximum += 10;
  }
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const x = (index: number) => pad.left + (index / Math.max(points.length - 1, 1)) * plotWidth;
  const y = (value: number) => pad.top + ((maximum - value) / (maximum - minimum)) * plotHeight;
  const path = points.map((point, index) => `${index ? "L" : "M"}${x(index)},${y(point.value)}`).join(" ");
  const ticks = Array.from({ length: 5 }, (_, index) => minimum + ((maximum - minimum) / 4) * index).reverse();
  const tooltip = hovered === null ? null : points[hovered];
  const tooltipX = hovered === null ? 0 : Math.min(Math.max(x(hovered) - 74, pad.left), width - 164);
  const tooltipY = hovered === null ? 0 : Math.max(y(points[hovered].value) - 82, 8);

  return (
    <div className="trend-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Weekly portfolio performance chart">
        {ticks.map((tick) => (
          <g key={tick}>
            <line className="chart-gridline" x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} />
            <text className="axis-label" x={pad.left - 10} y={y(tick) + 4} textAnchor="end">
              {metric === "mix" ? `${Math.round(tick)}%` : formatPercent(tick, 0)}
            </text>
          </g>
        ))}
        {baseline !== null ? (
          <g>
            <line className="baseline-line" x1={pad.left} x2={width - pad.right} y1={y(baseline)} y2={y(baseline)} />
            <text className="baseline-label" x={width - pad.right - 4} y={y(baseline) - 7} textAnchor="end">
              Prior average {formatPercent(baseline, 1)}
            </text>
          </g>
        ) : null}
        <path key={`${metric}-${path}`} className="trend-line" d={path} />
        {points.map((point, index) => (
          <g key={point.week}>
            {/* The visible dot is 4 units in an 820 unit viewBox, which lands
                near 8px on a phone. This invisible companion carries the
                pointer and keyboard affordance at a finger-sized radius. */}
            <circle
              className="trend-hit"
              cx={x(index)}
              cy={y(point.value)}
              r={20}
              tabIndex={0}
              role="button"
              aria-label={`${point.label}, ${formatPercent(point.value)}`}
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(index)}
              onBlur={() => setHovered(null)}
              onClick={() => onSelect(point.week)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onSelect(point.week);
              }}
            />
            <circle
              className="trend-point"
              cx={x(index)}
              cy={y(point.value)}
              r={hovered === index ? 6 : 4}
              aria-hidden="true"
            />
          </g>
        ))}
        {points.map((point, index) =>
          index % 2 === 0 || index === points.length - 1 ? (
            <text key={`${point.week}-label`} className="axis-label" x={x(index)} y={height - 14} textAnchor="middle">
              {point.label}
            </text>
          ) : null,
        )}
        {tooltip ? (
          <g className="chart-tooltip" transform={`translate(${tooltipX},${tooltipY})`}>
            <rect width="150" height="64" rx="8" />
            <text x="12" y="20">{tooltip.label}</text>
            <text className="tooltip-value" x="12" y="39">
              {metric === "mix" ? `${tooltip.value.toFixed(1)}% new mix` : formatPercent(tooltip.value)}
            </text>
            <text className="tooltip-meta" x="12" y="55">
              {metric === "mix"
                ? `${formatCompact(tooltip.newUnits)} / ${formatCompact(tooltip.units)} units`
                : `${formatCompact(tooltip.current)} vs ${formatCompact(tooltip.prior)}`}
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
}

function RetailerBars({
  rows,
  selected,
  onSelect,
}: {
  rows: RetailerMetric[];
  selected: string;
  onSelect: (retailer: string) => void;
}) {
  const minimum = -55;
  const maximum = 40;
  const zero = ((0 - minimum) / (maximum - minimum)) * 100;
  return (
    <div className="retailer-bars">
      {rows.map((row) => {
        const position = ((row.value - minimum) / (maximum - minimum)) * 100;
        const left = Math.min(position, zero);
        const width = Math.abs(position - zero);
        return (
          <button
            type="button"
            key={row.retailer}
            className={selected === row.retailer ? "selected" : ""}
            onClick={() => onSelect(row.retailer)}
          >
            <span className="bar-label">{titleCase(row.retailer)}</span>
            <span className="diverging-track">
              <i className="zero-line" style={{ left: `${zero}%` }} />
              <i
                className={row.value >= 0 ? "positive-bar" : "negative-bar"}
                style={{ left: `${left}%`, width: `${Math.max(width, 1)}%` }}
              />
            </span>
            <strong className={row.value >= 0 ? "positive-text" : "negative-text"}>{formatPercent(row.value)}</strong>
          </button>
        );
      })}
      <div className="bar-axis" style={{ paddingLeft: `${zero}%` }}>
        <span>0%</span>
      </div>
    </div>
  );
}

function MixBars({ rows, selected, onSelect }: { rows: RetailerMetric[]; selected: string; onSelect: (retailer: string) => void }) {
  return (
    <div className="mix-bars">
      {rows.map((row) => (
        <button
          type="button"
          key={row.retailer}
          className={selected === row.retailer ? "selected" : ""}
          onClick={() => onSelect(row.retailer)}
        >
          <span>{titleCase(row.retailer)}</span>
          <span className="mix-track"><i style={{ width: `${row.value}%` }} /></span>
          <strong>{row.value.toFixed(1)}%</strong>
        </button>
      ))}
    </div>
  );
}

function WosChart({
  rows,
  colorFilter,
  onSelect,
}: {
  rows: WosRow[];
  colorFilter: ColorFilter;
  onSelect: (retailer: string) => void;
}) {
  const largest = Math.max(0, ...rows.flatMap((row) => [row.black ?? 0, row.color ?? 0]));
  const max = Math.max(12, Math.ceil(largest / 4) * 4);
  const valueClass = (value: number) => value < 6 ? "low" : value > 8 ? "high" : "target";
  return (
    <div className="wos-chart">
      <div className="wos-toolbar">
        <div className="wos-legend">
          {colorFilter !== "Color" ? <span><i className="black-key" />Black</span> : null}
          {colorFilter !== "Black" ? <span><i className="color-key" />Color</span> : null}
          <span><i className="target-key" />6–8 target</span>
          <InfoTip
            label="How weeks of supply and the target are calculated"
            align="start"
            formula="WOS = latest complete-week inventory ÷ average weekly units sold across the latest 4 complete weeks."
            method="The shaded band marks 6–8 weeks on the same horizontal scale as every bar; the scale expands when a value exceeds 12."
            interpretation="Below 6 suggests lean coverage; 6–8 is the planning target; above 8 suggests excess coverage."
          />
        </div>
        <span className="wos-unit">Weeks of supply</span>
      </div>
      <div className="wos-scale" aria-hidden="true">
        <span />
        <span className="wos-scale-lines">
          <span />
          <span className="wos-scale-track">
            <i style={{ left: "0%" }}>0</i>
            <i style={{ left: `${(6 / max) * 100}%` }}>6</i>
            <i style={{ left: `${(8 / max) * 100}%` }}>8</i>
            <i style={{ left: "100%" }}>{max}</i>
          </span>
          <span />
        </span>
        <span />
      </div>
      <div className={`wos-rows ${rows.length === 1 ? "single" : ""}`}>
        <i
          className="wos-target-zone"
          aria-hidden="true"
          style={{
            left: `calc(var(--wos-track-start) + (100% - var(--wos-track-inset)) * ${6 / max})`,
            width: `calc((100% - var(--wos-track-inset)) * ${2 / max})`,
          }}
        />
        {rows.map((row) => (
          <button type="button" key={row.retailer} onClick={() => onSelect(row.retailer)}>
            <span className="wos-label">{titleCase(row.retailer)}</span>
            <span className="wos-lines">
              {colorFilter !== "Color" && row.black !== null ? (
                <span className="wos-line">
                  <span className="wos-series-name">Black</span>
                  <span className="wos-track">
                    <i className="black-bar" style={{ width: `${Math.min((row.black / max) * 100, 100)}%` }} />
                  </span>
                  <b className={valueClass(row.black)}>{row.black.toFixed(1)}</b>
                </span>
              ) : null}
              {colorFilter !== "Black" && row.color !== null ? (
                <span className="wos-line">
                  <span className="wos-series-name">Color</span>
                  <span className="wos-track">
                    <i className="color-bar" style={{ width: `${Math.min((row.color / max) * 100, 100)}%` }} />
                  </span>
                  <b className={valueClass(row.color)}>{row.color.toFixed(1)}</b>
                </span>
              ) : null}
            </span>
            <MdKeyboardArrowDown className="wos-open" aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}

function DrawerKpi({
  label,
  value,
  help,
  align = "center",
}: {
  label: string;
  value: string;
  help: InfoTipProps;
  align?: "start" | "center" | "end";
}) {
  return (
    <div>
      <div className="drawer-kpi-label">
        <span>{label}</span>
        <InfoTip {...help} align={align} label={`How ${label} is calculated`} />
      </div>
      <strong>{value}</strong>
    </div>
  );
}

function HelpHeader({ label, help, align = "center" }: { label: string; help: InfoTipProps; align?: "start" | "center" | "end" }) {
  return (
    <span className="table-head-label">
      <span>{label}</span>
      <InfoTip {...help} align={align} placement="top" label={`About ${label}`} />
    </span>
  );
}

function DetailDrawer({
  detail,
  data,
  filters,
  onClose,
}: {
  detail: Detail | null;
  data: CaseData;
  filters: Filters;
  onClose: () => void;
}) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  if (!detail) return null;

  let title = "";
  let subtitle = "";
  let headerHelp: InfoTipProps = {};
  let body: ReactNode = null;

  if (detail.kind === "week") {
    title = formatDate(detail.week);
    subtitle = "Underlying retailer–SKU records";
    headerHelp = {
      text: "This view exposes the records behind the selected weekly point.",
      method: "Rows are grouped by fiscal week ending, retailer, and SKU after applying the active retailer and color filters. Duplicate sales rows are summed; inventory uses the largest nonzero observation because inventory is a snapshot.",
      interpretation: "When the latest week is detected as incomplete, it is excluded from every dashboard metric and detail view.",
    };
    const rows = data.records
      .filter((record) => record.week === detail.week && matches(record, filters))
      .sort((a, b) => a.retailer.localeCompare(b.retailer) || a.sku.localeCompare(b.sku));
    const totals = rows.reduce(
      (sum, row) => ({ units: sum.units + row.salesUnits, pages: sum.pages + row.ratedPages, inventory: sum.inventory + row.inventoryUnits }),
      { units: 0, pages: 0, inventory: 0 },
    );
    body = (
      <>
        <div className="drawer-kpis">
          <DrawerKpi
            label="Units"
            value={formatNumber(totals.units)}
            align="start"
            help={{
              formula: "Units = Σ Sales (Units) across the displayed rows.",
              method: "Sales are summed within duplicate retailer–SKU–week keys before this total is calculated.",
              interpretation: "Physical cartridges sold during the selected complete week.",
            }}
          />
          <DrawerKpi
            label="Rated pages"
            value={formatCompact(totals.pages)}
            help={{
              formula: "Rated pages = Σ (sales units × rated yield for each SKU).",
              method: "Rated yield is matched from the workbook’s Reference sheet; values are then summed across displayed rows.",
              interpretation: "A yield-normalized demand measure that makes standard and XL cartridges more comparable.",
            }}
          />
          <DrawerKpi
            label="Inventory"
            value={formatNumber(totals.inventory)}
            align="end"
            help={{
              formula: "Inventory = Σ latest snapshot units across the displayed retailer–SKU keys.",
              method: "When duplicate source rows disagree, the largest nonzero inventory observation is retained instead of summing snapshots.",
              interpretation: "Point-in-time channel inventory at the selected week ending—not weekly inventory movement.",
            }}
          />
        </div>
        <div className="drawer-table-wrap">
          <table className="drawer-table">
            <thead><tr>
              <th><HelpHeader label="Retailer" align="start" help={{ text: "Retail account from the Raw Data sheet after name normalization." }} /></th>
              <th><HelpHeader label="SKU" align="start" help={{ text: "Workbook SKU key used to join Raw Data with product attributes in the Reference sheet." }} /></th>
              <th><HelpHeader label="Units" help={{ formula: "Σ Sales (Units) for this retailer–SKU–week key.", method: "Duplicate sales rows are additive." }} /></th>
              <th><HelpHeader label="Inventory" help={{ formula: "Largest nonzero inventory observation for this key.", method: "Inventory is treated as a snapshot, so duplicate values are not summed." }} /></th>
              <th><HelpHeader label="Rated pages" align="end" help={{ formula: "Sales units × SKU rated yield.", interpretation: "Yield-normalized demand for this row." }} /></th>
            </tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{titleCase(row.retailer)}</td>
                  <td>{row.sku}</td>
                  <td>{formatNumber(row.salesUnits)}</td>
                  <td>{formatNumber(row.inventoryUnits)}</td>
                  <td>{formatNumber(row.ratedPages)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  if (detail.kind === "retailer" || detail.kind === "inventory") {
    const retailer = detail.retailer;
    const dates = analysisDates(data);
    const retailerFilters: Filters = { ...filters, retailer };
    const full = matchedPerformance(data.records, dates.start, dates.end, retailerFilters);
    const latest = matchedPerformance(data.records, dates.latestFourStart, dates.end, retailerFilters);
    const week = sumRange(data.records, dates.end, dates.end, retailerFilters);
    const aligned = alignedPerformance(data.records, retailer, filters.color);
    const alignedPre = aligned.launch
      ? matchedPerformance(data.records, addDays(aligned.launch, -70), addDays(aligned.launch, -7), retailerFilters)
      : null;
    const alignedPost = aligned.launch
      ? matchedPerformance(data.records, aligned.launch, addDays(aligned.launch, 63), retailerFilters)
      : null;
    const newProducts = data.reference.filter((product) => product.generation === "New" && (filters.color === "All" || product.color === filters.color));
    const productRows = newProducts.map((product) => {
      const inventory = data.records
        .filter((record) => record.week === dates.end && record.retailer === retailer && record.sku === product.sku)
        .reduce((sum, record) => sum + record.inventoryUnits, 0);
      const trailingSales = sumRange(data.records, dates.latestFourStart, dates.end, { retailer, color: product.color }, { sku: product.sku }).units;
      return { product, inventory, trailingSales, average: trailingSales / 4, wos: trailingSales ? inventory / (trailingSales / 4) : null };
    });
    title = titleCase(retailer);
    subtitle = detail.kind === "inventory" ? "New-SKU inventory coverage" : aligned.launch ? `First new inventory: ${formatDate(aligned.launch)}` : "Retailer detail";
    headerHelp = {
      text: "Retailer metrics use rated-page demand so different cartridge yields can be compared on a common basis.",
      method: `Only complete weeks are included. The active color filter is applied. The latest complete week is ${formatDate(dates.end)}.`,
      interpretation: "Pre/post results are descriptive and directional; they do not isolate the launch from pricing, promotions, installed-base changes, or retailer inventory behavior.",
    };
    body = (
      <>
        <div className="drawer-kpis two-column">
          <DrawerKpi
            label="Full period"
            value={formatPercent(full.pages)}
            align="start"
            help={{
              text: "Year-over-year change in rated-page demand across the full dashboard window.",
              formula: full.prior.pages
                ? `100 × (${formatNumber(full.current.pages)} current pages ÷ ${formatNumber(full.prior.pages)} prior-year pages − 1) = ${formatPercent(full.pages)}`
                : "Not available when the matched prior-year rated-page total is zero.",
              method: `${formatDate(dates.start)}–${formatDate(dates.end)} is matched to the same 15 complete weeks 364 days earlier.`,
              interpretation: "Positive means normalized demand was higher than last year; negative means it was lower.",
            }}
          />
          <DrawerKpi
            label="Latest 4 weeks"
            value={formatPercent(latest.pages)}
            align="end"
            help={{
              text: "The freshest year-over-year demand signal.",
              formula: latest.prior.pages
                ? `100 × (${formatNumber(latest.current.pages)} current pages ÷ ${formatNumber(latest.prior.pages)} prior-year pages − 1) = ${formatPercent(latest.pages)}`
                : "Not available when the matched prior-year rated-page total is zero.",
              method: `${formatDate(dates.latestFourStart)}–${formatDate(dates.end)} is compared with the same four complete weeks 364 days earlier.`,
              interpretation: "Use with the full-period result: a weaker recent value indicates deterioration; a stronger value indicates improvement.",
            }}
          />
          <DrawerKpi
            label="New-SKU mix"
            value={week.units ? `${((week.newUnits / week.units) * 100).toFixed(1)}%` : "—"}
            align="start"
            help={{
              text: "Share of cartridge units coming from replacement SKUs in the latest complete week.",
              formula: week.units
                ? `100 × (${formatNumber(week.newUnits)} new-SKU units ÷ ${formatNumber(week.units)} total units) = ${((week.newUnits / week.units) * 100).toFixed(1)}%`
                : "Not available because total units are zero.",
              method: `Uses the week ending ${formatDate(dates.end)} and the Legacy/New mapping from the Reference sheet.`,
              interpretation: "Measures retailer channel conversion—not end-customer retention or one-to-one switching.",
            }}
          />
          <DrawerKpi
            label="Pre / post 10W"
            value={`${formatPercent(aligned.pre)} / ${formatPercent(aligned.post)}`}
            align="end"
            help={{
              text: "Two rated-page YoY results aligned to this retailer’s first week with positive new-SKU inventory.",
              formula: alignedPre && alignedPost && alignedPre.prior.pages && alignedPost.prior.pages
                ? `Pre: 100 × (${formatNumber(alignedPre.current.pages)} ÷ ${formatNumber(alignedPre.prior.pages)} − 1) = ${formatPercent(aligned.pre)}. Post: 100 × (${formatNumber(alignedPost.current.pages)} ÷ ${formatNumber(alignedPost.prior.pages)} − 1) = ${formatPercent(aligned.post)}.`
                : "Not available without a launch anchor and nonzero matched prior-year demand.",
              method: aligned.launch
                ? `Pre = ${formatDate(addDays(aligned.launch, -70))}–${formatDate(addDays(aligned.launch, -7))}; post = ${formatDate(aligned.launch)}–${formatDate(addDays(aligned.launch, 63))}. Each window contains 10 complete weeks and is compared with 364 days earlier.`
                : "No first positive new-SKU inventory week was found for this retailer.",
              interpretation: "The change between the two values is directional, not a causal estimate of the cartridge transition.",
            }}
          />
        </div>
        <div className="drawer-section">
          <div className="drawer-section-title">
            <h3>Inventory coverage</h3>
            <InfoTip
              label="How inventory coverage is calculated"
              align="start"
              placement="top"
              text="Coverage estimates how many weeks the latest new-SKU inventory could support at the recent sales pace."
              formula="WOS = latest complete-week inventory ÷ (units sold in latest 4 complete weeks ÷ 4)."
              method={`Inventory is from ${formatDate(dates.end)}; the sales window is ${formatDate(dates.latestFourStart)}–${formatDate(dates.end)}.`}
              interpretation="The planning target is 6–8 weeks. A missing value means the SKU had no sales in the trailing four weeks."
            />
          </div>
          <table className="drawer-table inventory-table">
            <thead><tr>
              <th><HelpHeader label="SKU" align="start" help={{ text: "Replacement SKU and color classification from the Reference sheet." }} /></th>
              <th><HelpHeader label="Inventory" help={{ formula: "Latest complete-week inventory snapshot.", method: "Duplicate snapshots use the largest nonzero observation; they are not added." }} /></th>
              <th><HelpHeader label="4W avg." align="end" help={{ formula: "Trailing 4-week sales units ÷ 4.", interpretation: "Average weekly sell-through used as the coverage denominator." }} /></th>
              <th><HelpHeader label="WOS" align="end" help={{ formula: "Inventory ÷ 4-week average weekly sales.", interpretation: "Below 6 = lean; 6–8 = target; above 8 = excess." }} /></th>
            </tr></thead>
            <tbody>
              {productRows.map(({ product, inventory, trailingSales, average, wos }) => {
                const coverageMeaning = wos === null
                  ? "No trailing sales; coverage cannot be calculated."
                  : wos < 6
                    ? "Below the 6-week lower bound; coverage is lean."
                    : wos > 8
                      ? "Above the 8-week upper bound; coverage is elevated."
                      : "Within the 6–8 week planning target.";
                return (
                  <tr key={product.sku}>
                    <td>{product.color} · {product.sku}</td>
                    <td><span className="table-value-with-help"><span>{formatNumber(inventory)}</span><InfoTip placement="top" label={`Inventory math for ${product.sku}`} formula={`${formatNumber(inventory)} units at ${formatDate(dates.end)}`} method="Point-in-time snapshot after duplicate-key reconciliation." /></span></td>
                    <td><span className="table-value-with-help"><span>{formatNumber(average)}</span><InfoTip align="end" placement="top" label={`Four-week average math for ${product.sku}`} formula={`${formatNumber(trailingSales)} trailing units ÷ 4 = ${formatNumber(average)} units/week`} method={`${formatDate(dates.latestFourStart)}–${formatDate(dates.end)}; complete weeks only.`} /></span></td>
                    <td><span className="table-value-with-help"><strong>{wos === null ? "—" : wos.toFixed(1)}</strong><InfoTip align="end" placement="top" label={`Weeks of supply math for ${product.sku}`} formula={wos === null ? `${formatNumber(inventory)} inventory ÷ 0 average weekly sales = undefined` : `${formatNumber(inventory)} inventory ÷ ${average.toFixed(1)} units/week = ${wos.toFixed(1)} weeks`} interpretation={coverageMeaning} /></span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  return (
    <>
      <button className="drawer-backdrop" aria-label="Close detail panel" type="button" onClick={onClose} />
      <aside className="detail-drawer" aria-modal="true" role="dialog" aria-label={title}>
        <div className="drawer-header">
          <div>
            <div className="drawer-title-line"><h2>{title}</h2><InfoTip {...headerHelp} align="start" label={`Methodology for ${title}`} /></div>
            <p>{subtitle}</p>
          </div>
          <button className="drawer-close" type="button" onClick={onClose} aria-label="Close detail panel">Close</button>
        </div>
        <div className="drawer-body">{body}</div>
      </aside>
    </>
  );
}

function DataImportDialog({
  open,
  status,
  onBundledWorkbook,
  onFile,
  onClose,
}: {
  open: boolean;
  status: ImportStatus;
  onBundledWorkbook: () => void;
  onFile: (file: File) => void;
  onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open, onClose]);

  if (!open) return null;

  const acceptFile = (file?: File) => {
    if (!file) return;
    onFile(file);
    if (input.current) input.current.value = "";
  };

  return (
    <>
      <button type="button" className="data-dialog-backdrop" aria-label="Close data source" onClick={onClose} />
      <section className="data-dialog" role="dialog" aria-modal="true" aria-labelledby="data-dialog-title">
        <div className="data-dialog-header">
          <h2 id="data-dialog-title">Replace data</h2>
          <button type="button" onClick={onClose} aria-label="Close"><MdClose /></button>
        </div>

        <div className="source-options compact">
          <button className="bundled-source" type="button" onClick={onBundledWorkbook} disabled={status.state === "reading"}>
            <MdTableChart aria-hidden="true" />
            <strong>{BUNDLED_WORKBOOK_NAME}</strong>
          </button>
          <button type="button" onClick={() => input.current?.click()} disabled={status.state === "reading"}>
            <MdCloudUpload aria-hidden="true" />
            <strong>Upload workbook</strong>
          </button>
        </div>
        <input
          ref={input}
          className="visually-hidden"
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          onChange={(event) => acceptFile(event.target.files?.[0])}
        />

        {status.state !== "idle" ? (
          <div className={`import-status ${status.state}`}>
            {status.state === "error" ? <MdClose /> : status.state === "reading" ? <MdRefresh /> : <MdCheck />}
            <span>{status.message}</span>
          </div>
        ) : null}
      </section>
    </>
  );
}

function EmptyDataView({
  status,
  onBundledWorkbook,
  onFile,
}: {
  status: ImportStatus;
  onBundledWorkbook: () => void;
  onFile: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);

  const acceptFile = (file?: File) => {
    if (!file) return;
    onFile(file);
    if (input.current) input.current.value = "";
  };

  return (
    <div className="source-screen">
      <header className="source-brand">
        <PortfolioMark />
        <strong>Portfolio Analytics</strong>
      </header>
      <main className="source-picker">
        <h1>Select data</h1>
        <div className="source-options">
          <button className="bundled-source" type="button" onClick={onBundledWorkbook} disabled={status.state === "reading"}>
            <MdTableChart aria-hidden="true" />
            <strong>{BUNDLED_WORKBOOK_NAME}</strong>
          </button>
          <button type="button" onClick={() => input.current?.click()} disabled={status.state === "reading"}>
            <MdCloudUpload aria-hidden="true" />
            <strong>Upload workbook</strong>
          </button>
        </div>
        <input
          ref={input}
          className="visually-hidden"
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          onChange={(event) => acceptFile(event.target.files?.[0])}
        />
        {status.state !== "idle" ? (
          <div className={`import-status ${status.state}`}>
            {status.state === "error" ? <MdClose /> : status.state === "reading" ? <MdRefresh /> : <MdCheck />}
            <span>{status.message}</span>
          </div>
        ) : null}
      </main>
    </div>
  );
}

export default function Home() {
  const [data, setData] = useState<CaseData | null>(null);
  const [genericData, setGenericData] = useState<GenericWorkbookData | null>(null);
  const [metric, setMetric] = useState<Metric>("pages");
  const [filters, setFilters] = useState<Filters>({ retailer: "All retailers", color: "All" });
  const [detail, setDetail] = useState<Detail | null>(null);
  const [dataDialog, setDataDialog] = useState(false);
  const [importStatus, setImportStatus] = useState<ImportStatus>({ state: "idle", message: "" });

  const applyData = (payload: CaseData) => {
    setData(payload);
    setGenericData(null);
    setFilters({ retailer: "All retailers", color: "All" });
    setMetric("pages");
    setDetail(null);
    setImportStatus({ state: "idle", message: "" });
    setDataDialog(false);
  };

  const loadBundledWorkbook = async () => {
    setImportStatus({ state: "reading", message: "Loading workbook…" });
    try {
      const response = await fetch("./case-data.json");
      if (!response.ok) throw new Error("The bundled workbook could not be loaded.");
      applyData(await response.json() as CaseData);
    } catch (error) {
      setImportStatus({ state: "error", message: error instanceof Error ? error.message : "The bundled workbook could not be loaded." });
    }
  };

  const importWorkbook = async (file: File) => {
    setImportStatus({ state: "reading", message: "Analyzing workbook…" });
    try {
      const buffer = await file.arrayBuffer();
      await loadXlsx();
      try {
        applyData(parseCaseWorkbookBuffer(buffer, file.name));
      } catch {
        setData(null);
        setGenericData(parseGenericWorkbookBuffer(buffer, file.name));
        setDetail(null);
        setImportStatus({ state: "idle", message: "" });
        setDataDialog(false);
      }
    } catch (error) {
      setImportStatus({ state: "error", message: error instanceof Error ? error.message : "The workbook could not be read." });
    }
  };

  const analytics = useMemo(() => {
    if (!data) return null;
    const dates = analysisDates(data);
    const retailers = Array.from(new Set(data.records.map((record) => record.retailer))).sort();
    const full = matchedPerformance(data.records, dates.start, dates.end, filters);
    const latestFour = matchedPerformance(data.records, dates.latestFourStart, dates.end, filters);
    const finalWeek = sumRange(data.records, dates.end, dates.end, filters);
    const legacyStart = sumRange(data.records, dates.legacyBase, dates.legacyBase, filters, { generation: "Legacy" }).legacyInventory;
    const legacyEnd = sumRange(data.records, dates.end, dates.end, filters, { generation: "Legacy" }).legacyInventory;
    const legacyDrawdown = legacyStart ? (legacyEnd / legacyStart - 1) * 100 : 0;

    const trend: TrendPoint[] = Array.from({ length: 15 }, (_, index) => addDays(dates.start, index * 7)).map((week) => {
      const current = sumRange(data.records, week, week, filters);
      const prior = sumRange(data.records, addDays(week, -364), addDays(week, -364), filters);
      const value = metric === "pages"
        ? metricValue(current.pages, prior.pages)
        : metric === "units"
          ? metricValue(current.units, prior.units)
          : current.units
            ? (current.newUnits / current.units) * 100
            : 0;
      return {
        week,
        label: formatDate(week),
        value,
        current: metric === "pages" ? current.pages : current.units,
        prior: metric === "pages" ? prior.pages : prior.units,
        newUnits: current.newUnits,
        units: current.units,
      };
    });

    const retailerPerformance = retailers.map((retailer) => ({
      retailer,
      value: matchedPerformance(data.records, dates.latestFourStart, dates.end, { ...filters, retailer }).pages,
    }));
    const retailerMix = retailers.map((retailer) => {
      const week = sumRange(data.records, dates.end, dates.end, { ...filters, retailer });
      return { retailer, value: week.units ? (week.newUnits / week.units) * 100 : 0 };
    });
    const newBlackSku = data.reference.find((product) => product.generation === "New" && product.color === "Black")?.sku;
    const newColorSku = data.reference.find((product) => product.generation === "New" && product.color === "Color")?.sku;
    const wosRows: WosRow[] = retailers
      .filter((retailer) => filters.retailer === "All retailers" || retailer === filters.retailer)
      .map((retailer) => {
        const calculate = (sku: string | undefined, color: "Black" | "Color") => {
          if (!sku) return null;
          const inventory = data.records
            .filter((record) => record.week === dates.end && record.retailer === retailer && record.sku === sku)
            .reduce((sum, record) => sum + record.inventoryUnits, 0);
          const sales = sumRange(data.records, dates.latestFourStart, dates.end, { retailer, color }, { sku }).units;
          return sales ? inventory / (sales / 4) : null;
        };
        return { retailer, black: calculate(newBlackSku, "Black"), color: calculate(newColorSku, "Color") };
      });

    const historicalValues = [1, 2]
      .map((yearsBack) => matchedPerformance(
        data.records,
        addDays(dates.start, -364 * yearsBack),
        addDays(dates.end, -364 * yearsBack),
        { retailer: "All retailers", color: "All" },
      ).pages)
      .filter(Number.isFinite);
    const historicalBaseline = historicalValues.length
      ? historicalValues.reduce((sum, value) => sum + value, 0) / historicalValues.length
      : null;

    return { dates, retailers, full, latestFour, finalWeek, legacyDrawdown, trend, retailerPerformance, retailerMix, wosRows, historicalBaseline };
  }, [data, filters, metric]);

  const selectRetailer = (retailer: string, kind: "retailer" | "inventory" = "retailer") => {
    setFilters((current) => ({ ...current, retailer }));
    setDetail({ kind, retailer });
  };

  if (genericData) {
    return (
      <>
        <GenericDashboard key={`${genericData.meta.sourceFile}-${genericData.meta.totalRows}`} data={genericData} brand={<PortfolioMark />} onReplace={() => { setImportStatus({ state: "idle", message: "" }); setDataDialog(true); }} />
        <DataImportDialog open={dataDialog} status={importStatus} onBundledWorkbook={loadBundledWorkbook} onFile={importWorkbook} onClose={() => setDataDialog(false)} />
      </>
    );
  }

  if (!data || !analytics) {
    return <EmptyDataView status={importStatus} onBundledWorkbook={loadBundledWorkbook} onFile={importWorkbook} />;
  }

  return (
    <div className="dashboard-shell dashboard-ready">
      <div className="main-column">
        <header className="topbar">
          <PortfolioMark />
          <div className="topbar-title">
            <strong>Portfolio Simplification</strong>
          </div>
          <div className="topbar-tools">
            <div className="filters">
              <FilterMenu
                label="Retailer"
                value={filters.retailer}
                options={[
                  { value: "All retailers", label: "All retailers" },
                  ...analytics.retailers.map((retailer) => ({ value: retailer, label: titleCase(retailer) })),
                ]}
                onChange={(retailer) => setFilters((current) => ({ ...current, retailer }))}
              />
              <FilterMenu<ColorFilter>
                label="Color"
                value={filters.color}
                options={[
                  { value: "All", label: "All colors" },
                  { value: "Black", label: "Black" },
                  { value: "Color", label: "Color" },
                ]}
                onChange={(color) => setFilters((current) => ({ ...current, color }))}
              />
              {(filters.retailer !== "All retailers" || filters.color !== "All") ? (
                <button type="button" className="reset-button" onClick={() => setFilters({ retailer: "All retailers", color: "All" })} aria-label="Reset filters"><MdRefresh /><span>Reset</span></button>
              ) : null}
            </div>
            <button
              type="button"
              className="data-source-button uploaded"
              onClick={() => {
                setImportStatus({ state: "idle", message: "" });
                setDataDialog(true);
              }}
            >
              <MdUploadFile aria-hidden="true" />
              <span><strong>Replace data</strong></span>
            </button>
          </div>
        </header>

        <main>
          <div className="view-stack">
              <div className="view-title">
                <div>
                  <p>PERFORMANCE</p>
                  <h1>Portfolio performance</h1>
                </div>
              </div>

              <div className="kpi-grid">
                <KpiCard icon={<MdSwapHoriz />} label="Channel conversion" value={analytics.finalWeek.units ? `${((analytics.finalWeek.newUnits / analytics.finalWeek.units) * 100).toFixed(1)}%` : "—"} meta={`Week ending ${formatDate(analytics.dates.end)}`} info="New-SKU units divided by total units in the latest complete week. This measures retailer channel conversion, not customer retention." tone="blue" />
                <KpiCard icon={<MdOutlineCompareArrows />} label="Rated-page demand" value={formatPercent(analytics.full.pages)} meta={`${formatDate(analytics.dates.start)}–${formatDate(analytics.dates.end)} YoY`} info="Year-over-year change across the 15 complete weeks shown. Rated pages equal units sold multiplied by the cartridge’s rated yield." tone="black" />
                <KpiCard icon={<MdOutlineTrendingDown />} label="Latest 4 weeks" value={formatPercent(analytics.latestFour.pages)} meta="Rated-page demand YoY" info="Year-over-year change in rated-page demand for the four most recent complete weeks." tone="coral" />
                <KpiCard icon={<MdInventory2 />} label="Legacy inventory" value={formatPercent(analytics.legacyDrawdown)} meta={`${formatDate(analytics.dates.legacyBase)}–${formatDate(analytics.dates.end)}`} info="Percentage change in legacy-SKU inventory from the baseline week to the latest complete week. Inventory is treated as a point-in-time snapshot." tone="slate" />
              </div>

              <div className="dashboard-grid">
                <Card className="trend-card">
                  <CardHeader
                    title="Weekly trend"
                    meta={metric === "mix" ? "New-SKU share of weekly units" : `${metric === "pages" ? "Rated-page capacity" : "Unit sales"} vs. prior year`}
                    info="Each point compares a complete week with the same week one year earlier. Rated pages equal units multiplied by rated yield; new-SKU mix equals new units divided by total units."
                    action={
                      <div className="metric-toggle" role="group" aria-label="Trend metric">
                        <button type="button" className={metric === "pages" ? "active" : ""} onClick={() => setMetric("pages")}>Rated pages</button>
                        <button type="button" className={metric === "units" ? "active" : ""} onClick={() => setMetric("units")}>Units</button>
                        <button type="button" className={metric === "mix" ? "active" : ""} onClick={() => setMetric("mix")}>New-SKU mix</button>
                      </div>
                    }
                  />
                  <TrendChart
                    points={analytics.trend}
                    metric={metric}
                    baseline={metric === "pages" && filters.retailer === "All retailers" && filters.color === "All" ? analytics.historicalBaseline : null}
                    onSelect={(week) => setDetail({ kind: "week", week })}
                  />
                </Card>

                <Card className="retailer-card">
                  <CardHeader title="Retailer performance" meta="Latest 4 weeks · rated pages YoY" info="For each retailer, current rated-page demand is compared with the same four weeks one year earlier." />
                  <RetailerBars rows={analytics.retailerPerformance} selected={filters.retailer} onSelect={(retailer) => selectRetailer(retailer)} />
                </Card>

                <Card className={`inventory-card ${analytics.wosRows.length === 1 ? "compact" : ""}`}>
                  <CardHeader title="Inventory coverage" meta="New SKUs · trailing 4-week sales rate" info="Weeks of supply equals latest new-SKU inventory divided by average weekly new-SKU sales over the prior four complete weeks. The shaded 6–8 range is the target." />
                  <WosChart rows={analytics.wosRows} colorFilter={filters.color} onSelect={(retailer) => selectRetailer(retailer, "inventory")} />
                </Card>

                <Card className="mix-card">
                  <CardHeader title="Channel conversion" meta={`New-SKU share · ${formatDate(analytics.dates.end)}`} info="New-SKU units divided by total cartridge units for each retailer in the latest complete week. This is channel mix, not observed customer retention." />
                  <MixBars rows={analytics.retailerMix} selected={filters.retailer} onSelect={(retailer) => selectRetailer(retailer)} />
                  <div className="metric-guardrail"><strong>{analytics.finalWeek.units ? `${((analytics.finalWeek.newUnits / analytics.finalWeek.units) * 100).toFixed(1)}%` : "—"}</strong><span>Channel mix, not customer retention</span></div>
                </Card>

                <Card className="mapping-card">
                  <CardHeader title="Portfolio mapping" meta="Four legacy SKUs consolidated into two replacements" info="This shows the designed SKU replacement relationships listed in the workbook’s Reference sheet. It does not represent measured customer switching or sales volume." />
                  <PortfolioMapping products={data.reference} />
                </Card>
              </div>

              <footer className="data-footer">
                <span>{data.meta.sourceFile}</span>
                <span>{formatNumber(data.meta.groupedRecords)} grouped records</span>
                <span>{(data.meta.excludedPartialRows ?? 0) > 0 ? `${formatDate(addDays(data.meta.lastCompleteWeek, 7))} partial week excluded` : "All detected weeks included"}</span>
              </footer>
          </div>
        </main>
      </div>

      <DetailDrawer detail={detail} data={data} filters={filters} onClose={() => setDetail(null)} />
      <DataImportDialog
        open={dataDialog}
        status={importStatus}
        onBundledWorkbook={loadBundledWorkbook}
        onFile={importWorkbook}
        onClose={() => setDataDialog(false)}
      />
    </div>
  );
}
