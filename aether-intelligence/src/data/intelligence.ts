import type {
  AetherToast,
  ClusterDefinition,
  ClusterId,
  FlowMetric,
  GraphState,
  IntelLink,
  IntelNode,
  IntelligenceAlert,
  SignalKind,
  SourceSignal,
} from '../types'

export const CLUSTERS: ClusterDefinition[] = [
  { id: 'competitors', label: 'Competitors', shortLabel: 'COMP', color: '#246bfe', lightColor: '#dbe7ff', anchor: { x: -210, y: -130 } },
  { id: 'products', label: 'Products & Features', shortLabel: 'PROD', color: '#f20a68', lightColor: '#ffd9e8', anchor: { x: 205, y: -135 } },
  { id: 'people', label: 'People & Hiring', shortLabel: 'PEOPLE', color: '#7047eb', lightColor: '#e6ddff', anchor: { x: 260, y: 75 } },
  { id: 'funding', label: 'Funding & Investors', shortLabel: 'CAPITAL', color: '#f2a51a', lightColor: '#ffedc7', anchor: { x: 125, y: 190 } },
  { id: 'technology', label: 'Technology Stack', shortLabel: 'TECH', color: '#20a875', lightColor: '#d2f4e6', anchor: { x: -150, y: 190 } },
  { id: 'signals', label: 'Market Signals', shortLabel: 'SIGNALS', color: '#24a9c7', lightColor: '#d4f3f8', anchor: { x: -275, y: 40 } },
]

export const CLUSTER_MAP = new Map(CLUSTERS.map((cluster) => [cluster.id, cluster]))

interface EntitySeed {
  label: string
  kind: string
  summary: string
  confidence?: number
  momentum?: number
  sources?: number
}

const ENTITY_SEEDS: Record<ClusterId, EntitySeed[]> = {
  competitors: [
    { label: 'Competitive field', kind: 'Portfolio', summary: 'Resolved market map across six monitored strategic competitors.', confidence: 99, momentum: 74, sources: 186 },
    { label: 'Northstar AI', kind: 'Company', summary: 'Enterprise agent platform expanding into governed workflow automation.', momentum: 87, sources: 64 },
    { label: 'Axiom Cloud', kind: 'Company', summary: 'Cloud data platform with a new vector-native analytics positioning.', momentum: 78, sources: 51 },
    { label: 'QuantaFlow', kind: 'Company', summary: 'Workflow intelligence vendor moving upmarket after its Series C.', momentum: 91, sources: 47 },
    { label: 'Meridian OS', kind: 'Company', summary: 'Horizontal operations platform increasing AI infrastructure hiring.', momentum: 66, sources: 39 },
    { label: 'Parcel Labs', kind: 'Company', summary: 'Developer-first entrant gaining share through usage-based pricing.', momentum: 82, sources: 42 },
    { label: 'Cinder Data', kind: 'Company', summary: 'Analytics incumbent bundling governance with its core warehouse.', momentum: 59, sources: 31 },
  ],
  products: [
    { label: 'Product surface', kind: 'Capability map', summary: 'Feature overlap, launch velocity, and roadmap adjacency.', confidence: 98, momentum: 83, sources: 143 },
    { label: 'Workflow Agents', kind: 'Product', summary: 'Autonomous task orchestration with human approval checkpoints.', momentum: 94, sources: 32 },
    { label: 'Enterprise Graph', kind: 'Feature', summary: 'Entity-linked context layer for customer data and operations.', momentum: 88, sources: 26 },
    { label: 'Vector Search', kind: 'Feature', summary: 'Hybrid retrieval with semantic filters and citation tracing.', momentum: 63, sources: 34 },
    { label: 'Realtime Analytics', kind: 'Product', summary: 'Sub-second operational dashboards over streaming event data.', momentum: 72, sources: 29 },
    { label: 'Governance Studio', kind: 'Feature', summary: 'Policy gates, audit trails, and explainable automation controls.', momentum: 86, sources: 24 },
    { label: 'Copilot Builder', kind: 'Product', summary: 'Low-code agent composer targeting line-of-business teams.', momentum: 79, sources: 37 },
  ],
  people: [
    { label: 'Talent movement', kind: 'People graph', summary: 'Leadership changes, specialist hiring, and team formation signals.', confidence: 97, momentum: 76, sources: 109 },
    { label: 'Maya Chen', kind: 'VP Product', summary: 'Joined Northstar AI after leading platform strategy at a public cloud vendor.', momentum: 95, sources: 12 },
    { label: 'Eli Navarro', kind: 'Head of AI', summary: 'Building an applied research group focused on agent reliability.', momentum: 84, sources: 9 },
    { label: 'Priya Shah', kind: 'VP Sales', summary: 'Opened twelve enterprise account roles across North America.', momentum: 71, sources: 11 },
    { label: 'Tomas Eriksen', kind: 'Principal Engineer', summary: 'Maintainer of a popular orchestration framework hired by QuantaFlow.', momentum: 89, sources: 8 },
    { label: 'Kira Hall', kind: 'Chief of Staff', summary: 'Driving an integration program following a strategic acquisition.', momentum: 61, sources: 7 },
    { label: 'Jonah Reed', kind: 'Research Director', summary: 'Published new work on long-context entity memory systems.', momentum: 77, sources: 10 },
  ],
  funding: [
    { label: 'Capital network', kind: 'Funding graph', summary: 'Rounds, investors, acquisition appetite, and runway indicators.', confidence: 98, momentum: 68, sources: 84 },
    { label: 'Series D · $180M', kind: 'Funding round', summary: 'Northstar AI raised at a simulated $2.4B post-money valuation.', momentum: 96, sources: 18 },
    { label: 'Horizon Ventures', kind: 'Investor', summary: 'Lead investor with a concentrated enterprise software portfolio.', momentum: 73, sources: 16 },
    { label: 'Northwind Capital', kind: 'Investor', summary: 'Growth investor increasing exposure to AI infrastructure.', momentum: 69, sources: 14 },
    { label: 'Growth Round · $75M', kind: 'Funding round', summary: 'QuantaFlow extended runway while expanding internationally.', momentum: 81, sources: 15 },
    { label: 'Strategic M&A', kind: 'Transaction', summary: 'Two adjacent workflow vendors entered early diligence.', momentum: 58, sources: 12 },
    { label: 'Secondary Tender', kind: 'Liquidity event', summary: 'Employee liquidity program suggests delayed public-market timing.', momentum: 42, sources: 9 },
  ],
  technology: [
    { label: 'Technical substrate', kind: 'Stack graph', summary: 'Observed infrastructure, frameworks, migrations, and dependencies.', confidence: 96, momentum: 72, sources: 167 },
    { label: 'Rust Services', kind: 'Backend', summary: 'Latency-sensitive ingestion services migrating from Go to Rust.', momentum: 84, sources: 21 },
    { label: 'Kubernetes', kind: 'Infrastructure', summary: 'Multi-region clusters with a growing platform engineering footprint.', momentum: 53, sources: 28 },
    { label: 'ClickHouse', kind: 'Data', summary: 'Columnar event analytics appears across postings and release notes.', momentum: 78, sources: 19 },
    { label: 'pgvector', kind: 'Data', summary: 'Vector retrieval layer used for early product search workloads.', momentum: 61, sources: 17 },
    { label: 'React 19', kind: 'Frontend', summary: 'Customer console is adopting transitions and server components.', momentum: 65, sources: 22 },
    { label: 'GraphQL', kind: 'API', summary: 'Public schema widened around workflow and audit event objects.', momentum: 48, sources: 14 },
    { label: 'Temporal', kind: 'Orchestration', summary: 'Durable execution dependency confirmed by three engineering roles.', momentum: 87, sources: 20 },
  ],
  signals: [
    { label: 'Signal exchange', kind: 'Evidence graph', summary: 'Fresh market evidence flowing from eleven monitored source classes.', confidence: 99, momentum: 91, sources: 214 },
    { label: 'Pricing page', kind: 'Web change', summary: 'Enterprise plan packaging changed from seat-based to hybrid usage.', momentum: 92, sources: 18 },
    { label: 'G2 sentiment', kind: 'Customer voice', summary: 'Implementation-speed sentiment improved while admin complaints rose.', momentum: 73, sources: 46 },
    { label: 'Patent US-2417', kind: 'Patent', summary: 'Entity-memory claims overlap with emerging product messaging.', momentum: 64, sources: 13 },
    { label: 'EU data region', kind: 'Launch', summary: 'New Frankfurt region lowers a recurring enterprise procurement barrier.', momentum: 86, sources: 23 },
    { label: 'Partner program', kind: 'Ecosystem', summary: 'Systems-integrator incentives expanded across three service tiers.', momentum: 71, sources: 21 },
    { label: 'Release v4.8', kind: 'Code release', summary: 'Introduced event replay, policy gates, and new audit endpoints.', momentum: 89, sources: 27 },
    { label: 'SOC 2 scope', kind: 'Compliance', summary: 'Scope expanded to include the hosted agent execution environment.', momentum: 56, sources: 16 },
  ],
}

const CROSS_LINKS: Array<[string, string, string, number]> = [
  ['competitors-1', 'products-1', 'launches', 0.96],
  ['competitors-1', 'funding-1', 'capitalized by', 0.93],
  ['competitors-1', 'people-1', 'hired', 0.91],
  ['competitors-2', 'products-2', 'bundles', 0.84],
  ['competitors-2', 'technology-3', 'runs on', 0.74],
  ['competitors-3', 'funding-4', 'raised', 0.89],
  ['competitors-3', 'people-4', 'recruited', 0.86],
  ['competitors-4', 'technology-6', 'exposes', 0.68],
  ['competitors-5', 'signals-1', 'changed', 0.94],
  ['competitors-5', 'products-6', 'positions against', 0.77],
  ['products-1', 'technology-7', 'orchestrated by', 0.92],
  ['products-2', 'signals-2', 'reviewed in', 0.76],
  ['products-4', 'technology-2', 'queries', 0.88],
  ['products-5', 'signals-6', 'released as', 0.93],
  ['people-2', 'products-5', 'owns roadmap', 0.85],
  ['people-5', 'signals-3', 'cited by', 0.66],
  ['funding-2', 'competitors-1', 'board observer', 0.81],
  ['funding-3', 'technology-0', 'thesis exposure', 0.58],
  ['signals-4', 'products-0', 'expands market', 0.88],
  ['signals-7', 'technology-0', 'validates', 0.82],
]

export function mulberry32(seed: number): () => number {
  return () => {
    let value = (seed += 0x6d2b79f5)
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function buildInitialGraph(seed = 4937): GraphState {
  const random = mulberry32(seed)
  const nodes: IntelNode[] = []
  const links: IntelLink[] = []

  for (const cluster of CLUSTERS) {
    const entities = ENTITY_SEEDS[cluster.id]
    entities.forEach((entity, index) => {
      const angle = index === 0 ? 0 : (index / Math.max(1, entities.length - 1)) * Math.PI * 2 + random() * 0.35
      const radius = index === 0 ? 0 : 48 + random() * 52
      nodes.push({
        id: `${cluster.id}-${index}`,
        label: entity.label,
        cluster: cluster.id,
        kind: entity.kind,
        summary: entity.summary,
        confidence: entity.confidence ?? Math.round(82 + random() * 16),
        momentum: entity.momentum ?? Math.round(45 + random() * 50),
        sourceCount: entity.sources ?? Math.round(8 + random() * 38),
        size: index === 0 ? 9 : 4.2 + random() * 2.8,
        color: cluster.color,
        isHub: index === 0,
        x: cluster.anchor.x + Math.cos(angle) * radius,
        y: cluster.anchor.y + Math.sin(angle) * radius,
      })

      if (index > 0) {
        links.push({
          id: `${cluster.id}-hub-${index}`,
          source: `${cluster.id}-0`,
          target: `${cluster.id}-${index}`,
          relation: index % 2 === 0 ? 'corroborates' : 'belongs to',
          strength: 0.72 + random() * 0.25,
          pulse: index % 3 === 0,
        })
        if (index > 1) {
          links.push({
            id: `${cluster.id}-ring-${index}`,
            source: `${cluster.id}-${index - 1}`,
            target: `${cluster.id}-${index}`,
            relation: 'adjacent signal',
            strength: 0.44 + random() * 0.25,
          })
        }
      }
    })
  }

  CROSS_LINKS.forEach(([source, target, relation, strength], index) => {
    links.push({
      id: `bridge-${index}`,
      source,
      target,
      relation,
      strength,
      pulse: index % 2 === 0,
      crossCluster: true,
    })
  })

  return { nodes, links }
}

const SOURCE_TEMPLATES: Array<Omit<SourceSignal, 'id' | 'timestamp'>> = [
  { kind: 'release', source: 'GitHub Releases', company: 'Northstar AI', headline: 'v4.8 adds policy gates and event replay', confidence: 96 },
  { kind: 'hiring', source: 'Greenhouse', company: 'Axiom Cloud', headline: 'Staff ML Platform Engineer role opened in London', confidence: 92 },
  { kind: 'pricing', source: 'Web Monitor', company: 'Parcel Labs', headline: 'Enterprise plan moves to hybrid usage pricing', confidence: 98 },
  { kind: 'review', source: 'G2 Reviews', company: 'QuantaFlow', headline: 'Admin sentiment drops as implementation speed rises', confidence: 87 },
  { kind: 'patent', source: 'USPTO', company: 'Meridian OS', headline: 'Entity-memory patent assigned to workflow research team', confidence: 95 },
  { kind: 'funding', source: 'SEC Form D', company: 'Northstar AI', headline: 'New filing corroborates $180M growth round', confidence: 99 },
  { kind: 'stack', source: 'Stack Radar', company: 'Cinder Data', headline: 'ClickHouse appears across three new engineering roles', confidence: 84 },
  { kind: 'market', source: 'Partner Portal', company: 'Axiom Cloud', headline: 'EMEA systems-integrator incentive tier expanded', confidence: 88 },
  { kind: 'hiring', source: 'LinkedIn Jobs', company: 'QuantaFlow', headline: 'Twelve enterprise account roles posted in 48 hours', confidence: 93 },
  { kind: 'release', source: 'Product Changelog', company: 'Parcel Labs', headline: 'EU data residency enters general availability', confidence: 97 },
  { kind: 'review', source: 'Community Forum', company: 'Meridian OS', headline: 'Customers report faster onboarding after console redesign', confidence: 79 },
  { kind: 'market', source: 'Conference Agenda', company: 'Cinder Data', headline: 'CEO keynote shifts positioning toward governed agents', confidence: 82 },
]

const ALERT_TEMPLATES: Array<Omit<IntelligenceAlert, 'id' | 'timestamp'>> = [
  { severity: 'critical', title: 'Pricing architecture changed', detail: 'Parcel Labs replaced seat tiers with a hybrid consumption model.', cluster: 'signals' },
  { severity: 'high', title: 'Feature convergence detected', detail: 'Three competitors now describe an enterprise graph control plane.', cluster: 'products' },
  { severity: 'high', title: 'Key leadership hire', detail: 'Northstar AI appointed a VP Product from a public cloud platform.', cluster: 'people' },
  { severity: 'medium', title: 'Capital signal corroborated', detail: 'A regulatory filing confirms the size and lead of a growth round.', cluster: 'funding' },
  { severity: 'medium', title: 'Stack migration emerging', detail: 'Rust adoption now appears in releases, roles, and contributor activity.', cluster: 'technology' },
]

const TOAST_TEMPLATES: Array<Omit<AetherToast, 'id'>> = [
  { title: 'Entity resolved', detail: '“Northstar Platform” merged with Northstar AI at 98% confidence.', tone: 'positive' },
  { title: 'Competitive overlap detected', detail: 'Governance Studio ↔ Workflow Agents · 4 supporting sources.', tone: 'warning' },
  { title: 'Funding signal linked', detail: 'SEC filing connected to Horizon Ventures and Northstar AI.', tone: 'info' },
  { title: 'New bridge formed', detail: 'Technical hiring now corroborates the observed Rust migration.', tone: 'positive' },
]

export function createSourceSignal(index: number, timestamp = new Date()): SourceSignal {
  const template = SOURCE_TEMPLATES[index % SOURCE_TEMPLATES.length]
  return { ...template, id: `signal-${timestamp.getTime()}-${index}`, timestamp }
}

export function createAlert(index: number, timestamp = new Date()): IntelligenceAlert {
  const template = ALERT_TEMPLATES[index % ALERT_TEMPLATES.length]
  return { ...template, id: `alert-${timestamp.getTime()}-${index}`, timestamp }
}

export function createToast(index: number): AetherToast {
  const template = TOAST_TEMPLATES[index % TOAST_TEMPLATES.length]
  return { ...template, id: `toast-${Date.now()}-${index}` }
}

export function createEphemeralGraphEvent(graph: GraphState, tick: number): GraphState {
  const cluster = CLUSTERS[tick % CLUSTERS.length]
  const candidates = graph.nodes.filter((node) => node.cluster === cluster.id && !node.isEphemeral)
  const target = candidates[(tick * 3) % candidates.length]
  const eventId = `live-${tick}`
  const angle = (tick * 2.399963) % (Math.PI * 2)
  const node: IntelNode = {
    id: eventId,
    label: ['New signal', 'Entity match', 'Fresh source', 'Market event'][tick % 4],
    cluster: cluster.id,
    kind: 'Live intelligence',
    summary: `A newly ingested signal was resolved into ${cluster.label.toLowerCase()} and linked with ${target.label}.`,
    confidence: 84 + (tick % 15),
    momentum: 58 + (tick * 7) % 38,
    sourceCount: 1 + (tick % 5),
    size: 3.8,
    color: cluster.color,
    isEphemeral: true,
    createdAt: tick,
    x: cluster.anchor.x + Math.cos(angle) * 112,
    y: cluster.anchor.y + Math.sin(angle) * 112,
  }
  const link: IntelLink = {
    id: `live-link-${tick}`,
    source: eventId,
    target: target.id,
    relation: 'newly linked',
    strength: 0.86,
    pulse: true,
    createdAt: tick,
  }

  const liveNodes = graph.nodes.filter((item) => !item.isEphemeral || (item.createdAt ?? tick) > tick - 48)
  const liveNodeIds = new Set(liveNodes.map((item) => item.id))
  const liveLinks = graph.links.filter((item) => {
    const sourceId = typeof item.source === 'string' ? item.source : item.source.id
    const targetId = typeof item.target === 'string' ? item.target : item.target.id
    return liveNodeIds.has(sourceId) && liveNodeIds.has(targetId)
  })

  return { nodes: [...liveNodes, node], links: [...liveLinks, link] }
}

export function createInitialLedger(now = new Date()): SourceSignal[] {
  return Array.from({ length: 9 }, (_, index) => createSourceSignal(index, new Date(now.getTime() - index * 43_000)))
}

export function createInitialAlerts(now = new Date()): IntelligenceAlert[] {
  return Array.from({ length: 4 }, (_, index) => createAlert(index, new Date(now.getTime() - index * 167_000)))
}

export function createInitialFlows(): FlowMetric[] {
  return CLUSTERS.map((cluster, index) => ({
    id: cluster.id,
    label: cluster.shortLabel,
    value: 44 + index * 7,
    delta: 2 + (index % 4),
    color: cluster.color,
  }))
}

export const SOURCE_KIND_LABELS: Record<SignalKind, string> = {
  release: 'Release',
  hiring: 'Hiring',
  funding: 'Funding',
  patent: 'Patent',
  review: 'Voice',
  pricing: 'Pricing',
  stack: 'Stack',
  market: 'Market',
}
