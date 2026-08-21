import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { BookOpenText } from 'lucide-react'
import { SOURCE_KIND_LABELS } from '../data/intelligence'
import type { SourceSignal } from '../types'
import { Panel } from './Panel'

interface SourceLedgerProps {
  items: SourceSignal[]
  now: Date
  running: boolean
}

function relativeTime(timestamp: Date, now: Date): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - timestamp.getTime()) / 1_000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`
}

export function SourceLedger({ items, now, running }: SourceLedgerProps) {
  const reduceMotion = useReducedMotion()

  return (
    <Panel
      className="source-ledger"
      eyebrow="CONTINUOUS INGEST"
      title="Source Ledger"
      action={<span className="panel-state"><i className={running ? 'pulse-dot' : ''} />{running ? 'STREAMING' : 'HELD'}</span>}
    >
      <div className="source-ledger__summary">
        <BookOpenText size={15} aria-hidden="true" />
        <span>11 source classes</span>
        <span className="source-ledger__divider" />
        <span>0 external APIs</span>
      </div>
      <div className="ledger-list" aria-live="polite">
        <AnimatePresence initial={false}>
          {items.slice(0, 7).map((item, index) => (
            <motion.article
              className="ledger-item"
              key={item.id}
              initial={reduceMotion ? false : { opacity: 0, height: 0, y: -8 }}
              animate={{ opacity: 1, height: 'auto', y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, height: 0 }}
              transition={{ duration: 0.3 }}
            >
              <div className="ledger-item__rail">
                <span className={`source-icon source-icon--${item.kind}`} aria-hidden="true" />
                {index < 6 ? <i /> : null}
              </div>
              <div className="ledger-item__body">
                <div className="ledger-item__meta">
                  <span>{SOURCE_KIND_LABELS[item.kind]}</span>
                  <time dateTime={item.timestamp.toISOString()}>{relativeTime(item.timestamp, now)} ago</time>
                </div>
                <strong>{item.company}</strong>
                <p>{item.headline}</p>
                <div className="ledger-item__source">
                  <span>{item.source}</span>
                  <span>{item.confidence}% conf.</span>
                </div>
              </div>
            </motion.article>
          ))}
        </AnimatePresence>
      </div>
      <div className="ledger-scanline" aria-hidden="true" />
    </Panel>
  )
}
