import { useCallback, useEffect, useRef, useState } from 'react'
import {
  buildInitialGraph,
  createAlert,
  createEphemeralGraphEvent,
  createInitialAlerts,
  createInitialFlows,
  createInitialLedger,
  createSourceSignal,
  createToast,
  mulberry32,
} from '../data/intelligence'
import type { SimulationMetrics, SimulationState } from '../types'

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function createInitialMetrics(): SimulationMetrics {
  return {
    agents: 112,
    signalsPerSecond: 264,
    graphNodes: 12_842,
    graphEdges: 48_906,
    entityMatches: 7_394,
    density: 88.42,
    bridges: 92,
    sourceCoverage: 94.7,
    activeStage: 3,
    signalHistory: [214, 229, 246, 238, 271, 260, 286, 279, 305, 291, 318, 303, 284, 312, 297, 325, 309, 278, 295, 264],
    heatmap: Array.from({ length: 48 }, (_, index) => 28 + ((index * 37) % 68)),
    flows: createInitialFlows(),
    uptimeSeconds: 14_762,
  }
}

function createInitialState(): SimulationState {
  const now = new Date()
  return {
    graph: buildInitialGraph(),
    metrics: createInitialMetrics(),
    ledger: createInitialLedger(now),
    alerts: createInitialAlerts(now),
    toasts: [],
    selectedNodeId: 'competitors-1',
    tick: 0,
  }
}

export interface AetherSimulationController {
  state: SimulationState
  selectNode: (nodeId: string | null) => void
  dismissToast: (toastId: string) => void
}

export function useAetherSimulation(running: boolean): AetherSimulationController {
  const [state, setState] = useState<SimulationState>(createInitialState)
  const randomRef = useRef(mulberry32(8_204 + new Date().getDate()))

  useEffect(() => {
    if (!running) return

    const interval = window.setInterval(() => {
      setState((current) => {
        const random = randomRef.current
        const tick = current.tick + 1
        const signalDelta = Math.round((random() - 0.48) * 34)
        const agentDelta = random() > 0.68 ? (random() > 0.5 ? 2 : -2) : random() > 0.5 ? 1 : -1
        const densityDip = tick % 37 === 0 ? -0.74 : 0
        const nextRate = clamp(current.metrics.signalsPerSecond + signalDelta, 180, 350)
        const nextHeatmap = current.metrics.heatmap.map((value, index) => {
          const shouldMove = (index + tick) % 4 === 0
          return shouldMove ? Math.round(clamp(value + (random() - 0.43) * 22, 12, 99)) : value
        })
        const nextFlows = current.metrics.flows.map((flow, index) => {
          const change = Math.round((random() - 0.42) * 10)
          return {
            ...flow,
            value: Math.round(clamp(flow.value + change, 28, 96)),
            delta: Math.round(clamp(flow.delta + (index + tick) % 3 - 1, -3, 9)),
          }
        })

        const metrics: SimulationMetrics = {
          ...current.metrics,
          agents: Math.round(clamp(current.metrics.agents + agentDelta, 78, 142)),
          signalsPerSecond: nextRate,
          graphNodes: current.metrics.graphNodes + (tick % 2 === 0 ? 1 + (tick % 3) : 0),
          graphEdges: current.metrics.graphEdges + (tick % 2 === 0 ? 3 + (tick % 5) : 1),
          entityMatches: current.metrics.entityMatches + (tick % 3 === 0 ? 2 : 1),
          density: clamp(current.metrics.density + 0.018 + (random() - 0.5) * 0.08 + densityDip, 84.2, 96.8),
          bridges: current.metrics.bridges + (tick % 11 === 0 ? 1 : 0),
          sourceCoverage: clamp(current.metrics.sourceCoverage + (random() - 0.47) * 0.035, 91.2, 98.8),
          activeStage: tick % 4 === 0 ? (current.metrics.activeStage + 1) % 6 : current.metrics.activeStage,
          signalHistory: [...current.metrics.signalHistory.slice(-27), nextRate],
          heatmap: nextHeatmap,
          flows: nextFlows,
          uptimeSeconds: current.metrics.uptimeSeconds + 1,
        }

        const graph = tick % 5 === 0 ? createEphemeralGraphEvent(current.graph, tick) : current.graph
        const ledger = tick % 2 === 0
          ? [createSourceSignal(tick / 2 + 8), ...current.ledger].slice(0, 14)
          : current.ledger
        const alerts = tick % 11 === 0
          ? [createAlert(Math.floor(tick / 11) + 3), ...current.alerts].slice(0, 5)
          : current.alerts
        const toasts = tick % 7 === 0
          ? [createToast(Math.floor(tick / 7)), ...current.toasts].slice(0, 3)
          : tick % 5 === 0
            ? current.toasts.slice(0, 2)
            : current.toasts

        return { ...current, tick, graph, metrics, ledger, alerts, toasts }
      })
    }, 1_000)

    return () => window.clearInterval(interval)
  }, [running])

  const selectNode = useCallback((nodeId: string | null) => {
    setState((current) => ({ ...current, selectedNodeId: nodeId }))
  }, [])

  const dismissToast = useCallback((toastId: string) => {
    setState((current) => ({
      ...current,
      toasts: current.toasts.filter((toast) => toast.id !== toastId),
    }))
  }, [])

  return { state, selectNode, dismissToast }
}
