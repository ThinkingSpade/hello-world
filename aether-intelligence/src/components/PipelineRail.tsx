import { BrainCircuit, DatabaseZap, Network, ScanSearch, ShieldCheck, Waypoints } from 'lucide-react'

const STAGES = [
  { label: 'Acquire', detail: '11 sources', Icon: ScanSearch },
  { label: 'Normalize', detail: 'Schema v4', Icon: DatabaseZap },
  { label: 'Resolve', detail: '98.4% match', Icon: Waypoints },
  { label: 'Reason', detail: '124 agents', Icon: BrainCircuit },
  { label: 'Link', detail: '7 bridges', Icon: Network },
  { label: 'Verify', detail: '4-source gate', Icon: ShieldCheck },
]

interface PipelineRailProps {
  activeStage: number
  running: boolean
}

export function PipelineRail({ activeStage, running }: PipelineRailProps) {
  return (
    <section className="pipeline-rail" aria-label="Intelligence inference pipeline">
      <div className="pipeline-rail__title">
        <span>INFERENCE PIPELINE</span>
        <strong>{running ? `Stage ${String(activeStage + 1).padStart(2, '0')} / 06` : 'Simulation held'}</strong>
      </div>
      <div className="pipeline-stages">
        {STAGES.map(({ label, detail, Icon }, index) => {
          const isActive = running && index === activeStage
          const isComplete = index < activeStage
          return (
            <div className={`pipeline-stage${isActive ? ' pipeline-stage--active' : ''}${isComplete ? ' pipeline-stage--complete' : ''}`} key={label}>
              <div className="pipeline-stage__index">{String(index + 1).padStart(2, '0')}</div>
              <Icon size={14} aria-hidden="true" />
              <div>
                <strong>{label}</strong>
                <span>{detail}</span>
              </div>
              {index < STAGES.length - 1 ? <span className="pipeline-stage__connector" aria-hidden="true" /> : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}
