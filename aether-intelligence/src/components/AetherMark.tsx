interface AetherMarkProps {
  compact?: boolean
}

export function AetherMark({ compact = false }: AetherMarkProps) {
  return (
    <div className={`aether-mark${compact ? ' aether-mark--compact' : ''}`} aria-hidden="true">
      <span className="aether-mark__orbit aether-mark__orbit--one" />
      <span className="aether-mark__orbit aether-mark__orbit--two" />
      <span className="aether-mark__core" />
    </div>
  )
}
