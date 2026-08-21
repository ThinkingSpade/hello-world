import type { LinkObject, NodeObject } from 'react-force-graph-2d'

export type Theme = 'light' | 'dark'

export type ClusterId =
  | 'competitors'
  | 'products'
  | 'people'
  | 'funding'
  | 'technology'
  | 'signals'

export type SignalKind =
  | 'release'
  | 'hiring'
  | 'funding'
  | 'patent'
  | 'review'
  | 'pricing'
  | 'stack'
  | 'market'

export interface ClusterDefinition {
  id: ClusterId
  label: string
  shortLabel: string
  color: string
  lightColor: string
  anchor: { x: number; y: number }
}

export interface IntelNode extends NodeObject {
  id: string
  label: string
  cluster: ClusterId
  kind: string
  summary: string
  confidence: number
  momentum: number
  sourceCount: number
  size: number
  color: string
  isHub?: boolean
  isEphemeral?: boolean
  createdAt?: number
}

export interface IntelLink extends LinkObject<IntelNode> {
  id: string
  source: string | IntelNode
  target: string | IntelNode
  relation: string
  strength: number
  pulse?: boolean
  crossCluster?: boolean
  createdAt?: number
}

export interface GraphState {
  nodes: IntelNode[]
  links: IntelLink[]
}

export interface SourceSignal {
  id: string
  kind: SignalKind
  source: string
  company: string
  headline: string
  timestamp: Date
  confidence: number
}

export interface IntelligenceAlert {
  id: string
  severity: 'critical' | 'high' | 'medium'
  title: string
  detail: string
  timestamp: Date
  cluster: ClusterId
}

export interface AetherToast {
  id: string
  title: string
  detail: string
  tone: 'info' | 'positive' | 'warning'
}

export interface FlowMetric {
  id: ClusterId
  label: string
  value: number
  delta: number
  color: string
}

export interface SimulationMetrics {
  agents: number
  signalsPerSecond: number
  graphNodes: number
  graphEdges: number
  entityMatches: number
  density: number
  bridges: number
  sourceCoverage: number
  activeStage: number
  signalHistory: number[]
  heatmap: number[]
  flows: FlowMetric[]
  uptimeSeconds: number
}

export interface SimulationState {
  graph: GraphState
  metrics: SimulationMetrics
  ledger: SourceSignal[]
  alerts: IntelligenceAlert[]
  toasts: AetherToast[]
  selectedNodeId: string | null
  tick: number
}
