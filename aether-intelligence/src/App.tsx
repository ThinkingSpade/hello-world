import { lazy, Suspense, useCallback, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Activity, LoaderCircle } from 'lucide-react'
import { AgentOperations } from './components/AgentOperations'
import { AlertLedger } from './components/AlertLedger'
import { BootSequence } from './components/BootSequence'
import { Header } from './components/Header'
import { PipelineRail } from './components/PipelineRail'
import { SourceLedger } from './components/SourceLedger'
import { SystemRibbon } from './components/SystemRibbon'
import { TelemetryGrid } from './components/TelemetryGrid'
import { ToastStack } from './components/ToastStack'
import { useAetherSimulation } from './hooks/useAetherSimulation'
import { useLiveClock } from './hooks/useLiveClock'
import { useTheme } from './hooks/useTheme'

const ContextGraph = lazy(() => import('./components/ContextGraph'))

function GraphFallback() {
  return (
    <div className="graph-fallback" role="status">
      <div><LoaderCircle size={18} aria-hidden="true" /><span>Warming graph renderer</span></div>
    </div>
  )
}

export default function App() {
  const [running, setRunning] = useState(true)
  const [booting, setBooting] = useState(true)
  const now = useLiveClock()
  const { theme, toggleTheme } = useTheme()
  const { state, selectNode, dismissToast } = useAetherSimulation(running && !booting)

  const toggleRunning = useCallback(() => setRunning((current) => !current), [])
  const completeBoot = useCallback(() => setBooting(false), [])

  return (
    <div className={`app-shell${running ? ' is-running' : ' is-paused'}`}>
      <AnimatePresence>{booting ? <BootSequence onComplete={completeBoot} /> : null}</AnimatePresence>
      <Header
        agents={state.metrics.agents}
        now={now}
        running={running}
        theme={theme}
        onToggleRunning={toggleRunning}
        onToggleTheme={toggleTheme}
      />
      <main className="dashboard">
        <SystemRibbon metrics={state.metrics} running={running} />
        <PipelineRail activeStage={state.metrics.activeStage} running={running} />

        <div className="primary-grid">
          <Suspense fallback={<GraphFallback />}>
            <ContextGraph
              graph={state.graph}
              metrics={state.metrics}
              running={running}
              selectedNodeId={state.selectedNodeId}
              theme={theme}
              onSelectNode={selectNode}
            />
          </Suspense>
          <div className="intelligence-rail">
            <SourceLedger items={state.ledger} now={now} running={running} />
            <AlertLedger alerts={state.alerts} now={now} />
          </div>
        </div>

        <TelemetryGrid metrics={state.metrics} running={running} />
        <AgentOperations metrics={state.metrics} running={running} />

        <footer className="dashboard-footer">
          <div><Activity size={13} aria-hidden="true" /><strong>AETHER LABS</strong><span>High-fidelity portfolio simulation</span></div>
          <p>All companies, events, metrics, and agent activity shown here are synthetic. No external APIs, tracking, or AI services are used.</p>
          <span>SIMULATION ENGINE v1.0.0</span>
        </footer>
      </main>
      <ToastStack toasts={state.toasts} onDismiss={dismissToast} />
      <AnimatePresence>
        {!running && !booting ? (
          <motion.div className="paused-banner" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
            <span />Simulation paused — the browser clock remains live
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
