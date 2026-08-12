"use client";

import { useId, useMemo } from "react";

export type SankeyLink = {
  source: string;
  target: string;
  value: number;
  color?: string;
};

type SankeyNode = {
  label: string;
  value: number;
  y: number;
  height: number;
  color: string;
};

const PALETTE = ["#024ad8", "#344054", "#447180", "#7f56d9", "#039855", "#f79009"];

function shortLabel(value: string) {
  return value.length > 25 ? `${value.slice(0, 24)}…` : value;
}

export function SankeyChart({
  links,
  valueFormatter = (value) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value),
  ariaLabel = "Flow diagram",
}: {
  links: SankeyLink[];
  valueFormatter?: (value: number) => string;
  ariaLabel?: string;
}) {
  const rawId = useId();
  const chartId = rawId.replace(/[^a-zA-Z0-9_-]/g, "");
  const layout = useMemo(() => {
    const cleaned = links.filter((link) => Number.isFinite(link.value) && link.value > 0 && link.source && link.target);
    const sources = [...new Set(cleaned.map((link) => link.source))];
    const targets = [...new Set(cleaned.map((link) => link.target))];
    const total = cleaned.reduce((sum, link) => sum + link.value, 0);
    if (!total || !sources.length || !targets.length) return null;

    const width = 1040;
    const height = 300;
    const padding = 24;
    const gap = 18;
    const nodeWidth = 11;
    const leftX = 205;
    const rightX = 824;
    const largestColumn = Math.max(sources.length, targets.length);
    const available = height - padding * 2 - gap * Math.max(0, largestColumn - 1);
    const scale = Math.max(0.001, available / total);
    const sourceTotals = new Map(sources.map((source) => [source, cleaned.filter((link) => link.source === source).reduce((sum, link) => sum + link.value, 0)]));
    const targetTotals = new Map(targets.map((target) => [target, cleaned.filter((link) => link.target === target).reduce((sum, link) => sum + link.value, 0)]));
    const sourceColors = new Map(sources.map((source, index) => [source, cleaned.find((link) => link.source === source)?.color ?? PALETTE[index % PALETTE.length]]));
    const targetColors = new Map(targets.map((target, index) => [target, cleaned.find((link) => link.target === target)?.color ?? PALETTE[index % PALETTE.length]]));

    const placeNodes = (labels: string[], values: Map<string, number>, colors: Map<string, string>) => {
      const columnHeight = labels.reduce((sum, label) => sum + (values.get(label) ?? 0) * scale, 0) + gap * Math.max(0, labels.length - 1);
      let cursor = (height - columnHeight) / 2;
      return new Map<string, SankeyNode>(labels.map((label) => {
        const value = values.get(label) ?? 0;
        const node = { label, value, y: cursor, height: value * scale, color: colors.get(label) ?? PALETTE[0] };
        cursor += node.height + gap;
        return [label, node];
      }));
    };

    const sourceNodes = placeNodes(sources, sourceTotals, sourceColors);
    const targetNodes = placeNodes(targets, targetTotals, targetColors);
    const sourceOffsets = new Map(sources.map((source) => [source, 0]));
    const targetOffsets = new Map(targets.map((target) => [target, 0]));
    const paths = cleaned.map((link, index) => {
      const source = sourceNodes.get(link.source)!;
      const target = targetNodes.get(link.target)!;
      const thickness = link.value * scale;
      const sourceY = source.y + (sourceOffsets.get(link.source) ?? 0);
      const targetY = target.y + (targetOffsets.get(link.target) ?? 0);
      sourceOffsets.set(link.source, (sourceOffsets.get(link.source) ?? 0) + thickness);
      targetOffsets.set(link.target, (targetOffsets.get(link.target) ?? 0) + thickness);
      const startX = leftX + nodeWidth;
      const endX = rightX;
      const bend = (startX + endX) / 2;
      const d = [
        `M${startX},${sourceY}`,
        `C${bend},${sourceY} ${bend},${targetY} ${endX},${targetY}`,
        `L${endX},${targetY + thickness}`,
        `C${bend},${targetY + thickness} ${bend},${sourceY + thickness} ${startX},${sourceY + thickness}`,
        "Z",
      ].join(" ");
      return { ...link, index, d, sourceColor: source.color, targetColor: target.color };
    });

    return { width, height, nodeWidth, leftX, rightX, sourceNodes: [...sourceNodes.values()], targetNodes: [...targetNodes.values()], paths };
  }, [links]);

  if (!layout) return null;

  return (
    <div className="sankey-wrap">
      <svg viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label={ariaLabel}>
        <defs>
          {layout.paths.map((path) => (
            <linearGradient id={`${chartId}-flow-${path.index}`} key={path.index} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor={path.sourceColor} stopOpacity=".56" />
              <stop offset="1" stopColor={path.targetColor} stopOpacity=".25" />
            </linearGradient>
          ))}
        </defs>
        {layout.paths.map((path) => (
          <path className="sankey-ribbon" d={path.d} fill={`url(#${chartId}-flow-${path.index})`} key={`${path.source}-${path.target}-${path.index}`}>
            <title>{`${path.source} → ${path.target}: ${valueFormatter(path.value)}`}</title>
          </path>
        ))}
        {layout.sourceNodes.map((node) => (
          <g className="sankey-node" key={`source-${node.label}`}>
            <rect x={layout.leftX} y={node.y} width={layout.nodeWidth} height={Math.max(1, node.height)} rx="2" fill={node.color} />
            <text className="sankey-label" x={layout.leftX - 13} y={node.y + node.height / 2 - 2} textAnchor="end">{shortLabel(node.label)}</text>
            <text className="sankey-value" x={layout.leftX - 13} y={node.y + node.height / 2 + 12} textAnchor="end">{valueFormatter(node.value)}</text>
          </g>
        ))}
        {layout.targetNodes.map((node) => (
          <g className="sankey-node" key={`target-${node.label}`}>
            <rect x={layout.rightX} y={node.y} width={layout.nodeWidth} height={Math.max(1, node.height)} rx="2" fill={node.color} />
            <text className="sankey-label" x={layout.rightX + layout.nodeWidth + 13} y={node.y + node.height / 2 - 2}>{shortLabel(node.label)}</text>
            <text className="sankey-value" x={layout.rightX + layout.nodeWidth + 13} y={node.y + node.height / 2 + 12}>{valueFormatter(node.value)}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
