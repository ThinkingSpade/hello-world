import { Activity, Clock3, Moon, Pause, Play, Sun } from 'lucide-react'
import type { Theme } from '../types'
import { AetherMark } from './AetherMark'

interface HeaderProps {
  agents: number
  now: Date
  running: boolean
  theme: Theme
  onToggleRunning: () => void
  onToggleTheme: () => void
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: '2-digit',
  year: 'numeric',
})

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

export function Header({ agents, now, running, theme, onToggleRunning, onToggleTheme }: HeaderProps) {
  return (
    <header className="top-header">
      <div className="brand-lockup">
        <AetherMark compact />
        <div>
          <div className="brand-lockup__name">Aether Intelligence</div>
          <div className="brand-lockup__tagline">Competitive Intelligence Swarm</div>
        </div>
      </div>

      <div className="header-context" aria-label="Active intelligence program">
        <span className="header-context__label">WATCHSPACE</span>
        <span className="header-context__value">Enterprise AI · North America</span>
      </div>

      <div className="header-status">
        <div className="clock-block" title={dateFormatter.format(now)}>
          <Clock3 size={14} aria-hidden="true" />
          <span className="clock-block__date">{dateFormatter.format(now)}</span>
          <time dateTime={now.toISOString()}>{timeFormatter.format(now)}</time>
        </div>
        <div className="agents-block" aria-label={`${agents} agents active`}>
          <Activity size={14} aria-hidden="true" />
          <span><strong>{agents}</strong> agents</span>
        </div>
        <div className={`live-badge${running ? '' : ' live-badge--paused'}`}>
          <span aria-hidden="true" />
          {running ? 'LIVE' : 'PAUSED'}
        </div>
        <button className="icon-button icon-button--wide" type="button" onClick={onToggleRunning} aria-label={running ? 'Pause simulation' : 'Resume simulation'}>
          {running ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
          <span>{running ? 'Pause' : 'Resume'}</span>
        </button>
        <button className="icon-button" type="button" onClick={onToggleTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}>
          {theme === 'light' ? <Moon size={16} aria-hidden="true" /> : <Sun size={16} aria-hidden="true" />}
        </button>
      </div>
    </header>
  )
}
