import { useState, useEffect, useCallback } from 'react'

export interface ToastItem {
  id: string
  type: 'success' | 'error' | 'info' | 'warning'
  message: string
  duration?: number
}

let toastIdCounter = 0
let globalAddToast: ((toast: Omit<ToastItem, 'id'>) => void) | null = null

export function showToast(type: ToastItem['type'], message: string, duration = 4000) {
  if (globalAddToast) {
    globalAddToast({ type, message, duration })
  }
}

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const addToast = useCallback((toast: Omit<ToastItem, 'id'>) => {
    const id = `toast-${++toastIdCounter}`
    setToasts(prev => [...prev, { ...toast, id }])
    const duration = toast.duration ?? 4000
    if (duration > 0) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id))
      }, duration)
    }
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  useEffect(() => {
    globalAddToast = addToast
    return () => { globalAddToast = null }
  }, [addToast])

  return { toasts, addToast, removeToast }
}
