import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react'
import type { AetherToast } from '../types'

interface ToastStackProps {
  toasts: AetherToast[]
  onDismiss: (toastId: string) => void
}

export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  const reduceMotion = useReducedMotion()
  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="false">
      <AnimatePresence>
        {toasts.map((toast) => {
          const Icon = toast.tone === 'positive' ? CheckCircle2 : toast.tone === 'warning' ? TriangleAlert : Info
          return (
            <motion.div
              className={`aether-toast aether-toast--${toast.tone}`}
              key={toast.id}
              initial={reduceMotion ? false : { opacity: 0, x: 24, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 18, scale: 0.97 }}
              transition={{ duration: 0.28 }}
            >
              <Icon size={16} aria-hidden="true" />
              <div><strong>{toast.title}</strong><span>{toast.detail}</span></div>
              <button type="button" onClick={() => onDismiss(toast.id)} aria-label={`Dismiss ${toast.title}`}><X size={13} aria-hidden="true" /></button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
