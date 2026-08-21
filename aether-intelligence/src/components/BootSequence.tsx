import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { AetherMark } from './AetherMark'

const BOOT_STEPS = [
  'Mounting shared memory',
  'Calibrating entity resolvers',
  'Connecting 11 source classes',
  'Warming competitive graph',
]

interface BootSequenceProps {
  onComplete: () => void
}

export function BootSequence({ onComplete }: BootSequenceProps) {
  const reduceMotion = useReducedMotion()
  const [progress, setProgress] = useState(8)

  useEffect(() => {
    if (reduceMotion) {
      const timeout = window.setTimeout(onComplete, 320)
      return () => window.clearTimeout(timeout)
    }

    const interval = window.setInterval(() => {
      setProgress((current) => Math.min(100, current + Math.max(2, Math.round((100 - current) * 0.16))))
    }, 95)
    const timeout = window.setTimeout(onComplete, 2_050)
    return () => {
      window.clearInterval(interval)
      window.clearTimeout(timeout)
    }
  }, [onComplete, reduceMotion])

  const stepIndex = Math.min(BOOT_STEPS.length - 1, Math.floor((progress / 101) * BOOT_STEPS.length))

  return (
    <motion.div
      className="boot-screen"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, filter: 'blur(10px)' }}
      transition={{ duration: reduceMotion ? 0 : 0.45 }}
      role="status"
      aria-live="polite"
    >
      <div className="boot-screen__grain" aria-hidden="true" />
      <div className="boot-screen__content">
        <AetherMark />
        <p className="eyebrow-text">AETHER // SYSTEM BOOT</p>
        <h1>Initializing Competitive Intelligence Swarm</h1>
        <div className="boot-screen__track" aria-label={`${progress}% initialized`}>
          <motion.span animate={{ width: `${progress}%` }} transition={{ ease: 'easeOut', duration: 0.14 }} />
        </div>
        <div className="boot-screen__status">
          <AnimatePresence mode="wait">
            <motion.span
              key={stepIndex}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
            >
              {BOOT_STEPS[stepIndex]}
            </motion.span>
          </AnimatePresence>
          <span>{String(progress).padStart(3, '0')}%</span>
        </div>
      </div>
    </motion.div>
  )
}
