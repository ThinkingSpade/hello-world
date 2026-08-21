import type { ReactNode } from 'react'

interface PanelProps {
  children: ReactNode
  className?: string
  title?: string
  eyebrow?: string
  action?: ReactNode
}

export function Panel({ children, className = '', title, eyebrow, action }: PanelProps) {
  return (
    <section className={`panel ${className}`.trim()}>
      {title ? (
        <header className="panel__header">
          <div>
            {eyebrow ? <span className="panel__eyebrow">{eyebrow}</span> : null}
            <h2>{title}</h2>
          </div>
          {action ? <div className="panel__action">{action}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  )
}
