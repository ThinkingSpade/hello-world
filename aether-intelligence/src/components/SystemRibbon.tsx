import { CircleCheck, Database, RadioTower, Shield, TimerReset } from 'lucide-react'
import type { SimulationMetrics } from '../types'

interface SystemRibbonProps {
  metrics: SimulationMetrics
  running: boolean
}

function formatUptime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function SystemRibbon({ metrics, running }: SystemRibbonProps) {
  return (
    <div className="system-ribbon">
      <div className="system-ribbon__lead"><RadioTower size={14} aria-hidden="true" /><strong>{running ? 'SWARM RUNNING' : 'SWARM PAUSED'}</strong><span>All systems nominal</span></div>
      <div><Database size={13} aria-hidden="true" /><span>Sources</span><strong>11 / 11</strong></div>
      <div><Shield size={13} aria-hidden="true" /><span>Evidence gate</span><strong>4-way</strong></div>
      <div><CircleCheck size={13} aria-hidden="true" /><span>Resolver precision</span><strong>98.4%</strong></div>
      <div><TimerReset size={13} aria-hidden="true" /><span>Uptime</span><strong>{formatUptime(metrics.uptimeSeconds)}</strong></div>
      <div className="system-ribbon__trace" aria-hidden="true"><span /><span /><span /><span /><span /><span /><span /><span /></div>
    </div>
  )
}
