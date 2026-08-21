import { memo, useMemo } from 'react'
import { Brain, GitBranch, ScanLine, TrendingUp } from 'lucide-react'
import type { SimulationMetrics } from '../types'
import { Panel } from './Panel'

interface TelemetryGridProps {
  metrics: SimulationMetrics
  running: boolean
}

const RelationshipFlow = memo(function RelationshipFlow({ metrics }: { metrics: SimulationMetrics }) {
  return (
    <Panel className="telemetry-card relationship-flow" eyebrow="NEW LINKS / MIN" title="Relationship Flow" action={<GitBranch size={15} aria-hidden="true" />}>
      <div className="flow-list">
        {metrics.flows.map((flow) => (
          <div className="flow-row" key={flow.id}>
            <span>{flow.label}</span>
            <div className="flow-row__track"><i style={{ width: `${flow.value}%`, background: flow.color }} /></div>
            <strong>{flow.delta >= 0 ? '+' : ''}{flow.delta}</strong>
          </div>
        ))}
      </div>
      <div className="telemetry-card__foot"><span>Cross-cluster bridge rate</span><strong>+14.2%</strong></div>
    </Panel>
  )
})

const EntityResolution = memo(function EntityResolution({ values, matches, running }: { values: number[]; matches: number; running: boolean }) {
  return (
    <Panel className="telemetry-card entity-resolution" eyebrow="PAIRWISE MATCH GRID" title="Entity Resolution" action={<ScanLine size={15} aria-hidden="true" />}>
      <div className={`entity-heatmap${running ? ' entity-heatmap--running' : ''}`} aria-label="Entity match confidence heatmap">
        {values.map((value, index) => (
          <span
            className={value > 83 ? 'heat-cell heat-cell--hot' : value > 58 ? 'heat-cell heat-cell--warm' : 'heat-cell'}
            key={index}
            style={{ opacity: 0.25 + value / 135 }}
            title={`${value}% match confidence`}
          />
        ))}
      </div>
      <div className="resolution-stats">
        <div><strong>{matches.toLocaleString()}</strong><span>resolved</span></div>
        <div><strong>98.4%</strong><span>precision</span></div>
        <div><strong>23</strong><span>review</span></div>
      </div>
    </Panel>
  )
})

function pointsToPath(values: number[], width: number, height: number): string {
  if (values.length < 2) return ''
  let min = values[0]
  let max = values[0]
  for (let index = 1; index < values.length; index += 1) {
    min = Math.min(min, values[index])
    max = Math.max(max, values[index])
  }
  const range = Math.max(1, max - min)
  return values.map((value, index) => {
    const x = (index / (values.length - 1)) * width
    const y = height - ((value - min) / range) * (height - 12) - 6
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

const SignalRate = memo(function SignalRate({ metrics }: { metrics: SimulationMetrics }) {
  const path = useMemo(() => pointsToPath(metrics.signalHistory, 240, 72), [metrics.signalHistory])
  const areaPath = path ? `${path} L240,78 L0,78 Z` : ''
  return (
    <Panel className="telemetry-card signal-rate" eyebrow="RESEARCH THROUGHPUT" title="Signal Rate" action={<TrendingUp size={15} aria-hidden="true" />}>
      <div className="signal-rate__value"><strong>{metrics.signalsPerSecond}</strong><span>signals / sec</span><i>+8.7%</i></div>
      <svg className="sparkline" viewBox="0 0 240 82" preserveAspectRatio="none" role="img" aria-label="Recent signal ingestion rate">
        <defs>
          <linearGradient id="signal-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--accent-blue)" stopOpacity=".28" />
            <stop offset="1" stopColor="var(--accent-blue)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className="sparkline__grid" d="M0 20 H240 M0 41 H240 M0 62 H240" />
        <path className="sparkline__area" d={areaPath} />
        <path className="sparkline__line" d={path} />
      </svg>
      <div className="signal-rate__axis"><span>30 sec ago</span><span>now</span></div>
    </Panel>
  )
})

const SharedMemory = memo(function SharedMemory({ metrics }: { metrics: SimulationMetrics }) {
  const density = metrics.density.toFixed(1)
  return (
    <Panel className="telemetry-card shared-memory" eyebrow="LIVING KNOWLEDGE" title="Shared Memory" action={<Brain size={15} aria-hidden="true" />}>
      <div className="memory-layout">
        <div className="memory-gauge" style={{ '--memory-value': `${metrics.density * 3.6}deg` } as React.CSSProperties}>
          <div><strong>{density}%</strong><span>density</span></div>
        </div>
        <div className="memory-kpis">
          <div><span>Coverage</span><strong>{metrics.sourceCoverage.toFixed(1)}%</strong></div>
          <div><span>Conflicts</span><strong>0.7%</strong></div>
          <div><span>Freshness</span><strong>14 sec</strong></div>
        </div>
      </div>
      <div className="memory-progress"><i style={{ width: `${metrics.density}%` }} /></div>
      <div className="telemetry-card__foot"><span>Compaction in</span><strong>06:42</strong></div>
    </Panel>
  )
})

export function TelemetryGrid({ metrics, running }: TelemetryGridProps) {
  return (
    <div className="telemetry-grid">
      <RelationshipFlow metrics={metrics} />
      <EntityResolution values={metrics.heatmap} matches={metrics.entityMatches} running={running} />
      <SignalRate metrics={metrics} />
      <SharedMemory metrics={metrics} />
    </div>
  )
}
