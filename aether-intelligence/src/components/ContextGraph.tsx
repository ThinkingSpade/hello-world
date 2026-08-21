import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { forceX, forceY } from 'd3-force'
import { Crosshair, Focus, Maximize2, Minus, Network, Plus, RotateCcw, X } from 'lucide-react'
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject as ForceGraphLinkObject,
  type NodeObject as ForceGraphNodeObject,
} from 'react-force-graph-2d'
import { CLUSTERS, CLUSTER_MAP } from '../data/intelligence'
import { useElementSize } from '../hooks/useElementSize'
import type { ClusterId, GraphState, IntelLink, IntelNode, SimulationMetrics, Theme } from '../types'
import { Panel } from './Panel'

interface ContextGraphProps {
  graph: GraphState
  metrics: SimulationMetrics
  running: boolean
  selectedNodeId: string | null
  theme: Theme
  onSelectNode: (nodeId: string | null) => void
}

function linkNodeId(value: string | IntelNode): string {
  return typeof value === 'string' ? value : value.id
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath()
  context.roundRect(x, y, width, height, radius)
}

export default function ContextGraph({ graph, metrics, running, selectedNodeId, theme, onSelectNode }: ContextGraphProps) {
  const graphRef = useRef<ForceGraphMethods<ForceGraphNodeObject<IntelNode>, ForceGraphLinkObject<IntelNode, IntelLink>> | undefined>(undefined)
  const [containerRef, size] = useElementSize<HTMLDivElement>()
  const [activeCluster, setActiveCluster] = useState<ClusterId | 'all'>('all')
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const reduceMotion = useReducedMotion()

  const visibleGraph = useMemo<GraphState>(() => {
    if (activeCluster === 'all') return graph
    const nodes = graph.nodes.filter((node) => node.cluster === activeCluster)
    const nodeIds = new Set(nodes.map((node) => node.id))
    const links = graph.links.filter((link) => nodeIds.has(linkNodeId(link.source)) && nodeIds.has(linkNodeId(link.target)))
    return { nodes, links }
  }, [activeCluster, graph])

  const connectedIds = useMemo(() => {
    const focusId = hoveredNodeId ?? selectedNodeId
    const ids = new Set<string>()
    if (!focusId) return ids
    ids.add(focusId)
    visibleGraph.links.forEach((link) => {
      const source = linkNodeId(link.source)
      const target = linkNodeId(link.target)
      if (source === focusId) ids.add(target)
      if (target === focusId) ids.add(source)
    })
    return ids
  }, [hoveredNodeId, selectedNodeId, visibleGraph.links])

  const selectedNode = useMemo(
    () => graph.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [graph.nodes, selectedNodeId],
  )

  const selectedRelationships = useMemo(() => {
    if (!selectedNode) return 0
    return graph.links.reduce((count, link) => {
      return count + (linkNodeId(link.source) === selectedNode.id || linkNodeId(link.target) === selectedNode.id ? 1 : 0)
    }, 0)
  }, [graph.links, selectedNode])

  useEffect(() => {
    const instance = graphRef.current
    if (!instance) return
    const xForce = forceX<IntelNode>((node) => CLUSTER_MAP.get(node.cluster)?.anchor.x ?? 0).strength(activeCluster === 'all' ? 0.055 : 0.02)
    const yForce = forceY<IntelNode>((node) => CLUSTER_MAP.get(node.cluster)?.anchor.y ?? 0).strength(activeCluster === 'all' ? 0.055 : 0.02)
    instance.d3Force('cluster-x', xForce)
    instance.d3Force('cluster-y', yForce)
    const charge = instance.d3Force('charge')
    if (charge && 'strength' in charge && typeof charge.strength === 'function') charge.strength(-78)
    const linkForce = instance.d3Force('link')
    if (linkForce && 'distance' in linkForce && typeof linkForce.distance === 'function') {
      linkForce.distance((link: IntelLink) => link.crossCluster ? 112 : link.pulse ? 47 : 38)
    }
    instance.d3ReheatSimulation()
    const timeout = window.setTimeout(() => instance.zoomToFit(650, 62), 120)
    return () => window.clearTimeout(timeout)
  }, [activeCluster, size.width])

  useEffect(() => {
    const instance = graphRef.current
    if (!instance) return
    if (running && !reduceMotion) {
      instance.resumeAnimation()
      instance.d3ReheatSimulation()
    } else {
      instance.pauseAnimation()
    }
  }, [reduceMotion, running])

  useEffect(() => {
    if (!running || reduceMotion) return
    graphRef.current?.d3ReheatSimulation()
  }, [graph.nodes.length, reduceMotion, running])

  const drawNode = useCallback((node: IntelNode, context: CanvasRenderingContext2D, globalScale: number) => {
    const isSelected = node.id === selectedNodeId
    const isHovered = node.id === hoveredNodeId
    const hasFocus = connectedIds.size > 0
    const isConnected = connectedIds.has(node.id)
    const faded = hasFocus && !isConnected
    const radius = node.size * (isSelected ? 1.38 : isHovered ? 1.2 : 1)
    const alpha = faded ? 0.14 : 1

    context.save()
    context.globalAlpha = alpha

    if (node.isHub || isSelected || isHovered) {
      const gradient = context.createRadialGradient(node.x ?? 0, node.y ?? 0, radius * 0.4, node.x ?? 0, node.y ?? 0, radius * 3.8)
      gradient.addColorStop(0, `${node.color}66`)
      gradient.addColorStop(1, `${node.color}00`)
      context.fillStyle = gradient
      context.beginPath()
      context.arc(node.x ?? 0, node.y ?? 0, radius * 3.8, 0, Math.PI * 2)
      context.fill()
    }

    context.fillStyle = theme === 'dark' ? '#090c12' : '#fbfaf5'
    context.strokeStyle = node.color
    context.lineWidth = (isSelected ? 2.3 : node.isHub ? 1.8 : 1.2) / globalScale
    context.beginPath()
    context.arc(node.x ?? 0, node.y ?? 0, radius, 0, Math.PI * 2)
    context.fill()
    context.stroke()

    context.fillStyle = node.color
    context.beginPath()
    context.arc(node.x ?? 0, node.y ?? 0, radius * (node.isHub ? 0.48 : 0.58), 0, Math.PI * 2)
    context.fill()

    if (node.isEphemeral) {
      context.strokeStyle = node.color
      context.globalAlpha = alpha * 0.55
      context.lineWidth = 0.8 / globalScale
      context.beginPath()
      context.arc(node.x ?? 0, node.y ?? 0, radius * 1.65, 0, Math.PI * 2)
      context.stroke()
      context.globalAlpha = alpha
    }

    const shouldLabel = node.isHub || isSelected || isHovered || globalScale > 2.25
    if (shouldLabel) {
      const fontSize = Math.max(7.5 / globalScale, node.isHub ? 9.5 : 8.2)
      context.font = `${node.isHub ? 650 : 560} ${fontSize}px "JetBrains Mono Variable", monospace`
      const textWidth = context.measureText(node.label).width
      const padX = 4.5
      const labelX = (node.x ?? 0) + radius + 4
      const labelY = (node.y ?? 0) - fontSize * 0.62
      context.fillStyle = theme === 'dark' ? 'rgba(7,9,14,.88)' : 'rgba(251,250,245,.9)'
      context.strokeStyle = theme === 'dark' ? 'rgba(255,255,255,.13)' : 'rgba(20,24,22,.2)'
      context.lineWidth = 0.7 / globalScale
      roundedRect(context, labelX, labelY, textWidth + padX * 2, fontSize + 5, 2.5)
      context.fill()
      context.stroke()
      context.fillStyle = theme === 'dark' ? '#f5f7fb' : '#151816'
      context.textBaseline = 'middle'
      context.fillText(node.label, labelX + padX, labelY + (fontSize + 5) / 2)
    }

    context.restore()
  }, [connectedIds, hoveredNodeId, selectedNodeId, theme])

  const paintPointerArea = useCallback((node: IntelNode, color: string, context: CanvasRenderingContext2D) => {
    context.fillStyle = color
    context.beginPath()
    context.arc(node.x ?? 0, node.y ?? 0, Math.max(8, node.size * 1.8), 0, Math.PI * 2)
    context.fill()
  }, [])

  const focusNode = useCallback((node: IntelNode) => {
    onSelectNode(node.id)
    if (typeof node.x !== 'number' || typeof node.y !== 'number') return
    graphRef.current?.centerAt(node.x, node.y, reduceMotion ? 0 : 550)
    graphRef.current?.zoom(2.5, reduceMotion ? 0 : 550)
  }, [onSelectNode, reduceMotion])

  const fitGraph = useCallback(() => graphRef.current?.zoomToFit(reduceMotion ? 0 : 650, 62), [reduceMotion])
  const zoomBy = useCallback((factor: number) => {
    const current = graphRef.current?.zoom() ?? 1
    graphRef.current?.zoom(current * factor, reduceMotion ? 0 : 260)
  }, [reduceMotion])

  const graphBackground = theme === 'dark' ? '#06080d' : '#f9f8f2'
  const baseLink = theme === 'dark' ? 'rgba(134,151,184,.18)' : 'rgba(43,60,83,.16)'

  return (
    <Panel
      className="context-graph"
      eyebrow="LIVING KNOWLEDGE GRAPH"
      title="Competitive Context Graph"
      action={<span className="graph-phase"><i className={running ? 'pulse-dot' : ''} />{running ? 'LINKING' : 'HELD'}</span>}
    >
      <div className="graph-toolbar">
        <div className="cluster-filters" role="group" aria-label="Filter graph by intelligence cluster">
          <button className={activeCluster === 'all' ? 'is-active' : ''} type="button" onClick={() => setActiveCluster('all')}>All domains</button>
          {CLUSTERS.map((cluster) => (
            <button className={activeCluster === cluster.id ? 'is-active' : ''} type="button" onClick={() => setActiveCluster(cluster.id)} key={cluster.id}>
              <i style={{ background: cluster.color }} />{cluster.shortLabel}
            </button>
          ))}
        </div>
        <div className="graph-controls" role="group" aria-label="Graph view controls">
          <button type="button" onClick={() => zoomBy(1.3)} aria-label="Zoom in"><Plus size={14} aria-hidden="true" /></button>
          <button type="button" onClick={() => zoomBy(0.77)} aria-label="Zoom out"><Minus size={14} aria-hidden="true" /></button>
          <button type="button" onClick={fitGraph} aria-label="Fit graph to view"><Maximize2 size={14} aria-hidden="true" /></button>
          <button type="button" onClick={() => { setActiveCluster('all'); onSelectNode(null); fitGraph() }} aria-label="Reset graph"><RotateCcw size={14} aria-hidden="true" /></button>
        </div>
      </div>

      <div className="graph-stage" ref={containerRef}>
        <div className="graph-stage__grid" aria-hidden="true" />
        {size.width > 0 && size.height > 0 ? (
          <ForceGraph2D<IntelNode, IntelLink>
            ref={graphRef}
            width={size.width}
            height={size.height}
            graphData={visibleGraph}
            backgroundColor={graphBackground}
            nodeRelSize={1}
            nodeVal={(node) => node.size}
            nodeCanvasObject={drawNode}
            nodePointerAreaPaint={paintPointerArea}
            nodeLabel={(node) => `${node.kind} · ${node.confidence}% confidence`}
            linkLabel={(link) => link.relation}
            linkColor={(link) => {
              const source = linkNodeId(link.source)
              const target = linkNodeId(link.target)
              const focused = connectedIds.has(source) && connectedIds.has(target)
              if (connectedIds.size > 0 && !focused) return theme === 'dark' ? 'rgba(104,116,142,.045)' : 'rgba(43,60,83,.045)'
              if (focused) return `${CLUSTER_MAP.get((typeof link.source === 'string' ? graph.nodes.find((node) => node.id === source)?.cluster : link.source.cluster) ?? 'signals')?.color ?? '#246bfe'}aa`
              return link.crossCluster ? (theme === 'dark' ? 'rgba(140,152,184,.28)' : 'rgba(43,60,83,.23)') : baseLink
            }}
            linkWidth={(link) => link.crossCluster ? 0.9 : link.pulse ? 0.75 : 0.45}
            linkCurvature={(link) => link.crossCluster ? 0.08 : 0}
            linkDirectionalParticles={(link) => running && !reduceMotion && link.pulse ? 1 : 0}
            linkDirectionalParticleColor={(link) => {
              const source = typeof link.source === 'string' ? graph.nodes.find((node) => node.id === link.source) : link.source
              return source?.color ?? '#246bfe'
            }}
            linkDirectionalParticleWidth={1.7}
            linkDirectionalParticleSpeed={(link) => 0.0035 + link.strength * 0.003}
            d3AlphaDecay={0.018}
            d3VelocityDecay={0.34}
            warmupTicks={80}
            cooldownTicks={running && !reduceMotion ? Infinity : 120}
            minZoom={0.55}
            maxZoom={8}
            enableNodeDrag
            enablePanInteraction
            enableZoomInteraction
            onNodeHover={(node) => setHoveredNodeId(node?.id ?? null)}
            onNodeClick={focusNode}
            onBackgroundClick={() => onSelectNode(null)}
          />
        ) : null}

        <div className="graph-cluster-key" aria-hidden="true">
          {CLUSTERS.map((cluster) => (
            <span key={cluster.id}><i style={{ background: cluster.color }} />{cluster.label}</span>
          ))}
        </div>

        <div className="graph-hint"><Crosshair size={12} aria-hidden="true" /> Drag nodes · scroll to zoom · select to inspect</div>

        <AnimatePresence>
          {selectedNode ? (
            <motion.aside
              className="node-inspector"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12 }}
              transition={{ duration: 0.24 }}
            >
              <button type="button" onClick={() => onSelectNode(null)} aria-label="Close node details"><X size={13} aria-hidden="true" /></button>
              <div className="node-inspector__topline">
                <span style={{ color: selectedNode.color }}><i style={{ background: selectedNode.color }} />{CLUSTER_MAP.get(selectedNode.cluster)?.label}</span>
                <span>{selectedNode.kind}</span>
              </div>
              <h3>{selectedNode.label}</h3>
              <p>{selectedNode.summary}</p>
              <div className="node-inspector__metrics">
                <div><strong>{selectedNode.confidence}%</strong><span>confidence</span></div>
                <div><strong>{selectedNode.sourceCount}</strong><span>sources</span></div>
                <div><strong>{selectedRelationships}</strong><span>links</span></div>
              </div>
              <div className="node-inspector__momentum"><span>Signal momentum</span><strong>{selectedNode.momentum}/100</strong><i><b style={{ width: `${selectedNode.momentum}%`, background: selectedNode.color }} /></i></div>
              <button className="node-inspector__focus" type="button" onClick={() => focusNode(selectedNode)}><Focus size={12} aria-hidden="true" />Focus neighborhood</button>
            </motion.aside>
          ) : null}
        </AnimatePresence>
      </div>

      <div className="graph-stats">
        <div><span>Entities</span><strong>{metrics.graphNodes.toLocaleString()}</strong><i>+{metrics.graphNodes % 47}</i></div>
        <div><span>Relationships</span><strong>{metrics.graphEdges.toLocaleString()}</strong><i>+{metrics.graphEdges % 83}</i></div>
        <div><span>Active Agents</span><strong>{metrics.agents}</strong><i>distributed</i></div>
        <div><span>Graph Density</span><strong>{metrics.density.toFixed(2)}%</strong><i>healthy</i></div>
        <div><span>Bridges</span><strong>{metrics.bridges}</strong><i>cross-domain</i></div>
        <div><span>Mode</span><strong><Network size={13} aria-hidden="true" /> FORCE</strong><i>canvas 2D</i></div>
      </div>
    </Panel>
  )
}
