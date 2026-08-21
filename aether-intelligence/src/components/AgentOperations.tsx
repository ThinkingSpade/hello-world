import { Bot, CheckCircle2, CircleDotDashed, ShieldCheck, Sparkles } from 'lucide-react'
import type { SimulationMetrics } from '../types'
import { Panel } from './Panel'

const AGENTS = [
  { id: 'R-17', name: 'Scout', role: 'Source discovery', task: 'Scanning launch notes', state: 'working', color: '#246bfe' },
  { id: 'E-04', name: 'Resolver', role: 'Entity identity', task: 'Merging Northstar aliases', state: 'working', color: '#24a9c7' },
  { id: 'L-22', name: 'Cartographer', role: 'Relationship linking', task: 'Testing investor bridge', state: 'working', color: '#7047eb' },
  { id: 'V-09', name: 'Verifier', role: 'Evidence quality', task: 'Cross-checking SEC filing', state: 'verified', color: '#20a875' },
  { id: 'S-31', name: 'Sentinel', role: 'Deviation detection', task: 'Watching pricing delta', state: 'working', color: '#f20a68' },
]

interface AgentOperationsProps {
  metrics: SimulationMetrics
  running: boolean
}

export function AgentOperations({ metrics, running }: AgentOperationsProps) {
  const uptimeHours = Math.floor(metrics.uptimeSeconds / 3_600)
  const uptimeMinutes = Math.floor((metrics.uptimeSeconds % 3_600) / 60)
  const matrix = Array.from({ length: 120 }, (_, index) => metrics.heatmap[index % metrics.heatmap.length] + ((index * 11) % 17) - 8)

  return (
    <div className="operations-grid">
      <Panel
        className="agent-operations"
        eyebrow="AUTONOMOUS WORKFORCE"
        title="Agent Operations"
        action={<span className="panel-state"><i className={running ? 'pulse-dot' : ''} />{metrics.agents} ONLINE</span>}
      >
        <div className="agent-roster">
          {AGENTS.map((agent, index) => (
            <article className="agent-row" key={agent.id}>
              <div className="agent-row__avatar" style={{ '--agent-color': agent.color } as React.CSSProperties}>
                {index === 3 ? <ShieldCheck size={14} aria-hidden="true" /> : index === 4 ? <Sparkles size={14} aria-hidden="true" /> : <Bot size={14} aria-hidden="true" />}
              </div>
              <div className="agent-row__identity"><strong>{agent.name}</strong><span>{agent.id} · {agent.role}</span></div>
              <div className="agent-row__task"><span>{agent.task}</span><div><i /></div></div>
              <div className={`agent-row__state agent-row__state--${agent.state}`}>
                {agent.state === 'verified' ? <CheckCircle2 size={12} aria-hidden="true" /> : <CircleDotDashed size={12} aria-hidden="true" />}
                {agent.state}
              </div>
            </article>
          ))}
        </div>
      </Panel>

      <Panel className="run-matrix" eyebrow="SWARM RUN WALL" title="Activity Matrix" action={<span className="matrix-uptime">UP {uptimeHours}H {uptimeMinutes}M</span>}>
        <div className={`run-matrix__cells${running ? ' run-matrix__cells--running' : ''}`} aria-label="Recent agent run outcomes">
          {matrix.map((value, index) => (
            <span
              key={index}
              className={value > 84 ? 'run-cell run-cell--linked' : value < 30 ? 'run-cell run-cell--deviation' : 'run-cell'}
              style={{ animationDelay: `${(index % 12) * 70}ms` }}
              title={value > 84 ? 'Relationship linked' : value < 30 ? 'Deviation reviewed' : 'Agent run complete'}
            />
          ))}
        </div>
        <div className="matrix-legend"><span><i className="legend-complete" />Complete</span><span><i className="legend-linked" />Linked</span><span><i className="legend-deviation" />Reviewed</span></div>
        <div className="matrix-summary">
          <div><span>Runs today</span><strong>18,402</strong></div>
          <div><span>Accepted</span><strong>97.8%</strong></div>
          <div><span>P95 latency</span><strong>1.2s</strong></div>
        </div>
      </Panel>
    </div>
  )
}
