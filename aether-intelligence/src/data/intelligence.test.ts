import { describe, expect, it } from 'vitest'
import { buildInitialGraph, createEphemeralGraphEvent, createSourceSignal } from './intelligence'

describe('intelligence simulation fixtures', () => {
  it('builds a deterministic, connected graph with unique identifiers', () => {
    const first = buildInitialGraph(42)
    const second = buildInitialGraph(42)

    expect(first).toEqual(second)
    expect(first.nodes.length).toBeGreaterThan(40)
    expect(first.links.length).toBeGreaterThan(first.nodes.length)
    expect(new Set(first.nodes.map((node) => node.id)).size).toBe(first.nodes.length)
    expect(new Set(first.links.map((link) => link.id)).size).toBe(first.links.length)
  })

  it('keeps the live graph bounded during long simulations', () => {
    let graph = buildInitialGraph(8)
    for (let tick = 5; tick <= 1_000; tick += 5) {
      graph = createEphemeralGraphEvent(graph, tick)
    }

    expect(graph.nodes.length).toBeLessThan(60)
    expect(graph.links.length).toBeLessThan(120)
  })

  it('cycles through realistic source types without external data', () => {
    const items = Array.from({ length: 16 }, (_, index) => createSourceSignal(index))
    expect(new Set(items.map((item) => item.kind)).size).toBeGreaterThanOrEqual(7)
    expect(items.every((item) => item.confidence >= 75 && item.confidence <= 100)).toBe(true)
  })
})
