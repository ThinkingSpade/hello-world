import { AlertTriangle, ArrowUpRight, Radar } from 'lucide-react'
import { CLUSTER_MAP } from '../data/intelligence'
import type { IntelligenceAlert } from '../types'
import { Panel } from './Panel'

interface AlertLedgerProps {
  alerts: IntelligenceAlert[]
  now: Date
}

function age(timestamp: Date, now: Date): string {
  const minutes = Math.max(1, Math.floor((now.getTime() - timestamp.getTime()) / 60_000))
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`
}

export function AlertLedger({ alerts, now }: AlertLedgerProps) {
  return (
    <Panel
      className="alert-ledger"
      eyebrow="PRIORITY DEVIATIONS"
      title="Signal Alerts"
      action={<span className="alert-count">{alerts.length}</span>}
    >
      <div className="alert-overview">
        <div className="alert-overview__icon"><Radar size={18} aria-hidden="true" /></div>
        <div><strong>3 consequential moves</strong><span>detected across the watchspace</span></div>
        <ArrowUpRight size={15} aria-hidden="true" />
      </div>
      <div className="alert-list">
        {alerts.slice(0, 4).map((alert) => {
          const cluster = CLUSTER_MAP.get(alert.cluster)
          return (
            <article className="alert-item" key={alert.id}>
              <div className={`alert-item__severity alert-item__severity--${alert.severity}`}>
                <AlertTriangle size={12} aria-hidden="true" />
                {alert.severity}
              </div>
              <strong>{alert.title}</strong>
              <p>{alert.detail}</p>
              <div className="alert-item__footer">
                <span><i style={{ background: cluster?.color }} />{cluster?.label}</span>
                <time dateTime={alert.timestamp.toISOString()}>{age(alert.timestamp, now)} ago</time>
              </div>
            </article>
          )
        })}
      </div>
    </Panel>
  )
}
